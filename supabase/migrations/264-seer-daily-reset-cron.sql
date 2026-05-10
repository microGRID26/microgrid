-- ─────────────────────────────────────────────────────────────────────────
-- mig 264 · Seer · Phase 1 — daily reset cron
-- ─────────────────────────────────────────────────────────────────────────
-- Per spec §10 Phase 1 step "Daily reset job (cron — 4am Central via
-- Supabase Edge Function)". Implemented via pg_cron rather than a Deno
-- edge function — same intent (scheduled task), simpler ops surface, no
-- service-role JWT to manage. Spec is silent on the implementation
-- mechanism beyond "scheduled".
--
-- What it resets:
--   - Streaks for users whose last_perfect_day < today_chicago - 1 (i.e.
--     they missed yesterday). current_streak ← 0; longest_streak preserved.
--
-- What it does NOT reset:
--   - seer_rings_daily — per-day rows; today's row is auto-created lazily
--     by seer_get_today_rings() on first read.
--   - seer_radar_state — decay is computed at read time per §6.3, no
--     mutation needed (idempotent).
--
-- Schedule: 9 UTC daily.
--   - DST (CDT, mid-Mar to early-Nov): 9 UTC = 4am CDT  ✓ exactly spec
--   - non-DST (CST, winter):           9 UTC = 3am CST  (1h early; still
--     dead-of-night, single-user app, acceptable)
-- ─────────────────────────────────────────────────────────────────────────

-- Enable pg_cron (Supabase-supported extension, available 1.6.4)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;

-- ──────────── seer_daily_reset (idempotent) ─────────────────────────────
-- SECURITY DEFINER + revoke from PUBLIC/authenticated/anon. Only callable
-- by postgres role (which is what pg_cron runs as).
CREATE OR REPLACE FUNCTION public.seer_daily_reset()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_today          date;
  v_broken_streaks int;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Chicago')::date;

  -- Break streaks for users who missed yesterday.
  UPDATE public.seer_streak
     SET current_streak = 0,
         updated_at = now()
   WHERE current_streak > 0
     AND (last_perfect_day IS NULL OR last_perfect_day < v_today - 1);
  GET DIAGNOSTICS v_broken_streaks = ROW_COUNT;

  RETURN jsonb_build_object(
    'ran_at',         now(),
    'today_chicago',  v_today,
    'streaks_broken', v_broken_streaks
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_daily_reset() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_daily_reset() FROM authenticated, anon;
-- pg_cron itself runs the job as the postgres role (function-owner) so
-- it bypasses ACL via SECURITY DEFINER. Explicit grant to service_role
-- so MCP / monitoring tooling can invoke it manually for smoke tests.
GRANT  EXECUTE ON FUNCTION public.seer_daily_reset() TO service_role;

-- ──────────── pg_cron schedule ──────────────────────────────────────────
-- Idempotent — unschedule if it already exists, then re-schedule.
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'seer-daily-reset';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'seer-daily-reset',
    '0 9 * * *',                          -- 9 UTC daily
    'SELECT public.seer_daily_reset();'
  );
END$$;
