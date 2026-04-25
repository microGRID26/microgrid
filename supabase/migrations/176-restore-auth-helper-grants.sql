-- 176: roll back migration 171's REVOKE on auth_* helpers
--
-- Migration 171 revoked PUBLIC + anon EXECUTE on the 13 auth_* SECDEF
-- helpers based on the 2026-04-25 audit-rotation suggestion that "PUBLIC
-- EXECUTE is a smell". The audit body was wrong: the auth_pre-commit
-- grant-parity hook caught the regression because PostgreSQL inlines
-- RLS USING clauses into the query plan and evaluates the function
-- call with the CALLER's privileges, not the policy owner's. Without
-- anon EXECUTE, anon-role read paths through any RLS policy that
-- references auth_is_admin() / auth_user_role() / etc. break.
--
-- This is the same outage migration 151 (2026-04-24) recovered from.
-- Restore the prior grants.
--
-- The audit's underlying concern — that anon shouldn't be able to call
-- these as a top-level RPC — is moot because the helpers are read-only
-- and search_path-pinned. PUBLIC EXECUTE is the load-bearing default.

GRANT EXECUTE ON FUNCTION public.auth_is_admin()             TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_finance()           TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_internal_writer()   TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_manager()           TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_org_admin(uuid)     TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_org_member(uuid)    TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_platform_user()     TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_is_super_admin()       TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_role_level()           TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_id()              TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_name()            TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_org_ids()         TO PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_role()            TO PUBLIC, anon;
