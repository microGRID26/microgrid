-- Migration 247 — Unified app_feedback platform.
--
-- Greg, 2026-05-08: "all our feedback structures should be the same. Across all
-- projects." Today five different feedback shapes coexist (customer_feedback,
-- spoke_feedback, bread_of_life_feedback, bloom_feedback, paul-feedback-tagged
-- greg_actions). This migration introduces a single discriminated table that
-- new apps can hit without schema work; existing tables stay readable so the
-- 5 callers cut over independently in later migrations.
--
-- Architectural choices (chosen for long-term, not short-term):
-- - Single table, app_id text discriminator → adding a new app is a 1-row
--   INSERT into the apps lookup table, no DDL required
-- - Apps lookup table (app_feedback_apps) acts as the whitelist; FK enforces
--   the discriminator boundary and prevents typo/spoofing pollution
-- - Separate 1:N attachments table → multiple screenshots/files per submission
-- - Triage columns shipped on day one with CHECK enums → Phase C/D autotriage
--   agents populate them without enum drift
-- - SECURITY DEFINER RPCs + REVOKE anon/authenticated → matches the post-#113
--   hardening pattern (existing atlas_* RPCs)
-- - Per-app boundary in get/resolve/triage RPCs: caller MUST pass p_app_id and
--   the row's app_id MUST match. List allows null app_id ONLY for the HQ
--   aggregate view (caller already needs service-role, HQ is the sole holder
--   today; if a per-app service key ever exists, it can only see/mutate its
--   own rows).
-- - Storage attachments validated server-side: bucket must be 'app-feedback',
--   path must start with the row's app_id and contain no '..' segments. This
--   blocks the "register attachment row pointing at another bucket / another
--   app's folder → exfiltrate via signed URL" attack.
-- - Length CHECKs on text fields, rate limit on add RPC, attachments array
--   capped at 20 — defense in depth against floods.
-- - Storage policies: explicit deny-all for anon + authenticated. Service-role
--   bypasses RLS for the upload path.
--
-- This migration is additive. No existing rows are touched. No locks beyond
-- the new-table create. Safe to apply during business hours.

-- ============================================================================
-- App whitelist (lookup table)
-- ============================================================================

create table public.app_feedback_apps (
  -- Lowercase slug, no dots/spaces/regex metacharacters. The id is interpolated
  -- into a regex anchor inside the add RPC's path-prefix check; the CHECK
  -- below keeps that regex safe for any future whitelist entry.
  id text primary key
    check (id ~ '^[a-z][a-z0-9-]*$' and length(id) between 2 and 40),
  name text not null,
  created_at timestamptz not null default now()
);

insert into public.app_feedback_apps (id, name) values
  ('atlas-hq',      'Atlas HQ'),
  ('microgrid',     'MicroGRID'),
  ('spark',         'SPARK'),
  ('edge',          'EDGE'),
  ('sentinel',      'SENTINEL'),
  ('edge-model',    'EDGE-MODEL'),
  ('bloom',         'Bloom'),
  ('spoke',         'SPOKE'),
  ('bread-of-life', 'Bread of Life'),
  ('paul-hq',       'Paul HQ'),
  ('quest',         'Quest');

-- ============================================================================
-- Tables
-- ============================================================================

