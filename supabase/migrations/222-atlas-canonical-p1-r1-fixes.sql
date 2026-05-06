-- 222-atlas-canonical-p1-r1-fixes.sql
-- R1 audit (2026-05-06) fixes for P1 of canonical-reports catalog (mig 221):
--
-- H1: atlas_canonical_verify checked function name only, not signature.
--     Admin could save a draft with function_name='jsonb_each' (or any
--     other (jsonb)-accepting Postgres builtin) and get a "verified"
--     stamp pointing at unrelated data shapes. Fix: require exact arity
--     + arg type (jsonb) match AND atlas_canonical_ prefix.
-- M1: atlas_canonical_save_draft accepted any function_name. Add a
--     DB-level CHECK constraint on the table so the convention is
--     enforced at write time across all paths.
--
-- (R1 M2 — explicit role gate on /api/atlas/canonical/list — fixed in
--  the route file directly; no DB migration needed.)

-- M1: naming-convention CHECK at the table level.
ALTER TABLE public.atlas_canonical_reports
  DROP CONSTRAINT IF EXISTS function_name_naming_convention;
ALTER TABLE public.atlas_canonical_reports
  ADD CONSTRAINT function_name_naming_convention
  CHECK (function_name ~ '^atlas_canonical_[a-z][a-z0-9_]*$');

-- H1: signature check (exact arity + jsonb arg) AND prefix re-check inline
-- so any pre-existing draft that slipped past the table CHECK is rejected
-- at verify time too.
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, integer, jsonb, text[], jsonb, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, integer, jsonb, text[], jsonb, numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.atlas_canonical_verify(
  p_id text, p_verification_method text, p_ground_truth_source text,
  p_expected_row_count integer, p_verified_params jsonb, p_verified_sample_ids text[],
  p_expected_aggregates jsonb DEFAULT NULL, p_drift_tolerance_pct numeric DEFAULT 0
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text;
  v_role text;
  v_function_name text;
  v_jsonb_oid oid := 'jsonb'::regtype::oid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT email, role INTO v_caller_email, v_role FROM public.users WHERE id = v_caller_id;
  IF v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Verifying reports requires admin or super_admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT function_name INTO v_function_name
  FROM public.atlas_canonical_reports WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found: %', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_function_name !~ '^atlas_canonical_[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Function name must match atlas_canonical_<slug> convention: got %', v_function_name
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Hard signature check: function must exist with EXACTLY one jsonb arg.
  -- Blocks "function_name=jsonb_each" attacks and signature-mismatch typos.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_function_name
      AND p.pronargs = 1
      AND p.proargtypes[0] = v_jsonb_oid
  ) THEN
    RAISE EXCEPTION 'Cannot verify: public.%(jsonb) does not exist with the required signature. Apply the report migration first.', v_function_name
      USING ERRCODE = 'undefined_function';
  END IF;

  UPDATE public.atlas_canonical_reports SET
    status = 'verified', verified_at = now(), verified_by = v_caller_email,
    verification_method = p_verification_method,
    ground_truth_source = p_ground_truth_source,
    expected_row_count = p_expected_row_count,
    expected_aggregates = p_expected_aggregates,
    verified_params = p_verified_params,
    verified_sample_ids = p_verified_sample_ids,
    drift_tolerance_pct = p_drift_tolerance_pct,
    draft_sql = NULL, updated_at = now()
  WHERE id = p_id;

  RETURN p_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, integer, jsonb, text[], jsonb, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, integer, jsonb, text[], jsonb, numeric) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, integer, jsonb, text[], jsonb, numeric) TO authenticated;
