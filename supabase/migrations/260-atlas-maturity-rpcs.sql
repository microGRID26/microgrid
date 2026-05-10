-- atlas_maturity_get_constellation / get_project / insert_snapshot
--
-- Three SECURITY DEFINER RPCs that ATLAS HQ calls via service role.
-- All grants to anon + authenticated explicitly REVOKEd; only service_role bypass works.
-- search_path locked to 'public' to defeat search_path injection.
--
-- Drift notes (production reality vs original plan):
--   - greg_actions uses `added_at` (not `created_at`) for ordering.
--   - red_team_findings table does not exist on MG yet; recent_findings returns empty array.
--     When the findings store is wired (v1.1 — likely from atlas_session_recaps audit logs),
--     re-CREATE OR REPLACE this function to populate the field.

-- =====================================================================
-- atlas_maturity_get_constellation(p_as_of date)
-- Returns one row per project as of the given date (defaults today).
-- =====================================================================
create or replace function public.atlas_maturity_get_constellation(p_as_of date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  with latest as (
    select distinct on (project_slug, axis)
      project_slug, project_tier, axis, score, raw_value, captured_at
    from atlas_codebase_maturity_snapshots
    where captured_at::date <= p_as_of
    order by project_slug, axis, captured_at desc
  ),
  per_project as (
    select
      project_slug,
      max(project_tier) as tier,
      jsonb_object_agg(axis, jsonb_build_object('score', score, 'raw', raw_value)) as axes,
      max(captured_at) as last_snapshot_at
    from latest
    group by project_slug
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
$$;

revoke all on function public.atlas_maturity_get_constellation(date) from anon, authenticated;

-- =====================================================================
-- atlas_maturity_get_project(p_slug text, p_days int)
-- Per-project deep-dive: radar, 90d trend per axis, related actions, deps.
-- recent_findings returns [] until red_team_findings table is wired (v1.1).
-- =====================================================================
create or replace function public.atlas_maturity_get_project(p_slug text, p_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_tier text;
  v_headline int;
begin
  -- latest score per axis for the headline
  with latest_axes as (
    select distinct on (axis)
      axis, score, raw_value, captured_at, project_tier
    from atlas_codebase_maturity_snapshots
    where project_slug = p_slug
    order by axis, captured_at desc
  )
  select
    max(project_tier),
    round(avg(score) filter (where score is not null))::int
  into v_tier, v_headline
  from latest_axes;

  with trend as (
    select axis, captured_at::date as day, max(score) as score
    from atlas_codebase_maturity_snapshots
    where project_slug = p_slug
      and captured_at >= now() - (p_days || ' days')::interval
    group by axis, captured_at::date
  ),
  axis_radar as (
    select distinct on (axis)
      axis, score, raw_value
    from atlas_codebase_maturity_snapshots
    where project_slug = p_slug
    order by axis, captured_at desc
  ),
  related_actions as (
    select id, priority, title
    from public.greg_actions
    where project = p_slug and status = 'open'
    order by case priority when 'P0' then 0 when 'P1' then 1 when 'P2' then 2 else 3 end, added_at desc
    limit 10
  ),
  deps as (
    select from_slug, to_slug, kind, intensity
    from public.atlas_codebase_maturity_dependencies
    where (from_slug = p_slug or to_slug = p_slug) and retired_at is null
  )
  select jsonb_build_object(
    'slug', p_slug,
    'tier', v_tier,
    'headline_score', v_headline,
    'axis_radar', (select coalesce(jsonb_agg(jsonb_build_object('axis', axis, 'score', score, 'raw', raw_value)), '[]'::jsonb) from axis_radar),
    'trend_per_axis', (select coalesce(jsonb_agg(jsonb_build_object('axis', axis, 'day', day, 'score', score)), '[]'::jsonb) from trend),
    'recent_findings', '[]'::jsonb,  -- TODO(v1.1): wire to red_team_findings or atlas_session_recaps audit log
    'related_actions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'priority', priority, 'title', title)), '[]'::jsonb) from related_actions),
    'dependencies', (select coalesce(jsonb_agg(jsonb_build_object('from_slug', from_slug, 'to_slug', to_slug, 'kind', kind, 'intensity', intensity)), '[]'::jsonb) from deps)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.atlas_maturity_get_project(text, int) from anon, authenticated;

-- =====================================================================
-- atlas_maturity_insert_snapshot(p_payload jsonb)
-- Idempotent batch insert from the collector. ON CONFLICT (captured_at, slug, axis) updates.
-- =====================================================================
create or replace function public.atlas_maturity_insert_snapshot(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_accepted int := 0;
  v_conflicts int := 0;
  v_row jsonb;
  v_captured_at timestamptz;
begin
  v_captured_at := (p_payload->>'captured_at')::timestamptz;
  if v_captured_at is null then
    raise exception 'captured_at required';
  end if;

  for v_row in select * from jsonb_array_elements(p_payload->'rows') loop
    begin
      insert into atlas_codebase_maturity_snapshots
        (captured_at, project_slug, project_tier, axis, raw_value, score, weighted_score, source)
      values (
        v_captured_at,
        v_row->>'project_slug',
        v_row->>'project_tier',
        v_row->>'axis',
        v_row->'raw_value',
        nullif(v_row->>'score', '')::int,
        nullif(v_row->>'weighted_score', '')::int,
        coalesce(v_row->>'source', 'collector')
      )
      on conflict (captured_at, project_slug, axis) do update set
        raw_value = excluded.raw_value,
        score = excluded.score,
        weighted_score = excluded.weighted_score,
        source = excluded.source;
      v_accepted := v_accepted + 1;
    exception when others then
      v_conflicts := v_conflicts + 1;
    end;
  end loop;

  return jsonb_build_object('accepted', v_accepted, 'conflicts', v_conflicts);
end;
$$;

revoke all on function public.atlas_maturity_insert_snapshot(jsonb) from anon, authenticated;