create table public.app_feedback (
  id uuid primary key default gen_random_uuid(),

  -- FK to the whitelist. New apps require a 1-row insert into app_feedback_apps,
  -- not a migration.
  app_id text not null references public.app_feedback_apps(id),

  category text check (category in ('bug','idea','praise','question','confusing','other')),
  status text not null default 'new'
    check (status in ('new','reviewing','responded','closed')),

  message text not null
    check (length(message) between 1 and 10000),

  rating int check (rating between 1 and 5),

  -- Context captured at submit time. All length-capped to prevent DoS.
  screen_path  text check (screen_path is null or length(screen_path) <= 2000),
  screen_w     int  check (screen_w is null or screen_w between 0 and 100000),
  screen_h     int  check (screen_h is null or screen_h between 0 and 100000),
  viewport_w   int  check (viewport_w is null or viewport_w between 0 and 100000),
  viewport_h   int  check (viewport_h is null or viewport_h between 0 and 100000),
  user_agent   text check (user_agent is null or length(user_agent) <= 1000),
  user_email   text check (user_email is null or (length(user_email) <= 320 and user_email like '%@%')),
  user_role    text check (user_role is null or length(user_role) <= 40),
  app_version  text check (app_version is null or length(app_version) <= 100),

  -- Triage fields — populated by Phase C/D autotriage agents (initially null).
  triage_decision text
    check (triage_decision is null or triage_decision in
      ('unclassified','duplicate','wontfix','queued','auto-fixed','escalated')),
  triage_severity text
    check (triage_severity is null or triage_severity in
      ('low','medium','high','critical')),
  greg_action_id int,            -- conceptual FK to greg_actions.id (soft, no hard FK)
  pr_url text check (pr_url is null or length(pr_url) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index app_feedback_app_status_created_idx
  on public.app_feedback (app_id, status, created_at desc);
-- Used by HQ aggregate "all-apps by status" view (atlas_list_app_feedback with
-- p_app_id=null). Kept despite partial overlap with the (app_id, status, …)
-- index because this query is a real callsite.
create index app_feedback_status_created_idx
  on public.app_feedback (status, created_at desc);
create index app_feedback_triage_decision_idx
  on public.app_feedback (triage_decision)
  where triage_decision is not null;
-- Supports the rate-limit query in atlas_add_app_feedback (count where
-- app_id+user_email+created_at>now()-1h). Partial index keeps the size down
-- since most submissions in a busy hour share a user_email.
create index app_feedback_ratelimit_idx
  on public.app_feedback (app_id, user_email, created_at desc)
  where user_email is not null;

create table public.app_feedback_attachments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.app_feedback(id) on delete cascade,
  storage_bucket text not null
    check (storage_bucket = 'app-feedback'),  -- single bucket; defense in depth
  storage_path text not null
    check (length(storage_path) between 1 and 1000 and position('..' in storage_path) = 0),
  mime_type text check (mime_type is null or length(mime_type) <= 200),
  size_bytes int check (size_bytes is null or size_bytes between 0 and 50000000),  -- 50MB cap
  original_filename text check (original_filename is null or length(original_filename) <= 500),
  created_at timestamptz not null default now()
);

create index app_feedback_attachments_feedback_id_idx
  on public.app_feedback_attachments (feedback_id);

-- RLS: deny everything by default. All access goes through SECURITY DEFINER RPCs.
alter table public.app_feedback enable row level security;
alter table public.app_feedback_attachments enable row level security;
alter table public.app_feedback_apps enable row level security;

-- Updated_at trigger
create or replace function public._app_feedback_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_feedback_set_updated_at
  before update on public.app_feedback
  for each row
  execute function public._app_feedback_set_updated_at();

-- ============================================================================
-- RPCs — all SECURITY DEFINER + REVOKE anon/authenticated below
-- ============================================================================

-- Insert path. p_attachments is an optional jsonb array of
-- {storage_bucket, storage_path, mime_type, size_bytes, original_filename}.
-- Server-side validation:
--   - app_id must exist in app_feedback_apps (FK)
--   - rate limit: max 20 submissions per (app_id, user_email) per hour
--   - attachments capped at 20 per submission
--   - storage_bucket must be 'app-feedback' (CHECK on attachments table)
--   - storage_path must start with '<app_id>/' and contain no '..'
create or replace function public.atlas_add_app_feedback(
  p_app_id text,
  p_message text,
  p_category text default null,
  p_rating int default null,
  p_screen_path text default null,
  p_screen_w int default null,
  p_screen_h int default null,
  p_viewport_w int default null,
  p_viewport_h int default null,
  p_user_agent text default null,
  p_user_email text default null,
  p_user_role text default null,
  p_app_version text default null,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_att jsonb;
  v_path text;
  v_app_id text := lower(trim(coalesce(p_app_id, '')));
  v_recent_count int;
begin
  if length(v_app_id) = 0 then
    raise exception 'app_id is required';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'message is required';
  end if;
  if not exists (select 1 from public.app_feedback_apps where id = v_app_id) then
    raise exception 'unknown app_id: %', v_app_id;
  end if;

  -- Rate limit: 20 submissions per (app_id, user_email) per hour. Skipped
  -- when user_email is null (anonymous) — those callers are typically
  -- public widgets that should add their own per-IP rate limit at the edge.
  if p_user_email is not null then
    select count(*) into v_recent_count
      from public.app_feedback
      where app_id = v_app_id
        and user_email = p_user_email
        and created_at > now() - interval '1 hour';
    if v_recent_count >= 20 then
      raise exception 'rate limit exceeded: % per hour for %', v_recent_count, p_user_email;
    end if;
  end if;

  if p_attachments is not null and jsonb_array_length(p_attachments) > 20 then
    raise exception 'too many attachments (max 20)';
  end if;

  insert into public.app_feedback (
    app_id, message, category, rating,
    screen_path, screen_w, screen_h, viewport_w, viewport_h,
    user_agent, user_email, user_role, app_version
  ) values (
    v_app_id, p_message, p_category, p_rating,
    p_screen_path, p_screen_w, p_screen_h, p_viewport_w, p_viewport_h,
    p_user_agent, p_user_email, p_user_role, p_app_version
  )
  returning id into v_id;

  if p_attachments is not null and jsonb_array_length(p_attachments) > 0 then
    for v_att in select * from jsonb_array_elements(p_attachments)
    loop
      v_path := v_att->>'storage_path';
      -- Path must start with the row's app_id followed by '/'. Blocks the
      -- "register an attachment row pointing at another app's folder" attack.
      if v_path is null or v_path !~ ('^' || v_app_id || '/') then
        raise exception 'attachment storage_path must start with %/...', v_app_id;
      end if;

      insert into public.app_feedback_attachments (
        feedback_id, storage_bucket, storage_path,
        mime_type, size_bytes, original_filename
      ) values (
        v_id,
        coalesce(v_att->>'storage_bucket', 'app-feedback'),
        v_path,
        v_att->>'mime_type',
        nullif(v_att->>'size_bytes','')::int,
        v_att->>'original_filename'
      );
    end loop;
  end if;

  return v_id;
end;
$$;

-- List path. Filter by app_id and/or status. Includes attachment count for the
-- UI to show a paperclip icon without a second round-trip.
--
-- p_app_id = null returns rows from ALL apps. This is the HQ aggregate view.
-- Today HQ is the only service-role caller; if per-app service keys ever
-- exist, harden this further by gating on a JWT claim or splitting into
-- atlas_admin_list_app_feedback (null OK) vs atlas_list_app_feedback (required).
create or replace function public.atlas_list_app_feedback(
  p_app_id text default null,
  p_status text default null,
  p_limit int default 50
)
returns table (
  id uuid,
  app_id text,
  category text,
  status text,
  message text,
  rating int,
  screen_path text,
  user_email text,
  user_role text,
  app_version text,
  triage_decision text,
  triage_severity text,
  greg_action_id int,
  pr_url text,
  attachment_count bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    f.id, f.app_id, f.category, f.status, f.message, f.rating,
    f.screen_path, f.user_email, f.user_role, f.app_version,
    f.triage_decision, f.triage_severity, f.greg_action_id, f.pr_url,
    (select count(*) from public.app_feedback_attachments a where a.feedback_id = f.id) as attachment_count,
    f.created_at, f.updated_at
  from public.app_feedback f
  where (p_app_id is null or f.app_id = lower(trim(p_app_id)))
    and (p_status is null or f.status = p_status)
  order by f.created_at desc
  limit greatest(1, least(p_limit, 500));
$$;

-- Get one feedback row with its attachments inline. Returns explicit fields
-- (NOT to_jsonb(f.*)) so future column additions don't silently leak.
-- Caller MUST pass p_app_id; row's app_id MUST match. Per-app boundary.
create or replace function public.atlas_get_app_feedback(
  p_app_id text,
  p_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'feedback', jsonb_build_object(
      'id', f.id,
      'app_id', f.app_id,
      'category', f.category,
      'status', f.status,
      'message', f.message,
      'rating', f.rating,
      'screen_path', f.screen_path,
      'screen_w', f.screen_w,
      'screen_h', f.screen_h,
      'viewport_w', f.viewport_w,
      'viewport_h', f.viewport_h,
      'user_agent', f.user_agent,
      'user_email', f.user_email,
      'user_role', f.user_role,
      'app_version', f.app_version,
      'triage_decision', f.triage_decision,
      'triage_severity', f.triage_severity,
      'greg_action_id', f.greg_action_id,
      'pr_url', f.pr_url,
      'created_at', f.created_at,
      'updated_at', f.updated_at
    ),
    'attachments', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', a.id,
                'storage_bucket', a.storage_bucket,
                'storage_path', a.storage_path,
                'mime_type', a.mime_type,
                'size_bytes', a.size_bytes,
                'original_filename', a.original_filename,
                'created_at', a.created_at
              ) order by a.created_at)
         from public.app_feedback_attachments a
         where a.feedback_id = f.id),
      '[]'::jsonb
    )
  )
  from public.app_feedback f
  where f.id = p_id
    and f.app_id = lower(trim(p_app_id));
