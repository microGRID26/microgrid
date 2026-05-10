-- Backfill of MCP-applied migration `fix_maturity_constellation_null_asof_v2`
-- (version 20260510130426, applied 2026-05-10). #740 closes the v1.1 chain rule:
-- when an RPC patch is applied via MCP, mirror it into the local migrations dir.
--
-- supabase-js passes explicit NULL for `p_as_of: asOf ?? null` in app/maturity/page.tsx;
-- Postgres treats explicit NULL as the value (not a default-trigger), so the previous
-- `where captured_at::date <= p_as_of` matched zero rows and the constellation rendered empty.
-- Coalesce inside the function to be tolerant of explicit NULLs from the client.
CREATE OR REPLACE FUNCTION public.atlas_maturity_get_constellation(p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
declare
  result jsonb;
  v_as_of date := coalesce(p_as_of, current_date);
begin
  with latest as (
    select distinct on (project_slug, axis)
      project_slug, project_tier, axis, score, raw_value, captured_at
    from atlas_codebase_maturity_snapshots
    where captured_at::date <= v_as_of
    order by project_slug, axis, captured_at desc
  ),
  latest_tier as (
    select distinct on (project_slug)
      project_slug, project_tier as tier
    from atlas_codebase_maturity_snapshots
    where captured_at::date <= v_as_of
    order by project_slug, captured_at desc
  ),
  per_project as (
    select
      l.project_slug,
      lt.tier,
      jsonb_object_agg(l.axis, jsonb_build_object('score', l.score, 'raw', l.raw_value)) as axes,
      max(l.captured_at) as last_snapshot_at
    from latest l join latest_tier lt using (project_slug)
    group by l.project_slug, lt.tier
  ),
  with_score as (
    select
      project_slug, tier, axes, last_snapshot_at,
      (select round(avg((value->>'score')::numeric))
         from jsonb_each(axes)
         where (value->>'score') is not null) as headline_score
    from per_project
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', project_slug,
    'tier', tier,
    'axis_breakdown', axes,
    'headline_score', headline_score,
    'last_snapshot_at', last_snapshot_at
  )), '[]'::jsonb)
  into result
  from with_score;

  return result;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_maturity_get_constellation(date) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_maturity_get_constellation(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_maturity_get_constellation(date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_maturity_get_constellation(date) TO service_role;
