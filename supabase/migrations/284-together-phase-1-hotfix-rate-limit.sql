-- Together — Phase 1 hotfix: same-transaction rate-limit collision.
--
-- Bug surfaced by live H-2 verification: together_rate_limit_check inserts
-- `(bucket, now())` into together_rate_limits, with PK on (bucket, hit_at).
-- Inside a single transaction, now() = transaction_start_time → identical
-- value on every call. The 2nd insert against the same bucket raises a
-- unique-key violation, which bubbles past the function and surfaces as a
-- 500 to the caller.
--
-- Production HTTP traffic is one transaction per RPC, so the bug only fires
-- when two requests land in the SAME microsecond, but it's a real edge case
-- and trivial to defend against.
--
-- Fix: use clock_timestamp() (advances within a transaction) and add
-- ON CONFLICT DO NOTHING so a rare same-microsecond collision across
-- transactions is also a no-op.

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
    where bucket = p_bucket and hit_at < clock_timestamp() - p_window;
  select count(*) into v_count
    from public.together_rate_limits
    where bucket = p_bucket and hit_at >= clock_timestamp() - p_window;
  if v_count >= p_max then
    return false;
  end if;
  insert into public.together_rate_limits (bucket, hit_at)
    values (p_bucket, clock_timestamp())
    on conflict (bucket, hit_at) do nothing;
  return true;
end$$;

revoke all on function public.together_rate_limit_check(text, int, interval) from public, anon, authenticated;

comment on function public.together_rate_limit_check(text, int, interval) is
  'Rate-limit primitive. Bucket key = "<op>:<identity>". Uses clock_timestamp (advances within a txn) + ON CONFLICT DO NOTHING (defends same-microsecond collisions across txns). Returns false when budget exhausted; caller raises P0001.';
