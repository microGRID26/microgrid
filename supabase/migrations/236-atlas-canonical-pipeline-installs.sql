-- 236-atlas-canonical-pipeline-installs.sql
--
-- Two more canonical reports per docs/atlas/seed-catalog-candidates.md.
-- Both keep the disposition rule established in mig 231 (terminal-set
-- exclusion) so cross-report numbers reconcile.
--
-- 1. atlas_canonical_pipeline_by_stage(jsonb)
--    Active pipeline counts grouped by stage. Excludes terminal disposition
--    states. Optional include_terminal flag for ops who want full visibility.
--
-- 2. atlas_canonical_installs_scheduled(jsonb)
--    Projects with install_scheduled_date in a window. Defaults: today →
--    today+30. Excludes terminal dispositions.
--
--    Data-quality note (R1 audit L2 / M3): install_scheduled_date is
--    populated for only ~8% of active deals (231 of 2841) at time of ship.
--    Empty results in the default window may reflect data-entry gaps
--    rather than real schedule. Drift tolerance is set to 9999% on this
--    report because forward-looking row counts swing daily as schedules
--    are entered/changed; row-count drift detection is the wrong tool
--    here. Use stage progression OR install_complete_date for backwards-
--    looking install reporting.
--
-- Both functions are SECURITY INVOKER (default) — wrapper RPC's SET LOCAL
-- ROLE authenticated pushes RLS on projects through.

-- =====================================================================
-- 1. pipeline_by_stage
-- =====================================================================

