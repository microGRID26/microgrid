-- 171: REVOKE PUBLIC + anon EXECUTE on the auth_* helper family
-- greg_actions #295 (P2 part 2). Audit-rotation 2026-04-25 / security-definer-rpcs.
--
-- These helpers are SECURITY DEFINER, search_path-pinned, read-only. They're
-- used inside RLS policies (which run as the table owner, so the policy use
-- itself isn't affected by these grants). PUBLIC EXECUTE is a smell:
-- nothing in the codebase calls these directly from anon contexts. Authenticated
-- callers retain access (RLS policies that compile to function calls in the
-- query plan resolve under the policy's authority, not the caller's, so this
-- is belt-and-suspenders).
--
-- Caveat: if a Supabase Edge Function or external SQL caller relies on PUBLIC
-- EXECUTE, this will break it. None known as of 2026-04-25.

REVOKE EXECUTE ON FUNCTION public.auth_is_admin()             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_finance()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_internal_writer()   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_manager()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_org_admin(uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_org_member(uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_platform_user()     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_super_admin()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_role_level()           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_user_id()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_user_name()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_user_org_ids()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.auth_user_role()            FROM PUBLIC, anon;
