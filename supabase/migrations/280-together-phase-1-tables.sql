-- Together 14-day challenge — Phase 1 (1/4): tables, indexes, deny_all RLS.
-- Spec: ~/.claude/plans/together-14-day-challenge-design.md §5
-- Plan: ~/.claude/plans/together-14-day-challenge-plan.md Task 1
--
-- These are the FIRST anon-grantable tables on MG. All access flows through
-- SECURITY DEFINER RPCs in migration 282; tables themselves are deny_all.

set local statement_timeout = '60s';

-- =========================================================================
-- 1. together_partnerships
-- =========================================================================
create table public.together_partnerships (
  id uuid primary key default gen_random_uuid(),
  pair_code_hash bytea,
  pair_code_expires_at timestamptz,
  pair_code_attempts int not null default 0,
  status text not null check (status in ('pending','redeemed','active','ended')) default 'pending',
  initiator_user_id uuid not null,
  initiator_display_name text not null check (
    char_length(initiator_display_name) between 1 and 24
    and initiator_display_name ~ '^[A-Za-z0-9 ''\-]+$'
  ),
  partner_anon_id uuid,
  partner_display_name text check (
    partner_display_name is null
    or (char_length(partner_display_name) between 1 and 24
        and partner_display_name ~ '^[A-Za-z0-9 ''\-]+$')
  ),
  partner_recovery_token_hash bytea,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  activated_at timestamptz,
  ended_at timestamptz,
  ended_by text check (ended_by in ('initiator','partner')),
  constraint together_partnerships_status_partner_invariant
    check (status = 'pending' or partner_anon_id is not null),
  constraint together_partnerships_status_active_invariant
    check ((status = 'active') = (activated_at is not null))
);

create unique index together_partnerships_pair_code_hash_idx
  on public.together_partnerships (pair_code_hash)
  where pair_code_hash is not null;

create index together_partnerships_pending_per_initiator_idx
  on public.together_partnerships (initiator_user_id)
  where status = 'pending';

create index together_partnerships_initiator_idx
  on public.together_partnerships (initiator_user_id)
  where status in ('redeemed','active');

create index together_partnerships_partner_idx
  on public.together_partnerships (partner_anon_id)
  where status in ('redeemed','active');

-- =========================================================================
-- 2. together_challenges
-- =========================================================================
create table public.together_challenges (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.together_partnerships(id) on delete cascade,
  owner_role text not null check (owner_role in ('initiator','partner','both')),
  title text not null check (char_length(title) between 1 and 60),
  goal_type text not null check (goal_type in (
    'walk_minutes','steps','water_glasses','sleep_by_time',
    'scripture','fruit','custom'
  )),
  daily_target numeric check (daily_target is null or (daily_target > 0 and daily_target <= 1440000)),
  daily_target_unit text,
  evidence_mode text not null check (evidence_mode in ('health','manual','either')) default 'either',
  started_at date not null,
  ends_at date not null,
  status text not null check (status in ('active','completed','ended')) default 'active',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint together_challenges_14_day_span check (ends_at = started_at + 13)
);

create index together_challenges_partnership_idx
  on public.together_challenges (partnership_id);

create index together_challenges_active_idx
  on public.together_challenges (partnership_id, status)
  where status = 'active';

-- =========================================================================
-- 3. together_challenge_days
-- =========================================================================
create table public.together_challenge_days (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.together_challenges(id) on delete cascade,
  owner_role text not null check (owner_role in ('initiator','partner')),
  day_number int not null check (day_number between 1 and 14),
  the_date date not null,
  completed_at timestamptz,
  source text check (source in ('health','manual')),
  source_value numeric,
  created_at timestamptz not null default now(),
  constraint together_challenge_days_unique unique (challenge_id, owner_role, day_number)
);

create index together_challenge_days_lookup_idx
  on public.together_challenge_days (challenge_id, owner_role);

-- =========================================================================
-- 4. RLS deny_all (mirrors MG convention for anon-grantable tables)
-- =========================================================================
alter table public.together_partnerships   enable row level security;
alter table public.together_challenges     enable row level security;
alter table public.together_challenge_days enable row level security;

revoke all on public.together_partnerships   from anon, authenticated;
revoke all on public.together_challenges     from anon, authenticated;
revoke all on public.together_challenge_days from anon, authenticated;

create policy together_partnerships_deny_all
  on public.together_partnerships for all to anon, authenticated
  using (false) with check (false);

create policy together_challenges_deny_all
  on public.together_challenges for all to anon, authenticated
  using (false) with check (false);

create policy together_challenge_days_deny_all
  on public.together_challenge_days for all to anon, authenticated
  using (false) with check (false);

-- =========================================================================
-- 5. Audit comments
-- =========================================================================
comment on table public.together_partnerships is
  'Together feature: pair-code-bound partnership between Quest (initiator) and BoL (partner). FIRST MG anon-grantable surface. All access via together_* SECURITY DEFINER RPCs; deny_all at table level. See spec §5.';
comment on table public.together_challenges is
  'Together feature: 14-day challenge within a partnership. owner_role=both for shared accountability. See spec §5.2.';
comment on table public.together_challenge_days is
  'Together feature: per-day completion log. owner_role is per-row; populated via RPC only (never client-asserted). See spec §5.3.';
