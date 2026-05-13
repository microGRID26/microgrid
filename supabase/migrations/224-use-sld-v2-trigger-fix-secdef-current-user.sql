-- Migration 224 — fix SECURITY DEFINER + current_user bug in 222b
--
-- ---------------------------------------------------------------------------
-- THE BUG (Critical, production-live since 2026-05-13 ~15:30 UTC)
-- ---------------------------------------------------------------------------
-- Migration 222b's `projects_block_direct_use_sld_v2_update()` trigger
-- function is SECURITY DEFINER owned by postgres. Inside the function body,
-- `current_user` returns the function OWNER ('postgres') regardless of the
-- session role (PostgreSQL semantics for SECURITY DEFINER functions).
--
-- The 222b bypass check is:
--   IF NOT (
--     current_user IN ('postgres', 'supabase_admin', 'service_role')
--     OR public.auth_is_admin()
--   ) THEN
--     RAISE EXCEPTION ... USING ERRCODE = '42501';
--   END IF;
--
-- Since `current_user` is ALWAYS 'postgres' inside this function (even when
-- called from an authenticated JWT), the bypass fires for EVERY caller. The
-- intended admin-only guard does not gate anything — any authenticated user
-- can flip `use_sld_v2` on any project.
--
-- Live repro confirmed pre-fix (chain pickup 2026-05-13 evening):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   UPDATE public.projects SET use_sld_v2 = NOT use_sld_v2 WHERE id = 'PROJ-32115';
--   -- Expected per 222b spec: raise 42501. Actual: succeeds.
--   ROLLBACK;
--
-- Same bug class was about to ship in mig 223 (stage trigger) before the
-- migration-planner subagent caught it pre-apply.
--
-- ---------------------------------------------------------------------------
-- THE FIX
-- ---------------------------------------------------------------------------
-- Replace `current_user` with `session_user`. session_user is the original
-- CONNECTION role (set at login, NOT changed by SET ROLE or SECURITY DEFINER).
-- For Supabase:
--   - PostgREST authenticated request  → session_user = 'authenticator'
--   - Direct postgres / MCP execute_sql → session_user = 'postgres'
--   - service_role direct connection   → session_user = 'service_role'
-- So `session_user IN ('postgres', 'supabase_admin', 'service_role')`
-- correctly bypasses DB-admin paths and traps API-authenticated callers.
--
-- auth_is_admin() is unaffected — it reads from JWT claims via auth.uid()
-- and auth.users, not from current_user/session_user. End-user JWT admins
-- continue to bypass as intended (use_sld_v2 has no governing RPC, so direct
-- admin UPDATEs are the supported path — unlike stage, see 223).

CREATE OR REPLACE FUNCTION public.projects_block_direct_use_sld_v2_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.use_sld_v2 IS DISTINCT FROM OLD.use_sld_v2) THEN
    IF NOT (
      session_user IN ('postgres', 'supabase_admin', 'service_role')
      OR public.auth_is_admin()
    ) THEN
      RAISE EXCEPTION 'projects.use_sld_v2 can only be flipped by admin/super_admin during the v2 rollout'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Owner + grants preserved by CREATE OR REPLACE.
-- Trigger binding (BEFORE UPDATE OF use_sld_v2) unchanged.
--
-- ---------------------------------------------------------------------------
-- POSTCONDITION ASSERT (R1-M3)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF position('session_user' IN pg_get_functiondef('public.projects_block_direct_use_sld_v2_update'::regproc)) = 0 THEN
    RAISE EXCEPTION 'migration 224 did not take effect — projects_block_direct_use_sld_v2_update body missing session_user';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SMOKE-TEST EVIDENCE (R1-L1 — clarify test setup)
-- ---------------------------------------------------------------------------
-- The "222b silently broken" claim was verified live against the pre-fix
-- function body using `SET LOCAL ROLE authenticated` from MCP — under that
-- shape, the SECURITY DEFINER trigger sees current_user='postgres' (function
-- owner) and 222b's bypass `current_user IN ('postgres', ...)` fires for
-- every caller. Repro succeeded: UPDATE use_sld_v2 returned no error.
--
-- The post-fix authenticated-path verification (T2) uses SET LOCAL SESSION
-- AUTHORIZATION authenticator (NOT just SET LOCAL ROLE) because session_user
-- is the original CONNECTION role and is NOT changed by SET LOCAL ROLE.
-- Inside MCP execute_sql, session_user remains 'postgres' under SET LOCAL
-- ROLE alone — which would land in the bypass list and falsely pass the
-- test. SESSION AUTHORIZATION flips session_user to 'authenticator',
-- simulating a real PostgREST connection. Pre-commit smoke test result:
--   T2 (authenticated path):  SET LOCAL SESSION AUTHORIZATION authenticator
--                             + SET LOCAL ROLE authenticated
--                             + UPDATE projects SET use_sld_v2 = NOT use_sld_v2 WHERE id = 'PROJ-32115'
--                             → SQLSTATE 42501 (correctly blocked post-fix)
--   T4 (postgres MCP path):   UPDATE projects SET use_sld_v2 = use_sld_v2 WHERE id = 'PROJ-32115'
--                             → succeeded (Bypass A correctly fired)
--
-- Blast-radius audit (this session, post-fix): only PROJ-32115 has
-- use_sld_v2=true; zero audit_log rows for use_sld_v2 changes during the
-- 222b buggy window (~6h, 2026-05-13 ~15:30 → ~21:30 UTC). No unauthorized
-- flips occurred.
