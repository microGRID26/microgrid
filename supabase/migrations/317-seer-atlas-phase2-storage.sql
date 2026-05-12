-- mig 317: Seer Atlas Phase 2 — private TTS bucket + STT request counter
-- Applied via MCP apply_migration on 2026-05-12 (this file is the canonical record).
-- Transactional: apply_migration wraps in BEGIN/COMMIT.

-- 1. Private bucket for Atlas TTS audio
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('seer-atlas-audio', 'seer-atlas-audio', false, 5242880, array['audio/mpeg'])
on conflict (id) do nothing;

-- 2. RLS on storage.objects for this bucket
--    SELECT: owner only (documentary; signed URLs bypass RLS by design)
--    NOTE: no service_role INSERT policy — service_role has BYPASSRLS=true.
--          Including a policy gives false sense of explicit gating; omit it.
create policy "seer_atlas_audio_owner_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'seer-atlas-audio' and atlas_hq_is_owner(auth.uid()));

-- 3. STT request counter on existing daily-usage table
--    Column name utc_day matches Phase 1 mig 315 PK
alter table seer_atlas_daily_usage
  add column if not exists stt_request_count int not null default 0;

create or replace function seer_atlas_increment_stt_requests(p_uid uuid)
returns table(request_count_today int, cap_exceeded boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_cap   constant int := 500;
  v_existing int;
  v_new int;
begin
  -- Check-then-increment: never tick on rejected requests.
  select stt_request_count into v_existing
  from seer_atlas_daily_usage
  where owner_id = p_uid and utc_day = v_today
  for update;

  if v_existing is null then
    insert into seer_atlas_daily_usage (owner_id, utc_day, stt_request_count)
    values (p_uid, v_today, 1)
    on conflict (owner_id, utc_day) do update
      set stt_request_count = seer_atlas_daily_usage.stt_request_count + 1
    returning stt_request_count into v_new;
    return query select v_new, false;
  end if;

  if v_existing >= v_cap then
    return query select v_existing, true;  -- cap hit; do NOT increment
  end if;

  update seer_atlas_daily_usage
  set stt_request_count = stt_request_count + 1
  where owner_id = p_uid and utc_day = v_today
  returning stt_request_count into v_new;

  return query select v_new, false;
end $$;

revoke all on function seer_atlas_increment_stt_requests(uuid) from public, anon, authenticated;
grant execute on function seer_atlas_increment_stt_requests(uuid) to service_role;

-- Rollback DDL (commented; apply manually if needed pre-rollout):
--   drop function if exists seer_atlas_increment_stt_requests(uuid);
--   alter table seer_atlas_daily_usage drop column if exists stt_request_count;
--   drop policy if exists "seer_atlas_audio_owner_select" on storage.objects;
--   delete from storage.buckets where id = 'seer-atlas-audio';
--      (safe pre-rollout; bucket has 0 objects)
