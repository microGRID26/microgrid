-- Defense-in-depth REVOKE on atlas_chain_audit_log. mig 275 granted SELECT
-- to anon + authenticated but left INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
-- TRIGGER in the default Supabase-public state (full CRUD via the public.*
-- schema default). RLS is enabled with no INSERT/UPDATE/DELETE policy so
-- the wide grants are unexploitable today — but if anyone toggles RLS off
-- or adds a permissive INSERT policy by mistake, the table is wide open
-- without these explicit REVOKEs.
--
-- greg_actions #757 M-1. Sibling to mig 308's CHECK + comment hygiene.
--
-- Keep SELECT — owner UIs read findings_json transparently. SELECT is
-- additionally gated by RLS atlas_chain_audit_log_owner_read which checks
-- atlas_is_hq_owner() so anon+authenticated still can't actually read
-- anyone else's findings.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.atlas_chain_audit_log
  FROM anon, authenticated;

DO $$
DECLARE wide_grants int;
BEGIN
  SELECT COUNT(*) INTO wide_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'atlas_chain_audit_log'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
  IF wide_grants > 0 THEN
    RAISE EXCEPTION 'mig 309: % anon/authenticated CRUD grants still present after REVOKE — expected 0', wide_grants;
  END IF;
END $$;
