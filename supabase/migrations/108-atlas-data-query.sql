-- supabase/migrations/108-atlas-data-query.sql
--
-- Heidi 2026-04-28: 'I want to run reports myself.' Greg pitched an
-- ask-Atlas button that takes natural language and returns a table + CSV.
-- This migration is the BACKEND for that feature. Workflow:
--
--   1. Manager+ types a question in /reports
--   2. /api/atlas/query calls Anthropic SDK with a constrained system prompt
--      (allowlist schema embedded) -> structured {sql, explanation}
--   3. Route runs sql through lib/atlas/sql-validator.ts (regex-based DML
--      reject + allowlist enforce) BEFORE sending to Postgres
--   4. Validator-passed sql is sent to atlas_safe_query() RPC, which runs it
--      with a 5s statement_timeout, a 5000-row hard cap, under SET LOCAL
--      ROLE authenticated so RLS applies
--   5. Result rows are returned to the UI as a table + CSV download
--
-- The validator + RPC enforce the same rules in two places (defense in
-- depth). The RPC is the ultimate authority since it runs server-side.
--
-- R1 audit fixes (2026-04-28, baked in):
--  - Critical: dropped `users` from the allowlist (employee PII leak via
--    SECURITY DEFINER bypassing RLS).
--  - High: SET LOCAL ROLE authenticated for the EXECUTE so per-table RLS
--    enforces tenant isolation.
--  - Medium: error messages sanitized in the route response.
--
-- R1 audit fixes (2026-05-06, applied as migrations 109/110/111 — body
-- merged here so this file matches live):
--  - Critical: REVOKE EXECUTE FROM anon (Supabase's platform default
--    re-grants every public function to anon unless explicitly stripped).
--  - High: forbidden-functions regex uses non-word-boundary anchors so
--    pg_sleep_for / pg_sleep_until are caught (\y treats `_` as word char).
--  - High: FROM/JOIN allowlist regex captures quoted OR bare identifiers
--    so `FROM "users"` doesn't slip past server-side allowlist.
--  - High: FORCE ROW LEVEL SECURITY on 29 allowlisted tables — defense
--    in depth so any future role-switch refactor doesn't silently re-grant
--    owner-bypass reads.
--  - Medium: atlas_query_log RLS uses uuid = uuid (drop ::text casts).

-- ---------------------------------------------------------------------------
-- 1. Audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlas_query_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  user_email TEXT,
  user_role TEXT,
  question TEXT NOT NULL,
  generated_sql TEXT,
  row_count INTEGER,
  truncated BOOLEAN DEFAULT false,
  error TEXT,
  page_path TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atlas_query_log_created
  ON public.atlas_query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_query_log_user
  ON public.atlas_query_log(user_id, created_at DESC);