CREATE OR REPLACE FUNCTION public.atlas_canonical_pipeline_by_stage(p_params jsonb)
RETURNS TABLE(
  stage text,
  project_count bigint,
  total_kw numeric,
  avg_kw numeric
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_include_terminal boolean := false;
  v_raw text := p_params->>'include_terminal';
BEGIN
  -- R1 audit M1 — explicit boolean cast with structured error so a bad
  -- value ('maybe', integer, etc.) raises invalid_parameter_value rather
  -- than leaking the raw Postgres "invalid input syntax" string into
  -- atlas_canonical_run_log.error.
  IF v_raw IS NOT NULL AND v_raw <> '' THEN
    BEGIN
      v_include_terminal := v_raw::boolean;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'include_terminal must be boolean (true/false): got %', v_raw
        USING ERRCODE = 'invalid_parameter_value';
    END;
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(NULLIF(p.stage,''), '<empty>')                  AS stage,
    COUNT(*)::bigint                                         AS project_count,
    ROUND(SUM(NULLIF(p.systemkw,'')::numeric), 2)            AS total_kw,
    ROUND(AVG(NULLIF(p.systemkw,'')::numeric), 2)            AS avg_kw
  FROM public.projects p
  WHERE v_include_terminal
     OR COALESCE(p.disposition,'') NOT IN ('Cancel','Cancelled','Test','Loss','Legal','On Hold')
  GROUP BY 1
  ORDER BY 2 DESC, 1;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_pipeline_by_stage(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_pipeline_by_stage(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_pipeline_by_stage(jsonb) TO authenticated;

-- =====================================================================
-- 2. installs_scheduled
-- =====================================================================

CREATE OR REPLACE FUNCTION public.atlas_canonical_installs_scheduled(p_params jsonb)
RETURNS TABLE(
  project_id text,
  customer_name text,
  install_scheduled_date date,
  stage text,
  systemkw numeric,
  city text,
  state text,
  consultant text
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_since_raw text := p_params->>'since_date';
  v_until_raw text := p_params->>'until_date';
  v_since date;
  v_until date;
BEGIN
  -- Defaults: today → today + 30 days.
  IF v_since_raw IS NULL OR v_since_raw = '' THEN
    v_since := CURRENT_DATE;
  ELSE
    BEGIN v_since := v_since_raw::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'since_date must be ISO date (YYYY-MM-DD): got %', v_since_raw
        USING ERRCODE = 'invalid_parameter_value';
    END;
  END IF;
  IF v_until_raw IS NULL OR v_until_raw = '' THEN
    v_until := CURRENT_DATE + INTERVAL '30 days';
  ELSE
    BEGIN v_until := v_until_raw::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'until_date must be ISO date (YYYY-MM-DD): got %', v_until_raw
        USING ERRCODE = 'invalid_parameter_value';
    END;
  END IF;

  IF v_until < v_since THEN
    RAISE EXCEPTION 'until_date (%) must be on or after since_date (%)', v_until, v_since
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  SELECT
    p.id::text                                                  AS project_id,
    p.name                                                      AS customer_name,
    NULLIF(p.install_scheduled_date,'')::date                   AS install_scheduled_date,
    COALESCE(NULLIF(p.stage,''),'<empty>')                      AS stage,
    NULLIF(p.systemkw,'')::numeric                              AS systemkw,
    p.city                                                      AS city,
    p.state                                                     AS state,
    p.consultant                                                AS consultant
  FROM public.projects p
  WHERE NULLIF(p.install_scheduled_date,'')::date BETWEEN v_since AND v_until
    AND COALESCE(p.disposition,'') NOT IN ('Cancel','Cancelled','Test','Loss','Legal','On Hold')
  ORDER BY NULLIF(p.install_scheduled_date,'')::date ASC, p.id;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_installs_scheduled(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_installs_scheduled(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_installs_scheduled(jsonb) TO authenticated;

-- =====================================================================
-- Catalog seeds (draft — verified by direct UPDATE below after applying.)
-- =====================================================================

INSERT INTO public.atlas_canonical_reports (
  id, name, description, category,
  example_questions, parameter_schema, result_columns,
  function_name, owner, status
) VALUES (
  'pipeline_by_stage',
  'Pipeline by Stage',
  'Active project counts and total kW by pipeline stage. Excludes terminal-state dispositions (Cancel, Cancelled, Test, Loss, Legal, On Hold) by default. Pass include_terminal=true to see all rows including dead ones.',
  'pipeline',
  ARRAY[
    'What is our pipeline right now',
    'How many projects in install',
    'Pipeline breakdown by stage',
    'Show me active deals by stage',
    'How many projects in permit'
  ],
  jsonb_build_object(
    'include_terminal', jsonb_build_object(
      'type','boolean','required',false,'default',false,
      'description','Set true to include terminal-state rows (Cancelled, Legal, etc.). Default false.'
    )
  ),
  jsonb_build_array(
    jsonb_build_object('key','stage','label','Stage','type','text'),
    jsonb_build_object('key','project_count','label','Projects','type','int'),
    jsonb_build_object('key','total_kw','label','Total kW','type','number'),
    jsonb_build_object('key','avg_kw','label','Avg kW','type','number')
  ),
  'atlas_canonical_pipeline_by_stage',
  'greg@gomicrogridenergy.com',
  'draft'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  example_questions = EXCLUDED.example_questions,
  parameter_schema = EXCLUDED.parameter_schema,
  result_columns = EXCLUDED.result_columns,
  function_name = EXCLUDED.function_name,
  status = CASE WHEN public.atlas_canonical_reports.status = 'verified' THEN 'draft' ELSE public.atlas_canonical_reports.status END,
  version = public.atlas_canonical_reports.version + 1,
  updated_at = now();


INSERT INTO public.atlas_canonical_reports (
  id, name, description, category,
  example_questions, parameter_schema, result_columns,
  function_name, owner, status
) VALUES (
  'installs_scheduled',
  'Installs Scheduled (Date Window)',
  'Projects with install_scheduled_date in a date window. Defaults to today through 30 days out. Excludes terminal-state dispositions. Returns one row per project with location and consultant.',
  'install',
  ARRAY[
    'Which installs are scheduled this week',
    'Whats installing tomorrow',
    'Install schedule next 7 days',
    'Show me upcoming installs',
    'Installs scheduled this month'
  ],
  jsonb_build_object(
    'since_date', jsonb_build_object(
      'type','date','required',false,'format','YYYY-MM-DD',
      'description','Inclusive lower bound for install_scheduled_date. Default today.'
    ),
    'until_date', jsonb_build_object(
      'type','date','required',false,'format','YYYY-MM-DD',
      'description','Inclusive upper bound for install_scheduled_date. Default today + 30 days.'
    )
  ),
  jsonb_build_array(
    jsonb_build_object('key','project_id','label','Project','type','text'),
    jsonb_build_object('key','customer_name','label','Customer','type','text'),
    jsonb_build_object('key','install_scheduled_date','label','Install Date','type','date'),
    jsonb_build_object('key','stage','label','Stage','type','text'),
    jsonb_build_object('key','systemkw','label','System kW','type','number'),
    jsonb_build_object('key','city','label','City','type','text'),
    jsonb_build_object('key','state','label','State','type','text'),
    jsonb_build_object('key','consultant','label','Consultant','type','text')
  ),
  'atlas_canonical_installs_scheduled',
  'greg@gomicrogridenergy.com',
  'draft'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  example_questions = EXCLUDED.example_questions,
  parameter_schema = EXCLUDED.parameter_schema,
  result_columns = EXCLUDED.result_columns,
  function_name = EXCLUDED.function_name,
  status = CASE WHEN public.atlas_canonical_reports.status = 'verified' THEN 'draft' ELSE public.atlas_canonical_reports.status END,
  version = public.atlas_canonical_reports.version + 1,
  updated_at = now();
