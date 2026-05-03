-- Bulk run-status history for the ATLAS HQ /intel page.
-- Returns the last N runs of every registered agent in one round-trip,
-- so the Agent Runs view can render a per-agent sparkline without
-- N+1 fan-out (one HTTP request per agent).
--
-- Greg's ask 2026-04-29 (Phase 2 of /intel redesign): the existing
-- per-agent endpoint /api/intel/agents/runs?slug=...&limit=20 is fine
-- for the drawer (one agent at a time), but the table view needs trend
-- data for ~18 agents at once. Calling that endpoint 18 times on every
-- page load would be wasteful; this RPC pulls everything in a single
-- partitioned-window query.
--
-- Output shape: one row per (agent_slug, started_at, status). Caller
-- groups by agent_slug client-side.
--
-- Limit is clamped to [1, 100] inside the function to bound payload size.

CREATE OR REPLACE FUNCTION public.atlas_recent_run_statuses(
  p_per_agent_limit int default 14
)
  RETURNS TABLE(
    agent_slug text,
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
      r.started_at,
      r.status,
      row_number() over (
        partition by r.agent_slug
        order by r.started_at desc
      ) as rn
    from atlas_agent_runs r
  )
  select agent_slug, started_at, status
  from ranked, bounded
  where rn <= bounded.n
  order by agent_slug, started_at desc;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_recent_run_statuses(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_recent_run_statuses(int) TO service_role;
