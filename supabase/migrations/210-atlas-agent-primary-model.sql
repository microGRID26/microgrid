-- 210-atlas-agent-primary-model.sql
-- Adds atlas_agents.primary_model so the /intel MODEL column reads from data,
-- not a hardcoded slug→model map in lib/intel/agent-display.ts.
-- Replaces atlas_list_agents_v2 to surface the new column. (#440)

begin;

alter table public.atlas_agents
  add column if not exists primary_model text;

comment on column public.atlas_agents.primary_model is
  'Short model slug (e.g. ''haiku-4-5'', ''sonnet-4-6'', ''opus-4-7'', ''gemini-2.5-pro'') the agent ' ||
  'primarily uses. NULL for non-LLM agents (DB / HTTP-only crons). Surfaced in the /intel MODEL column. ' ||
  'Update when you migrate a model version (e.g. haiku-4-5 → haiku-4-6).';

-- Seed values from the hardcoded AGENT_MODEL map curated 2026-04-30
-- in lib/intel/agent-display.ts. NULL = explicitly non-LLM.
update public.atlas_agents set primary_model = case slug
  -- ATLAS HQ — LLM agents
  when 'hq-atlas-ambient'        then 'haiku-4-5'
  when 'hq-atlas-chat'           then 'sonnet-4-6'
  when 'hq-feedback-fixer'       then 'sonnet-4-6'
  when 'hq-feedback-monitor'     then 'haiku-4-5'
  when 'hq-meeting-ingest'       then 'opus-4-7'
  when 'hq-morning-digest'       then 'haiku-4-5'
  when 'hq-qa-autofix'           then 'sonnet-4-6'
  when 'hq-release-summaries'    then 'haiku-4-5'
  when 'hq-spark-test-failures'  then 'sonnet-4-6'
  -- ATLAS HQ — non-LLM crons
  when 'hq-capture-snapshots'    then null
  when 'hq-cost-monitor'         then null
  when 'hq-refresh-cache'        then null
  -- MicroGRID — non-LLM crons
  when 'mg-email-digest'         then null
  when 'mg-email-onboarding-reminder' then null
  when 'mg-email-send-daily'     then null
  when 'mg-qa-runs-cleanup'      then null
  -- SENTINEL
  when 'sentinel-collect'        then 'haiku-4-5'
  when 'sentinel-digest'         then 'haiku-4-5'
  else primary_model
end
where slug in (
  'hq-atlas-ambient','hq-atlas-chat','hq-feedback-fixer','hq-feedback-monitor',
  'hq-meeting-ingest','hq-morning-digest','hq-qa-autofix','hq-release-summaries',
  'hq-spark-test-failures','hq-capture-snapshots','hq-cost-monitor','hq-refresh-cache',
  'mg-email-digest','mg-email-onboarding-reminder','mg-email-send-daily','mg-qa-runs-cleanup',
  'sentinel-collect','sentinel-digest'
);

-- RETURNS TABLE shape changes require drop+recreate.
drop function if exists public.atlas_list_agents_v2();

create or replace function public.atlas_list_agents_v2()
returns table(
  slug text, name text, type text, owner_project text, description text,
  schedule text, repo_url text, trigger_url text, enabled boolean,
  auto_disable_on_breach boolean, created_at timestamp with time zone,
  last_run_at timestamp with time zone, last_status text, last_items integer,
  last_duration_ms integer, runs_24h bigint, errors_24h bigint,
  cost_mtd numeric, cost_7d numeric,
  daily_budget_usd numeric, monthly_budget_usd numeric,
  cost_alert_email text, last_breach_level text, last_breach_alerted_at timestamp with time zone,
  cost_today_usd numeric, day_usage_pct numeric, month_usage_pct numeric,
  cache_hit_rate_24h numeric, cache_read_tokens_24h bigint, input_tokens_24h bigint,
  primary_model text
)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with latest as (
    select distinct on (agent_slug)
      agent_slug, started_at, finished_at, status, items_processed
    from atlas_agent_runs
    order by agent_slug, started_at desc
  ),
  today_usage as (
    select agent_slug, coalesce(sum(total_cost_usd), 0) as cost_today
    from atlas_cost_events
    where ts >= date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago'
    group by agent_slug
  ),
  week_usage as (
    select agent_slug, coalesce(sum(total_cost_usd), 0) as cost_7d
    from atlas_cost_events
    where ts > now() - interval '7 days'
    group by agent_slug
  ),
  month_usage as (
    select agent_slug, coalesce(sum(total_cost_usd), 0) as cost_mtd
    from atlas_cost_events
    where ts >= date_trunc('month', now())
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
    coalesce(m.cost_mtd, 0) as cost_mtd,
    coalesce(w.cost_7d, 0) as cost_7d,
    a.daily_budget_usd, a.monthly_budget_usd,
    a.cost_alert_email, a.last_breach_level, a.last_breach_alerted_at,
    coalesce(t.cost_today, 0) as cost_today_usd,
    case when a.daily_budget_usd is not null and a.daily_budget_usd > 0
      then round((coalesce(t.cost_today, 0) / a.daily_budget_usd * 100)::numeric, 2)
    end as day_usage_pct,
    case when a.monthly_budget_usd is not null and a.monthly_budget_usd > 0
      then round((coalesce(m.cost_mtd, 0) / a.monthly_budget_usd * 100)::numeric, 2)
    end as month_usage_pct,
    case when c.input_tokens + c.cache_read_tokens > 0
      then round((c.cache_read_tokens::numeric / (c.input_tokens + c.cache_read_tokens) * 100), 2)
    end as cache_hit_rate_24h,
    coalesce(c.cache_read_tokens, 0) as cache_read_tokens_24h,
    coalesce(c.input_tokens, 0) as input_tokens_24h,
    a.primary_model
  from atlas_agents a
  left join latest      l on l.agent_slug = a.slug
  left join today_usage t on t.agent_slug = a.slug
  left join week_usage  w on w.agent_slug = a.slug
  left join month_usage m on m.agent_slug = a.slug
  left join cache_rollup c on c.agent_slug = a.slug
  order by a.owner_project, a.slug;
$function$;

-- Grants: keep Postgres default (PUBLIC has EXECUTE on new functions) to
-- match the prior function's effective grants (postgres + service_role +
-- PUBLIC). PostgREST calls this from the anon role via PUBLIC.

commit;
