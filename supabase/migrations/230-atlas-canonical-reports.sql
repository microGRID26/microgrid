-- 230-atlas-canonical-reports.sql
--
-- Re-stage of the canonical-reports catalog (P1 of
-- ~/.claude/plans/twinkly-jumping-thimble.md). The original P1 shipped to
-- prod via MCP apply_migration during session atlas-canonical-reports-p1
-- (2026-05-06) but its file representation was lost in PR #9's squash-merge
-- (the P1 commit a677037 stayed on the dead branch). This migration is
-- idempotent — re-applying matches the prod state byte-for-byte.
--
-- Stops Atlas from generating LLM-improvised SQL and instead routes user
-- questions to hand-written, NetSuite-verified report functions. Each
-- canonical report function takes a single jsonb param and returns rows.
-- The wrapper RPC dispatches dynamically via EXECUTE format(%I).
--
-- Original P1 was shipped as 221+222 (where 222 was R1-audit fixes for H1
-- signature check + M1 naming-convention CHECK). They are folded together
-- here so the final-state file is the single source of truth.

-- ---------------------------------------------------------------------------
-- 1. Catalog table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlas_canonical_reports (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,

  example_questions text[] NOT NULL DEFAULT ARRAY[]::text[],
  parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_columns jsonb NOT NULL DEFAULT '[]'::jsonb,

  function_name text NOT NULL,

  verified_at timestamptz,
  verified_by text,
  verification_method text CHECK (
    verification_method IS NULL OR
    verification_method IN ('netsuite_saved_search','manual_count','consensus_with_heidi','spot_check_of_5_rows')
  ),
  ground_truth_source text,
  expected_row_count int,
  expected_aggregates jsonb,
  verified_params jsonb,
  verified_sample_ids text[],
  drift_tolerance_pct numeric NOT NULL DEFAULT 0,
  last_drift_check_at timestamptz,
  last_drift_check_passed boolean,

  status text NOT NULL DEFAULT 'draft',
  owner text NOT NULL,
  version int NOT NULL DEFAULT 1,

  draft_sql text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_id_format CHECK (id ~ '^[a-z][a-z0-9_]+$'),
  CONSTRAINT category_valid CHECK (category IN ('sales','pipeline','install','finance','commission','ops')),
  CONSTRAINT status_valid CHECK (status IN ('draft','verified','deprecated')),
  CONSTRAINT verified_has_metadata CHECK (
    status <> 'verified' OR (
      verified_at IS NOT NULL AND
      verified_by IS NOT NULL AND
      ground_truth_source IS NOT NULL AND
      expected_row_count IS NOT NULL AND
      verification_method IS NOT NULL
    )
  )
);

-- Naming-convention CHECK (R1 audit M1 fix from original 222).
ALTER TABLE public.atlas_canonical_reports
  DROP CONSTRAINT IF EXISTS function_name_naming_convention;
ALTER TABLE public.atlas_canonical_reports
  ADD CONSTRAINT function_name_naming_convention
  CHECK (function_name ~ '^atlas_canonical_[a-z][a-z0-9_]*$');

CREATE INDEX IF NOT EXISTS idx_atlas_canonical_reports_status ON public.atlas_canonical_reports(status);
CREATE INDEX IF NOT EXISTS idx_atlas_canonical_reports_category ON public.atlas_canonical_reports(category);

CREATE OR REPLACE FUNCTION public.atlas_canonical_reports_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS atlas_canonical_reports_touch ON public.atlas_canonical_reports;
CREATE TRIGGER atlas_canonical_reports_touch
  BEFORE UPDATE ON public.atlas_canonical_reports
  FOR EACH ROW EXECUTE FUNCTION public.atlas_canonical_reports_touch_updated_at();

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_reports_touch_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_reports_touch_updated_at() FROM anon;

ALTER TABLE public.atlas_canonical_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_canonical_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atlas_canonical_reports_admin_read ON public.atlas_canonical_reports;
CREATE POLICY atlas_canonical_reports_admin_read ON public.atlas_canonical_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND (u.role IN ('admin','super_admin') OR u.email = 'hhildreth@gomicrogridenergy.com')
    )
  );

DROP POLICY IF EXISTS atlas_canonical_reports_verified_read ON public.atlas_canonical_reports;
CREATE POLICY atlas_canonical_reports_verified_read ON public.atlas_canonical_reports
  FOR SELECT TO authenticated
  USING (
    status = 'verified' AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.role IN ('manager','team_leader','admin','super_admin')
    )
  );

