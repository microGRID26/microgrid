-- 315-seer-atlas-tab-phase1
--
-- Phase 1 of the Seer Atlas tab build (spec: ~/.claude/plans/seer-atlas-tab.md).
-- (Renumbered from 314 to 315 mid-execution after a parallel session shipped
--  314-seer-feedback-status-and-resolve in the same hour. DB apply succeeded
--  under the migration-table name `seer_atlas_tab_phase1`.)
--
-- Adds two owner-gated tables:
--   - seer_atlas_messages — single rolling thread per owner. Content stored as
--     Claude Messages content-block JSONB (text / tool_use / tool_result) so
--     the edge function passes raw rows to Anthropic without transformation.
--   - seer_atlas_daily_usage — per-UTC-day token + request count, used to
--     enforce a per-day cost cap (default 500K input + 100K output ~ $3/day on
--     Sonnet 4.6).
--
-- Plus one RPC `seer_atlas_thread_load(p_limit int default 200)` that returns
-- the most recent messages in chronological order. Client calls this on mount.
--
-- All access gated by atlas_hq_is_owner(auth.uid()) — Seer is single-tenant
-- owner-only, mirrors the pattern used by seer_feed_list etc.

create table if not exists public.seer_atlas_messages (
  id          bigserial primary key,
  owner_id    uuid not null default auth.uid(),
  role        text not null check (role in ('user', 'assistant', 'tool_use', 'tool_result')),
  content     jsonb not null check (jsonb_typeof(content) = 'array'),
  model       text,
  is_memory_summary boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.seer_atlas_messages enable row level security;

create policy "atlas messages owner only"
  on public.seer_atlas_messages for all to authenticated
  using (atlas_hq_is_owner(auth.uid()))
  with check (atlas_hq_is_owner(auth.uid()));

revoke all on public.seer_atlas_messages from public, anon;
grant select, insert, update, delete on public.seer_atlas_messages to authenticated;
grant usage, select on sequence public.seer_atlas_messages_id_seq to authenticated;

create index if not exists seer_atlas_messages_owner_created_idx
  on public.seer_atlas_messages (owner_id, created_at);

create table if not exists public.seer_atlas_daily_usage (
  owner_id      uuid not null default auth.uid(),
  utc_day       date not null default (now() at time zone 'utc')::date,
  input_tokens  int  not null default 0,
  output_tokens int  not null default 0,
  request_count int  not null default 0,
  primary key (owner_id, utc_day)
);

alter table public.seer_atlas_daily_usage enable row level security;

create policy "atlas usage owner only"
  on public.seer_atlas_daily_usage for all to authenticated
  using (atlas_hq_is_owner(auth.uid()))
  with check (atlas_hq_is_owner(auth.uid()));

revoke all on public.seer_atlas_daily_usage from public, anon;
grant select, insert, update on public.seer_atlas_daily_usage to authenticated;

create or replace function public.seer_atlas_thread_load(p_limit int default 200)
returns table (
  id bigint,
  role text,
  content jsonb,
  model text,
  is_memory_summary boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, role, content, model, is_memory_summary, created_at
  from public.seer_atlas_messages
  where owner_id = auth.uid()
    and atlas_hq_is_owner(auth.uid())
  order by created_at asc
  limit p_limit;
$$;

revoke all on function public.seer_atlas_thread_load(int) from public, anon;
grant execute on function public.seer_atlas_thread_load(int) to authenticated;
