-- 285-atlas-hmac-nonces-db-pk.sql
-- Extend atlas_hmac_nonces PK to include `db` so per-db HMAC secrets
-- can't collide structurally with each other under operator misconfig.
-- Closes greg_actions #769 (R1 M4 from codebase-maturity chain v1.8).
--
-- Threat being closed: a degenerate misconfig where two dbs are minted
-- with the SAME MATURITY_LINT_SECRET_<DB> value would collapse replay
-- protection across those tenants — one legit microgrid + one legit
-- spark request landing at the same ts+sig would mutually 401. With
-- per-db HMAC secrets cross-db sig collisions are cryptographically
-- impossible, but defense-in-depth removes the misconfig footgun.
--
-- Strategy: ALTER + backfill (closes red-teamer H2 on mig 285 draft v1).
-- Original draft used DROP+CREATE which wiped ~16 in-flight nonces and
-- briefly weakened replay protection for any captured sig within the
-- 5-min freshness window. ALTER preserves the rolling window.
--
-- Deploy decoupling: a TRANSITIONAL 3-arg shim of
-- atlas_hmac_check_and_record_nonce stays in place, calling the 4-arg
-- form with p_db := '__legacy__'. atlas-hq's existing 3-arg callers
-- continue to work after this mig applies. Once atlas-hq deploys the
-- 4-arg helper + route updates, a follow-up migration drops the shim.
-- Closes red-teamer C1 on mig 285 draft v1.
--
-- Sentinel namespacing (closes red-teamer M1+M2): sentinels for
-- routes without per-tenant binding are namespaced as '__ingest__',
-- '__refresh-from-gh__', '__legacy__'. These shapes are syntactically
-- impossible as future tenant slugs (registry slugs match
-- /^[a-z][a-z0-9-]*$/ and don't start with underscore), so a future
-- tenant rename can never collide with a sentinel.

-- Lock note (R2 L2): the ALTER TABLE statements below take ACCESS
-- EXCLUSIVE on atlas_hmac_nonces for the duration of the change.
-- Concurrent /lint or /ingest nonce inserts during this window will
-- block on the lock; with lock_timeout=5s set below, anything blocked
-- longer returns a serialization error which propagates as fail-closed
-- 503 to that one request. On the 16-row nonce table the mig runs in
-- microseconds in practice. Collector retries absorb a one-off 503.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- ── Step 1: add `db` column with backfill default ───────────────────
-- Existing rows (16 as of mig apply) get db='__legacy__'. New inserts
-- without an explicit db value also default to '__legacy__' — this is
-- the back-compat hook the 3-arg shim depends on.
alter table public.atlas_hmac_nonces
  add column if not exists db text not null default '__legacy__';

-- ── Step 2: swap the PK from (route, sig) to (route, db, sig) ───────
-- All existing rows share db='__legacy__'; the new PK is satisfiable
-- without conflict. ALTER TABLE … DROP CONSTRAINT, ADD CONSTRAINT in
-- a single ALTER is atomic — there's no instant where the table has
-- no PK.
alter table public.atlas_hmac_nonces
  drop constraint atlas_hmac_nonces_pkey,
  add primary key (route, db, sig);

-- ── Step 3: refresh the table comment to reflect the new shape ──────
comment on table public.atlas_hmac_nonces is
  'Replay-protection nonce cache for HMAC-gated maturity routes. PK extended to (route, db, sig) in mig 285 to defend against operator misconfig where two tenants are minted with the same per-db secret. Sentinel db values for non-tenant-scoped routes: __ingest__, __refresh-from-gh__, __legacy__ (the latter assigned by the 3-arg shim during deploy decoupling). Prune interval (10m) MUST exceed (freshness window 5m + pre-stage tolerance 30s + max plausible client clock skew). Service-role only.';

-- ── Step 4: create the NEW 4-arg function ───────────────────────────
create or replace function public.atlas_hmac_check_and_record_nonce(
  p_route text, p_db text, p_sig text, p_ts bigint
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

  insert into public.atlas_hmac_nonces (route, db, sig, ts)
  values (p_route, p_db, p_sig, p_ts)
  on conflict (route, db, sig) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

revoke execute on function public.atlas_hmac_check_and_record_nonce(text, text, text, bigint)
  from public;
revoke execute on function public.atlas_hmac_check_and_record_nonce(text, text, text, bigint)
  from anon;
revoke execute on function public.atlas_hmac_check_and_record_nonce(text, text, text, bigint)
  from authenticated;
grant execute on function public.atlas_hmac_check_and_record_nonce(text, text, text, bigint)
  to service_role;
alter function public.atlas_hmac_check_and_record_nonce(text, text, text, bigint)
  owner to postgres;

comment on function public.atlas_hmac_check_and_record_nonce(text, text, text, bigint) is
  'Atomic check-and-record. Returns true if (route, db, sig) is new (proceed). Returns false on replay. Postgres ON CONFLICT row-locks the unique index entry — concurrent inserts of the same key serialize and only the first reports rowcount=1. p_db is the validated tenant slug for /lint; a fixed route-name sentinel for bulk-multi-tenant routes (__ingest__, __refresh-from-gh__).';

-- ── Step 5: convert the OLD 3-arg function into a transitional shim ─
-- This is what closes the deploy-coupling Critical. atlas-hq's existing
-- code (live in prod right now) calls the 3-arg form via PostgREST.
-- After this migration applies, those calls succeed and write rows
-- with db='__legacy__'. Once atlas-hq deploys with the 4-arg helper +
-- route updates, follow-up migration 287 drops this shim
-- (see greg_actions #797 + placeholder file 287-...).
--
-- R2 v2 fixes folded in:
--   - L1: shim body delegates to the 4-arg form (no duplicate insert
--     logic — single SoT for the ON CONFLICT semantics).
--   - M1: raise notice on every call so Supabase logs surface any
--     orphaned 3-arg traffic post-deploy. Ops signal for action #797.
create or replace function public.atlas_hmac_check_and_record_nonce(
  p_route text, p_sig text, p_ts bigint
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result boolean;
begin
  -- R2 M1 (telemetry): emit a NOTICE on every shim hit so any traffic
  -- still using the 3-arg signature post-atlas-hq-deploy shows up in
  -- Supabase logs. Greg's cutover check ("0 inserts to db='__legacy__'
  -- for 7 consecutive days") is verified against this log line +
  -- against atlas_hmac_nonces row count.
  raise notice 'maturity_legacy_shim_called route=% ts=%', p_route, p_ts;

  -- R2 L1 (single source of truth): delegate to the 4-arg form. Any
  -- future change to the canonical insert (timeouts, ON CONFLICT
  -- behavior, telemetry) lands in one place.
  v_result := public.atlas_hmac_check_and_record_nonce(
    p_route, '__legacy__', p_sig, p_ts
  );
  return v_result;
end;
$$;

revoke execute on function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  from public;
revoke execute on function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  from anon;
revoke execute on function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  from authenticated;
grant execute on function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  to service_role;
alter function public.atlas_hmac_check_and_record_nonce(text, text, bigint)
  owner to postgres;

comment on function public.atlas_hmac_check_and_record_nonce(text, text, bigint) is
  'TRANSITIONAL 3-arg shim. Delegates to the 4-arg form with p_db = ''__legacy__''. Exists only to keep pre-v1.12 atlas-hq deploys working during the deploy window. Drop after atlas-hq is confirmed fully migrated to the 4-arg call shape.';

-- pg_cron prune job is unchanged — it filters by recorded_at, doesn't
-- reference the PK. No need to re-schedule.
