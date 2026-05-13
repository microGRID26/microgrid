-- Migration 223 — fix NULL auth.role() bypass in 215b's stage trigger
--
-- 215b used `IF auth.role() <> 'authenticated' THEN RETURN NEW;` to skip the
-- guard for service_role / postgres / unauthenticated contexts. But
-- `auth.role()` returns NULL for MCP execute_sql / direct postgres-role
-- connections, and `NULL <> 'authenticated'` evaluates to NULL — which is
-- falsy in plpgsql IF semantics. The bypass never fires for those callers,
-- and the trigger raises on what should be allowlisted DB-level flips.
--
-- ---------------------------------------------------------------------------
-- WHY session_user, NOT current_user
-- ---------------------------------------------------------------------------
-- The trigger function is SECURITY DEFINER, owned by postgres. Inside the
-- function body, `current_user` returns the function OWNER ('postgres'),
-- regardless of the session role. That means
-- `current_user IN ('postgres', 'supabase_admin', 'service_role')` evaluates
-- true for EVERY caller — including end-user authenticated JWTs — silently
-- nuking the guard.
--
-- `session_user` returns the original connection role (set at login, NOT
-- changed by SET ROLE or SECURITY DEFINER). For Supabase:
--   - PostgREST authenticated request  → session_user = 'authenticator'
--   - Direct postgres / MCP execute_sql → session_user = 'postgres'
--   - service_role direct connection   → session_user = 'service_role'
-- So `session_user IN ('postgres', 'supabase_admin', 'service_role')`
-- correctly bypasses DB-admin paths and traps API-authenticated callers.
--
-- Migration 222b (use_sld_v2 trigger) shipped with the broken current_user
-- pattern and is silently bypassed by every authenticated user in prod
-- today. Migration 224 (this session) ships the parallel fix for that
-- function.
--
-- ---------------------------------------------------------------------------
-- WHY NO `OR public.auth_is_admin()` HERE (DELTA FROM 222b/224 PATTERN)
-- ---------------------------------------------------------------------------
-- The set_project_stage RPC owns stage transitions and contains all
-- validation logic (transition rules, p_force admin check, stage_history
-- insert, audit_log insert). Letting JWT admins bypass via direct UPDATE
-- would skip all of that. End-user JWT admins continue to go through the
-- RPC like everyone else.
--
-- After fix, the bypass routes are:
--   1. DB-admin role (postgres / supabase_admin / service_role) — direct
--      UPDATE works, intended for migrations and operator data corrections.
--   2. The set_project_stage RPC — sets the transaction-local GUC
--      `app.via_set_project_stage = 'true'`.
-- Everything else hits 42501.

CREATE OR REPLACE FUNCTION public.projects_block_direct_stage_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bypass A: DB-admin connection roles. Uses session_user (NOT current_user)
  -- because the function is SECURITY DEFINER — see comment above.
  IF session_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF (NEW.stage IS DISTINCT FROM OLD.stage)
     OR (NEW.stage_date IS DISTINCT FROM OLD.stage_date) THEN
    -- Bypass B: set_project_stage RPC sets a transaction-local GUC.
    IF current_setting('app.via_set_project_stage', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'projects.stage / stage_date cannot be UPDATEd directly; use set_project_stage(...) RPC'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Owner + grants preserved by CREATE OR REPLACE (Postgres semantics confirmed:
-- prior owner=postgres, ACL=authenticated+service_role+anon EXECUTE).
-- Trigger binding (BEFORE UPDATE OF stage, stage_date) unchanged.