$$;

-- Resolve / status update. Per-app boundary enforced.
create or replace function public.atlas_resolve_app_feedback(
  p_app_id text,
  p_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app_id text := lower(trim(coalesce(p_app_id, '')));
  v_updated int;
begin
  if length(v_app_id) = 0 then
    raise exception 'app_id is required';
  end if;
  if p_status not in ('new','reviewing','responded','closed') then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.app_feedback
    set status = p_status
    where id = p_id and app_id = v_app_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'feedback not found or app_id mismatch: id=%, app_id=%', p_id, v_app_id;
  end if;
end;
$$;

-- Triage write — used by Phase C autotriage agent. Idempotent. Per-app
-- boundary enforced. p_decision is REQUIRED; severity, greg_action_id, pr_url
-- are coalesced so a partial update does NOT clobber prior values.
create or replace function public.atlas_set_app_feedback_triage(
  p_app_id text,
  p_id uuid,
  p_decision text,
  p_severity text default null,
  p_greg_action_id int default null,
  p_pr_url text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app_id text := lower(trim(coalesce(p_app_id, '')));
  v_updated int;
begin
  if length(v_app_id) = 0 then
    raise exception 'app_id is required';
  end if;
  if p_decision not in ('unclassified','duplicate','wontfix','queued','auto-fixed','escalated') then
    raise exception 'invalid triage_decision: %', p_decision;
  end if;
  if p_severity is not null and p_severity not in ('low','medium','high','critical') then
    raise exception 'invalid triage_severity: %', p_severity;
  end if;

  update public.app_feedback
    set triage_decision = p_decision,
        triage_severity = coalesce(p_severity, triage_severity),
        greg_action_id  = coalesce(p_greg_action_id, greg_action_id),
        pr_url          = coalesce(p_pr_url, pr_url)
    where id = p_id and app_id = v_app_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'feedback not found or app_id mismatch: id=%, app_id=%', p_id, v_app_id;
  end if;
end;
$$;

-- ============================================================================
-- REVOKE PUBLIC + anon + authenticated; GRANT service_role.
--
-- Per atlas-fn-grant-guard hook (#636 2026-05-08): combined "REVOKE FROM
-- anon, authenticated" is insufficient — Supabase's default ACLs on the
-- public schema auto-grant to anon + authenticated separately, and Postgres
-- auto-grants EXECUTE to PUBLIC on CREATE FUNCTION. All three must be
-- revoked explicitly, then service_role granted explicitly. HQ holds the
-- MICROGRID_SUPABASE_SERVICE_KEY (sb_secret_*) which is service_role.
-- ============================================================================

-- Trigger function (cosmetic; harmless if not REVOKEd, but matches house style)
revoke execute on function public._app_feedback_set_updated_at() from public;
revoke execute on function public._app_feedback_set_updated_at() from anon;
revoke execute on function public._app_feedback_set_updated_at() from authenticated;

-- atlas_add_app_feedback
revoke execute on function public.atlas_add_app_feedback(text, text, text, int, text, int, int, int, int, text, text, text, text, jsonb) from public;
revoke execute on function public.atlas_add_app_feedback(text, text, text, int, text, int, int, int, int, text, text, text, text, jsonb) from anon;
revoke execute on function public.atlas_add_app_feedback(text, text, text, int, text, int, int, int, int, text, text, text, text, jsonb) from authenticated;
grant  execute on function public.atlas_add_app_feedback(text, text, text, int, text, int, int, int, int, text, text, text, text, jsonb) to service_role;

-- atlas_list_app_feedback
revoke execute on function public.atlas_list_app_feedback(text, text, int) from public;
revoke execute on function public.atlas_list_app_feedback(text, text, int) from anon;
revoke execute on function public.atlas_list_app_feedback(text, text, int) from authenticated;
grant  execute on function public.atlas_list_app_feedback(text, text, int) to service_role;

-- atlas_get_app_feedback
revoke execute on function public.atlas_get_app_feedback(text, uuid) from public;
revoke execute on function public.atlas_get_app_feedback(text, uuid) from anon;
revoke execute on function public.atlas_get_app_feedback(text, uuid) from authenticated;
grant  execute on function public.atlas_get_app_feedback(text, uuid) to service_role;

-- atlas_resolve_app_feedback
revoke execute on function public.atlas_resolve_app_feedback(text, uuid, text) from public;
revoke execute on function public.atlas_resolve_app_feedback(text, uuid, text) from anon;
revoke execute on function public.atlas_resolve_app_feedback(text, uuid, text) from authenticated;
grant  execute on function public.atlas_resolve_app_feedback(text, uuid, text) to service_role;

-- atlas_set_app_feedback_triage
revoke execute on function public.atlas_set_app_feedback_triage(text, uuid, text, text, int, text) from public;
revoke execute on function public.atlas_set_app_feedback_triage(text, uuid, text, text, int, text) from anon;
revoke execute on function public.atlas_set_app_feedback_triage(text, uuid, text, text, int, text) from authenticated;
grant  execute on function public.atlas_set_app_feedback_triage(text, uuid, text, text, int, text) to service_role;

-- ============================================================================
-- Storage bucket. Private. Files keyed by <app_id>/<user-segment>/<filename>.
-- Read access via signed URLs only (lib/storage/mg-sign.ts on HQ).
-- Explicit deny-all for anon + authenticated; service-role bypasses RLS.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('app-feedback', 'app-feedback', false)
on conflict (id) do nothing;

-- Defense-in-depth: explicit policies that deny anon + authenticated on
-- the app-feedback bucket. The bucket being public=false already blocks
-- public CDN reads; these policies harden direct supabase-js calls from
-- a leaked anon key.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'app_feedback_bucket_deny_anon_authenticated'
  ) then
    create policy app_feedback_bucket_deny_anon_authenticated on storage.objects
      as restrictive
      for all
      to anon, authenticated
      using (bucket_id <> 'app-feedback')
      with check (bucket_id <> 'app-feedback');
  end if;
end$$;
