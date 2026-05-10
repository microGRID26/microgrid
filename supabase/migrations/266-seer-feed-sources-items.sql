-- ─────────────────────────────────────────────────────────────────────────
-- mig 266 · Seer · Phase 2 Feed Sprint 1 — sources + items + ingest infra
-- ─────────────────────────────────────────────────────────────────────────
-- Per spec §10 Phase 2 + §6.2 feed-category → axis mapping:
--   - seer_feed_sources  (one row per RSS/Atom source, owner-curated)
--   - seer_feed_items    (one row per article ingested; deduped by url_hash)
--   - seer_feed_list(p_limit)  — owner-gated SELECT for mobile Feed tab
--   - seer_close_feed_ring(uuid) — REPLACED with category-aware axis push
--   - 90-day TTL prune cron     — runs after the 9:00 UTC streak reset
--   - Seed: Simon Willison entries-only Atom (frontier)
--
-- RLS: deny-all-direct on both tables (matches mig 263 pattern). Reads go
-- through the SECURITY DEFINER RPC; writes go through the `feed-ingest`
-- edge function with the service-role key (bypasses RLS).
--
-- og:image cache + SSRF allowlist deferred to Sprint 2 per handoff §3.
-- og_image_url ships NULL until then.
-- ─────────────────────────────────────────────────────────────────────────

-- ────────────── seer_feed_sources ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seer_feed_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('rss','atom')),
  url             text NOT NULL UNIQUE,
  category        text NOT NULL CHECK (category IN ('frontier','workflow','tooling','lab')),
  enabled         bool NOT NULL DEFAULT true,
  last_polled_at  timestamptz,
  last_etag       text,
  last_modified   text,
  last_error      text,
  inserted_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seer_feed_sources ENABLE ROW LEVEL SECURITY;

-- ────────────── seer_feed_items ─────────────────────────────────────────
-- url_hash = sha256(url) hex, computed by the ingest edge fn. Cheap dedupe
-- without a large btree on the full URL string.
CREATE TABLE IF NOT EXISTS public.seer_feed_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid NOT NULL REFERENCES public.seer_feed_sources(id) ON DELETE CASCADE,
  url_hash      text NOT NULL UNIQUE,
  url           text NOT NULL,
  title         text NOT NULL,
  summary       text,
  author        text,
  published_at  timestamptz NOT NULL,
  category      text NOT NULL CHECK (category IN ('frontier','workflow','tooling','lab')),
  og_image_url  text,
  inserted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seer_feed_items_published_idx
  ON public.seer_feed_items (published_at DESC);

CREATE INDEX IF NOT EXISTS seer_feed_items_source_published_idx
  ON public.seer_feed_items (source_id, published_at DESC);