DROP POLICY IF EXISTS atlas_canonical_reports_no_direct_write ON public.atlas_canonical_reports;
CREATE POLICY atlas_canonical_reports_no_direct_write ON public.atlas_canonical_reports
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 2. Run log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlas_canonical_run_log (
  id BIGSERIAL PRIMARY KEY,
  user_id uuid,
  user_email text,
  user_role text,
  question text,
  report_id text REFERENCES public.atlas_canonical_reports(id) ON DELETE SET NULL,
  params jsonb,
  row_count int,
  truncated boolean DEFAULT false,
  error text,
  drift_detected boolean DEFAULT false,
  duration_ms int,
  page_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atlas_canonical_run_log_created ON public.atlas_canonical_run_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_canonical_run_log_user ON public.atlas_canonical_run_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_canonical_run_log_report ON public.atlas_canonical_run_log(report_id, created_at DESC);

ALTER TABLE public.atlas_canonical_run_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_canonical_run_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atlas_canonical_run_log_admin_read ON public.atlas_canonical_run_log;
CREATE POLICY atlas_canonical_run_log_admin_read ON public.atlas_canonical_run_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','super_admin'))
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS atlas_canonical_run_log_no_direct_write ON public.atlas_canonical_run_log;
CREATE POLICY atlas_canonical_run_log_no_direct_write ON public.atlas_canonical_run_log
  FOR INSERT TO authenticated WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 3. Router catalog RPC — what the LLM router sees
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atlas_router_catalog()
RETURNS TABLE(
  id text,
  name text,
  description text,
  category text,
  example_questions text[],
  parameter_schema jsonb,
  result_columns jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.name, r.description, r.category,
         r.example_questions, r.parameter_schema, r.result_columns
  FROM public.atlas_canonical_reports r
  WHERE r.status = 'verified'
  ORDER BY r.category, r.id;
$$;

REVOKE EXECUTE ON FUNCTION public.atlas_router_catalog() FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_router_catalog() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_router_catalog() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Wrapper RPC — atlas_run_canonical_report
--
-- R1 audit H2 (2026-05-06): the wrapper writes to atlas_canonical_run_log
-- in two paths (success at the end, error inside the EXCEPTION block).
-- Both INSERTs fire AFTER `RESET ROLE`, which means the role is back to
-- the function owner. The atlas_canonical_run_log table has FORCE ROW
-- LEVEL SECURITY plus a `WITH CHECK (false)` no-direct-write policy, so
-- the INSERT only succeeds because the function owner (postgres) has
-- BYPASSRLS — verified in prod 2026-05-06 via:
--   SELECT proowner::regrole, rolbypassrls FROM pg_proc p
--   JOIN pg_roles r ON r.oid = p.proowner WHERE proname='atlas_run_canonical_report';
-- → owner=postgres, bypass=t.
-- If a future RLS hardening pass moves these RPCs to a non-superuser owner,
-- audit logging will silently break. Either keep the postgres owner pinned
-- or replace the no-direct-write policy with an explicit "wrapper-only"
-- INSERT policy.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atlas_run_canonical_report(
  p_report_id text,
  p_params jsonb DEFAULT '{}'::jsonb,
  p_question text DEFAULT NULL,
  p_page_path text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   uuid := auth.uid();
  v_caller      RECORD;
  v_role        text;
  v_report      RECORD;
  v_started_at  timestamptz := clock_timestamp();
  v_rows        jsonb;
  v_row_count   int;
  v_drift       boolean := false;
  v_log_id      bigint;
  v_err         text;
  v_required    text;
  v_required_keys text[];
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT u.id, u.email, u.role INTO v_caller
  FROM public.users u WHERE u.id = v_caller_id;
  v_role := COALESCE(v_caller.role, '');

  IF v_role NOT IN ('admin','manager','team_leader','super_admin') THEN
    RAISE EXCEPTION 'Atlas data query is restricted to admin, manager, team_leader, super_admin (got %)', v_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_report
  FROM public.atlas_canonical_reports
  WHERE id = p_report_id AND status = 'verified';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No verified report with id=% (or it is in draft/deprecated state)', p_report_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_report.parameter_schema IS NOT NULL AND jsonb_typeof(v_report.parameter_schema) = 'object' THEN
    SELECT array_agg(key) INTO v_required_keys
    FROM jsonb_each(v_report.parameter_schema) AS s(key, val)
    WHERE COALESCE((val->>'required')::boolean, false) = true;

    IF v_required_keys IS NOT NULL THEN
      FOREACH v_required IN ARRAY v_required_keys LOOP
        IF NOT (p_params ? v_required) THEN
          RAISE EXCEPTION 'Missing required parameter: %', v_required
            USING ERRCODE = 'invalid_parameter_value';
        END IF;
      END LOOP;
    END IF;
  END IF;

  PERFORM set_config('statement_timeout', '5000', true);

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE format('SELECT to_jsonb(array_agg(t)) FROM %I($1) t', v_report.function_name)
      INTO v_rows
      USING p_params;
    EXECUTE 'RESET ROLE';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      EXECUTE 'RESET ROLE';
      INSERT INTO public.atlas_canonical_run_log (
        user_id, user_email, user_role, question, report_id, params,
        row_count, truncated, error, page_path, duration_ms
      ) VALUES (
        v_caller_id, v_caller.email, v_role, p_question, p_report_id, p_params,
        NULL, false, v_err, p_page_path,
        (extract(epoch FROM clock_timestamp() - v_started_at) * 1000)::int
      );
      RAISE EXCEPTION 'Report execution failed: %', v_err USING ERRCODE = 'data_exception';
  END;

  v_rows := COALESCE(v_rows, '[]'::jsonb);
  v_row_count := jsonb_array_length(v_rows);

  IF v_report.expected_row_count IS NOT NULL THEN
    IF v_report.drift_tolerance_pct = 0 THEN
      v_drift := (v_row_count <> v_report.expected_row_count);
    ELSE
      v_drift := abs(v_row_count - v_report.expected_row_count)::numeric
                 > (v_report.expected_row_count * v_report.drift_tolerance_pct / 100.0);
    END IF;
  END IF;

  INSERT INTO public.atlas_canonical_run_log (
    user_id, user_email, user_role, question, report_id, params,
    row_count, truncated, error, drift_detected, page_path, duration_ms
  ) VALUES (
    v_caller_id, v_caller.email, v_role, p_question, p_report_id, p_params,
    v_row_count, false, NULL, v_drift, p_page_path,
    (extract(epoch FROM clock_timestamp() - v_started_at) * 1000)::int
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'log_id',           v_log_id,
    'report_id',        p_report_id,
    'rows',             v_rows,
    'row_count',        v_row_count,
    'drift_detected',   v_drift,
    'expected_row_count', v_report.expected_row_count,
    'verified_at',      v_report.verified_at,
    'verified_by',      v_report.verified_by,
    'verification_method', v_report.verification_method,
    'ground_truth_source', v_report.ground_truth_source,
    'result_columns',   v_report.result_columns
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_run_canonical_report(text, jsonb, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_run_canonical_report(text, jsonb, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_run_canonical_report(text, jsonb, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Admin authoring RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atlas_canonical_save_draft(
  p_id text,
  p_name text,
  p_description text,
  p_category text,
  p_example_questions text[],
  p_parameter_schema jsonb,
  p_result_columns jsonb,
  p_function_name text,
  p_draft_sql text,
  p_owner text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT role INTO v_role FROM public.users WHERE id = v_caller_id;
  IF v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Drafting reports requires admin or super_admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.atlas_canonical_reports (
    id, name, description, category, example_questions, parameter_schema,
    result_columns, function_name, draft_sql, owner, status
  ) VALUES (
    p_id, p_name, p_description, p_category, p_example_questions, p_parameter_schema,
    p_result_columns, p_function_name, p_draft_sql, p_owner, 'draft'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    example_questions = EXCLUDED.example_questions,
    parameter_schema = EXCLUDED.parameter_schema,
    result_columns = EXCLUDED.result_columns,
    function_name = EXCLUDED.function_name,
    draft_sql = EXCLUDED.draft_sql,
    owner = EXCLUDED.owner,
    status = CASE WHEN public.atlas_canonical_reports.status = 'verified' THEN 'draft' ELSE public.atlas_canonical_reports.status END,
    version = public.atlas_canonical_reports.version + 1,
    updated_at = now();

  RETURN p_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) TO authenticated;


-- atlas_canonical_verify — final form with R1 H1 fix (signature check) folded in.
CREATE OR REPLACE FUNCTION public.atlas_canonical_verify(
  p_id text,
  p_verification_method text,
  p_ground_truth_source text,
  p_expected_row_count integer,
  p_verified_params jsonb,
  p_verified_sample_ids text[],
  p_expected_aggregates jsonb DEFAULT NULL,
  p_drift_tolerance_pct numeric DEFAULT 0
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

  -- Hard signature check: must be public.<function_name>(jsonb) — exactly.
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


CREATE OR REPLACE FUNCTION public.atlas_canonical_deprecate(p_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT role INTO v_role FROM public.users WHERE id = v_caller_id;
  IF v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Deprecating reports requires admin or super_admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.atlas_canonical_reports
  SET status = 'deprecated', updated_at = now()
  WHERE id = p_id;

  RETURN p_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_deprecate(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_deprecate(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_deprecate(text) TO authenticated;
