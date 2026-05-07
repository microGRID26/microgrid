-- 238-atlas-canonical-record-drift-check.sql
--
-- R1 audit MED-1 fix for the canonical-reports drift cron (mig 237).
--
-- 230's invariant is "no direct writes to atlas_canonical_reports — all
-- mutations go through SECURITY DEFINER RPCs" (the table has FORCE RLS +
-- WITH CHECK (false) on authenticated, and bypassing that under service-
-- role from a route handler erodes the architectural promise). This RPC
-- gives the drift cron a SECURITY DEFINER channel parallel to save_draft
-- / verify / deprecate.
--
-- Caveat: the BEFORE UPDATE trigger atlas_canonical_reports_touch bumps
-- updated_at unconditionally, so cron writes still bump updated_at —
-- meaning that column's "last admin edit" semantic is eroded. We use
-- last_drift_check_at as the canonical "last cron touched" column so the
-- noise is discoverable. A future migration should make the touch trigger
-- skip when only last_drift_check_* changed.

CREATE OR REPLACE FUNCTION public.atlas_canonical_record_drift_check(
  p_report_id text,
  p_passed    boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.atlas_canonical_reports
     SET last_drift_check_at = now(),
         last_drift_check_passed = p_passed
   WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found: %', p_report_id USING ERRCODE = 'no_data_found';
  END IF;

  RETURN p_report_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_record_drift_check(text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_record_drift_check(text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_record_drift_check(text, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_record_drift_check(text, boolean) TO service_role;
