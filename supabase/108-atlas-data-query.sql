-- supabase/108-atlas-data-query.sql
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
--      with a 5s statement_timeout, a 5000-row hard cap, and inside an
--      ABORT-on-write transaction (read-only)
--   5. Result rows are returned to the UI as a table + CSV download
--
-- The validator + RPC enforce the same rules in two places (defense in
-- depth). The RPC is the ultimate authority since it runs server-side.
--
-- Audit log (atlas_query_log) records every query: who, what NL question,
-- what generated SQL, row count, error if any. Admin-readable.

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
  ON atlas_query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atlas_query_log_user
  ON atlas_query_log(user_id, created_at DESC);

ALTER TABLE atlas_query_log ENABLE ROW LEVEL SECURITY;

-- Admins read everything; users read their own.
DROP POLICY IF EXISTS atlas_query_log_admin_read ON atlas_query_log;
CREATE POLICY atlas_query_log_admin_read ON atlas_query_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id::text = auth.uid()::text AND users.role = 'admin')
    OR user_id::text = auth.uid()::text
  );

-- Inserts must come through atlas_safe_query() — block direct inserts.
DROP POLICY IF EXISTS atlas_query_log_no_direct_insert ON atlas_query_log;
CREATE POLICY atlas_query_log_no_direct_insert ON atlas_query_log
  FOR INSERT TO authenticated WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- 2. Allowlist of queryable tables. v1 = ~27 core business tables.
--
--    Stored in a constant array inside the function for simplicity.
--    Future: pull from a config table if Heidi wants to add tables.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. atlas_safe_query — SECURITY DEFINER read-only SQL executor
--
--    Three layers of safety:
--    a) Regex prefix check: must start with SELECT or WITH (case-insensitive)
--    b) Forbidden token regex: rejects ; -- /* INSERT UPDATE DELETE etc.
--    c) Allowlist check: every \bFROM <ident> and \bJOIN <ident> must be
--       in the allowlist. (Subqueries with FROM nested are caught.)
--
--    THEN executes inside SET LOCAL statement_timeout='5s', wrapped with
--    a row-cap LIMIT, and inside a function so the caller can never
--    write (function body cannot mutate).
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
  v_pos         INTEGER;
  v_capped_sql  TEXT;
  v_started_at  TIMESTAMPTZ := clock_timestamp();
  v_rows        jsonb;
  v_row_count   INTEGER;
  v_truncated   BOOLEAN := false;
  v_err         TEXT;
  v_log_id      BIGINT;
  -- Allowlist: every table the LLM may reference. Must match exactly.
  -- R1 audit Critical (2026-04-28): `users` removed — would leak employee
  -- PII across tenants under SECURITY DEFINER. Use sales_reps for rep-level
  -- queries (org-scoped via RLS).
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
  -- ── Auth + role gate ────────────────────────────────────────────────────
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

  -- ── Validation ──────────────────────────────────────────────────────────
  IF p_sql IS NULL OR length(trim(p_sql)) = 0 THEN
    RAISE EXCEPTION 'p_sql is empty' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF length(p_sql) > 8000 THEN
    RAISE EXCEPTION 'p_sql exceeds 8000 chars' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_normalized := trim(p_sql);
  v_lower := lower(v_normalized);

  -- (a) Must start with SELECT. CTEs (WITH) excluded — alias-vs-table needs
  -- a real parser to enforce safely; regex allowlist would silently accept
  -- 'JOIN <cte_alias>' as if it were a table.
  IF v_lower !~ '^select\s' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed (got prefix: %)', substring(v_lower from 1 for 20)
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- (b) Forbidden-token regex. \y is word boundary in Postgres.
  --     Multi-statement (;), comments (--, /*), DML, DDL, GRANT, COPY, lo_*,
  --     dblink, pg_read_*, dollar-quoted strings, etc.
  IF v_lower ~ '(;|--|/\*|\\)'
     OR v_lower ~ '\y(insert|update|delete|alter|drop|truncate|create|grant|revoke|call|do|copy|merge|reindex|cluster|vacuum|analyze|listen|notify|prepare|execute|deallocate|lock|set|reset|fetch|move|comment|security|invoker|definer)\y'
     OR v_lower ~ '\y(pg_read_file|pg_read_binary_file|lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend|pg_sleep|copy_program)\y'
  THEN
    RAISE EXCEPTION 'SQL contains forbidden token. Only pure SELECT against the allowlist is permitted.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- (c) Allowlist enforcement: every \bFROM <ident> and \bJOIN <ident> must
  --     be in v_allowlist. Strip schema prefix (public.X -> X). Reject if any
  --     reference is to a schema other than public or the bare allowlist.
  v_referenced := ARRAY[]::TEXT[];
  FOR v_match IN
    SELECT (regexp_matches(v_lower, '\y(?:from|join)\s+([a-z_][a-z0-9_."]*)', 'g'))[1]
  LOOP
    v_table := lower(trim(v_match));
    -- Strip surrounding quotes
    v_table := regexp_replace(v_table, '"', '', 'g');
    -- If schema-qualified, must be public.X
    IF position('.' IN v_table) > 0 THEN
      IF v_table !~ '^public\.' THEN
        RAISE EXCEPTION 'Cross-schema reference rejected: %', v_table USING ERRCODE = 'insufficient_privilege';
      END IF;
      v_table := substring(v_table from 8); -- strip 'public.'
    END IF;
    -- Trim trailing comma / paren / whitespace
    v_table := regexp_replace(v_table, '[,\s\)].*$', '');
    v_referenced := array_append(v_referenced, v_table);
    IF NOT (v_table = ANY(v_allowlist)) THEN
      RAISE EXCEPTION 'Table not in allowlist: % (allowed: %)', v_table, v_allowlist
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  -- ── Execute ────────────────────────────────────────────────────────────
  v_capped_sql := format('SELECT to_jsonb(array_agg(t)) FROM (%s LIMIT 5001) t', v_normalized);

  -- Statement timeout to prevent runaway queries.
  PERFORM set_config('statement_timeout', '5000', true);

  -- R1 audit High 1 (2026-04-28): execute the user's SQL under the
  -- `authenticated` role so RLS policies on per-table org_id apply.
  -- The logging INSERT below runs back as DEFINER (after RESET ROLE).
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

  -- ── Log success ────────────────────────────────────────────────────────
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

COMMENT ON FUNCTION atlas_safe_query(TEXT, TEXT, TEXT) IS
  'Read-only NL->SQL executor. Manager+ only. Validates SQL with regex DML-reject + allowlist enforcement, then executes with 5s statement_timeout and 5000-row cap. Every call logged to atlas_query_log.';

-- ---------------------------------------------------------------------------
-- 4. Grant EXECUTE on the RPC to authenticated. RLS-style role gate is
--    inside the function (admin/manager/team_leader).
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION atlas_safe_query(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION atlas_safe_query(TEXT, TEXT, TEXT) TO authenticated;
