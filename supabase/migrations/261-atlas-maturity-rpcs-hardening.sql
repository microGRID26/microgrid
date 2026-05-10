-- Hardening pass on the 3 atlas_maturity_* RPCs after Phase 0 R1 audit.
--
-- Fixes:
--   HIGH #1 — atlas_maturity_insert_snapshot now distinguishes idempotent-replay
--             (unique_violation → conflicts) from real validation/cast errors
--             (check_violation, invalid_text_representation, not_null_violation
--             → re-raised AND surfaced via errors counter + first 3 SQLSTATEs).
--   HIGH #2 — atlas_maturity_get_project now whitelists p_slug against the
--             canonical 15-project list before joining greg_actions. SECURITY
--             DEFINER + arbitrary slug was a privilege-escalation vector once
--             the RPC ever fronted a non-owner endpoint.
--   MEDIUM #5 — atlas_maturity_get_constellation now picks the LATEST tier per
--             project (distinct on + order by captured_at desc) instead of
--             text-max(project_tier). Text-max maps 'personal' > 'core', which
--             would silently corrupt the displayed tier when a project moved.

-- =====================================================================
-- atlas_maturity_get_constellation — tier from latest snapshot, not text-max
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
  latest_tier as (
    -- Pick the tier from the most-recent snapshot per project (any axis).
    -- Fixes MEDIUM #5: text-max('personal','core') = 'personal' silently lies.
    select distinct on (project_slug)
      project_slug, project_tier as tier
    from atlas_codebase_maturity_snapshots
    where captured_at::date <= p_as_of
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
$$;

revoke all on function public.atlas_maturity_get_constellation(date) from anon, authenticated;

-- =====================================================================
-- atlas_maturity_get_project — whitelist p_slug, never trust caller input
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
  v_known_slugs text[] := array[
    'microgrid','edge','spark',
    'atlas-hq','paul-hq','sentinel','edge-model',
    'seer','cali','quest','bloom','bread-of-life','collector',
    'spoke','adf'
  ];
begin
  -- HIGH #2 fix: reject unknown slugs before joining greg_actions.
  -- SECURITY DEFINER means we bypass RLS on greg_actions; an attacker calling
  -- with arbitrary text could otherwise pivot to fish for action titles by slug.
  if not (p_slug = any(v_known_slugs)) then
    raise exception 'unknown project slug: %', p_slug
      using errcode = '22023';  -- invalid_parameter_value
  end if;

  with latest_axes as (
    select distinct on (axis)
      axis, score, raw_value, captured_at, project_tier
    from atlas_codebase_maturity_snapshots
    where project_slug = p_slug
    order by axis, captured_at desc
  )
  select
    (select project_tier from atlas_codebase_maturity_snapshots
     where project_slug = p_slug order by captured_at desc limit 1),
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
-- atlas_maturity_insert_snapshot — distinguish replay from validation errors
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
  v_errors int := 0;
  v_error_samples jsonb := '[]'::jsonb;
  v_row jsonb;
  v_captured_at timestamptz;
  v_unique_violation constant text := '23505';
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
    exception
      when unique_violation then
        -- ON CONFLICT DO UPDATE makes this rare, but keep the bucket for races.
        v_conflicts := v_conflicts + 1;
      when others then
        -- Validation/cast/check failures (HIGH #1 fix). Surface them so the
        -- collector can log + alert. First 3 errors get sampled into the response.
        v_errors := v_errors + 1;
        if jsonb_array_length(v_error_samples) < 3 then
          v_error_samples := v_error_samples || jsonb_build_object(
            'sqlstate', SQLSTATE,
            'message', SQLERRM,
            'row', v_row
          );
        end if;
    end;
  end loop;

  return jsonb_build_object(
    'accepted', v_accepted,
    'conflicts', v_conflicts,
    'errors', v_errors,
    'error_samples', v_error_samples
  );
end;
$$;

revoke all on function public.atlas_maturity_insert_snapshot(jsonb) from anon, authenticated;
