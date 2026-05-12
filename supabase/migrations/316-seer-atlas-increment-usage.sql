-- 316 — seer_atlas_increment_usage RPC (additive to mig 315).
-- Atomic cap-check + token-increment in one statement so concurrent requests
-- cannot bypass the per-UTC-day cap.
--
-- Semantics:
--   pre-flight call:  (owner, 0, 0, true)   → returns current totals, ticks request_count
--   post-flight call: (owner, N, M, false)  → adds N/M to totals
--   cap_exceeded reflects the row state AFTER this increment, so the edge fn
--   can decide whether to allow the NEXT request (or whether the just-completed
--   one busted the cap and should not be retried).

create or replace function public.seer_atlas_increment_usage(
  p_owner_id     uuid,
  p_input        int default 0,
  p_output       int default 0,
  p_is_preflight boolean default false
) returns table (
  input_tokens  int,
  output_tokens int,
  request_count int,
  cap_exceeded  boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_input_cap  constant int := 500000;
  c_output_cap constant int := 100000;
  v_req_tick   int := case when p_is_preflight then 1 else 0 end;
begin
  if p_input < 0 or p_output < 0 then
    raise exception 'p_input/p_output must be non-negative';
  end if;
  if p_owner_id is null then
    raise exception 'p_owner_id required';
  end if;
  -- request_count tick is driven by the explicit p_is_preflight flag, NOT
  -- inferred from p_input/p_output == 0 (which would mis-tick on day-rollover
  -- races where a post-flight call lands as the first INSERT for a new day).

  return query
  insert into public.seer_atlas_daily_usage (owner_id, utc_day, input_tokens, output_tokens, request_count)
  values (p_owner_id, (now() at time zone 'utc')::date, p_input, p_output, v_req_tick)
  on conflict (owner_id, utc_day) do update
    set input_tokens  = seer_atlas_daily_usage.input_tokens  + excluded.input_tokens,
        output_tokens = seer_atlas_daily_usage.output_tokens + excluded.output_tokens,
        request_count = seer_atlas_daily_usage.request_count + excluded.request_count
  returning
    seer_atlas_daily_usage.input_tokens,
    seer_atlas_daily_usage.output_tokens,
    seer_atlas_daily_usage.request_count,
    (seer_atlas_daily_usage.input_tokens >= c_input_cap
       or seer_atlas_daily_usage.output_tokens >= c_output_cap) as cap_exceeded;
end $$;

revoke all on function public.seer_atlas_increment_usage(uuid, int, int, boolean) from public, anon, authenticated;
grant execute on function public.seer_atlas_increment_usage(uuid, int, int, boolean) to service_role;
-- service_role ONLY. The edge function is the sole caller. Clients have no
-- direct path to mutate the cap — a malicious authenticated client cannot
-- self-DoS by writing inflated tokens.
