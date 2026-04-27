-- 186-funding-nf-cleanup-and-notifications.sql
--
-- Funding NF code cleanup + notification + Notes @-mention infrastructure.
--
-- 1. Delete 9 Sunnova-related rows from nonfunded_codes (zero project_funding usage verified).
-- 2. Fix RGM whitespace ("Field\n   Ops" -> "Field Ops").
-- 3. responsible_party_emails: party -> recipient email(s). Seeded from TriSMART
--    Funding Audit sheet's Team Email column.
-- 4. funding_nf_changes: append-only audit + idempotency for NF notification emails.
-- 5. note_mentions: @-mentions on funding notes (and reusable for tickets/comments).

begin;

-- 1. Sunnova cleanup
delete from public.nonfunded_codes
where code in ('PPD','SCO','SUB','TU-C','TU-P','TU-S','CP','OI','TU');

-- 2. RGM whitespace fix
update public.nonfunded_codes
set responsible_party = 'Field Ops'
where code = 'RGM' and responsible_party <> 'Field Ops';

-- 3. responsible_party_emails
create table if not exists public.responsible_party_emails (
  responsible_party text not null,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (responsible_party, email),
  constraint responsible_party_emails_email_format
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

alter table public.responsible_party_emails enable row level security;

-- Read: finance-and-above only. Funding routing tables expose internal team
-- distribution lists; sales/portal-customer sessions should not see them (R1#M5).
create policy responsible_party_emails_read on public.responsible_party_emails
  for select to authenticated using (
    exists (
      select 1 from public.users u
      where lower(u.email) = lower(auth.email())
        and u.active = true
        and u.role in ('finance','admin','super_admin')
    )
  );

-- Write: admin-only.
create policy responsible_party_emails_write on public.responsible_party_emails
  for all to authenticated using (auth_is_admin()) with check (auth_is_admin());

insert into public.responsible_party_emails (responsible_party, email) values
  ('Customer Service',   'customerservice@trismartsolar.com'),
  ('Design',             'design@trismartsolar.com'),
  ('Field Ops',          'aalford@trismartsolar.com'),
  ('Funding',            'funding@trismartsolar.com'),
  ('Legal',              'legal@trismartsolar.com'),
  ('Monitoring',         'monitoring@trismartsolar.com'),
  ('Project Management', 'permitting@trismartsolar.com'),
  ('Sales Ops',          'helpdesk@trismartsolar.com')
on conflict do nothing;

-- 4. funding_nf_changes
create table if not exists public.funding_nf_changes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  slot smallint not null check (slot in (1,2,3)),
  action text not null check (action in ('add','update','clear')),
  old_code text,
  new_code text,
  changed_by uuid references public.users(id),
  changed_at timestamptz not null default now(),
  notified_at timestamptz,
  notified_to text[],
  notification_error text
);

create index funding_nf_changes_project_idx on public.funding_nf_changes (project_id, changed_at desc);
create index funding_nf_changes_pending_idx on public.funding_nf_changes (changed_at) where notified_at is null;

-- DB-level idempotency: cannot insert two identical (project, slot, action, new_code,
-- changed_by) rows within the same calendar minute. `nulls not distinct` is required
-- so that NULL `new_code` (clear actions) and NULL `changed_by` (legacy / machine
-- callers, if any are added later) still dedupe correctly (R2 Critical#1).
-- Idempotency helper: minute bucket. `extract(epoch from timestamptz)` is technically
-- STABLE per Postgres (because session timezone could affect timestamp INPUT parsing),
-- but timestamptz values are stored as UTC and epoch extraction is invariant across
-- sessions. Wrapping in our own IMMUTABLE function lets us index on the result.
create or replace function public._minute_bucket(t timestamptz)
returns bigint
language sql
immutable
parallel safe
as $$ select (extract(epoch from t)::bigint) / 60 $$;

-- DB-level idempotency: cannot insert two identical (project, slot, action, new_code,
-- changed_by) rows within the same calendar minute. `nulls not distinct` makes NULL
-- `new_code` (clear actions) still dedupe (R2 Critical#1). `changed_by` is always
-- non-null since the route requires a session cookie, but the index treats it
-- defensively too.
create unique index funding_nf_changes_idempotency_idx on public.funding_nf_changes (
  project_id, slot, action, new_code, changed_by, public._minute_bucket(changed_at)
) nulls not distinct;

alter table public.funding_nf_changes enable row level security;

-- Read: finance-and-above only (audit log mirrors the access level of the page that
-- generates it — R1#M6).
create policy funding_nf_changes_read on public.funding_nf_changes
  for select to authenticated using (
    exists (
      select 1 from public.users u
      where lower(u.email) = lower(auth.email())
        and u.active = true
        and u.role in ('finance','admin','super_admin')
    )
  );

-- Insert/update: any active user with a role (the API enforces finance-or-above on
-- inbound traffic; this is defense-in-depth so internal writers like the cron path
-- can still record audit rows).
create policy funding_nf_changes_insert on public.funding_nf_changes
  for insert to authenticated with check (auth_is_internal_writer());

create policy funding_nf_changes_update on public.funding_nf_changes
  for update to authenticated using (auth_is_internal_writer()) with check (auth_is_internal_writer());

-- 5. note_mentions: reusable @-mention surface keyed by (source_type, source_id, milestone?).
create table if not exists public.note_mentions (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('funding_note','ticket_comment','project_comment')),
  source_id text not null,
  source_milestone text check (source_milestone in ('m1','m2','m3')),
  mentioned_user_id uuid not null references public.users(id),
  mentioned_by uuid references public.users(id),
  note_excerpt text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  notification_error text
);

create index note_mentions_user_idx on public.note_mentions (mentioned_user_id, created_at desc);
create index note_mentions_source_idx on public.note_mentions (source_type, source_id);
create index note_mentions_pending_idx on public.note_mentions (created_at) where notified_at is null;

alter table public.note_mentions enable row level security;

-- Mentioned user can read their own mentions; admins read all. Email comparison is
-- case-insensitive (auth.email() casing is environment-dependent — R1#M4).
create policy note_mentions_read on public.note_mentions
  for select to authenticated
  using (
    auth_is_admin()
    or mentioned_user_id = (
      select id from public.users
      where lower(email) = lower(auth.email()) and active = true
      limit 1
    )
  );

-- Internal writers create + update.
create policy note_mentions_insert on public.note_mentions
  for insert to authenticated with check (auth_is_internal_writer());

create policy note_mentions_update on public.note_mentions
  for update to authenticated using (auth_is_internal_writer()) with check (auth_is_internal_writer());

commit;
