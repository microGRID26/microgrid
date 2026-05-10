-- 272-atlas-hmac-nonces.sql
-- Replay-protection nonce cache for HMAC-gated maturity routes
-- (atlas-hq /api/maturity/{ingest,lint}). Closes greg_actions #738.
--
-- Defense layer 2 (in addition to ts freshness window): track every
-- (route, sig) pair seen in the last 10 minutes; second observation
-- of the same pair is a replay → 401. PK is (route, sig) — route
-- discriminator prevents future HMAC-gated routes (sharing the secret)
-- from cross-poisoning each other's nonce namespace.
--
-- Storage: ~100 rows steady-state at current collector cadence
-- (1 batch/day → 1-3 sigs/day; held for 10min → ≤ a handful at any
-- moment). Pruned every 5 minutes by pg_cron. Service-role only.

-- ── Table ────────────────────────────────────────────────────────────
create table if not exists public.atlas_hmac_nonces (
  route       text not null,                          -- 'ingest' | 'lint' | future routes
  sig         text not null,                          -- 64-char lowercase hex (SHA-256 HMAC)
  ts          bigint not null,                        -- ms-epoch from x-maturity-timestamp
  recorded_at timestamptz not null default now(),
  primary key (route, sig)
);
alter table public.atlas_hmac_nonces enable row level security;
-- No policies → deny-all. Read/write only via service role.

create index if not exists atlas_hmac_nonces_recorded_at_idx
  on public.atlas_hmac_nonces (recorded_at);

comment on table public.atlas_hmac_nonces is
  'Replay-protection nonce cache for HMAC-gated maturity routes. Prune interval (10m) MUST exceed (freshness window 5m + pre-stage tolerance 30s + max plausible client clock skew). Service-role only.';

-- ── Atomic check-and-record RPC ──────────────────────────────────────
create or replace function public.atlas_hmac_check_and_record_nonce(
  p_route text, p_sig text, p_ts bigint
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted int;
begin
  set local statement_timeout = '2s';
  set local lock_timeout = '1s';

  insert into public.atlas_hmac_nonces (route, sig, ts)
  values (p_route, p_sig, p_ts)
  on conflict (route, sig) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

revoke all on function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  to service_role;
alter function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  owner to postgres;

comment on function public.atlas_hmac_check_and_record_nonce(text, text, bigint) is
  'Atomic check-and-record. Returns true if (route, sig) is new (proceed). Returns false on replay. Postgres ON CONFLICT row-locks the unique index entry — concurrent inserts of the same key serialize and only the first reports rowcount=1.';

-- ── pg_cron prune job ────────────────────────────────────────────────
-- Idempotent: unschedule any prior version before scheduling.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'atlas-hmac-nonces-prune') then
    perform cron.unschedule('atlas-hmac-nonces-prune');
  end if;
end $$;

select cron.schedule(
  'atlas-hmac-nonces-prune',
  '*/5 * * * *',
  $cron$
    set local search_path = public, pg_temp;
    set local statement_timeout = '5s';
    delete from public.atlas_hmac_nonces where recorded_at < now() - interval '10 minutes';
  $cron$
);
