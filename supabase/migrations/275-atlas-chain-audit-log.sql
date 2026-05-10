-- 275: chain audit log — persistent record of subagent audit findings
--
-- Captures every red-teamer / migration-planner / drift-checker / etc.
-- audit run keyed by (chain_slug, version, gate, agent_id). Future sessions
-- can answer "why is the helper using statement_timeout=500ms?" by querying
-- the log instead of re-running the audit. Also lets the chain see which
-- finding patterns recur (e.g. how many missing-grant Criticals across the
-- maturity chain — answer guides what the protocol-guard hook codifies).
--
-- Owner-only RLS via atlas_is_hq_owner() from mig 273.

create table if not exists public.atlas_chain_audit_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  chain_slug    text not null,                          -- e.g. 'maturity', 'spark-b5a'
  version       text not null,                          -- e.g. 'v1.5', 'phase-3'
  gate          text not null,                          -- 'spec' | 'pre-apply' | 'r1' | 'r2'
  agent         text not null,                          -- 'red-teamer' | 'migration-planner' | ...
  agent_id      text,                                   -- subagent run id for SendMessage resume
  grade         text,                                   -- 'A'..'F'
  critical      int  not null default 0,
  high          int  not null default 0,
  medium        int  not null default 0,
  low           int  not null default 0,
  findings_json jsonb not null default '[]'::jsonb,     -- array of {severity, file, summary, fix}
  notes         text
);

create index if not exists atlas_chain_audit_log_chain_idx
  on public.atlas_chain_audit_log (chain_slug, created_at desc);

alter table public.atlas_chain_audit_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='atlas_chain_audit_log'
      and policyname='atlas_chain_audit_log_owner_read'
  ) then
    create policy atlas_chain_audit_log_owner_read
      on public.atlas_chain_audit_log
      for select to authenticated
      using (public.atlas_is_hq_owner());
  end if;
end $$;

grant select on public.atlas_chain_audit_log to authenticated;

-- Insert RPC. service_role-only execute (atlas_audit_log.py uses the
-- service-role key); the script is the only writer.
create or replace function public.atlas_chain_audit_log_insert(
  p_chain_slug text,
  p_version    text,
  p_gate       text,
  p_agent      text,
  p_agent_id   text,
  p_grade      text,
  p_critical   int,
  p_high       int,
  p_medium     int,
  p_low        int,
  p_findings   jsonb,
  p_notes      text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  set local statement_timeout = '5s';
  insert into public.atlas_chain_audit_log
    (chain_slug, version, gate, agent, agent_id, grade,
     critical, high, medium, low, findings_json, notes)
  values
    (p_chain_slug, p_version, p_gate, p_agent, p_agent_id, p_grade,
     coalesce(p_critical,0), coalesce(p_high,0),
     coalesce(p_medium,0),   coalesce(p_low,0),
     coalesce(p_findings,'[]'::jsonb), p_notes)
  returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.atlas_chain_audit_log_insert(
  text, text, text, text, text, text, int, int, int, int, jsonb, text
) from public;
revoke execute on function public.atlas_chain_audit_log_insert(
  text, text, text, text, text, text, int, int, int, int, jsonb, text
) from anon;
revoke execute on function public.atlas_chain_audit_log_insert(
  text, text, text, text, text, text, int, int, int, int, jsonb, text
) from authenticated;
grant  execute on function public.atlas_chain_audit_log_insert(
  text, text, text, text, text, text, int, int, int, int, jsonb, text
) to service_role;
alter  function public.atlas_chain_audit_log_insert(
  text, text, text, text, text, text, int, int, int, int, jsonb, text
) owner to postgres;

comment on table public.atlas_chain_audit_log is
  'Persistent record of subagent audit findings (red-teamer, migration-planner, etc.) per chain version + gate. Source of truth for "why is this code shape?" Q&A. Logged via ~/.claude/scripts/atlas_audit_log.py.';
