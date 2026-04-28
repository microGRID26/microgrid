-- Phase B of audit-rotation 2026-04-28 follow-up.
-- Closes greg_actions #355 (organizations.org_select leak) + #357
-- (mention_notifications + note_mentions write/read asymmetry).
--
-- All changes are metadata-only (DROP POLICY + CREATE POLICY). No data
-- migration. No table rewrites. Lock profile = AccessExclusiveLock per
-- catalog row, microseconds. Safe under prod write load.
--
-- APPLIED TO PROD 2026-04-28 via Supabase MCP apply_migration. This local
-- file is the source-control mirror.

begin;

-- ── #355 — organizations.org_select tightened to membership-scoped ─────────
-- Was: qual = auth_is_internal_writer() — full org list visible to every
-- internal writer including sales role. Now: caller can read orgs they
-- belong to + admins/super_admins/platform users see all (latter for the
-- HQ owner-only surface and EDGE platform). Preserves OrgSwitcher / useOrg
-- functionality (user sees orgs they're a member of) while closing the
-- recon-channel leak that lets a sales rep enumerate every dealer org's
-- name + UUID.
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations
  for select to authenticated
  using (
    id = any(public.auth_user_org_ids())
    or public.auth_is_admin()
    or public.auth_is_super_admin()
    or public.auth_is_platform_user()
  );

-- ── #357 — mention_notifications spoof fix + bell-leak fix ─────────────────
-- Old: cmd=ALL `mentions_write` policy lets any internal writer INSERT a
-- row claiming any mentioned_by/mentioned_user_id. Cron picks up
-- notified_at IS NULL → real emails sent in the company's name.
-- Old: cmd=SELECT `mentions_read` policy lets every internal writer read
-- every other user's bell, including 400-char excerpts of finance-only
-- funding notes (the bell-leak from the funding-notifications R1).
--
-- New: split into cmd-specific policies. INSERT/UPDATE WITH CHECK requires
-- mentioned_by matches the caller's verified email (column is text on this
-- table, populated from server-side users.email lookup). SELECT scoped to
-- the recipient.

drop policy if exists mentions_write on public.mention_notifications;
drop policy if exists mentions_read on public.mention_notifications;

create policy mentions_select on public.mention_notifications
  for select to authenticated
  using (
    lower(mentioned_user_id) = lower(auth.email())
    or public.auth_is_admin()
    or public.auth_is_super_admin()
  );

create policy mentions_insert on public.mention_notifications
  for insert to authenticated
  with check (
    public.auth_is_internal_writer()
    and lower(mentioned_by) = lower(auth.email())
  );

create policy mentions_update on public.mention_notifications
  for update to authenticated
  using (lower(mentioned_user_id) = lower(auth.email()) or public.auth_is_admin())
  with check (lower(mentioned_user_id) = lower(auth.email()) or public.auth_is_admin());

create policy mentions_delete on public.mention_notifications
  for delete to authenticated
  using (public.auth_is_admin() or public.auth_is_super_admin());

-- ── #357 — note_mentions spoof fix ─────────────────────────────────────────
-- mentioned_by is uuid → reference public.users.id. Use the same email-lookup
-- pattern the existing note_mentions_read policy uses. The 14-of-15 email
-- match rate is acceptable; the user with no email match cannot mint
-- mentions for themselves either, which is the conservative fail-state.

drop policy if exists note_mentions_insert on public.note_mentions;
drop policy if exists note_mentions_update on public.note_mentions;

create policy note_mentions_insert on public.note_mentions
  for insert to authenticated
  with check (
    public.auth_is_internal_writer()
    and mentioned_by = (
      select u.id from public.users u
      where lower(u.email) = lower(auth.email()) and u.active = true
      limit 1
    )
  );

create policy note_mentions_update on public.note_mentions
  for update to authenticated
  using (
    public.auth_is_admin()
    or mentioned_by = (
      select u.id from public.users u
      where lower(u.email) = lower(auth.email()) and u.active = true
      limit 1
    )
  )
  with check (
    public.auth_is_admin()
    or mentioned_by = (
      select u.id from public.users u
      where lower(u.email) = lower(auth.email()) and u.active = true
      limit 1
    )
  );

commit;