ALTER TABLE public.atlas_query_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atlas_query_log_admin_read ON public.atlas_query_log;
CREATE POLICY atlas_query_log_admin_read ON public.atlas_query_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'admin')
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS atlas_query_log_no_direct_insert ON public.atlas_query_log;
CREATE POLICY atlas_query_log_no_direct_insert ON public.atlas_query_log
  FOR INSERT TO authenticated WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 2. atlas_safe_query — SECURITY DEFINER read-only SQL executor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atlas_safe_query(
  p_question  TEXT,
  p_sql       TEXT,
  p_page_path TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id   UUID    := auth.uid();
  v_caller      RECORD;
  v_role        TEXT;
  v_normalized  TEXT;
  v_lower       TEXT;
  v_table       TEXT;
  v_match       TEXT;
  v_capped_sql  TEXT;
  v_started_at  TIMESTAMPTZ := clock_timestamp();
  v_rows        jsonb;
  v_row_count   INTEGER;
  v_truncated   BOOLEAN := false;
  v_err         TEXT;
  v_log_id      BIGINT;
  v_allowlist   TEXT[] := ARRAY[
    'projects', 'change_orders', 'project_funding', 'task_state',
    'stage_history', 'project_files', 'project_folders',
    'project_documents', 'project_adders', 'project_materials',
    'project_boms', 'notes', 'sales_reps', 'sales_teams',
    'crews', 'invoices', 'invoice_line_items', 'commission_records',
    'service_calls', 'work_orders', 'equipment', 'financiers',
    'utilities', 'hoas', 'ahjs', 'welcome_call_logs', 'task_due_dates',
    'task_history', 'task_reasons'
  ];
  v_referenced  TEXT[];
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT u.id, u.email, u.role INTO v_caller
  FROM users u WHERE u.id = v_caller_id;
  v_role := COALESCE(v_caller.role, '');

  IF v_role NOT IN ('admin', 'manager', 'team_leader') THEN
    RAISE EXCEPTION 'Atlas data query is restricted to admin, manager, team_leader (got %)', v_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_sql IS NULL OR length(trim(p_sql)) = 0 THEN
    RAISE EXCEPTION 'p_sql is empty' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(p_sql) > 8000 THEN
    RAISE EXCEPTION 'p_sql exceeds 8000 chars' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_normalized := trim(p_sql);
  v_lower := lower(v_normalized);

  IF v_lower !~ '^select\s' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed (got prefix: %)', substring(v_lower from 1 for 20)
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Forbidden punctuation + DML/DDL keyword block (\y word boundary).
  IF v_lower ~ '(;|--|/\*|\\)'
     OR v_lower ~ '\y(insert|update|delete|alter|drop|truncate|create|grant|revoke|call|do|copy|merge|reindex|cluster|vacuum|analyze|listen|notify|prepare|execute|deallocate|lock|set|reset|fetch|move|comment|security|invoker|definer)\y'
  THEN
    RAISE EXCEPTION 'SQL contains forbidden token. Only pure SELECT against the allowlist is permitted.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- R1 H1 (2026-05-06): dangerous-functions check uses non-word-boundary
  -- anchors so pg_sleep_for / pg_sleep_until variants are caught.
  IF v_lower ~ '(^|[^a-z0-9_])(pg_read_file|pg_read_binary_file|lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend|pg_sleep|pg_sleep_for|pg_sleep_until|copy_program)([^a-z0-9_]|$)'
  THEN
    RAISE EXCEPTION 'SQL references a forbidden function.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- R1 H2 (2026-05-06): capture quoted OR bare identifiers in FROM/JOIN
  -- so the RPC allowlist also enforces against `FROM "users"`.
  v_referenced := ARRAY[]::TEXT[];
  FOR v_match IN
    SELECT (regexp_matches(v_lower, '\y(?:from|join)\s+("[^"]+"|[a-z_][a-z0-9_."]*)', 'g'))[1]
  LOOP
    v_table := lower(trim(v_match));
    v_table := regexp_replace(v_table, '"', '', 'g');
    IF position('.' IN v_table) > 0 THEN
      IF v_table !~ '^public\.' THEN
        RAISE EXCEPTION 'Cross-schema reference rejected: %', v_table USING ERRCODE = 'insufficient_privilege';
      END IF;
      v_table := substring(v_table from 8);
    END IF;
    v_table := regexp_replace(v_table, '[,\s\)].*$', '');
    v_referenced := array_append(v_referenced, v_table);
    IF NOT (v_table = ANY(v_allowlist)) THEN
      RAISE EXCEPTION 'Table not in allowlist: % (allowed: %)', v_table, v_allowlist
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  v_capped_sql := format('SELECT to_jsonb(array_agg(t)) FROM (%s LIMIT 5001) t', v_normalized);

  PERFORM set_config('statement_timeout', '5000', true);

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE v_capped_sql INTO v_rows;
    EXECUTE 'RESET ROLE';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      EXECUTE 'RESET ROLE';
      INSERT INTO atlas_query_log (
        user_id, user_email, user_role, question, generated_sql,
        row_count, truncated, error, page_path, duration_ms
      ) VALUES (
        v_caller_id, v_caller.email, v_role, p_question, p_sql,
        NULL, false, v_err, p_page_path,
        (extract(epoch FROM clock_timestamp() - v_started_at) * 1000)::int
      );
      RAISE EXCEPTION 'Query failed: %', v_err USING ERRCODE = 'data_exception';
  END;

  v_rows := COALESCE(v_rows, '[]'::jsonb);
  v_row_count := jsonb_array_length(v_rows);
  IF v_row_count > 5000 THEN
    v_truncated := true;
    v_rows := (SELECT jsonb_agg(elem) FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS x(elem, idx) WHERE idx <= 5000);
    v_row_count := 5000;
  END IF;

  INSERT INTO atlas_query_log (
    user_id, user_email, user_role, question, generated_sql,
    row_count, truncated, error, page_path, duration_ms
  ) VALUES (
    v_caller_id, v_caller.email, v_role, p_question, p_sql,
    v_row_count, v_truncated, NULL, p_page_path,
    (extract(epoch FROM clock_timestamp() - v_started_at) * 1000)::int
  ) RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'log_id',    v_log_id,
    'rows',      v_rows,
    'row_count', v_row_count,
    'truncated', v_truncated,
    'sql',       p_sql,
    'tables_referenced', to_jsonb(v_referenced)
  );
END $$;

COMMENT ON FUNCTION public.atlas_safe_query(TEXT, TEXT, TEXT) IS
  'Read-only NL->SQL executor. Manager+ only. Validates SQL with regex DML-reject + allowlist enforcement, then executes with 5s statement_timeout and 5000-row cap. Every call logged to atlas_query_log.';

-- R1 C1 (2026-05-06): strip anon — Supabase platform default re-grants
-- anon EXECUTE on every public function unless explicitly revoked.
REVOKE EXECUTE ON FUNCTION public.atlas_safe_query(text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_safe_query(text,text,text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_safe_query(text,text,text) TO authenticated;

-- R1 H3 (2026-05-06): FORCE ROW LEVEL SECURITY on the 29 allowlisted
-- business tables. Service role + postgres-owned SECURITY DEFINER fns
-- have rolbypassrls=true and are unaffected; this protects against any
-- future refactor that changes the role-switch path inside atlas_safe_query.
DO $force_rls$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'projects','change_orders','project_funding','task_state',
    'stage_history','project_files','project_folders','project_documents',
    'project_adders','project_materials','project_boms','notes',
    'sales_reps','sales_teams','crews','invoices','invoice_line_items',
    'commission_records','service_calls','work_orders','equipment',
    'financiers','utilities','hoas','ahjs','welcome_call_logs',
    'task_due_dates','task_history','task_reasons'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
  END LOOP;
END $force_rls$;
