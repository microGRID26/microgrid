-- Backfill of MCP-applied migration `maturity_headline_excludes_provisional_axes`
-- (version 20260510134335, applied 2026-05-10). #740 chain-rule mirror.
--
-- Stub axes (audit, rls today) carry `_provisional: true` in their raw_value and
-- score 100 by default — that drags every project's headline toward 100 even when
-- real signals (typecheck, ci, velocity) tell a different story. Excluding
-- provisional rows from the headline_score average makes the constellation read
-- the real variance: e.g., microgrid drops from 100 → ~67 because ci=0/30 deploys.
-- Per #730 (Option A — hide stubs from headline until real scanners land).
--
-- NOTE: this version uses `::boolean` cast — superseded by 262c which switches to
-- safe text membership. Keep the file for chain history.
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
         where (value->>'score') is not null
           and coalesce((value->'raw'->>'_provisional')::boolean, false) = false
      ) as headline_score
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
