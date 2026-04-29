-- ============================================================================
-- 192-rls-drop-platform-org-bypass.sql
-- Closes greg_action #354 (P1 — drop org_type='platform' short-circuit on MG)
--
-- WHY
-- ---
-- `auth_is_platform_user()` returns true for any user with `org_memberships`
-- to an org with `org_type='platform'`. The audit-rotation 2026-04-28 verdict:
-- "platform org_type is supposed to exist only on EDGE, never on MG." On MG
-- it's the highest-power short-circuit in 100 RLS policies — anyone in the
-- platform org sees and edits every project across every dealer org.
--
-- Today the EDGE platform org `1f82d049-8e2b-46d5-9fe2-efd8664a91a5` exists on
-- MG with 3 members:
--   - greg@energydevelopmentgroup.com  (super_admin)
--   - gkelsch@trismartsolar.com         (super_admin)
--   - paul@energydevelopmentgroup.com   (admin)
--
-- All 3 ALSO belong to the MG epc org (`a0000000-…0001`). The threat model the
-- audit raised: anyone with admin-on-org_memberships could grant themselves
-- platform-org membership and instantly read/write every multi-tenant table.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Refactors `auth_is_platform_user()` to drop the org_type='platform'
--    branch. Keeps the super_admin fallback (current behavior — super_admins
--    have always been treated as platform users regardless of org membership).
-- 2. Deletes the 3 org_memberships rows for the EDGE platform org. The org
--    row ITSELF stays (it's referenced by 14 invoices to_org + 1 invoice
--    from_org + 2 engineering_assignments — financial / engineering history
--    that we don't want to lose).
-- 3. Adds a `NOT VALID` check constraint preventing future inserts of
--    `org_type='platform'` on MG. NOT VALID skips existing rows so the
--    EDGE platform row remains valid; only future inserts are blocked.
--
-- REGRESSION ANALYSIS
-- -------------------
-- - Greg + gkelsch@trismart (super_admin): `auth_is_platform_user()` still
--   returns true via the super_admin fallback. Zero change in access.
-- - Paul (admin): loses the platform branch but keeps MG-org membership.
--   For RLS policies of shape `org_id = ANY(auth_user_org_ids()) OR
--   auth_is_platform_user()`, the first clause grants MG-org rows. Loses
--   only cross-org rows — and MG is single-tenant today, so there are no
--   cross-org rows for him to lose.
-- - Future second-dealer onboarding: Paul would lose visibility into the
--   new dealer's data. By then the right answer is to either grant him
--   the new org's membership explicitly or upgrade his role — same decision
--   Greg would make about any other admin.
--
-- LOCK PROFILE
-- ------------
--   CREATE OR REPLACE FUNCTION    : function catalog only, sub-ms
--   DELETE on org_memberships     : 3 row locks, sub-ms
--   ADD CONSTRAINT … NOT VALID    : ACCESS EXCLUSIVE on organizations briefly
--                                    (catalog op, no row scan), sub-ms
--   100 policies that call the helper: NOT touched by this migration. They
--                                    keep working transparently because the
--                                    function signature is identical.
--
-- PRE-APPLY GATES
-- ---------------
-- 1. Apply to a Supabase branch first.
-- 2. Verify Paul can still log in to MG and see his MG-org projects/tickets.
-- 3. Verify Greg + gkelsch retain full visibility (super_admin fallback).
-- 4. Diff `get_advisors(type='security')` before vs after — expect no new
--    ERROR-level lints; some MEDIUM-level "policies use SECURITY DEFINER
--    helper that may bypass RLS" lints may shrink (good).
--
-- ROLLBACK
-- --------
-- Restore the prior helper definition + re-INSERT the 3 memberships +
-- DROP CONSTRAINT no_platform_orgs_on_mg. Inline at bottom as commented SQL.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Refactor auth_is_platform_user() — drop the platform-org-membership
--    branch. Preserve the session-cache pattern + the super_admin fallback.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_is_platform_user()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cached TEXT;
  result BOOLEAN;
BEGIN
  -- Try session cache (set on first call within a transaction)
  BEGIN
    cached := current_setting('app.is_platform_user', true);
  EXCEPTION WHEN OTHERS THEN
    cached := NULL;
  END;

  IF cached IS NOT NULL AND cached != '' THEN
    RETURN cached::BOOLEAN;
  END IF;

  -- The platform-org-membership branch was removed here
  -- (greg_action #354, 2026-04-29). Previously this function returned true
  -- for any user with org_memberships → organizations(org_type='platform').
  -- The EDGE platform org existed on MG with 3 members, giving them blanket
  -- access to every multi-tenant table. The threat model: anyone able to
  -- write org_memberships could grant themselves the same blanket access.
  --
  -- Now: only super_admin role-bearers are treated as platform users.
  -- super_admin is `users.role`-gated and visible in the audit log; any
  -- privilege escalation requires an explicit users.role flip.
  result := public.auth_is_super_admin();

  PERFORM set_config('app.is_platform_user', result::TEXT, true);
  RETURN result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Delete the 3 org_memberships rows for the EDGE platform org. The org
--    row itself stays — it's referenced by 14 invoices.to_org + 1
--    invoices.from_org + 2 engineering_assignments.assigned_org rows. Those
--    keep working because the foreign-key target row remains valid.
--
--    org_memberships.org_id is ON DELETE CASCADE — but we explicitly DELETE
--    just the memberships, NOT the org itself.
-- ----------------------------------------------------------------------------
DELETE FROM public.org_memberships
WHERE org_id IN (SELECT id FROM public.organizations WHERE org_type = 'platform');

-- ----------------------------------------------------------------------------
-- 3. Block future insertion of `org_type='platform'` rows on MG. NOT VALID
--    skips the existing EDGE platform org so it doesn't fail constraint
--    validation — only future inserts are checked. The constraint name
--    documents intent: "no platform orgs on MG".
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizations
  ADD CONSTRAINT no_platform_orgs_on_mg CHECK (org_type <> 'platform') NOT VALID;

COMMIT;

-- ============================================================================
-- POST-FLIGHT QUERIES (run after apply)
-- ============================================================================
-- 1. Helper no longer references org_type:
--    SELECT prosrc FROM pg_proc WHERE proname='auth_is_platform_user'
--      AND pronamespace='public'::regnamespace;
--    -- expect: no occurrence of 'platform' in the body
--
-- 2. Zero memberships in any platform org:
--    SELECT count(*) FROM public.org_memberships om
--    JOIN public.organizations o ON o.id = om.org_id
--    WHERE o.org_type = 'platform';
--    -- expect: 0
--
-- 3. EDGE org row preserved (FK refs intact):
--    SELECT id, name, org_type FROM public.organizations
--    WHERE id = '1f82d049-8e2b-46d5-9fe2-efd8664a91a5';
--    -- expect: 1 row, org_type='platform' (the existing one — NOT VALID
--    -- check constraint allows it to remain)
--
-- 4. Future insertion of platform org_type fails:
--    INSERT INTO public.organizations (name, org_type)
--      VALUES ('attempt', 'platform');
--    -- expect: ERROR — new row violates check constraint "no_platform_orgs_on_mg"
--
-- 5. Smoke each affected user:
--    a) Sign in as paul@energydevelopmentgroup.com → visit /projects → see
--       MG-org projects (NOT 0 rows). Visit /funding → see MG funding.
--    b) Sign in as greg@energydevelopmentgroup.com → visit any page → see
--       full data (super_admin fallback path).
--    c) Sign in as gkelsch@trismartsolar.com → same as (b).

