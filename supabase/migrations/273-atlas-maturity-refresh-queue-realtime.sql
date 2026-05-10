-- 273: maturity v1.5 — Realtime read on atlas_maturity_refresh_queue
--
-- Replaces the 30s × 10-iteration RefreshButton polling with a one-shot
-- Supabase Realtime channel. Owner authenticates with their session JWT;
-- Realtime evaluates the SELECT policy below per row per subscriber via
-- postgres_changes (legacy WAL) mode.
--
-- Why this is safe to add:
--   * SELECT-only policy. Service-role still writes (queue RPCs +
--     maturity_refresh_watcher.py); no INSERT/UPDATE/DELETE policy exposed.
--   * Owner-gate mirrors middleware.ts (atlas_hq_users.role='owner' + scope
--     contains 'atlas_hq' + active=true). atlas_is_hq_owner() is the single
--     SQL anchor for that check; widen it ONLY with a re-audit.
--   * requested_by is free-text email (PII). Single owner today (Greg);
--     when a 2nd owner exists, hash the column or add scoping per the
--     v1.2 deferral note in HANDOFF.md.
--
-- Future-extension hazard: if a feature wants the owner to UPDATE/DELETE
-- queue rows directly (e.g., a "cancel pending refresh" button), add an
-- explicit per-cmd policy and re-audit Realtime broadcast surface — today
-- ONLY service_role writes.

-- A. SECURITY DEFINER helper that mirrors middleware's owner check.
create or replace function public.atlas_is_hq_owner()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.atlas_hq_users u
    where u.auth_user_id = auth.uid()
      and u.role = 'owner'
      and u.active = true
      -- Mirrors middleware.ts:140 — NULL/empty scope defaults to atlas_hq
      -- (every pre-scope-migration row was for HQ).
      and 'atlas_hq' = any(coalesce(u.scope, array['atlas_hq']::text[]))
  );
$$;

revoke execute on function public.atlas_is_hq_owner() from public;
revoke execute on function public.atlas_is_hq_owner() from anon;
revoke execute on function public.atlas_is_hq_owner() from authenticated;
grant  execute on function public.atlas_is_hq_owner() to authenticated;
alter  function public.atlas_is_hq_owner() owner to postgres;
alter  function public.atlas_is_hq_owner() set statement_timeout = '500ms';

-- B. RLS read policy on the queue (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'atlas_maturity_refresh_queue'
      and policyname = 'atlas_maturity_refresh_queue_owner_read'
  ) then
    create policy atlas_maturity_refresh_queue_owner_read
      on public.atlas_maturity_refresh_queue
      for select to authenticated
      using (public.atlas_is_hq_owner());
  end if;
end $$;

-- C. Add to realtime publication (idempotent). Mode: postgres_changes (legacy
-- WAL). RLS evaluated per-row per-subscriber via the SELECT policy above. If
-- a future migration switches to Broadcast-from-DB, channel ACL in
-- realtime.messages must be added in the same migration.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname    = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'atlas_maturity_refresh_queue'
  ) then
    alter publication supabase_realtime add table public.atlas_maturity_refresh_queue;
  end if;
end $$;

comment on column public.atlas_maturity_refresh_queue.requested_by is
  'Free-text email. PII. Realtime broadcasts this column to authorized subscribers. Re-audit before widening atlas_is_hq_owner() (v1.2 deferred PII-hash follow-up still open).';
