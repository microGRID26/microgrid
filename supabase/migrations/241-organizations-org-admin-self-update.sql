-- 241: organizations RLS — let org admins update their own org row
--
-- Current state (problem):
--   • CHECK no_platform_orgs_on_mg = (org_type <> 'platform') NOT VALID
--     blocks every UPDATE to platform-org rows (e.g. EDGE) from anyone
--     including legitimate platform-org admins. Result: there's no path
--     to set EDGE.billing_email except direct DB surgery.
--   • org_update RLS policy only allows super_admin → too restrictive
--     for the day-to-day "an org admin updates their own contact info"
--     workflow (which the EDGE admin settings page will exercise).
--
-- This migration:
--   1. Drops the blunt CHECK. Replaced with policy + trigger nuance below.
--   2. Replaces org_update RLS policy with: super_admin OR
--      auth_is_org_admin(id). Org admins can update their OWN org row
--      (the helper checks membership + role); they cannot touch other
--      orgs' rows.
--   3. Adds a BEFORE UPDATE trigger using an ALLOW-LIST: org_admin can
--      change ONLY {name, logo_url, billing_email, billing_address}.
--      Every other column rejects with 42501. Specifically locked out:
--        • org_type, id, slug — privilege escalation vectors
--        • allowed_domains — tenancy boundary (provision_user_membership
--          auto-grants membership on email-domain match → cross-tenant
--          attack vector)
--        • active — self-DoS for a whole tenant; auth helpers gate on
--          COALESCE(active, true) so flipping breaks routing
--        • settings JSONB — contains tenancy flags including
--          is_sales_originator and is_underwriter that lib/invoices/chain.ts
--          + DealerRelationshipsManager scan org-wide. Flipping these on
--          your own org reroutes the platform's sales-leg invoice chain
--          to your books. Critical money path.
--        • created_at — system-managed
--
-- Audit-driven: red-teamer + migration-planner R1 flagged settings JSONB
-- as Critical, allowed_domains/active as High. Allow-list approach
-- forecloses the entire class.

-- ── 1. Drop the blunt CHECK ────────────────────────────────────────────
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS no_platform_orgs_on_mg;

-- ── 2. Replace org_update RLS policy ──────────────────────────────────
DROP POLICY IF EXISTS org_update ON public.organizations;

CREATE POLICY org_update ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    auth_is_super_admin()
    OR auth_is_org_admin(id)
  )
  WITH CHECK (
    auth_is_super_admin()
    OR auth_is_org_admin(id)
  );

-- ── 3. Allow-list trigger ─────────────────────────────────────────────
-- super_admin can change anything. Everyone else (org_admin via the new
-- policy) can change ONLY the contact-info columns. Any other column
-- diff raises 42501.

CREATE OR REPLACE FUNCTION public.organizations_immutable_fields_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth_is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Locked columns (rejected if changed) ──────────────────────────────
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'organizations.id is immutable'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.org_type IS DISTINCT FROM OLD.org_type THEN
    RAISE EXCEPTION
      'organizations.org_type can only be changed by super_admin (was %, attempted %)',
      OLD.org_type, NEW.org_type
      USING ERRCODE = '42501';
  END IF;

  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION
      'organizations.slug can only be changed by super_admin'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.allowed_domains IS DISTINCT FROM OLD.allowed_domains THEN
    RAISE EXCEPTION
      'organizations.allowed_domains can only be changed by super_admin (tenancy boundary; affects provision_user_membership auto-grants)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.active IS DISTINCT FROM OLD.active THEN
    RAISE EXCEPTION
      'organizations.active can only be changed by super_admin'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.settings IS DISTINCT FROM OLD.settings THEN
    RAISE EXCEPTION
      'organizations.settings can only be changed by super_admin (contains chain-routing flags is_sales_originator, is_underwriter that reroute money paths)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'organizations.created_at is immutable'
      USING ERRCODE = '42501';
  END IF;

  -- Allow-listed columns (org_admin may change):
  --   name, logo_url, billing_email, billing_address, updated_at

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_immutable_fields_trigger ON public.organizations;

CREATE TRIGGER organizations_immutable_fields_trigger
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_immutable_fields_guard();

COMMENT ON FUNCTION public.organizations_immutable_fields_guard() IS
  'Allow-list guard for non-super_admin UPDATEs to organizations. '
  'Org admins (per new org_update RLS policy) may change only '
  'name, logo_url, billing_email, billing_address. Everything else '
  '— including settings JSONB and allowed_domains — is super_admin only. '
  'Pairs with mig 241 RLS change. Audit anchor: red-teamer + migration-planner '
  '2026-05-08 flagged settings/allowed_domains as Critical/High.';
