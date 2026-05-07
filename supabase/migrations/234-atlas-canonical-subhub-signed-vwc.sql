-- 234-atlas-canonical-subhub-signed-vwc.sql
--
-- Second canonical report: SubHub-truth booked sales for an EC, with
-- VWC-status proxy. Source-of-truth is the welcome_call_logs table (raw
-- SubHub project_export events), NOT the projects table — projects has a
-- 90-row gap for Regan because the SubHub→projects ingest pipeline only
-- started 2026-03-14 while welcome_call_logs has been receiving events
-- the whole time.
--
-- Scope per Greg 2026-05-06: "we only care about projects from SubHub.
-- And we don't want any tests. They need to have signed contracts and
-- we need to know if they have a virtual welcome call."
--
-- Translates to:
--   * Source: welcome_call_logs (SubHub event log) — distinct on subhub_id
--     keeping the most recent event per project (status updates).
--   * No tests: SubHub payload has no test flag and Regan has 0
--     disposition='Test' rows — accept as-is.
--   * Signed contracts: iso_format_contract_signed_date IS NOT NULL.
--   * VWC status: derived from payload->>'stage'. SubHub doesn't fire VWC-
--     specific events (event_type is always 'project_export'), so we infer
--     from stage progression:
--       'Completed','Install','Permitting','Inspection','Site Survey','Design','Agreement Signing'
--          → 'likely_yes' (project moved past welcome stage)
--       '', NULL, 'Evaluation' → 'pending' (no signal yet)
--       'Cancelled' → excluded entirely
--
-- Excludes Cancelled rows from the result. Returns one row per distinct
-- subhub_id. Also surfaces in_mg_projects so Greg can see which deals
-- need to be backfilled into the projects table.

CREATE OR REPLACE FUNCTION public.atlas_canonical_subhub_signed_with_vwc(p_params jsonb)
RETURNS TABLE(
  subhub_id text,
  customer_name text,
  contract_signed_at timestamptz,
  stage text,
  vwc_status text,
  system_size_kw numeric,
  sales_organization text,
  in_mg_projects boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ec_name text := p_params->>'ec_name';
  v_since_raw text := p_params->>'since_date';
  v_since timestamptz;
BEGIN
  IF v_ec_name IS NULL OR v_ec_name = '' THEN
    RAISE EXCEPTION 'ec_name is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_since_raw IS NULL OR v_since_raw = '' THEN
    v_since := TIMESTAMPTZ '1900-01-01';
  ELSE
    BEGIN
      v_since := (v_since_raw::date)::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'since_date must be ISO date (YYYY-MM-DD): got %', v_since_raw
        USING ERRCODE = 'invalid_parameter_value';
    END;
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (wcl.payload->>'subhub_id')
      wcl.payload->>'subhub_id'                                          AS subhub_id,
      COALESCE(NULLIF(wcl.payload->>'customer_name',''), wcl.customer_name) AS customer_name,
      NULLIF(wcl.payload->>'iso_format_contract_signed_date','')::timestamptz AS contract_signed_at,
      NULLIF(wcl.payload->>'stage','')                                   AS stage,
      NULLIF(wcl.payload->>'system_size_kw','')::numeric                 AS system_size_kw,
      NULLIF(wcl.payload->>'organization_name','')                       AS sales_organization
    FROM public.welcome_call_logs wcl
    WHERE lower(wcl.payload->>'sales_representative_name') = lower(v_ec_name)
    -- R1 audit M1 — deterministic tiebreak on id when received_at is identical.
    ORDER BY wcl.payload->>'subhub_id', wcl.received_at DESC, wcl.id DESC
  )
  SELECT
    l.subhub_id,
    l.customer_name,
    l.contract_signed_at,
    l.stage,
    CASE
      WHEN l.stage IN ('Completed','Install','Permitting','Inspection','Site Survey','Design','Agreement Signing') THEN 'likely_yes'
      WHEN l.stage IS NULL OR l.stage = '' OR l.stage = 'Evaluation' THEN 'pending'
      ELSE 'unknown'
    END                                                                  AS vwc_status,
    l.system_size_kw,
    l.sales_organization,
    EXISTS (SELECT 1 FROM public.projects p WHERE p.subhub_id = l.subhub_id) AS in_mg_projects
  FROM latest l
  WHERE l.contract_signed_at IS NOT NULL
    AND l.contract_signed_at >= v_since
    AND COALESCE(l.stage,'') <> 'Cancelled'
  ORDER BY l.contract_signed_at DESC NULLS LAST, l.subhub_id;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_subhub_signed_with_vwc(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_subhub_signed_with_vwc(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_subhub_signed_with_vwc(jsonb) TO authenticated;

-- Seed catalog row (draft — Greg flips to verified after spot-check).
INSERT INTO public.atlas_canonical_reports (
  id, name, description, category,
  example_questions, parameter_schema, result_columns,
  function_name, owner, status
) VALUES (
  'subhub_signed_with_vwc',
  'SubHub Signed Contracts (with VWC status)',
  'SubHub-truth booked sales for an EC. Reads the welcome_call_logs SubHub event log (NOT the projects table — projects has a sync gap and misses ~90 of Regan''s SubHub deals). Filters to signed contracts since a date, distinct by subhub_id (keeping the most recent event), excluding Cancelled. VWC status is inferred from the SubHub stage value because SubHub doesn''t fire VWC-specific events (project_export only).',
  'sales',
  ARRAY[
    'How many SubHub deals does Regan have signed since last September',
    'Show me Regan Spencer''s SubHub deals with VWC status',
    'List all of {EC}''s signed SubHub contracts',
    'How many of Heidi''s SubHub deals have completed VWC',
    'Show SubHub deals for Regan since 9/1/2025'
  ],
  jsonb_build_object(
    'ec_name', jsonb_build_object(
      'type','string','required',true,
      'description','SubHub sales_representative_name (case-insensitive). Example: "Regan Spencer".'
    ),
    'since_date', jsonb_build_object(
      'type','date','required',false,'format','YYYY-MM-DD','default','1900-01-01',
      'description','Inclusive lower bound for contract_signed_date. Optional — omit for all-time.'
    )
  ),
  jsonb_build_array(
    jsonb_build_object('key','subhub_id','label','SubHub ID','type','text'),
    jsonb_build_object('key','customer_name','label','Customer','type','text'),
    jsonb_build_object('key','contract_signed_at','label','Contract Signed','type','date'),
    jsonb_build_object('key','stage','label','SubHub Stage','type','text'),
    jsonb_build_object('key','vwc_status','label','VWC Status','type','text'),
    jsonb_build_object('key','system_size_kw','label','System kW','type','number'),
    jsonb_build_object('key','sales_organization','label','Sales Org','type','text'),
    jsonb_build_object('key','in_mg_projects','label','In MG?','type','boolean')
  ),
  'atlas_canonical_subhub_signed_with_vwc',
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
