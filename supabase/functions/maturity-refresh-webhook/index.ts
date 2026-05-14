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
