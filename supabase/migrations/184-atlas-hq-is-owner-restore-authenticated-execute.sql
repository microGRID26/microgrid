-- 184-atlas-hq-is-owner-restore-authenticated-execute.sql
--
-- Follow-up to 183. The REVOKE EXECUTE ... FROM PUBLIC in 183 stripped
-- the implicit `authenticated` grant on atlas_hq_is_owner (Supabase
-- default-ACL grant came via PUBLIC, not an explicit role grant).
--
-- Side effect: the RLS policy `owners_all` on atlas_hq_users uses
-- `atlas_hq_is_owner(auth.uid())` in its qual. Postgres evaluates RLS
-- policy expressions as the invoking role (authenticated for any
-- browser-side query), which means authenticated needs EXECUTE on the
-- helper function. Without it, the policy can't evaluate and any
-- direct SELECT from atlas_hq_users (e.g. the HQ /admin/users page if
-- it ever queries the table directly via the publishable key) silently
-- returns empty.
--
-- Re-grant EXECUTE to authenticated. The function is now self-protective
-- via the auth.role() / auth.uid() gate added in 183, so authenticated
-- having EXECUTE no longer enables impersonation.

GRANT EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) TO authenticated;
