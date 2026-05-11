-- Together — Phase 1 (3/4): the app-facing API.
-- Plan: ~/.claude/plans/together-14-day-challenge-plan.md Task 3
-- Spec: ~/.claude/plans/together-14-day-challenge-design.md §5.5
--
-- All RPCs SECURITY DEFINER with explicit search_path. All assert caller
-- identity inside the body. All anon-callable RPCs apply rate limits before
-- expensive work. The pair-code regex uses POSIX classes (Postgres ~ uses
-- POSIX ERE; \p{L}/\p{N} are not supported).

set local statement_timeout = '60s';

-- =========================================================================
-- together_mint_pair_code — authenticated callers (Quest, Greg's MG session)
-- =========================================================================
create or replace function public.together_mint_pair_code(p_display_name text)
returns text
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_active_pending int;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_display_name is null
     or char_length(p_display_name) not between 1 and 24
     or p_display_name !~ '^[A-Za-z0-9 ''\-]+$' then
    raise exception 'invalid display name' using errcode = '22023';
  end if;

  if not public.together_rate_limit_check('mint:' || v_uid::text, 20, interval '1 hour') then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  select count(*) into v_active_pending
    from public.together_partnerships
    where initiator_user_id = v_uid
      and status = 'pending'
      and pair_code_expires_at > now();
  if v_active_pending >= 5 then
    raise exception 'too many active pair codes' using errcode = 'P0001';
  end if;

  for i in 1..5 loop
    v_code := public.together_random_code();
    exit when not exists (
      select 1 from public.together_partnerships
        where pair_code_hash = public.together_hash_code(v_code)
          and pair_code_expires_at > now()
    );
    v_code := null;
  end loop;
  if v_code is null then
    raise exception 'could not generate unique code; retry' using errcode = 'P0001';
  end if;

  insert into public.together_partnerships (
    pair_code_hash, pair_code_expires_at, status,
    initiator_user_id, initiator_display_name
  ) values (
    public.together_hash_code(v_code),
    now() + interval '10 minutes',
    'pending',
    v_uid,
    p_display_name
  );

  return v_code;
end$$;

revoke all on function public.together_mint_pair_code(text) from public, anon, authenticated;
grant execute on function public.together_mint_pair_code(text) to authenticated;

-- =========================================================================
-- together_redeem_pair_code — anon callers (BoL, Anne)
-- =========================================================================
create or replace function public.together_redeem_pair_code(
  p_code text,
  p_partner_display_name text
) returns table(partnership_id uuid, recovery_token text)
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_sub uuid;
  v_norm text;
  v_hash bytea;
  v_partnership record;
  v_token text;
  v_token_hash bytea;
begin
  begin
    v_sub := nullif(auth.jwt() ->> 'sub', '')::uuid;
  exception when others then
    v_sub := null;
  end;
  if v_sub is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.together_rate_limit_check('redeem:min:' || v_sub::text, 5, interval '1 minute') then
    raise exception 'rate limit exceeded (per minute)' using errcode = 'P0001';
  end if;
  if not public.together_rate_limit_check('redeem:hour:' || v_sub::text, 50, interval '1 hour') then
    raise exception 'rate limit exceeded (per hour)' using errcode = 'P0001';
  end if;

  if p_partner_display_name is null
     or char_length(p_partner_display_name) not between 1 and 24
     or p_partner_display_name !~ '^[A-Za-z0-9 ''\-]+$' then
    raise exception 'invalid display name' using errcode = '22023';
  end if;

  -- R2-M1 fix: bound input length before regexp_replace work
  if p_code is null or char_length(p_code) > 64 then
    raise exception 'invalid code' using errcode = '22023';
  end if;

  v_norm := public.together_normalize_code(p_code);
  if char_length(v_norm) <> 8 then
    raise exception 'invalid code' using errcode = '22023';
  end if;
  v_hash := public.together_hash_code(v_norm);

  select * into v_partnership
    from public.together_partnerships
    where pair_code_hash = v_hash
      and status = 'pending'
      and pair_code_expires_at > now()
    for update;

  if not found then
    update public.together_partnerships
      set pair_code_attempts = pair_code_attempts + 1
      where pair_code_hash = v_hash;
    raise exception 'invalid or expired code' using errcode = 'P0002';
  end if;

  if v_partnership.pair_code_attempts >= 5 then
    raise exception 'code locked after too many attempts' using errcode = '42501';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := digest(v_token, 'sha256');

  update public.together_partnerships set
    partner_anon_id = v_sub,
    partner_display_name = p_partner_display_name,
    partner_recovery_token_hash = v_token_hash,
    pair_code_hash = null,
    pair_code_expires_at = null,
    status = 'redeemed',
    redeemed_at = now()
  where id = v_partnership.id;

  return query select v_partnership.id, v_token;
end$$;

revoke all on function public.together_redeem_pair_code(text, text) from public;
grant execute on function public.together_redeem_pair_code(text, text) to anon, authenticated;

-- =========================================================================
-- together_confirm_partner — initiator confirms after redeem (two-step pair)
-- =========================================================================
create or replace function public.together_confirm_partner(p_partnership_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.together_partnerships
    set status = 'active', activated_at = now()
    where id = p_partnership_id
      and initiator_user_id = v_uid
      and status = 'redeemed';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'forbidden or not redeemed' using errcode = '42501';
  end if;
end$$;

revoke all on function public.together_confirm_partner(uuid) from public, anon, authenticated;
grant execute on function public.together_confirm_partner(uuid) to authenticated;

-- =========================================================================
-- together_get_my_partnership — read sanitized view rows the caller owns
-- =========================================================================
create or replace function public.together_get_my_partnership()
returns setof public.together_partnerships_view
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid;
  v_sub uuid;
begin
  -- R2-H1 fix: wrap both auth helpers in exception handlers so a missing
  -- or malformed GUC never aborts the function (and never returns a stale
  -- value from a pooled connection without an explicit check).
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;
  begin
    v_sub := nullif(auth.jwt() ->> 'sub', '')::uuid;
  exception when others then
    v_sub := null;
  end;

  if v_uid is null and v_sub is null then
    return;  -- no identity = no rows; never a stale-claim leak
  end if;

  return query
    select * from public.together_partnerships_view
    where status in ('pending','redeemed','active')
      and (
        (v_uid is not null and initiator_user_id = v_uid)
        or
        (v_sub is not null and partner_anon_id = v_sub)
      );
end$$;

revoke all on function public.together_get_my_partnership() from public;
grant execute on function public.together_get_my_partnership() to anon, authenticated;

-- =========================================================================
-- together_create_challenge — initiator only; BoL cannot create challenges
-- =========================================================================
create or replace function public.together_create_challenge(
  p_partnership_id uuid,
  p_owner_role text,
  p_title text,
  p_goal_type text,
  p_daily_target numeric,
  p_daily_target_unit text,
  p_evidence_mode text,
  p_started_at date
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_caller record;
  v_challenge_id uuid;
begin
  select role, identity_id into v_caller
    from public.together_caller_role_in(p_partnership_id);

  if v_caller.role <> 'initiator' then
    raise exception 'only initiator can create challenges' using errcode = '42501';
  end if;

  if p_owner_role not in ('initiator','both') then
    raise exception 'owner_role must be initiator or both' using errcode = '22023';
  end if;

  -- R2-H2 fix: use UTC date so client TZ claim can't shift the window.
  if p_started_at < (now() at time zone 'UTC')::date then
    raise exception 'cannot start in the past' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.together_partnerships
      where id = p_partnership_id and status = 'active'
  ) then
    raise exception 'partnership not active' using errcode = '42501';
  end if;

  -- R3-L2 fix: serialize concurrent create_challenge calls per partnership
  -- so the active-cap count-then-insert can't race past 3 on a double-tap.
  perform pg_advisory_xact_lock(hashtext('together_cc:' || p_partnership_id::text));

  -- R2-M3 fix: cap concurrent active challenges per partnership at 3.
  if (
    select count(*) from public.together_challenges
      where partnership_id = p_partnership_id and status = 'active'
  ) >= 3 then
    raise exception 'maximum active challenges reached for this partnership' using errcode = '42501';
  end if;

  insert into public.together_challenges (
    partnership_id, owner_role, title, goal_type,
    daily_target, daily_target_unit, evidence_mode,
    started_at, ends_at, status
  ) values (
    p_partnership_id, p_owner_role, p_title, p_goal_type,
    p_daily_target, p_daily_target_unit, coalesce(p_evidence_mode,'either'),
    p_started_at, p_started_at + 13, 'active'
  ) returning id into v_challenge_id;

  return v_challenge_id;
end$$;

revoke all on function public.together_create_challenge(uuid, text, text, text, numeric, text, text, date) from public, anon, authenticated;
grant execute on function public.together_create_challenge(uuid, text, text, text, numeric, text, text, date) to authenticated;

-- =========================================================================
-- together_record_day — anon + authenticated; server derives role/date,
-- validates source vs goal_type, caps source_value. Handles all C-5 vectors.
-- =========================================================================
create or replace function public.together_record_day(
  p_challenge_id uuid,
  p_day_number int,
  p_source text,
  p_source_value numeric
) returns table(was_inserted boolean, was_updated boolean)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_challenge record;
  v_caller record;
  v_role_to_use text;
  v_the_date date;
  v_max_day int;
  v_existing record;
  v_inserted boolean := false;
  v_updated boolean := false;
begin
  if p_day_number is null or p_day_number not between 1 and 14 then
    raise exception 'day_number out of range' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('health','manual') then
    raise exception 'source must be health or manual' using errcode = '22023';
  end if;

  select * into v_challenge
    from public.together_challenges
    where id = p_challenge_id;
  if not found then
    raise exception 'challenge not found' using errcode = 'P0002';
  end if;
  if v_challenge.status <> 'active' then
    raise exception 'challenge not active' using errcode = '42501';
  end if;

  select role, identity_id into v_caller
    from public.together_caller_role_in(v_challenge.partnership_id);

  if v_challenge.owner_role = 'initiator' and v_caller.role <> 'initiator' then
    raise exception 'this challenge is initiator-only' using errcode = '42501';
  end if;
  if v_challenge.owner_role = 'partner' and v_caller.role <> 'partner' then
    raise exception 'this challenge is partner-only' using errcode = '42501';
  end if;
  v_role_to_use := v_caller.role;

  v_the_date := v_challenge.started_at + (p_day_number - 1);
  -- R2-H2 fix: anchor "today" to UTC so client TZ claim can't shift ±14h.
  v_max_day := ((now() at time zone 'UTC')::date - v_challenge.started_at) + 1;
  if p_day_number > v_max_day then
    raise exception 'cannot complete a future day' using errcode = '22023';
  end if;

  if p_source = 'health' and v_challenge.goal_type in ('scripture','fruit','custom') then
    raise exception 'goal type has no health signal' using errcode = '22023';
  end if;

  if p_source_value is not null then
    case v_challenge.goal_type
      when 'walk_minutes'   then if p_source_value > 1440      then raise exception 'value too large' using errcode = '22023'; end if;
      when 'steps'          then if p_source_value > 200000    then raise exception 'value too large' using errcode = '22023'; end if;
      when 'water_glasses'  then if p_source_value > 30        then raise exception 'value too large' using errcode = '22023'; end if;
      when 'sleep_by_time'  then if p_source_value < 0 or p_source_value > 1440 then raise exception 'value out of range' using errcode = '22023'; end if;
      else null;
    end case;
  end if;

  select * into v_existing
    from public.together_challenge_days
    where challenge_id = p_challenge_id
      and owner_role = v_role_to_use
      and day_number = p_day_number;

  if not found then
    insert into public.together_challenge_days (
      challenge_id, owner_role, day_number, the_date,
      completed_at, source, source_value
    ) values (
      p_challenge_id, v_role_to_use, p_day_number, v_the_date,
      now(), p_source, p_source_value
    );
    v_inserted := true;
  else
    if v_existing.source = 'manual' and p_source = 'health' then
      v_updated := false;
    else
      update public.together_challenge_days set
        completed_at = coalesce(completed_at, now()),
        source = p_source,
        source_value = greatest(coalesce(source_value, 0), coalesce(p_source_value, 0))
      where id = v_existing.id;
      v_updated := true;
    end if;
  end if;

  return query select v_inserted, v_updated;
end$$;

revoke all on function public.together_record_day(uuid, int, text, numeric) from public;
grant execute on function public.together_record_day(uuid, int, text, numeric) to anon, authenticated;

-- =========================================================================
-- together_end_partnership — either side; identity checked
-- =========================================================================
create or replace function public.together_end_partnership(p_partnership_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_caller record;
  v_updated int;
begin
  select role, identity_id into v_caller
    from public.together_caller_role_in(p_partnership_id);

  update public.together_partnerships
    set status = 'ended', ended_at = now(), ended_by = v_caller.role
    where id = p_partnership_id
      and status in ('pending','redeemed','active');

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'already ended' using errcode = '42501';
  end if;
end$$;

revoke all on function public.together_end_partnership(uuid) from public;
grant execute on function public.together_end_partnership(uuid) to anon, authenticated;

-- =========================================================================
-- together_rebind_partner — Anne's BoL JWT rotated; recover via token
-- =========================================================================
create or replace function public.together_rebind_partner(
  p_partnership_id uuid,
  p_recovery_token text
) returns void
language plpgsql security definer set search_path = public, extensions, pg_catalog as $$
declare
  v_sub uuid;
  v_token_hash bytea;
  v_stored_hash bytea;
begin
  begin
    v_sub := nullif(auth.jwt() ->> 'sub', '')::uuid;
  exception when others then
    v_sub := null;
  end;
  if v_sub is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not public.together_rate_limit_check('rebind:' || v_sub::text, 3, interval '1 hour') then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  if p_recovery_token is null or char_length(p_recovery_token) <> 64 then
    raise exception 'invalid recovery token' using errcode = '22023';
  end if;

  v_token_hash := digest(p_recovery_token, 'sha256');

  select partner_recovery_token_hash into v_stored_hash
    from public.together_partnerships
    where id = p_partnership_id
      and status in ('redeemed','active');
  if not found or v_stored_hash is null or v_stored_hash <> v_token_hash then
    raise exception 'invalid recovery token' using errcode = '42501';
  end if;

  update public.together_partnerships
    set partner_anon_id = v_sub
    where id = p_partnership_id;
end$$;

revoke all on function public.together_rebind_partner(uuid, text) from public, authenticated;
grant execute on function public.together_rebind_partner(uuid, text) to anon;

-- =========================================================================
-- together_delete_my_data — caller deletes their own day rows
-- =========================================================================
create or replace function public.together_delete_my_data(p_partnership_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_caller record;
begin
  select role, identity_id into v_caller
    from public.together_caller_role_in(p_partnership_id);

  -- R2-M4 fix: rate-limit destructive op to once per hour per identity.
  if not public.together_rate_limit_check(
    'delete_my_data:' || v_caller.identity_id::text,
    1,
    interval '1 hour'
  ) then
    raise exception 'rate limit exceeded' using errcode = 'P0001';
  end if;

  delete from public.together_challenge_days d
    using public.together_challenges c
    where d.challenge_id = c.id
      and c.partnership_id = p_partnership_id
      and d.owner_role = v_caller.role;
end$$;

revoke all on function public.together_delete_my_data(uuid) from public;
grant execute on function public.together_delete_my_data(uuid) to anon, authenticated;
