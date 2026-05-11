-- Together — Phase 1 (4/4): pg_cron auto-purge jobs.
-- Plan: ~/.claude/plans/together-14-day-challenge-plan.md Task 4
-- Spec: ~/.claude/plans/together-14-day-challenge-design.md §5.5 (M-4 mitigation)

-- Verified before authoring: pg_cron 1.6.4 is installed on MG (schema pg_catalog).

-- =========================================================================
-- 1. Purge source_value 90 days past challenge end (elder health-data retention)
-- =========================================================================
create or replace function public.together_purge_old_source_values()
returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_affected int;
begin
  update public.together_challenge_days d
    set source_value = null
    from public.together_challenges c
    where d.challenge_id = c.id
      and d.source_value is not null
      and c.status in ('completed','ended')
      and coalesce(c.completed_at, c.ends_at::timestamptz) < now() - interval '90 days';
  get diagnostics v_affected = row_count;
  return v_affected;
end$$;

revoke all on function public.together_purge_old_source_values() from public, anon, authenticated;

-- =========================================================================
-- 2. Purge stale rate-limit hits older than 25 hours
-- =========================================================================
create or replace function public.together_purge_old_rate_limits()
returns int
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_affected int;
begin
  delete from public.together_rate_limits where hit_at < now() - interval '25 hours';
  get diagnostics v_affected = row_count;
  return v_affected;
end$$;

revoke all on function public.together_purge_old_rate_limits() from public, anon, authenticated;

-- =========================================================================
-- 3. Schedule both jobs via pg_cron. Daily at 04:07 / 04:17 UTC (off-peak).
-- =========================================================================
select cron.schedule(
  'together_purge_source_values_daily',
  '7 4 * * *',
  $$select public.together_purge_old_source_values()$$
);

select cron.schedule(
  'together_purge_rate_limits_daily',
  '17 4 * * *',
  $$select public.together_purge_old_rate_limits()$$
);

comment on function public.together_purge_old_source_values() is
  'Elder health-data retention: NULL out source_value on completed/ended challenges 90 days past end. Cron: together_purge_source_values_daily @ 04:07 UTC.';
comment on function public.together_purge_old_rate_limits() is
  'Rate-limit table hygiene: delete hits older than 25h. Cron: together_purge_rate_limits_daily @ 04:17 UTC.';
