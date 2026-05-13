-- Migration 306: Seer Atlas Phase 3 — daily write cap
--
-- Adds a per-day write counter to seer_atlas_daily_usage (alongside the
-- existing input_tokens / output_tokens / stt_request_count) and a new
-- atomic increment-and-check RPC mirroring the proven
-- seer_atlas_increment_stt_requests pattern.
--
-- Why a separate cap from tokens: the existing token cap protects against
-- runaway COST. A write cap protects against runaway SIDE EFFECTS — a rogue
-- model loop shouldn't be able to file 1000 actions inside the token cap.
--
-- Cap = 30 writes/day. Each successful write tool invocation increments;
-- cap_denied and cancelled outcomes do NOT increment (H1 fix from spec
-- pre-flight reviewer — cap counter only ticks on actual side effects).
--
-- Daily window: midnight UTC, matching existing pattern.

BEGIN;

ALTER TABLE public.seer_atlas_daily_usage
  ADD COLUMN IF NOT EXISTS write_request_count int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.seer_atlas_increment_writes(p_uid uuid)
RETURNS TABLE(write_count_today int, cap_exceeded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_today    date     := (now() AT TIME ZONE 'utc')::date;
  v_cap      CONSTANT int := 30;
  v_existing int;
  v_new      int;
BEGIN
  IF p_uid IS NULL THEN
    RAISE EXCEPTION 'p_uid required';
  END IF;

  -- Check-then-increment under row lock. Never tick on rejected requests.
  SELECT write_request_count INTO v_existing
    FROM public.seer_atlas_daily_usage
   WHERE owner_id = p_uid AND utc_day = v_today
     FOR UPDATE;

  IF v_existing IS NULL THEN
    -- No row for today yet — insert with count=1
    INSERT INTO public.seer_atlas_daily_usage (owner_id, utc_day, write_request_count)
    VALUES (p_uid, v_today, 1)
    ON CONFLICT (owner_id, utc_day) DO UPDATE
      SET write_request_count = public.seer_atlas_daily_usage.write_request_count + 1
    RETURNING write_request_count INTO v_new;
    RETURN QUERY SELECT v_new, false;
    RETURN;
  END IF;

  IF v_existing >= v_cap THEN
    -- Cap hit; return existing count without incrementing.
    RETURN QUERY SELECT v_existing, true;
    RETURN;
  END IF;

  UPDATE public.seer_atlas_daily_usage
     SET write_request_count = write_request_count + 1
   WHERE owner_id = p_uid AND utc_day = v_today
  RETURNING write_request_count INTO v_new;

  RETURN QUERY SELECT v_new, false;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.seer_atlas_increment_writes(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_atlas_increment_writes(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_atlas_increment_writes(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.seer_atlas_increment_writes(uuid) TO service_role;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='seer_atlas_daily_usage'
      AND column_name='write_request_count'
  ) THEN
    RAISE EXCEPTION 'write_request_count column did not get added';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname='seer_atlas_increment_writes'
      AND pronamespace='public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'seer_atlas_increment_writes RPC missing';
  END IF;

  -- Verify service_role has EXECUTE and authenticated does NOT
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE specific_schema='public'
      AND routine_name='seer_atlas_increment_writes'
      AND grantee IN ('authenticated','anon','PUBLIC')
  ) THEN
    RAISE EXCEPTION 'seer_atlas_increment_writes: authenticated/anon must NOT have EXECUTE';
  END IF;
END $verify$;

COMMIT;
