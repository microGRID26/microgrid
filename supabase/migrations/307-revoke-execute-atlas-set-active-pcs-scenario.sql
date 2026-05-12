-- Defense-in-depth REVOKE on atlas_set_active_pcs_scenario(uuid).
--
-- mig 245 created this SECURITY DEFINER function without a paired
-- REVOKE EXECUTE ... FROM authenticated. The function gates internally
-- on auth_is_super_admin() so the missing REVOKE is non-exploitable, but
-- the gate flagged it as a "REAL HOLE" in greg_actions #666 + #939 P0.
--
-- Zero callers in the MG repo (`grep -rn atlas_set_active_pcs_scenario`
-- 2026-05-12 → only documentation comments in lib/cost/api.ts). REVOKE
-- is safe — no UI path breaks.
--
-- security-definer-grants test scans migration files for in-file REVOKEs,
-- so this migration does NOT remove mig 245's KNOWN_OFFENDERS entry —
-- mig 245's file is unchanged. The comment on that entry in the test
-- gets a follow-up note in the same commit.

REVOKE EXECUTE ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) TO service_role;

-- Verify the ACL ended up where we expect: only postgres + service_role
-- should hold EXECUTE.
DO $$
DECLARE acl_text text;
BEGIN
  SELECT pg_catalog.array_to_string(p.proacl, ',') INTO acl_text
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'atlas_set_active_pcs_scenario';

  IF acl_text LIKE '%authenticated%' THEN
    RAISE EXCEPTION 'mig 307: authenticated still has EXECUTE on atlas_set_active_pcs_scenario after REVOKE — ACL = %', acl_text;
  END IF;
  IF acl_text LIKE '%anon=%' THEN
    RAISE EXCEPTION 'mig 307: anon still has EXECUTE on atlas_set_active_pcs_scenario after REVOKE — ACL = %', acl_text;
  END IF;
  IF acl_text NOT LIKE '%service_role%' THEN
    RAISE EXCEPTION 'mig 307: service_role missing EXECUTE on atlas_set_active_pcs_scenario after GRANT — ACL = %', acl_text;
  END IF;
END $$;
