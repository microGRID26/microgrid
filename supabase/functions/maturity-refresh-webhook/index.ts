// maturity-refresh-webhook — receive a GitHub `push` webhook from a work
// repo, verify the HMAC, dedupe via GitHub's delivery-id, and insert a row
// into atlas_maturity_refresh_queue with target_slug set so the watcher's
// collector run is scoped to just the touched project.
//
// Wire format (GitHub):
//   POST /functions/v1/maturity-refresh-webhook
//   Headers:
//     X-Hub-Signature-256: sha256=<hex>
//     X-GitHub-Event: push
//     X-GitHub-Delivery: <uuid>   — used for replay-safe dedupe
//     Content-Type: application/json
//   Body: GitHub push event JSON (we only read repository.full_name).
//
// Secret: MATURITY_WEBHOOK_GITHUB_SECRET (Supabase function secret). Same
// secret across all 5 repos — owner-controlled, per-repo isolation buys
// nothing.
//
// Replay defense (R1 H-1): GitHub's delivery-id is unique per attempt
// (re-deliveries reuse the same id, brand new pushes get new ids). We
// INSERT into atlas_maturity_webhook_deliveries with a PK constraint. The
// `ON CONFLICT DO NOTHING` semantics mean: same delivery-id replayed by
// an attacker who captured the signed body → conflict, no enqueue.
//
// Dedupe race defense (R1 H-2): same delivery-id table also serializes
// concurrent first-attempt deliveries from the same push storm via the
// PK uniqueness.
//
// Auth model: verify_jwt=false (GitHub doesn't carry a Supabase JWT).
// HMAC IS the auth.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SLUG_MAP: Record<string, string> = {
  "microgrid26/microgrid": "microgrid",
  "microgrid26/edge":      "edge",
  "microgrid26/spark":     "spark",
  "microgrid26/atlas-hq":  "atlas-hq",
  "microgrid26/sentinel":  "sentinel",
};

const MAX_BODY_BYTES = 1_000_000; // 1MB — GitHub payloads cap at 25MB by default but our event shape is <10KB; tight ceiling.

// R1 M-1 mitigation (v3) — per-slug enqueue collapse. A captured-HMAC adversary
// (or a misconfigured re-push loop) gets a fresh delivery-id every push, so the
// PK-based replay defense doesn't gate them. Instead: if a refresh request for
// this slug is already pending OR was completed in the last RATELIMIT_WINDOW_S,
// short-circuit with `collapsed:true`. The watcher will get to the existing
// row; one collector run per push burst is the only useful outcome anyway.
//
// v3 R1 H-1 fix: bound the unclaimed-row branch by UNCLAIMED_GRACE_SECONDS
// so a stalled watcher can't permanently suppress all future webhooks for a
// slug. A row older than the grace window is treated as orphaned for
// collapse purposes (the watcher's own claim path still owns it).
//
// v3 R1 M-2 tradeoff: 60s collapse window means a fast push-amend-push dev
// loop merges its second push into the first refresh. Documented and
// accepted; the alternative (no collapse) lets a captured-HMAC adversary
// flood the queue with one POST/sec of fresh-delivery-id pushes.
const RATELIMIT_WINDOW_SECONDS = 60;
const UNCLAIMED_GRACE_SECONDS = 300; // 5x collapse window — past this the row is presumed orphaned.

const URL_ENV         = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY_ENV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SECRET_ENV      = Deno.env.get("MATURITY_WEBHOOK_GITHUB_SECRET");

