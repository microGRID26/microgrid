-- Repo-wide auth-helper hardening: email-match → uid-AND-email-match.
--
-- Action #628 P0. Source: R1 red-teamer on mig 242 (employee-mobile F0,
-- 2026-05-08) found that every public auth_is_* / auth_user_* helper joined
-- public.users to the session via lower(email) = lower(auth.email()) ONLY,
-- with no auth.uid() linkage. Attacker who registers a fresh Supabase auth
-- with a stolen employee email becomes that employee for every RLS gate
-- (auth_is_admin, auth_is_super_admin, auth_user_role, auth_user_id).
--
-- This migration tightens the 4 remaining email-only helpers to require
-- BOTH auth_user_id = auth.uid() AND email match. The auth_user_id column
-- was added in mig 241; auth_is_employee (mig 242) already uses this
-- pattern. The other 8 helpers in the public schema (auth_is_finance,
-- auth_is_internal_writer, auth_is_manager, auth_is_org_admin,
-- auth_is_org_member, auth_is_platform_user, auth_user_name,
-- auth_user_org_ids) don't reference lower(email) at all — they delegate to
-- org_memberships or already-hardened helpers, so no change needed there.
--
-- ## Lockout risk: NONE for currently-authenticated users.
--
-- Diagnostic at apply-time:
--   * 22 total rows in public.users; 21 have auth_user_id populated.
--   * 1 active orphan with NULL auth_user_id: Aaron Semliatschenko
--     (manager). matching_auth_users = 0 (no Supabase auth row by his
--     email at all) → he has no auth session today and is not granted
--     anything by the current email-only path either. The hardening
--     doesn't change his effective access.
--   * If/when Aaron signs up, his uid won't match any existing users row;
--     he'll get default role until Greg backfills users.auth_user_id —
--     same onboarding flow as new hires.
--
-- ## Belt-and-suspenders: keep the email match alongside the uid match.
-- An attacker who manages to compromise both an auth.uid and the linked MG
-- users row already has access to do anything that role allows. Keeping
-- email match is a cheap defense-in-depth check against a future bug where
-- users.auth_user_id is mis-linked to the wrong auth.users row (Aaron-style
-- onboarding flow has a small race window if multiple people share an
-- email at the auth-table level, which Supabase prevents but a future
-- multi-auth-provider integration might re-open).

BEGIN;

-- ---------------------------------------------------------------------------
-- auth_is_admin: role IN ('admin', 'super_admin')
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin', 'super_admin')
       FROM public.users
      WHERE auth_user_id = auth.uid()
        AND lower(email) = lower(auth.email())
        AND COALESCE(active, true) = true
      LIMIT 1),
    false
  );
$$;

COMMENT ON FUNCTION public.auth_is_admin() IS
  'Returns true iff the JWT identifies an active admin or super_admin. Requires uid AND email match (action #628). SECURITY DEFINER + search_path locked.';

-- ---------------------------------------------------------------------------
-- auth_is_super_admin: role = 'super_admin'
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT role = 'super_admin'
       FROM public.users
      WHERE auth_user_id = auth.uid()
        AND lower(email) = lower(auth.email())
        AND COALESCE(active, true) = true
      LIMIT 1),
    false
  );
$$;

COMMENT ON FUNCTION public.auth_is_super_admin() IS
  'Returns true iff the JWT identifies an active super_admin. Requires uid AND email match (action #628). SECURITY DEFINER + search_path locked.';

-- ---------------------------------------------------------------------------
-- auth_user_role: returns the role string (or 'user' default)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT role
       FROM public.users
      WHERE auth_user_id = auth.uid()
        AND lower(email) = lower(auth.email())
        AND COALESCE(active, true) = true
      LIMIT 1),
    'user'
  );
$$;

COMMENT ON FUNCTION public.auth_user_role() IS
  'Returns the MG role for the authenticated JWT, defaulting to ''user'' on no match. Requires uid AND email match (action #628). SECURITY DEFINER + search_path locked.';

-- ---------------------------------------------------------------------------
-- auth_user_id: returns the public.users.id (text) for the session
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id::text
    FROM public.users
   WHERE auth_user_id = auth.uid()
     AND lower(email) = lower(auth.email())
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.auth_user_id() IS
  'Returns the MG public.users.id (text) for the authenticated JWT. Requires uid AND email match (action #628). SECURITY DEFINER + search_path locked.';

-- Re-assert grant posture to match live state on prod.
--
-- Live verification at apply-time (hzymsezqfxzpbcqryeim 2026-05-12): all
-- four helpers have EXECUTE for anon + authenticated + service_role. The
-- R1 red-teamer audit on this migration originally flagged this as a HIGH
-- regression vs migration 171, but mig 176 (`restore_auth_helper_grants`,
-- 2026-04-25) explicitly restored anon EXECUTE for a documented use case.
-- Re-stating the grants here ensures CREATE OR REPLACE doesn't accidentally
-- regress the post-176 posture in case Postgres semantics change in a
-- future major version.
GRANT EXECUTE ON FUNCTION public.auth_is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_super_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_user_id() TO anon, authenticated, service_role;

COMMIT;
