// supabase/functions/feed-ingest — Seer · Phase 2 Sprint 1
//
// Pulls each enabled row from public.seer_feed_sources, fetches the feed
// (HTTPS only, 10s timeout, 5MB cap, content-type guard), parses Atom or
// RSS, and bulk-upserts entries into public.seer_feed_items dedup-by-
// url_hash. Updates the source's last_polled_at + last_etag + last_modified
// on success or last_error on failure (per-source isolated — one bad source
// doesn't block the others).
//
// Auth: callable only with the service-role key in Authorization. Cron
// (pg_net) or Greg's local terminal are the only intended callers.
//
// Sprint 2 will fold in og:image hardening (SSRF allowlist by IP, image/*
// content-type guard) — for now og_image_url ships NULL.
//
// Tunables: MAX_ENTRIES_PER_FETCH caps how many entries the parser will
// return per source per run, defending against a hostile / runaway feed.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { XMLParser } from "npm:fast-xml-parser@4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Shared-secret bearer for the ingest endpoint. Set via Supabase dashboard
// → Edge Functions → Secrets. Without this, the function is open to anyone
// holding the project's anon key (shipped in the Seer mobile bundle), which
// is an outbound-fetch DoS amplifier.
const INGEST_TOKEN = Deno.env.get("SEER_FEED_INGEST_TOKEN") ?? "";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES_PER_FETCH = 200;
const TITLE_MAX = 500;
const SUMMARY_MAX = 600;
const AUTHOR_MAX = 200;
const URL_MAX = 2000;

