-- atlas_maturity_refresh_queue + RPCs.
--
-- Backs the v1.2 Refresh button on /maturity. Queue is a tiny coordination
-- table read/written by service_role only:
--   - atlas-hq POST /api/maturity/refresh inserts a row when the owner clicks Refresh.
--   - A launchd helper on Greg's Mac (~/.claude/scripts/maturity_refresh_watcher.py)
--     polls atlas_maturity_claim_refresh() every 30s, runs maturity_collector.py
--     --ad-hoc on a hit, and calls atlas_maturity_complete_refresh(id) when done.
--
-- Concurrency: claim uses FOR UPDATE SKIP LOCKED so two helpers (or a hot launchd
-- relaunch) cannot double-claim. Stale rows (>1h unclaimed) are ignored — Mac
-- offline + click-spam shouldn't replay a day-old request.

create table if not exists public.atlas_maturity_refresh_queue (
  id            uuid primary key default gen_random_uuid(),
  requested_at  timestamptz not null default now(),
  requested_by  text,                     -- owner email; informational only
  claimed_at    timestamptz,              -- null until a watcher picks it up
  completed_at  timestamptz,              -- null until the collector finishes
  result        text                      -- 'ok' | 'failed:<reason>' | null
);

-- Index supports the claim path: oldest unclaimed within freshness window.
create index if not exists idx_maturity_refresh_queue_open
  on public.atlas_maturity_refresh_queue (requested_at)
  where claimed_at is null;

alter table public.atlas_maturity_refresh_queue enable row level security;
-- Default deny — no policies declared. Only service_role + the SECURITY DEFINER
-- RPCs below ever touch this table.
revoke all on public.atlas_maturity_refresh_queue from anon, authenticated;


-- =====================================================================
-- atlas_maturity_request_refresh — owner-initiated wake signal.
-- Called by atlas-hq /api/maturity/refresh after session/owner check.
-- Returns the new row id so the client can correlate completion later.
-- =====================================================================
-- Idempotent coalesce: if a fresh unclaimed row already exists (within 2 min),
-- return ITS id instead of inserting a new one. Defends against owner click-spam
-- and stuck setIntervals from leaked tabs that would otherwise enqueue thousands
-- of rows and pin Greg's Mac through serialized 5-min collector runs.
create or replace function public.atlas_maturity_request_refresh(p_requested_by text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_id uuid;
  new_id      uuid;
begin
  set local statement_timeout = '5s';
  set local lock_timeout      = '2s';

  select id into existing_id
  from public.atlas_maturity_refresh_queue
  where claimed_at is null
    and requested_at > now() - interval '2 minutes'
  order by requested_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.atlas_maturity_refresh_queue (requested_by)
  values (left(coalesce(p_requested_by, 'unknown'), 254))
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.atlas_maturity_request_refresh(text) from public;
revoke execute on function public.atlas_maturity_request_refresh(text) from anon;
revoke execute on function public.atlas_maturity_request_refresh(text) from authenticated;
grant  execute on function public.atlas_maturity_request_refresh(text) to service_role;
alter  function public.atlas_maturity_request_refresh(text) owner to postgres;


-- =====================================================================
-- atlas_maturity_claim_refresh — atomic dequeue.
-- Picks the oldest unclaimed row inside the freshness window, marks it
-- claimed, returns its details. FOR UPDATE SKIP LOCKED makes concurrent
-- watchers safe (each claims a distinct row or none).
-- =====================================================================
create or replace function public.atlas_maturity_claim_refresh()
returns table(id uuid, requested_at timestamptz, requested_by text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  set local statement_timeout = '5s';
  set local lock_timeout      = '2s';

  return query
  update public.atlas_maturity_refresh_queue q
  set claimed_at = now()
  where q.id = (
    select inner_q.id
    from public.atlas_maturity_refresh_queue inner_q
    where inner_q.claimed_at is null
      and inner_q.requested_at > now() - interval '1 hour'
    order by inner_q.requested_at
    for update skip locked
    limit 1
  )
  returning q.id, q.requested_at, q.requested_by;
end;
$$;

revoke execute on function public.atlas_maturity_claim_refresh() from public;
revoke execute on function public.atlas_maturity_claim_refresh() from anon;
revoke execute on function public.atlas_maturity_claim_refresh() from authenticated;
grant  execute on function public.atlas_maturity_claim_refresh() to service_role;
alter  function public.atlas_maturity_claim_refresh() owner to postgres;


-- =====================================================================
-- atlas_maturity_complete_refresh — mark a claimed row done.
-- Watcher calls after the collector finishes. result is 'ok' on success or
-- 'failed:<short reason>' otherwise. No-ops if id wasn't claimed by us
-- (defense against caller-supplied id).
-- =====================================================================
-- plpgsql + RETURN FOUND so a no-match returns explicit FALSE (not NULL).
-- A language-sql scalar function with zero RETURNING rows yields NULL, which
-- silently passes a `if (data === false)` check in callers. RETURN FOUND
-- gives the explicit boolean the watcher contract expects.
create or replace function public.atlas_maturity_complete_refresh(p_id uuid, p_result text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  set local statement_timeout = '5s';
  set local lock_timeout      = '2s';

  update public.atlas_maturity_refresh_queue
  set completed_at = now(),
      result       = left(coalesce(p_result, 'ok'), 254)
  where id = p_id
    and claimed_at is not null
    and completed_at is null;
  return found;
end;
$$;

revoke execute on function public.atlas_maturity_complete_refresh(uuid, text) from public;
revoke execute on function public.atlas_maturity_complete_refresh(uuid, text) from anon;
revoke execute on function public.atlas_maturity_complete_refresh(uuid, text) from authenticated;
grant  execute on function public.atlas_maturity_complete_refresh(uuid, text) to service_role;
alter  function public.atlas_maturity_complete_refresh(uuid, text) owner to postgres;


comment on table  public.atlas_maturity_refresh_queue is
  'Single-consumer queue for owner-initiated /maturity refresh requests. service_role only via SECURITY DEFINER RPCs.';
comment on function public.atlas_maturity_request_refresh(text) is
  'Enqueue a refresh request. Called by atlas-hq /api/maturity/refresh.';
comment on function public.atlas_maturity_claim_refresh() is
  'Atomic dequeue. Called by maturity_refresh_watcher.py on Greg''s Mac every 30s.';
comment on function public.atlas_maturity_complete_refresh(uuid, text) is
  'Mark a claimed refresh row done. Called by the watcher after the collector finishes.';
