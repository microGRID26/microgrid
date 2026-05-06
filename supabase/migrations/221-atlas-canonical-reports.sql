-- 221-atlas-canonical-reports.sql
--
-- P1 of the canonical-reports catalog (~/.claude/plans/twinkly-jumping-thimble.md).
-- Stops Atlas from generating LLM-improvised SQL and instead routes user
-- questions to hand-written, NetSuite-verified report functions.
--
-- This migration ships the TABLE + WRAPPER RPC + ROUTER-CATALOG RPC.
-- It does NOT ship any actual canonical reports — those land in P2 as
-- separate migrations (one per report) following the function naming
-- convention atlas_canonical_<slug>(p_params jsonb).
--
-- Each canonical report function takes a SINGLE jsonb param (p_params)
-- and parses + casts internally. This keeps the wrapper RPC universal —
-- it dispatches dynamically via EXECUTE format('SELECT ... FROM %I($1)').

-- ---------------------------------------------------------------------------
-- 1. Catalog table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlas_canonical_reports (
  id text PRIMARY KEY,                         -- slug; matches function suffix
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,                      -- 'sales' | 'pipeline' | 'install' | 'finance' | 'commission' | 'ops'

  -- LLM router sees ONLY these (plus id, name, description, category):
  example_questions text[] NOT NULL DEFAULT ARRAY[]::text[],
  parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_columns jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Function reference (the SQL):
  function_name text NOT NULL,                 -- e.g. 'atlas_canonical_ec_booked_sales_since'

  -- Verification metadata (NULL until status='verified'):
  verified_at timestamptz,
  verified_by text,
  verification_method text CHECK (
    verification_method IS NULL OR
    verification_method IN ('netsuite_saved_search','manual_count','consensus_with_heidi','spot_check_of_5_rows')
  ),
  ground_truth_source text,
  expected_row_count int,
  expected_aggregates jsonb,
  verified_params jsonb,                       -- exact params used at verification time
  verified_sample_ids text[],                  -- 5-10 row ids that MUST appear in re-runs
  drift_tolerance_pct numeric NOT NULL DEFAULT 0,
  last_drift_check_at timestamptz,
  last_drift_check_passed boolean,

  -- Lifecycle:
  status text NOT NULL DEFAULT 'draft',        -- 'draft' | 'verified' | 'deprecated'
  owner text NOT NULL,                         -- email
  version int NOT NULL DEFAULT 1,

  -- Draft-only (cleared when status flips to verified):
  draft_sql text,                              -- SQL body written in admin UI before migration

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

CREATE INDEX IF NOT EXISTS idx_atlas_canonical_reports_status ON public.atlas_canonical_reports(status);
CREATE INDEX IF NOT EXISTS idx_atlas_canonical_reports_category ON public.atlas_canonical_reports(category);

-- updated_at auto-touch trigger
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

-- Trigger function — no callers other than the trigger itself; revoke
-- from PUBLIC so anon/authenticated can't invoke it directly.
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_reports_touch_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_reports_touch_updated_at() FROM anon;

ALTER TABLE public.atlas_canonical_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_canonical_reports FORCE ROW LEVEL SECURITY;

-- Authenticated users with admin/super_admin OR Director-of-Inside-Operations
-- can SELECT all reports (including drafts). Other authenticated roles
-- (manager, team_leader) can SELECT only verified rows. anon/PUBLIC: nothing.
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

-- Writes: only admin / super_admin / Heidi via the wrapper functions; never direct.
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
--    Returns only verified rows. Crucially, does NOT return the SQL or
--    function_name (router never needs SQL; SQL leak risk is lower).
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
--    Validates params + dispatches to the canonical report function.
--    Returns rows + row_count + drift_detected + verification metadata.
--
--    Param validation is intentionally minimal in P1 (required keys exist
--    + basic type check). Each canonical report function does its own
--    typed validation + lookup-bound validation against the source tables
--    (e.g. ec_name must exist in sales_reps).
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
  -- Auth
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

  -- Lookup report
  SELECT * INTO v_report
  FROM public.atlas_canonical_reports
  WHERE id = p_report_id AND status = 'verified';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No verified report with id=% (or it is in draft/deprecated state)', p_report_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Param validation: every key in parameter_schema marked "required":true
  -- must be present in p_params. P1 minimal — typed validation lives inside
  -- each canonical report function.
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

  -- Statement timeout for the report execution
  PERFORM set_config('statement_timeout', '5000', true);

  -- Dispatch to the canonical report function. Each function takes a
  -- single jsonb arg and returns rows. Wrap in to_jsonb(array_agg) so
  -- the result is a single jsonb value we can return.
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

  -- Drift detection: row_count vs expected
  IF v_report.expected_row_count IS NOT NULL THEN
    IF v_report.drift_tolerance_pct = 0 THEN
      v_drift := (v_row_count <> v_report.expected_row_count);
    ELSE
      v_drift := abs(v_row_count - v_report.expected_row_count)::numeric
                 > (v_report.expected_row_count * v_report.drift_tolerance_pct / 100.0);
    END IF;
  END IF;

  -- Log success
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
-- 5. Admin-only authoring RPCs (for the admin UI to draft + manage reports)
--    P1 ships the API; the UI uses it in P5. Insert/update via these RPCs
--    only — direct writes blocked by RLS no_direct_write policy above.
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
    -- Editing a verified report drops it back to draft until re-verified.
    status = CASE WHEN public.atlas_canonical_reports.status = 'verified' THEN 'draft' ELSE public.atlas_canonical_reports.status END,
    version = public.atlas_canonical_reports.version + 1,
    updated_at = now();

  RETURN p_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_save_draft(text, text, text, text, text[], jsonb, jsonb, text, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.atlas_canonical_verify(
  p_id text,
  p_verification_method text,
  p_ground_truth_source text,
  p_expected_row_count int,
  p_verified_params jsonb,
  p_verified_sample_ids text[],
  p_expected_aggregates jsonb DEFAULT NULL,
  p_drift_tolerance_pct numeric DEFAULT 0
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_email text;
  v_role text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT email, role INTO v_caller_email, v_role FROM public.users WHERE id = v_caller_id;
  IF v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'Verifying reports requires admin or super_admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify the function actually exists in pg_proc (catches typos +
  -- "draft saved but migration never merged" cases).
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = (SELECT function_name FROM public.atlas_canonical_reports WHERE id = p_id)
  ) THEN
    RAISE EXCEPTION 'Cannot verify: function for report % does not exist in pg_proc — has the migration been applied?', p_id
      USING ERRCODE = 'undefined_function';
  END IF;

  UPDATE public.atlas_canonical_reports SET
    status = 'verified',
    verified_at = now(),
    verified_by = v_caller_email,
    verification_method = p_verification_method,
    ground_truth_source = p_ground_truth_source,
    expected_row_count = p_expected_row_count,
    expected_aggregates = p_expected_aggregates,
    verified_params = p_verified_params,
    verified_sample_ids = p_verified_sample_ids,
    drift_tolerance_pct = p_drift_tolerance_pct,
    draft_sql = NULL,  -- clear draft once verified; pg_get_functiondef is the source of truth
    updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found: %', p_id USING ERRCODE = 'no_data_found';
  END IF;

  RETURN p_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, int, jsonb, text[], jsonb, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, int, jsonb, text[], jsonb, numeric) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_verify(text, text, text, int, jsonb, text[], jsonb, numeric) TO authenticated;


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