type FeedEntry = {
  url: string;
  title: string;
  summary: string | null;
  author: string | null;
  published_at: string;
};

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function safeIso(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

async function fetchFeed(
  url: string,
  etag: string | null,
  lastModified: string | null,
): Promise<
  | { unchanged: true }
  | { unchanged: false; body: string; etag: string | null; lastModified: string | null }
> {
  const u = new URL(url);
  if (u.protocol !== "https:") {
    throw new Error(`refusing non-https feed url: ${u.protocol}`);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "User-Agent": "SeerFeedIngest/1.0 (+https://seer.atlas)",
      "Accept":
        "application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
    };
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const res = await fetch(url, {
      headers,
      signal: ctl.signal,
      redirect: "follow",
    });
    if (res.status === 304) return { unchanged: true };
    if (!res.ok) throw new Error(`http ${res.status}`);

    const ctype = res.headers.get("content-type") ?? "";
    if (!/xml|rss|atom/i.test(ctype)) {
      throw new Error(`unexpected content-type: ${ctype}`);
    }

    const cl = res.headers.get("content-length");
    if (cl && Number(cl) > MAX_BYTES) {
      throw new Error(`content-length ${cl} exceeds cap ${MAX_BYTES}`);
    }

    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error(`stream exceeded cap ${MAX_BYTES}`);
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    const body = new TextDecoder().decode(merged);

    return {
      unchanged: false,
      body,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseFeed(xml: string): FeedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    // Skip entity expansion entirely. Atom/RSS bodies can carry hundreds of
    // &amp;/&lt;/etc. inside HTML-encoded content; the parser's default 1000-
    // entity ceiling trips on Simon Willison's feed (1254 entities). We
    // strip HTML tags downstream anyway, so preserving entities raw is fine.
    processEntities: false,
    isArray: (name: string) =>
      name === "entry" || name === "item" || name === "link",
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const entries: FeedEntry[] = [];

  const pushEntry = (
    rawUrl: unknown,
    rawTitle: unknown,
    rawSummary: unknown,
    rawAuthor: unknown,
    rawPublished: unknown,
  ) => {
    if (entries.length >= MAX_ENTRIES_PER_FETCH) return;
    if (typeof rawUrl !== "string") return;
    // Decode entities BEFORE protocol check so `&amp;` in query strings
    // round-trips correctly (R1 MEDIUM #4) and so a `&#x68;ttps:` style
    // bypass can't sneak past `startsWith("http")` (R1 HIGH #2 / LOW #1).
    const url = decodeEntities(rawUrl).trim();
    if (!url || url.length > URL_MAX) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:") return;

    const title = typeof rawTitle === "string"
      ? rawTitle
      : (rawTitle as { "#text"?: string })?.["#text"] ?? "";
    const t = stripTags(String(title));
    if (!t) return;

    const published = safeIso(rawPublished);
    if (!published) return;

    let summaryRaw = "";
    if (typeof rawSummary === "string") {
      summaryRaw = rawSummary;
    } else if (rawSummary && typeof rawSummary === "object") {
      summaryRaw = (rawSummary as { "#text"?: string })["#text"] ?? "";
    }
    const summary = summaryRaw ? stripTags(summaryRaw) : null;

    let authorRaw = "";
    if (typeof rawAuthor === "string") {
      authorRaw = rawAuthor;
    } else if (rawAuthor && typeof rawAuthor === "object") {
      const a = rawAuthor as { name?: unknown; "#text"?: string };
      authorRaw = typeof a.name === "string" ? a.name : (a["#text"] ?? "");
    }
    const author = authorRaw ? decodeEntities(authorRaw).trim() : null;

    entries.push({
      url,
      title: clip(t, TITLE_MAX),
      summary: summary ? clip(summary, SUMMARY_MAX) : null,
      author: author ? clip(author, AUTHOR_MAX) : null,
      published_at: published,
    });
  };

  // Atom
  const feed = doc.feed as { entry?: unknown[] } | undefined;
  if (feed?.entry) {
    for (const e of feed.entry as Record<string, unknown>[]) {
      const linksField = e.link as unknown;
      const links = Array.isArray(linksField) ? linksField : [linksField];
      const link = links
        .map((l) =>
          l && typeof l === "object"
            ? (l as Record<string, string>)
            : null
        )
        .find((l) => l && (!l["@_rel"] || l["@_rel"] === "alternate"))?.["@_href"];
      const fallbackText = typeof linksField === "string" ? linksField : null;
      pushEntry(
        link ?? fallbackText,
        e.title,
        e.summary ?? e.content,
        e.author,
        e.published ?? e.updated,
      );
    }
  }

  // RSS 2.0
  const rss = doc.rss as { channel?: { item?: unknown } } | undefined;
  const rssItems = rss?.channel?.item;
  if (rssItems) {
    const items = Array.isArray(rssItems) ? rssItems : [rssItems];
    for (const e of items as Record<string, unknown>[]) {
      const link = typeof e.link === "string" ? e.link : null;
      pushEntry(
        link,
        e.title,
        e.description,
        e.author ?? e["dc:creator"],
        e.pubDate ?? e["dc:date"],
      );
    }
  }

  return entries;
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  // Shared-secret bearer auth. The Supabase project's anon key is shipped
  // in the Seer mobile bundle and trivially extractable; relying on it
  // alone leaves the endpoint open to outbound-fetch amplification (R1
  // HIGH #1). SEER_FEED_INGEST_TOKEN must be set in Edge Function secrets.
  if (!INGEST_TOKEN) {
    return new Response("ingest token not configured", { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${INGEST_TOKEN}`) {
    return new Response("forbidden", { status: 403 });
  }

  const { data: sources, error: srcErr } = await supabase
    .from("seer_feed_sources")
    .select("id, kind, url, category, last_etag, last_modified")
    .eq("enabled", true);
  if (srcErr) {
    return new Response(JSON.stringify({ error: srcErr.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const summary: Array<Record<string, unknown>> = [];

  for (const src of sources ?? []) {
    try {
      const r = await fetchFeed(src.url, src.last_etag, src.last_modified);
      if (r.unchanged) {
        await supabase
          .from("seer_feed_sources")
          .update({
            last_polled_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", src.id);
        summary.push({ source: src.url, unchanged: true });
        continue;
      }

      const entries = parseFeed(r.body);

      const records = await Promise.all(
        entries.map(async (e) => ({
          source_id: src.id,
          url_hash: await sha256Hex(e.url),
          url: e.url,
          title: e.title,
          summary: e.summary,
          author: e.author,
          published_at: e.published_at,
          category: src.category,
        })),
      );

      let inserted = 0;
      if (records.length > 0) {
        const { data: ins, error: insErr } = await supabase
          .from("seer_feed_items")
          .upsert(records, {
            onConflict: "url_hash",
            ignoreDuplicates: true,
          })
          .select("id");
        if (insErr) throw insErr;
        inserted = ins?.length ?? 0;
      }

      await supabase
        .from("seer_feed_sources")
        .update({
          last_polled_at: new Date().toISOString(),
          last_etag: r.etag,
          last_modified: r.lastModified,
          last_error: null,
        })
        .eq("id", src.id);

      summary.push({
        source: src.url,
        parsed: entries.length,
        inserted,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("seer_feed_sources")
        .update({
          last_polled_at: new Date().toISOString(),
          last_error: msg.slice(0, 500),
        })
        .eq("id", src.id);
      summary.push({ source: src.url, error: msg });
    }
  }

  return new Response(JSON.stringify({ ok: true, summary }), {
    headers: { "content-type": "application/json" },
  });
});
