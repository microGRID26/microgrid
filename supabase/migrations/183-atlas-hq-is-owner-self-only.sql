-- 183-atlas-hq-is-owner-self-only.sql
--
-- Defensive sweep finding from 2026-04-26 session. CRITICAL severity.
--
-- atlas_hq_is_owner(p_uid uuid) was checking only that p_uid is in the
-- atlas_hq_users owners list. It did NOT verify p_uid = auth.uid(). The
-- 3 owner-gated RPCs (atlas_hq_create_user, atlas_hq_update_user,
-- atlas_hq_list_users) take an explicit p_caller uuid arg and pass it
-- straight to atlas_hq_is_owner(p_caller).
--
-- Combined with these 3 RPCs being granted EXECUTE to anon (Supabase's
-- default ACL on public.* SECURITY DEFINER functions), this means:
--   * Anyone with the MG publishable (anon) key could call
--     atlas_hq_create_user(p_caller := <known_owner_auth_uid>, ...) and
--     create themselves an owner-role HQ user.
--   * Same impersonation primitive on update_user (privilege escalation
--     by demoting / deactivating other owners) and list_users (HQ user
--     list disclosure: emails, names, last sign-in).
--
-- Companion atlas_hq_link_auth_user already has the correct pattern
-- (`p_auth_user_id <> auth.uid()` → RAISE). The 3 broken RPCs were
-- written without that defense.
--
-- Two-layer fix:
--   1. Tighten atlas_hq_is_owner with a role-aware gate:
--        * Trust service_role and postgres (HQ Next.js API routes use
--          getServiceSupabase which calls into Postgres as service_role
--          with no JWT context — auth.uid() returns NULL there). The
--          API layer is responsible for verifying the caller before
--          passing p_uid, and that's been working since HQ launched.
--        * For authenticated callers (direct PostgREST /rest/v1/rpc/
--          path), require p_uid = auth.uid(). Kills the impersonation
--          primitive: an authenticated non-owner can no longer pass an
--          owner's uid as p_caller and pass the gate.
--        * For anon (and any other role), neither condition matches.
--          Combined with the explicit REVOKE below, anon is locked out
--          two ways.
--   2. REVOKE EXECUTE on the 3 owner-gated RPCs from anon and PUBLIC.
--      Defense in depth — anon shouldn't be able to invoke owner-tier
--      RPCs at all, even with the tightened gate. Authenticated keeps
--      EXECUTE since HQ admin pages route through service_role server-
--      side, but a future direct-from-browser call would need authenticated
--      EXECUTE retained.

CREATE OR REPLACE FUNCTION public.atlas_hq_is_owner(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM atlas_hq_users
    WHERE auth_user_id = p_uid
      AND (
        auth.role() IN ('service_role', 'postgres')
        OR auth_user_id = auth.uid()
      )
      AND role = 'owner'
      AND active
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_create_user(uuid, text, text, text)
  FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_update_user(uuid, uuid, text, boolean)
  FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_list_users(uuid)
  FROM anon, PUBLIC;
