-- Together — Phase 1 (2/4): helpers, view, rate-limit bucket.
-- Plan: ~/.claude/plans/together-14-day-challenge-plan.md Task 2
-- pgcrypto is in `extensions` schema on MG — every SECURITY DEFINER function
-- below includes `extensions` in search_path so `digest()` and
-- `gen_random_bytes()` resolve without an explicit schema prefix.

set local statement_timeout = '60s';

-- =========================================================================
-- Rate-limit bucket table (modeled on bread_of_life_feedback_rate_limit)
-- =========================================================================
create table public.together_rate_limits (
  bucket text not null,
  hit_at timestamptz not null default now(),
  primary key (bucket, hit_at)
);

create index together_rate_limits_lookup_idx
  on public.together_rate_limits (bucket, hit_at desc);

create index together_rate_limits_prune_idx
  on public.together_rate_limits (hit_at);

alter table public.together_rate_limits enable row level security;
revoke all on public.together_rate_limits from anon, authenticated;
create policy together_rate_limits_deny_all
  on public.together_rate_limits for all to anon, authenticated
  using (false) with check (false);

-- =========================================================================
-- Code-alphabet helpers (immutable; safe to inline in indexes/checks)
-- =========================================================================
-- R2-M1 fix: callers must enforce a sane input length BEFORE calling normalize
-- (an unbounded blob gets normalized in-memory otherwise). together_redeem_pair_code
-- enforces char_length(p_code) <= 64 before calling this function.
create or replace function public.together_normalize_code(p_code text)
returns text language sql immutable set search_path = pg_catalog as $$
  select regexp_replace(upper(coalesce(p_code,'')), '[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]', '', 'g');
$$;

create or replace function public.together_hash_code(p_code text)
returns bytea language sql immutable set search_path = public, extensions, pg_catalog as $$
  select digest(public.together_normalize_code(p_code), 'sha256');
$$;

-- R2-C1 fix: use cryptographic gen_random_bytes (pgcrypto) instead of
-- non-cryptographic random(). R2-H3 fix: rejection-sample bytes >= 248
-- to avoid modulo bias against the 31-char alphabet (248 = 31*8, largest
-- multiple of 31 under 256).
create or replace function public.together_random_code()
returns text language plpgsql
set search_path = public, extensions, pg_catalog as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';  -- 31 chars
  alphabet_len constant int := 31;
  threshold constant int := 248;  -- 31 * 8
  out_code text := '';
  b int;
begin
  while char_length(out_code) < 8 loop
    b := get_byte(gen_random_bytes(1), 0);
    if b < threshold then
      out_code := out_code || substr(alphabet, 1 + (b % alphabet_len), 1);
    end if;
  end loop;
  return out_code;
end$$;

-- =========================================================================
-- Rate-limit helper. Returns true if under limit (and records the hit).
-- =========================================================================
create or replace function public.together_rate_limit_check(
  p_bucket text,
  p_max int,
  p_window interval
) returns boolean
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_count int;
begin
  delete from public.together_rate_limits
    where bucket = p_bucket and hit_at < now() - p_window;
  select count(*) into v_count
    from public.together_rate_limits
    where bucket = p_bucket and hit_at >= now() - p_window;
  if v_count >= p_max then
    return false;
  end if;
  insert into public.together_rate_limits (bucket, hit_at) values (p_bucket, now());
  return true;
end$$;

revoke all on function public.together_rate_limit_check(text, int, interval) from public, anon, authenticated;

-- =========================================================================
-- Caller-identity helper.
-- Returns ('initiator', uuid) or ('partner', uuid), or raises if caller is
-- in neither side of the partnership.
-- =========================================================================
create or replace function public.together_caller_role_in(p_partnership_id uuid)
returns table (role text, identity_id uuid)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_initiator uuid;
  v_partner uuid;
  v_caller_uid uuid;
  v_caller_sub uuid;
begin
  select initiator_user_id, partner_anon_id
    into v_initiator, v_partner
    from public.together_partnerships
    where id = p_partnership_id;

  if not found then
    raise exception 'partnership not found' using errcode = 'P0002';
  end if;

  v_caller_uid := auth.uid();
  begin
    v_caller_sub := nullif(auth.jwt() ->> 'sub', '')::uuid;
  exception when others then
    v_caller_sub := null;
  end;

  if v_caller_uid is not null and v_caller_uid = v_initiator then
    return query select 'initiator'::text, v_initiator;
  elsif v_caller_sub is not null and v_caller_sub = v_partner then
    return query select 'partner'::text, v_partner;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;
end$$;

revoke all on function public.together_caller_role_in(uuid) from public, anon, authenticated;

-- =========================================================================
-- Sanitized partnership view — hides hash, attempt counter, recovery token.
-- =========================================================================
create or replace view public.together_partnerships_view
with (security_invoker = on) as
  select
    id,
    status,
    initiator_user_id,
    initiator_display_name,
    partner_anon_id,
    partner_display_name,
    created_at,
    redeemed_at,
    activated_at,
    ended_at,
    ended_by
  from public.together_partnerships;

revoke all on public.together_partnerships_view from public, anon, authenticated;
-- The view is only read from inside together_get_my_partnership() RPC.

comment on function public.together_caller_role_in(uuid) is
  'Returns calling principal''s role in the partnership or raises. Used inside SECURITY DEFINER RPCs to derive role from auth.uid()/auth.jwt() sub. Never trust client-supplied owner_role.';
comment on function public.together_rate_limit_check(text, int, interval) is
  'Rate-limit primitive. Bucket key = "<op>:<identity>". Returns false when budget exhausted; caller raises P0001.';
