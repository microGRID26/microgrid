-- Migration 160 — R1 fixes for migrations 158+159:
-- H2: rate-limit TOCTOU race. Two concurrent inserts could both pass the 19-row
--     check at READ COMMITTED. Fix: pg_advisory_xact_lock at trigger entry so
--     both keyed checks (per-uid 60s + global 20/min) serialize cleanly inside
--     the per-table bucket. Cheap: only serializes the rate-limit check, the
--     insert itself proceeds concurrently after.
-- H4: defense-in-depth. RLS enforces submitter_uid = auth.uid(), but the trigger
--     ran without re-checking. If RLS were ever loosened, the trigger wouldn't
--     catch a forwarded-user attack. Add the assertion.

CREATE OR REPLACE FUNCTION public.spoke_feedback_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'spoke_feedback: authentication required' USING ERRCODE = '42501';
  END IF;
  IF NEW.submitter_uid IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'spoke_feedback: submitter_uid must equal auth.uid()' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('spoke_feedback_rate_limit'));
  IF EXISTS (
    SELECT 1 FROM public.spoke_feedback sf
    WHERE sf.submitter_uid = v_uid
      AND sf.created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'spoke_feedback: rate limit (60s/uid) exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF (
    SELECT count(*) FROM public.spoke_feedback sf
    WHERE sf.created_at > now() - interval '60 seconds'
  ) >= 20 THEN
    RAISE EXCEPTION 'spoke_feedback: global rate limit (20/min) exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.bread_of_life_feedback_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bread_of_life_feedback: authentication required' USING ERRCODE = '42501';
  END IF;
  IF NEW.submitter_uid IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'bread_of_life_feedback: submitter_uid must equal auth.uid()' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('bread_of_life_feedback_rate_limit'));
  IF EXISTS (
    SELECT 1 FROM public.bread_of_life_feedback b
    WHERE b.submitter_uid = v_uid
      AND b.created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'bread_of_life_feedback: rate limit (60s/uid) exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF (
    SELECT count(*) FROM public.bread_of_life_feedback b
    WHERE b.created_at > now() - interval '60 seconds'
  ) >= 20 THEN
    RAISE EXCEPTION 'bread_of_life_feedback: global rate limit (20/min) exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.spoke_feedback_rate_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spoke_feedback_rate_limit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.spoke_feedback_rate_limit() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.bread_of_life_feedback_rate_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bread_of_life_feedback_rate_limit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bread_of_life_feedback_rate_limit() FROM authenticated;
