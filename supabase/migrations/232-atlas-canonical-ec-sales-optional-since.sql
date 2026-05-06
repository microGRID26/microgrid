-- 232-atlas-canonical-ec-sales-optional-since.sql
--
-- Make since_date optional on atlas_canonical_ec_booked_sales_since.
-- Real-world question patterns Greg sent in are date-less ("how many sales
-- is Greg Kelsch listed as the EC") — without a default, the router refuses
-- with "Missing required param: since_date" and falls through to the legacy
-- LLM, which generates an unverified table answer.
--
-- Default: '1900-01-01' — truly all-time. (R1 audit M3, 2026-05-06: an
-- earlier draft used '2020-01-01' as "effectively all-time" but TriSMART/
-- MG legacy NetSuite imports may include pre-2020 sales; '1900-01-01' lets
-- the data speak for itself without silent exclusion.)
--
-- Catalog metadata also updated so the router prompt sees since_date as
-- optional + knows the default. Existing verified row stays verified
-- (verified_params still {ec_name:'Regan Spencer', since_date:'2025-09-01'},
-- expected_row_count still 171 for that exact query — drift detection
-- behaves the same on the verified path).

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
AS $fn$
DECLARE
  v_ec_name text := p_params->>'ec_name';
  v_since_raw text := p_params->>'since_date';
  v_since_date date;
BEGIN
  IF v_ec_name IS NULL OR v_ec_name = '' THEN
    RAISE EXCEPTION 'ec_name is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- since_date is now OPTIONAL. NULL or missing → '1900-01-01' (effectively
  -- all time for MicroGRID's project history).
  IF v_since_raw IS NULL OR v_since_raw = '' THEN
    v_since_date := DATE '1900-01-01';
  ELSE
    BEGIN
      v_since_date := v_since_raw::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'since_date must be ISO date (YYYY-MM-DD): got %', v_since_raw
        USING ERRCODE = 'invalid_parameter_value';
    END;
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
END $fn$;

REVOKE EXECUTE ON FUNCTION public.atlas_canonical_ec_booked_sales_since(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_canonical_ec_booked_sales_since(jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_canonical_ec_booked_sales_since(jsonb) TO authenticated;

-- Update catalog row's parameter_schema so the router prompt knows
-- since_date is optional + has a default. Add a few date-less example
-- questions so the router's exact-match logic catches them without
-- needing to do param_tweak inference.
UPDATE public.atlas_canonical_reports
SET
  parameter_schema = jsonb_build_object(
    'ec_name', jsonb_build_object(
      'type', 'string',
      'required', true,
      'description', 'Consultant full name as it appears in projects.consultant (case-insensitive). Example: "Regan Spencer".'
    ),
    'since_date', jsonb_build_object(
      'type', 'date',
      'required', false,
      'format', 'YYYY-MM-DD',
      'default', '1900-01-01',
      'description', 'Inclusive lower bound for sale_date. Optional — omit to count all-time sales.'
    )
  ),
  example_questions = ARRAY[
    'How many sales has Regan had since last September?',
    'How many sales is Greg Kelsch listed as the Energy Consultant',
    'How many booked sales does Heidi have',
    'Show me Regan Spencer''s sales since 9/1/2025',
    'List all of Greg Kelsch''s sales',
    'Top sales for Regan this year'
  ],
  -- Editing a verified row would normally drop it back to draft, but the
  -- function's verified-param query is unchanged (Regan since 2025-09-01 = 171
  -- still) so we keep status='verified'. atlas_canonical_save_draft enforces
  -- the verified→draft drop; a direct UPDATE here intentionally preserves it.
  updated_at = now()
WHERE id = 'ec_booked_sales_since';
