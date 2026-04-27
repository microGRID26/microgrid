-- 187-funding-notes-thread.sql
--
-- Comment thread for funding milestones. Mirrors ticket_comments shape.
-- Per-milestone scoping: each row is (project_id, milestone) bound.
--
-- Author display name is NOT a column — it's resolved on read via join to
-- users.name keyed on author_id. This blocks display-name spoofing (R1#H1
-- on 187): a malicious client cannot write a fake `author = 'Paul Christo'`
-- while owning a different author_id.
--
-- Legacy m{1,2,3}_notes columns on project_funding are NOT dropped — they're
-- surfaced in the UI as "migrated note" entries when the per-milestone thread
-- is empty. A future one-shot script may backfill into funding_notes.

create table if not exists public.funding_notes (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(id) on delete cascade,
  milestone text not null check (milestone in ('m1','m2','m3')),
  author_id uuid not null references public.users(id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index funding_notes_project_milestone_idx on public.funding_notes
  (project_id, milestone, created_at desc) where deleted_at is null;
create index funding_notes_recent_idx on public.funding_notes
  (project_id, created_at desc) where deleted_at is null;

alter table public.funding_notes enable row level security;

-- Read: finance-and-above only, AND deleted rows hidden from non-admins. Admins
-- retain visibility into deleted bodies for audit / dispute resolution.
create policy funding_notes_read on public.funding_notes
  for select to authenticated using (
    (deleted_at is null or auth_is_admin())
    and exists (
      select 1 from public.users u
      where lower(u.email) = lower(auth.email())
        and u.active = true
        and u.role in ('finance','admin','super_admin')
    )
  );

-- Insert: finance-and-above, AND author_id MUST match the inserter's own users.id
-- (resolved via case-insensitive email bridge — canonical pattern per migration 132).
create policy funding_notes_insert on public.funding_notes
  for insert to authenticated with check (
    exists (
      select 1 from public.users u
      where lower(u.email) = lower(auth.email())
        and u.active = true
        and u.role in ('finance','admin','super_admin')
        and u.id = author_id
    )
  );

-- Update / soft-delete: admins always; otherwise the row's author_id MUST match
-- the caller's own users.id. The duplicate `u.id = author_id` clause is
-- defense-in-depth against the (theoretical) email-collision case where two
-- users share an email and `limit 1` is non-deterministic — the row's
-- author_id binding still has to match the caller's resolved id.
create policy funding_notes_update on public.funding_notes
  for update to authenticated using (
    auth_is_admin()
    or exists (
      select 1 from public.users u
      where lower(u.email) = lower(auth.email())
        and u.active = true
        and u.id = author_id
    )
  ) with check (
    auth_is_admin()
    or exists (
      select 1 from public.users u
      where lower(u.email) = lower(auth.email())
        and u.active = true
        and u.id = author_id
    )
  );