ALTER TABLE public.seer_feed_items ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- seer_feed_list — owner-gated list for mobile Feed tab
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.seer_feed_list(int);
CREATE OR REPLACE FUNCTION public.seer_feed_list(p_limit int DEFAULT 50)
RETURNS TABLE (
  id            uuid,
  source_id     uuid,
  source_name   text,
  url           text,
  title         text,
  summary       text,
  author        text,
  published_at  timestamptz,
  category      text,
  og_image_url  text,
  opened_today  bool
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid          uuid;
  v_today        date;
  v_today_items  uuid[];
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();
  v_today := public.seer_today_chicago();

  SELECT feed_items INTO v_today_items
    FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  v_today_items := COALESCE(v_today_items, ARRAY[]::uuid[]);

  RETURN QUERY
  SELECT i.id,
         i.source_id,
         s.name AS source_name,
         i.url,
         i.title,
         i.summary,
         i.author,
         i.published_at,
         i.category,
         i.og_image_url,
         (i.id = ANY (v_today_items)) AS opened_today
    FROM public.seer_feed_items i
    JOIN public.seer_feed_sources s ON s.id = i.source_id
   WHERE s.enabled = true
   ORDER BY i.published_at DESC
   LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_feed_list(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_feed_list(int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_feed_list(int) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- seer_close_feed_ring — REPLACED with category-aware axis push
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1 stub (mig 263) only counted opens. Phase 2 looks up item.category
-- and applies the §6.2 feed-table axis push:
--   frontier → Frontier +3
--   workflow → Workflow +3
--   tooling  → Tooling  +3
--   lab      → Frontier +2 + Tooling +1
--
-- Hardening matches mig 265: per-(user, date) advisory lock at fn entry,
-- per-item dedupe, RAISE on unknown item, REVOKE FROM anon.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.seer_close_feed_ring(uuid);
CREATE OR REPLACE FUNCTION public.seer_close_feed_ring(p_item_id uuid)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid             uuid;
  v_today           date;
  v_category        text;
  v_already_opened  bool := false;
  v_row             public.seer_rings_daily;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'invalid_item_id' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();
  v_today := public.seer_today_chicago();

  -- Race fix matching mig 265 read/quiz pattern. Two parallel taps on the
  -- same item could both observe v_already_opened=false before either upsert
  -- commits, double-firing the axis push and double-counting feed_opened.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );

  -- Lookup item category. RAISE if missing — closes the surface where a
  -- fabricated UUID could otherwise bump feed_opened toward ring close
  -- without ever opening a real article.
  SELECT category INTO v_category
    FROM public.seer_feed_items
   WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_feed_item: %', p_item_id USING ERRCODE = '22023';
  END IF;

  -- Capture pre-upsert dedupe state (NULL → false for never-touched day).
  SELECT (p_item_id = ANY (feed_items)) INTO v_already_opened
    FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  v_already_opened := COALESCE(v_already_opened, false);

  INSERT INTO public.seer_rings_daily (user_id, date, feed_opened, feed_items)
  VALUES (v_uid, v_today, 1, ARRAY[p_item_id])
  ON CONFLICT (user_id, date) DO UPDATE
    SET feed_opened = CASE
          WHEN p_item_id = ANY (public.seer_rings_daily.feed_items)
            THEN public.seer_rings_daily.feed_opened
          ELSE public.seer_rings_daily.feed_opened + 1
        END,
        feed_items = CASE
          WHEN p_item_id = ANY (public.seer_rings_daily.feed_items)
            THEN public.seer_rings_daily.feed_items
          ELSE array_append(public.seer_rings_daily.feed_items, p_item_id)
        END,
        updated_at = now()
  RETURNING * INTO v_row;

  -- Axis push only on FIRST per-item open today.
  IF NOT v_already_opened THEN
    CASE v_category
      WHEN 'frontier' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Frontier', 3, 'feed:'||p_item_id::text);
      WHEN 'workflow' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 3, 'feed:'||p_item_id::text);
      WHEN 'tooling' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 3, 'feed:'||p_item_id::text);
      WHEN 'lab' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Frontier', 2, 'feed:'||p_item_id::text);
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 1, 'feed:'||p_item_id::text);
      ELSE
        -- Drift fix matching mig 265: unknown category warns + continues
        -- (CHECK constraint should make this unreachable, belt-and-braces).
        RAISE WARNING 'seer_close_feed_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_uid, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 90-day TTL prune (cron) — runs at 9:23 UTC daily, after the 9:00 UTC
-- streak reset (mig 264). Keeps seer_feed_items bounded.
-- ─────────────────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'seer-feed-prune-daily',
  '23 9 * * *',
  $$DELETE FROM public.seer_feed_items WHERE published_at < now() - interval '90 days'$$
);

-- ─────────────────────────────────────────────────────────────────────────
-- Seed: Simon Willison entries-only Atom feed (frontier).
-- One source for Sprint 1; Karpathy + others added in Sprint 2 multi-source.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.seer_feed_sources (name, kind, url, category)
VALUES (
  'Simon Willison',
  'atom',
  'https://simonwillison.net/atom/entries/',
  'frontier'
)
ON CONFLICT (url) DO NOTHING;
