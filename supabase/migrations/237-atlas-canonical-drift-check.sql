-- 237-atlas-canonical-drift-check.sql
--
-- P4 of ~/.claude/plans/twinkly-jumping-thimble.md.
--
-- Daily drift cron needs to replay each verified canonical report under the
-- same row-visibility the verifier saw. The user-facing wrapper
-- atlas_run_canonical_report requires auth.uid() + a manager+ role; the
-- cron runs with the service-role key and has neither. This RPC is the
-- service-role-only counterpart: it replays the report's underlying
-- function with the snapshot verified_params and returns rows + the full
-- verification metadata. ALL drift comparison logic lives in TypeScript
-- (lib/atlas/drift-check.ts) so jsonb-shaped expected_aggregates can be
-- diffed without plpgsql gymnastics.
--
-- Why service_role-only: this RPC bypasses the role-gate that protects
-- atlas_run_canonical_report. Granting it to authenticated would let any
-- logged-in user replay a report ignoring their role — a privilege
-- escalation for the data-query path. service_role can already run
-- arbitrary SQL via PostgREST so the grant is a no-op for that role.

CREATE OR REPLACE FUNCTION public.atlas_canonical_drift_run(p_report_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report      RECORD;
  v_rows        jsonb;
  v_started_at  timestamptz := clock_timestamp();
  v_error       text;
BEGIN
  SELECT *
    INTO v_report
    FROM public.atlas_canonical_reports
    WHERE id = p_report_id AND status = 'verified';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No verified report with id=%', p_report_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Defense-in-depth: function_name is already CHECK'd to match
  -- ^atlas_canonical_[a-z][a-z0-9_]*$ at insert/update time, but re-validate
  -- here so a future schema change can't bypass the format gate without
  -- also updating this RPC.
  IF v_report.function_name !~ '^atlas_canonical_[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'function_name fails naming convention: %', v_report.function_name
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('statement_timeout', '15000', true);

  BEGIN
    EXECUTE format('SELECT to_jsonb(array_agg(t)) FROM %I($1) t', v_report.function_name)
      INTO v_rows
      USING COALESCE(v_report.verified_params, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  v_rows := COALESCE(v_rows, '[]'::jsonb);

  RETURN jsonb_build_object(
    'report_id',           v_report.id,
    'function_name',       v_report.function_name,
    'verified_params',     COALESCE(v_report.verified_params, '{}'::jsonb),
    'expected_row_count',  v_report.expected_row_count,
    'expected_aggregates', v_report.expected_aggregates,
    'verified_sample_ids', v_report.verified_sample_ids,
    'drift_tolerance_pct', v_report.drift_tolerance_pct,
    'verified_at',         v_report.verified_at,
    'verified_by',         v_report.verified_by,
    'executed_at',         v_started_at,
    'duration_ms',         (extract(epoch FROM clock_timestamp() - v_started_at) * 1000)::int,
    'rows',                v_rows,
    'error',               v_error
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_drift_run(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_drift_run(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_drift_run(text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_drift_run(text) TO service_role;
