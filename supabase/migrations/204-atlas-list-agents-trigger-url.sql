-- Add `trigger_url` to the atlas_list_agents RPC return shape so the
-- /intel Agent Runs view can decide which agents are triggerable
-- without a separate fetch.
--
-- DROP+CREATE because Postgres doesn't allow shape changes via
-- CREATE OR REPLACE on a function with a TABLE return type.
-- Brief gap (ms-scale) handled by lib/fleet/fetch.ts which catches
-- the error and returns []; HQ falls back to the empty-state.

DROP FUNCTION IF EXISTS public.atlas_list_agents();

CREATE OR REPLACE FUNCTION public.atlas_list_agents()
  RETURNS TABLE(
    slug text,
    name text,
    type text,
    owner_project text,
    description text,
    schedule text,
    repo_url text,
    trigger_url text,
    enabled boolean,
    auto_disable_on_breach boolean,
    created_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_status text,
    last_items integer,
    last_duration_ms integer,
    runs_24h bigint,
    errors_24h bigint,
    cost_mtd numeric,
    cost_7d numeric,
    daily_budget_usd numeric,
    monthly_budget_usd numeric,
    cost_alert_email text,
    last_breach_level text,
    last_breach_alerted_at timestamp with time zone,
    cost_today_usd numeric,
    day_usage_pct numeric,
    month_usage_pct numeric,
    cache_hit_rate_24h numeric,
    cache_read_tokens_24h bigint,
    input_tokens_24h bigint
  )
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  with latest as (
    select distinct on (agent_slug)
      agent_slug, started_at, finished_at, status, items_processed
    from atlas_agent_runs
    order by agent_slug, started_at desc
  ),
  today_usage as (
    select agent_slug, coalesce(sum(cost_usd), 0) as cost_today
    from atlas_agent_runs
    where started_at >= date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago'
    group by agent_slug
  ),
  week_usage as (
    select agent_slug, coalesce(sum(cost_usd), 0) as cost_7d
    from atlas_agent_runs
    where started_at > now() - interval '7 days'
    group by agent_slug
  ),
  cache_rollup as (
    select
      agent_slug,
      coalesce(sum((metadata -> 'usage_breakdown' ->> 'cache_read_tokens')::bigint), 0) as cache_read_tokens,
      coalesce(sum(input_tokens), 0) as input_tokens
    from atlas_agent_runs
    where started_at > now() - interval '24 hours'
    group by agent_slug
  )
  select
    a.slug, a.name, a.type, a.owner_project, a.description,
    a.schedule, a.repo_url, a.trigger_url, a.enabled, a.auto_disable_on_breach, a.created_at,
    l.started_at as last_run_at, l.status as last_status, l.items_processed as last_items,
    case when l.finished_at is not null and l.started_at is not null
      then extract(epoch from (l.finished_at - l.started_at))::int * 1000
    end as last_duration_ms,
    coalesce((select count(*) from atlas_agent_runs r
              where r.agent_slug = a.slug and r.started_at > now() - interval '24 hours'), 0) as runs_24h,
    coalesce((select count(*) from atlas_agent_runs r
              where r.agent_slug = a.slug and r.started_at > now() - interval '24 hours' and r.status = 'error'), 0) as errors_24h,
    coalesce((select sum(cost_usd) from atlas_agent_runs r
              where r.agent_slug = a.slug and r.started_at >= date_trunc('month', now())), 0) as cost_mtd,
    coalesce(w.cost_7d, 0) as cost_7d,
    a.daily_budget_usd, a.monthly_budget_usd,
    a.cost_alert_email, a.last_breach_level, a.last_breach_alerted_at,
    coalesce(t.cost_today, 0) as cost_today_usd,
    case when a.daily_budget_usd is not null and a.daily_budget_usd > 0
      then round((coalesce(t.cost_today, 0) / a.daily_budget_usd * 100)::numeric, 2)
    end as day_usage_pct,
    case when a.monthly_budget_usd is not null and a.monthly_budget_usd > 0
      then round((
        coalesce((select sum(cost_usd) from atlas_agent_runs r
                  where r.agent_slug = a.slug and r.started_at >= date_trunc('month', now())), 0)
        / a.monthly_budget_usd * 100
      )::numeric, 2)
    end as month_usage_pct,
    case when c.input_tokens + c.cache_read_tokens > 0
      then round((c.cache_read_tokens::numeric / (c.input_tokens + c.cache_read_tokens) * 100), 2)
    end as cache_hit_rate_24h,
    coalesce(c.cache_read_tokens, 0) as cache_read_tokens_24h,
    coalesce(c.input_tokens, 0) as input_tokens_24h
  from atlas_agents a
  left join latest l on l.agent_slug = a.slug
  left join today_usage t on t.agent_slug = a.slug
  left join week_usage w on w.agent_slug = a.slug
  left join cache_rollup c on c.agent_slug = a.slug
  order by a.owner_project, a.slug;
$function$;

-- Pin search_path explicitly (sibling form picked up by atlas-fn-grant-guard).
ALTER FUNCTION public.atlas_list_agents() SET search_path = public, pg_temp;

-- Default GRANT to PUBLIC must be revoked; service_role keeps EXECUTE.
-- Same posture as every other atlas_* read RPC (see 199, 201, 202).
REVOKE EXECUTE ON FUNCTION public.atlas_list_agents() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_agents() TO service_role;