function errJson(status: number, code: string): Response {
  // R1 M-2/M-3 fix — codes are static strings; attacker-controlled bytes
  // (repo full_name, event header) are NEVER reflected back. They go to
  // console.error for owner-side log inspection.
  return new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okJson(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...payload }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function verifyHmac(secret: string, body: string, sigHeader: string): Promise<boolean> {
  if (!sigHeader.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = "sha256=" + Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== sigHeader.length) return false;
  let r = 0;
  for (let i = 0; i < expected.length; i++) {
    r |= expected.charCodeAt(i) ^ sigHeader.charCodeAt(i);
  }
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errJson(405, "method_not_allowed");

  if (!SECRET_ENV || !URL_ENV || !SERVICE_KEY_ENV) {
    console.error("env_missing", {
      secret: !!SECRET_ENV, url: !!URL_ENV, service: !!SERVICE_KEY_ENV,
    });
    return errJson(500, "server_misconfigured");
  }

  // R1 L-1 fix — cheap body-size ceiling before reading + HMACing.
  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return errJson(413, "body_too_large");
  }

  const sig = req.headers.get("x-hub-signature-256");
  if (!sig) return errJson(401, "missing_signature");

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return errJson(413, "body_too_large");
  }

  // R1 M-3 fix — HMAC verify BEFORE the event-allowlist check so an
  // unauthenticated POST can't get the event header reflected.
  const valid = await verifyHmac(SECRET_ENV, body, sig);
  if (!valid) return errJson(401, "invalid_signature");

  const event = req.headers.get("x-github-event");
  if (event !== "push" && event !== "ping") {
    console.error("ignored_event", { event });
    return errJson(202, "ignored_event");
  }

  if (event === "ping") {
    return okJson({ pong: true });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return errJson(400, "invalid_json");
  }

  const repoFullName = (payload.repository as Record<string, unknown> | undefined)?.full_name as string | undefined;
  if (!repoFullName) return errJson(400, "missing_repository_full_name");

  // R1 L-3 — lowercase both sides for case-insensitive lookup (defensive
  // against org/repo rename to a different casing).
  const slug = SLUG_MAP[repoFullName.toLowerCase()];
  if (!slug) {
    console.error("unknown_repo", { repo: repoFullName });
    return errJson(400, "unknown_repo");
  }

  const deliveryId = req.headers.get("x-github-delivery");
  if (!deliveryId) return errJson(400, "missing_delivery_id");

  const supabase = createClient(URL_ENV, SERVICE_KEY_ENV, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // R1 H-1 + H-2 fix — replay-safe + race-safe dedupe via PK conflict.
  // Same delivery-id (replay) or two concurrent first-attempts of the
  // same id (race) → only the winner enqueues; loser short-circuits.
  const { error: deliveryInsErr } = await supabase
    .from("atlas_maturity_webhook_deliveries")
    .insert({
      delivery_id: deliveryId,
      source:      `github:${repoFullName}`,
      target_slug: slug,
    });

  if (deliveryInsErr) {
    // Postgres unique-violation = SQLSTATE 23505 (PostgREST surfaces this
    // via .code === "23505"). Any other DB error is a real failure.
    if ((deliveryInsErr as { code?: string }).code === "23505") {
      return okJson({ slug, replay: true });
    }
    console.error("delivery_insert_failed", deliveryInsErr);
    return errJson(500, "delivery_insert_failed");
  }

  // Per-slug enqueue collapse — check for a fresh-unclaimed row OR a
  // recently-completed run for this slug. If either exists, skip insert.
  // The check is racy by design — worst case two concurrent first-attempts
  // both enqueue, which the watcher's claim contention resolves to one run.
  //
  // R1 H-1 fix: the unclaimed branch is age-bounded by UNCLAIMED_GRACE so
  // a stalled watcher can't permanently suppress webhooks for a slug.
  // R1 H-2 fix: lookup errors fall through to insert (open-fail) — collapse
  // is an optimization, not a safety gate; GitHub retry with the same
  // delivery-id would otherwise hit the PK replay gate and lose the push.
  // R1 L-1 fix: select only id; the row contents aren't read.
  const sinceIso        = new Date(Date.now() - RATELIMIT_WINDOW_SECONDS * 1000).toISOString();
  const unclaimedSinceIso = new Date(Date.now() - UNCLAIMED_GRACE_SECONDS * 1000).toISOString();
  const { data: existingRows, error: lookupErr } = await supabase
    .from("atlas_maturity_refresh_queue")
    .select("id")
    .eq("target_slug", slug)
    .or(`and(claimed_at.is.null,requested_at.gte.${unclaimedSinceIso}),completed_at.gte.${sinceIso}`)
    .limit(1);
  if (lookupErr) {
    console.error("queue_lookup_failed_openfail", lookupErr);
    // fall through — better double-enqueue than drop-push.
  } else if (existingRows && existingRows.length > 0) {
    return okJson({ slug, collapsed: true });
  }

  const { error: insErr } = await supabase
    .from("atlas_maturity_refresh_queue")
    .insert({
      requested_by: `github:${repoFullName}`,
      target_slug:  slug,
    });
  if (insErr) {
    console.error("queue_insert_failed", insErr);
    return errJson(500, "queue_insert_failed");
  }

  return okJson({ slug, enqueued: true });
});
