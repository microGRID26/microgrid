-- Add `owner_project` to atlas_recent_run_statuses output.
--
-- Phase 2 R1 of the /intel redesign caught that fetchRecentRunStatuses
-- applies the work-safe filter using only `agent_slug` because the RPC
-- doesn't return owner_project. The slug-only path desyncs from
-- atlas_list_agents (which checks BOTH slug AND owner_project),
-- under-reporting run history for agents whose slug doesn't carry a
-- work keyword but whose owner_project does (e.g., a slug like
-- "email-digest" owned by MicroGRID).
--
-- Postgres doesn't allow changing RETURNS TABLE shape via CREATE OR
-- REPLACE, so DROP first then re-create. RPC was applied 2026-04-29
-- and has zero consumers in production yet — safe to re-shape.

DROP FUNCTION IF EXISTS public.atlas_recent_run_statuses(int);

CREATE OR REPLACE FUNCTION public.atlas_recent_run_statuses(
  p_per_agent_limit int default 14
)
  RETURNS TABLE(
    agent_slug text,
    owner_project text,
    started_at timestamptz,
    status text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $function$
  with bounded as (
    select greatest(1, least(coalesce(p_per_agent_limit, 14), 100)) as n
  ),
  ranked as (
    select
      r.agent_slug,
      a.owner_project,
      r.started_at,
      r.status,
      row_number() over (
        partition by r.agent_slug
        order by r.started_at desc
      ) as rn
    from atlas_agent_runs r
    left join atlas_agents a on a.slug = r.agent_slug
  )
  select agent_slug, owner_project, started_at, status
  from ranked, bounded
  where rn <= bounded.n
  order by agent_slug, started_at desc;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_recent_run_statuses(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_recent_run_statuses(int) TO service_role;
