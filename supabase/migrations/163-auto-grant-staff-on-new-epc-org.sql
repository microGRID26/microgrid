-- Migration 163 — Auto-grant every active MG staff user org_memberships
-- row on new epc-org onboarding (#278).
--
-- Why: storage upload RLS (migration 157) goes through tickets.org_id →
-- EXISTS via auth_user_org_ids(). Works today because every internal user
-- happens to be a member of every epc org. The moment MG onboards a new
-- customer, staff without an explicit membership on the new epc org hit 403
-- when trying to attach a screenshot to that customer's tickets — an
-- operational paper cut, not a security issue. Semantically MG already
-- treats "staff sees all epc tickets" as the norm; this trigger removes the
-- manual-grant step on onboarding so the invariant stays true.
--
-- Scope: fires only for org_type='epc'. Platform/engineering/distribution
-- orgs have different membership semantics and are not in scope.
-- "Staff" = users whose role matches auth_is_internal_writer's canonical
-- list ('super_admin','admin','finance','manager','user','sales'). Mirrors
-- the same internal-user definition used elsewhere in MG RLS.

CREATE OR REPLACE FUNCTION public.organizations_grant_staff_on_new_epc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.org_type <> 'epc' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.active, true) = false THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.org_memberships (user_id, org_id, org_role, is_default)
  SELECT u.id, NEW.id, 'member', false
    FROM public.users u
   WHERE COALESCE(u.active, true) = true
     AND u.role IN ('super_admin', 'admin', 'finance', 'manager', 'user', 'sales')
  ON CONFLICT (user_id, org_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger functions are invoked by the executor, not PostgREST — REVOKEs are
-- cosmetic defense-in-depth for future-proofing (matches pattern in
-- migration 146 tightening atlas_kb_entries_touch_updated_at).
REVOKE EXECUTE ON FUNCTION public.organizations_grant_staff_on_new_epc() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.organizations_grant_staff_on_new_epc() FROM anon;
REVOKE EXECUTE ON FUNCTION public.organizations_grant_staff_on_new_epc() FROM authenticated;

DROP TRIGGER IF EXISTS organizations_grant_staff_on_new_epc_trg ON public.organizations;
CREATE TRIGGER organizations_grant_staff_on_new_epc_trg
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_grant_staff_on_new_epc();

-- Also fire on UPDATEs that *promote* an org into the (epc, active) state —
-- e.g., an org staged as inactive then flipped live, or an org created under
-- a non-epc org_type then re-typed. Without this, the INSERT-only trigger
-- leaves the invariant broken post-promotion (R1 M1).
CREATE OR REPLACE FUNCTION public.organizations_grant_staff_on_promote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.org_type <> 'epc' OR COALESCE(NEW.active, true) = false THEN
    RETURN NEW;
  END IF;
  -- Only run when the pair (org_type, active) actually changed INTO
  -- (epc, active). Idempotent otherwise (normal updates touch name/settings).
  IF (OLD.org_type, COALESCE(OLD.active, true)) IS NOT DISTINCT FROM
     (NEW.org_type, COALESCE(NEW.active, true)) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.org_memberships (user_id, org_id, org_role, is_default)
  SELECT u.id, NEW.id, 'member', false
    FROM public.users u
   WHERE COALESCE(u.active, true) = true
     AND u.role IN ('super_admin', 'admin', 'finance', 'manager', 'user', 'sales')
  ON CONFLICT (user_id, org_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.organizations_grant_staff_on_promote() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.organizations_grant_staff_on_promote() FROM anon;
REVOKE EXECUTE ON FUNCTION public.organizations_grant_staff_on_promote() FROM authenticated;

DROP TRIGGER IF EXISTS organizations_grant_staff_on_promote_trg ON public.organizations;
CREATE TRIGGER organizations_grant_staff_on_promote_trg
  AFTER UPDATE OF org_type, active ON public.organizations
  FOR EACH ROW
  WHEN (NEW.org_type = 'epc' AND COALESCE(NEW.active, true) = true)
  EXECUTE FUNCTION public.organizations_grant_staff_on_promote();

-- Backfill: any existing active epc org where an active staff user is NOT
-- currently a member gets the missing membership row. Keeps the new invariant
-- true across history, not just for onboarding forward.
INSERT INTO public.org_memberships (user_id, org_id, org_role, is_default)
SELECT u.id, o.id, 'member', false
  FROM public.users u
 CROSS JOIN public.organizations o
 WHERE COALESCE(u.active, true) = true
   AND u.role IN ('super_admin', 'admin', 'finance', 'manager', 'user', 'sales')
   AND o.active = true
   AND o.org_type = 'epc'
   AND NOT EXISTS (
     SELECT 1 FROM public.org_memberships m
      WHERE m.user_id = u.id AND m.org_id = o.id
   )
ON CONFLICT (user_id, org_id) DO NOTHING;  -- belt + suspenders; NOT EXISTS prevents conflict today, ON CONFLICT is the guard if a future unique-index addition races (R2 L1)
