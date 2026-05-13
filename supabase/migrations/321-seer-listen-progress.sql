-- 321-seer-listen-progress
--
-- Backs the "Resume from M:SS" feature on Seer's TTSPlayer (Chain 1 of
-- ~/.claude/plans/atomic-popping-dusk.md). Greg's feedback `aaf86d81`
-- (2026-05-13, seer_feedback): "I want to be able to listen to the concepts
-- without having the app open... I also want when I stop listening midway
-- through a lesson, it to remember where I left off for the next time."
--
-- Background-audio half is handled by app.json `UIBackgroundModes: ["audio"]`
-- + existing `shouldPlayInBackground: true` audio-session config. This
-- migration backs the resume half: persist (owner, kind, slug) → last position
-- so a fresh mount can offer a Resume CTA.
--
-- One row per (owner_id, kind, slug). Upsert from client on:
--   - pause
--   - app backgrounded (AppState 'background')
--   - every ~10s during active playback (throttled)
--   - explicit stop
-- Reset (position_seconds = 0) once playback reaches the existing ≥90%
-- completion gate — at that point the side-effects already fired and Greg
-- doesn't need to resume something he's effectively finished.
--
-- Owner-gated like every other Seer table; mirrors the pattern in
-- 315-seer-atlas-tab-phase1 (atlas_hq_is_owner(auth.uid())).

create table if not exists public.seer_listen_progress (
  owner_id          uuid not null default auth.uid(),
  kind              text not null check (kind in ('concept', 'story', 'flashcard')),
  slug              text not null check (char_length(slug) <= 200),
  position_seconds  numeric(10,3) not null default 0
                      check (position_seconds >= 0),
  duration_seconds  numeric(10,3) not null default 0
                      check (duration_seconds >= 0),
  updated_at        timestamptz not null default now(),
  primary key (owner_id, kind, slug),
  -- Allow a tiny float slop (≤1s) on the position-vs-duration invariant so
  -- the 90% completion path doesn't trip a constraint when the player
  -- reports currentTime momentarily past duration.
  check (position_seconds <= duration_seconds + 1)
);

alter table public.seer_listen_progress enable row level security;

-- R1 M1: defense-in-depth. atlas_hq_is_owner alone is sufficient today
-- (single-owner), but tightening with check (owner_id = auth.uid()) closes
-- the row-spoof gap if the owner check ever broadens.
create policy "listen progress owner only"
  on public.seer_listen_progress for all to authenticated
  using (owner_id = auth.uid() and atlas_hq_is_owner(auth.uid()))
  with check (owner_id = auth.uid() and atlas_hq_is_owner(auth.uid()));

revoke all on public.seer_listen_progress from public, anon;
grant select, insert, update, delete on public.seer_listen_progress to authenticated;

-- updated_at maintenance — keeps "most recently listened" queries cheap
-- (future: Today screen "Continue listening" carousel).
create or replace function public.seer_listen_progress_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- R1 M2: fire on insert AND update so a client cannot spoof updated_at via
-- the insert path of upsert. Keeping ordering of the planned "Continue
-- listening" carousel honest.
drop trigger if exists seer_listen_progress_updated_at on public.seer_listen_progress;
create trigger seer_listen_progress_updated_at
  before insert or update on public.seer_listen_progress
  for each row execute function public.seer_listen_progress_set_updated_at();

create index if not exists seer_listen_progress_owner_updated_idx
  on public.seer_listen_progress (owner_id, updated_at desc);
