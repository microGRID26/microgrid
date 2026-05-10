-- ─────────────────────────────────────────────────────────────────────────
-- mig 267 · Seer · Phase 2 Feed Sprint 2 — hardening + hourly cron
-- ─────────────────────────────────────────────────────────────────────────
-- Bundles the deferrals from mig 266's R1 audit + the Sprint 2 deck:
--   - REVOKE ALL ON public.seer_feed_sources, seer_feed_items FROM anon,
--     authenticated (defense-in-depth — RLS deny-all already covers reads
--     today, this closes the surface if anyone ever adds a permissive
--     policy without thinking about default privileges)
--   - CHECK constraint on seer_rings_daily.feed_items cardinality (cap at
--     1000 — owner-only, but bounds the ANY-scan + array rewrite cost so
--     the daily row never crosses TOAST in pathological tap-spam)
--   - seer_close_feed_ring now JOINs seer_feed_sources for the category
--     lookup AND enforces enabled=true (R1 LOW: a stale client cache could
--     otherwise tap a since-disabled item's id and still earn axis points)
--   - Two additional Atom sources seeded: Anthropic news (frontier) +
--     Lilian Weng (frontier) — proves multi-source ingest end-to-end
--   - pg_net + supabase_vault extensions enabled (idempotent)
--   - Vault secret `seer_feed_ingest_token` mirrored from edge fn env so
--     the cron job can decrypt-and-bear without storing the token in the
--     cron command (which is visible in cron.job)
--   - Hourly cron `seer-feed-ingest-hourly` invokes the feed-ingest edge
--     function via net.http_post with the decrypted vault token
--
-- POSTURE NOTE (R1 HIGH, risk-accepted): the bearer token below is in
-- plaintext in this migration file (committed to git) AND mirrored to
-- vault. For an owner-only product the blast radius is bounded — anyone
-- who lifts the token can force outbound fetches against the source
-- list. Rotation plan: queue greg_action to rotate post-merge via
-- Management API + vault.update_secret, then redact this file in a
-- follow-up. NOT industry-standard practice, accepted here for the
-- single-tenant single-owner shape. Do NOT carry this pattern into any
-- multi-tenant migration.
--
-- Deferred to Sprint 3:
--   - og:image SSRF allowlist + cache (own session per spec §10 H-5)
--   - magazine masthead + hero pick algorithm (multi-session UI)
--   - fast-xml-parser DoS bounding (parse-side timeout) — handled in the
--     edge fn redeploy that ships with this migration; not SQL surface
--   - Sentry/PostHog wiring for closeFeedRing failures (Sentry not yet
--     installed in Seer)
-- ─────────────────────────────────────────────────────────────────────────

-- ────────────── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ────────────── Defense-in-depth REVOKEs ────────────────────────────────
-- Supabase default-privileges grant anon + authenticated full DML on every
-- new public.* table; RLS deny-all (no policy + RLS on) makes this inert
-- TODAY, but a future migration that adds a permissive policy without
-- thinking about default-privs would unlock writes. Belt-and-braces.
REVOKE ALL ON public.seer_feed_sources FROM anon, authenticated;
REVOKE ALL ON public.seer_feed_items   FROM anon, authenticated;

-- ────────────── feed_items cardinality cap ──────────────────────────────
-- Bound the per-day array growth so seer_close_feed_ring's ANY-scan +
-- array rewrite stays linear. 1000 is far above a realistic owner tap
-- rate (Greg won't tap 1000 distinct feed items in one day) but well
-- below the TOAST-pressure threshold.
ALTER TABLE public.seer_rings_daily
  DROP CONSTRAINT IF EXISTS seer_rings_daily_feed_items_cardinality_check;
ALTER TABLE public.seer_rings_daily
  ADD CONSTRAINT seer_rings_daily_feed_items_cardinality_check
  CHECK (cardinality(feed_items) <= 1000);

-- ────────────── seer_close_feed_ring · enabled=false guard ──────────────
DROP FUNCTION IF EXISTS public.seer_close_feed_ring(uuid);
CREATE OR REPLACE FUNCTION public.seer_close_feed_ring(p_item_id uuid)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );

  -- JOIN sources to enforce enabled=true. A stale client cache could
  -- otherwise tap an item whose source was disabled (e.g. taken down
  -- because it's spammy or compromised) and still earn axis points.
  SELECT i.category
    INTO v_category
    FROM public.seer_feed_items i
    JOIN public.seer_feed_sources s ON s.id = i.source_id
   WHERE i.id = p_item_id
     AND s.enabled = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_or_disabled_feed_item: %', p_item_id USING ERRCODE = '22023';
  END IF;

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
        RAISE WARNING 'seer_close_feed_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_uid, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) TO authenticated;

-- ────────────── New feed sources (multi-source proof) ───────────────────
INSERT INTO public.seer_feed_sources (name, kind, url, category)
VALUES
  ('Anthropic',    'rss',  'https://www.anthropic.com/news/rss.xml',  'frontier'),
  ('Lilian Weng',  'atom', 'https://lilianweng.github.io/index.xml',  'frontier')
ON CONFLICT (url) DO NOTHING;

-- ────────────── Vault secret for the cron-driven ingest ─────────────────
-- Mirror the edge function env var into vault so the cron job can read
-- it without exposing the token in cron.job's command column. Idempotent
-- via the WHERE NOT EXISTS guard — a re-apply doesn't rotate the secret.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'seer_feed_ingest_token') THEN
    PERFORM vault.create_secret(
      '6723a58c46a12008601f27d09c221d2b20c8be13e891c50ebb342a266d0ab3bd',
      'seer_feed_ingest_token',
      'Bearer token for seer feed-ingest edge function (mirrors Functions secret SEER_FEED_INGEST_TOKEN)'
    );
  END IF;
END $$;

-- ────────────── Hourly ingest cron ──────────────────────────────────────
-- Fires at :07 every hour. Reads the bearer token from vault at execution
-- time so cron.job stores the SELECT query, not the token itself.
-- The Supabase gateway requires an `apikey` header on every Edge Function
-- call; the project's publishable (anon) key is the right value there.
-- That key is non-secret (it ships in the Seer mobile bundle), so it's
-- fine to hardcode in the cron command. The actual auth gate inside the
-- function checks Authorization Bearer against the vaulted INGEST_TOKEN.
SELECT cron.schedule(
  'seer-feed-ingest-hourly',
  '7 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://hzymsezqfxzpbcqryeim.supabase.co/functions/v1/feed-ingest',
      headers := jsonb_build_object(
        'apikey', 'sb_publishable_mY0uHkw46TOFM2FmX3Dczw_9xbS1sJD',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'seer_feed_ingest_token'
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);
