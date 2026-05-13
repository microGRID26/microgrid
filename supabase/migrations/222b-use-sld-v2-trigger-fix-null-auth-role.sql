-- Migration 222b — fix NULL auth.role() bypass in 222
--
-- 222 used `IF auth.role() <> 'authenticated' THEN RETURN NEW;` to skip the
-- guard for service_role / postgres / unauthenticated contexts. But
-- `auth.role()` returns NULL for MCP execute_sql / direct postgres-role
-- connections, and `NULL <> 'authenticated'` evaluates to NULL — which is
-- falsy in plpgsql IF semantics. The bypass never fires for those callers,
-- and the trigger raises on what should be allowlisted DB-level flips.
--
-- Repro: `UPDATE projects SET use_sld_v2 = ... WHERE id = ...` via Supabase
-- MCP execute_sql hit 42501 even though current_user = 'postgres'.
--
-- Same latent bug exists in 215b's stage trigger, but nobody UPDATEs stage
-- directly via MCP (RPC set_project_stage owns that path), so it's never
-- hit. 222 is the first time the pattern faces direct MCP UPDATE traffic.
--
-- Fix: explicit allowlist on `current_user` (postgres, supabase_admin,
-- service_role) PLUS `auth_is_admin()` for end-user contexts.

CREATE OR REPLACE FUNCTION public.projects_block_direct_use_sld_v2_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.use_sld_v2 IS DISTINCT FROM OLD.use_sld_v2) THEN
    IF NOT (
      current_user IN ('postgres', 'supabase_admin', 'service_role')
      OR public.auth_is_admin()
    ) THEN
      RAISE EXCEPTION 'projects.use_sld_v2 can only be flipped by admin/super_admin during the v2 rollout'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