-- ============================================================================
-- ROLLBACK (paste into a fresh transaction if you must revert)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE public.organizations DROP CONSTRAINT no_platform_orgs_on_mg;
--   INSERT INTO public.org_memberships (org_id, user_id, org_role)
--   VALUES
--     ('1f82d049-8e2b-46d5-9fe2-efd8664a91a5', '528de936-c427-4854-8495-fe1641be468b', 'owner'),    -- greg@edg
--     ('1f82d049-8e2b-46d5-9fe2-efd8664a91a5', '9f152711-775a-4064-aaa3-c2606ae09f3d', 'owner'),    -- gkelsch@trismart
--     ('1f82d049-8e2b-46d5-9fe2-efd8664a91a5', '45dc9ad1-005f-438d-ac49-86d8c187a05a', 'member');   -- paul@edg
--   CREATE OR REPLACE FUNCTION public.auth_is_platform_user()
--   RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     cached       TEXT;
--     result       BOOLEAN;
--     v_public_uid uuid;
--   BEGIN
--     BEGIN
--       cached := current_setting('app.is_platform_user', true);
--     EXCEPTION WHEN OTHERS THEN
--       cached := NULL;
--     END;
--
--     IF cached IS NOT NULL AND cached != '' THEN
--       RETURN cached::BOOLEAN;
--     END IF;
--
--     SELECT u.id INTO v_public_uid
--       FROM public.users u
--       WHERE lower(u.email) = lower(auth.email())
--         AND COALESCE(u.active, true) = true
--       LIMIT 1;
--
--     IF v_public_uid IS NULL THEN
--       result := public.auth_is_super_admin();
--       PERFORM set_config('app.is_platform_user', result::TEXT, true);
--       RETURN result;
--     END IF;
--
--     SELECT EXISTS(
--       SELECT 1 FROM public.org_memberships om
--       JOIN public.organizations o ON o.id = om.org_id
--       WHERE om.user_id = v_public_uid AND o.org_type = 'platform'
--     ) OR public.auth_is_super_admin() INTO result;
--
--     PERFORM set_config('app.is_platform_user', result::TEXT, true);
--     RETURN result;
--   END;
--   $$;
-- COMMIT;
