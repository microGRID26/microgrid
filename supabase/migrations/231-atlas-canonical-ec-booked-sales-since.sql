-- 231-atlas-canonical-ec-booked-sales-since.sql
--
-- First canonical report (P2 of ~/.claude/plans/twinkly-jumping-thimble.md).
-- Shipped as DRAFT; flipped to verified by atlas_canonical_verify after
-- Greg spot-checks 5 representative rows.
--
-- "Booked sales attributed to a consultant since a date."
-- Filter rule (anchor: docs/atlas/disposition-canonical.md):
--   lower(consultant) = lower(:ec_name)   -- exact match, case-insensitive
--   AND NULLIF(sale_date,'')::date >= :since_date
--   AND COALESCE(disposition,'') NOT IN ('Cancel','Cancelled','Test','Loss','Legal','On Hold')
--
-- Why exact-match and not ILIKE: ILIKE honors %/_ wildcards, so an LLM
-- router that infers ec_name='%' (e.g. "show all sales since June" → match
-- any consultant) would silently widen the report. Exact-case-insensitive
-- match keeps the report scoped to a single named consultant. (R1 audit
-- M1, 2026-05-06.)
--
-- Includes: 'Sale' AND 'Loyalty' (post-sale customer state — counted as sale).
-- Excludes: terminal-state dispositions only.
-- Attribution: consultant column (primary EC of record). Advisor-only rows
-- are not counted by this report.
--
-- For Regan Spencer since 2025-09-01 this returns 171 rows (= 166 Sale + 5
-- Loyalty). Greg's reference number 175 came from a tool with unknown
-- attribution (could be advisor-included or NetSuite-side imports);
-- reproducing it requires NetSuite saved-search export, which is not yet
-- accessible to Atlas. The 4-row gap is documented in the verification row.
--
-- Function is SECURITY INVOKER (default) so the wrapper RPC's SET LOCAL
-- ROLE authenticated pushes RLS on projects through to this query.

CREATE OR REPLACE FUNCTION public.atlas_canonical_ec_booked_sales_since(p_params jsonb)
RETURNS TABLE(
  project_id text,
  customer_name text,
  sale_date date,
  disposition text,
  systemkw numeric,
  consultant text,
  advisor text,
  stage text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_ec_name text := p_params->>'ec_name';
  v_since_date date;
BEGIN
  IF v_ec_name IS NULL OR v_ec_name = '' THEN
    RAISE EXCEPTION 'ec_name is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  BEGIN
    v_since_date := (p_params->>'since_date')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'since_date must be ISO date (YYYY-MM-DD): got %', p_params->>'since_date'
      USING ERRCODE = 'invalid_parameter_value';
  END;
  IF v_since_date IS NULL THEN
    RAISE EXCEPTION 'since_date is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  SELECT
    p.id::text                                       AS project_id,
    p.name                                           AS customer_name,
    NULLIF(p.sale_date,'')::date                     AS sale_date,
    COALESCE(NULLIF(p.disposition,''),'<empty>')     AS disposition,
    NULLIF(p.systemkw,'')::numeric                   AS systemkw,
    p.consultant                                     AS consultant,
    p.advisor                                        AS advisor,
    p.stage                                          AS stage
  FROM public.projects p
  WHERE lower(p.consultant) = lower(v_ec_name)
    AND NULLIF(p.sale_date,'')::date >= v_since_date
    AND COALESCE(p.disposition,'') NOT IN ('Cancel','Cancelled','Test','Loss','Legal','On Hold')
  ORDER BY NULLIF(p.sale_date,'')::date DESC NULLS LAST, p.id;
END $$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_ec_booked_sales_since(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_ec_booked_sales_since(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_ec_booked_sales_since(jsonb) TO authenticated;

-- Seed the catalog row as DRAFT. atlas_canonical_save_draft is admin-only,
-- but seeding via direct INSERT here is fine (migration runs as superuser).
-- Status flips to verified by Greg via atlas_canonical_verify after spot-check.
INSERT INTO public.atlas_canonical_reports (
  id, name, description, category,
  example_questions, parameter_schema, result_columns,
  function_name, owner, status
) VALUES (
  'ec_booked_sales_since',
  'EC Booked Sales Since Date',
  'Booked sales attributed to a consultant (EC of record) since a given date. Includes Sale + Loyalty dispositions; excludes terminal states (Cancel/Cancelled/Test/Loss/Legal/On Hold). See docs/atlas/disposition-canonical.md for the rule lock.',
  'sales',
  ARRAY[
    'How many sales has Regan had since last September?',
    'Show me Regan Spencer''s sales since 9/1/2025',
    'How many booked sales does {EC} have since {date}?',
    'List Heidi''s sales since June 1',
    'Top sales for Regan this year'
  ],
  jsonb_build_object(
    'ec_name', jsonb_build_object(
      'type', 'string',
      'required', true,
      'description', 'Consultant full name as it appears in projects.consultant (case-insensitive). Example: "Regan Spencer".'
    ),
    'since_date', jsonb_build_object(
      'type', 'date',
      'required', true,
      'format', 'YYYY-MM-DD',
      'description', 'Inclusive lower bound for sale_date.'
    )
  ),
  jsonb_build_array(
    jsonb_build_object('key','project_id','label','Project','type','text'),
    jsonb_build_object('key','customer_name','label','Customer','type','text'),
    jsonb_build_object('key','sale_date','label','Sale Date','type','date'),
    jsonb_build_object('key','disposition','label','Disposition','type','text'),
    jsonb_build_object('key','systemkw','label','System kW','type','number'),
    jsonb_build_object('key','consultant','label','Consultant','type','text'),
    jsonb_build_object('key','advisor','label','Advisor','type','text'),
    jsonb_build_object('key','stage','label','Stage','type','text')
  ),
  'atlas_canonical_ec_booked_sales_since',
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
  -- Re-running this migration on a verified row drops it back to draft so
  -- the operator re-verifies after any code change.
  status = CASE WHEN public.atlas_canonical_reports.status = 'verified' THEN 'draft' ELSE public.atlas_canonical_reports.status END,
  version = public.atlas_canonical_reports.version + 1,
  updated_at = now();
