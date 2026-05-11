-- 294: org_billing_audit table + AFTER UPDATE trigger on public.organizations
--
-- Action #660 (P1) — mig 241 R2 follow-up.
--
-- Why this exists:
--   Mig 241 opened the door for org_admins to update their own org row,
--   bounded by an allow-list trigger (organizations_immutable_fields_guard)
--   admitting {name, logo_url, billing_email, billing_address, updated_at}.
--   Correct authorization, but leaves BEC (Business Email Compromise) pivot
--   defenseless: an attacker who compromises a legitimate org_admin's
--   session can swap billing_email to redirect ACH wire instructions or
--   billing_address to redirect physical AR mail. Today there is no audit
--   trail of these changes; Greg cannot detect or revert.
--
-- This migration adds:
--   1. public.org_billing_audit — append-only audit table, one row per
--      changed billing field per UPDATE.
--   2. organizations_billing_audit_capture() — SECURITY DEFINER trigger
--      function that captures before/after + actor on every UPDATE that
--      changes billing_email or billing_address.
--   3. organizations_billing_audit_trigger — AFTER UPDATE on organizations,
--      WHEN clause short-circuits if neither billing field changed.
--   4. RLS: super_admin reads all; org_admin reads only own org's rows.
--      No INSERT/UPDATE/DELETE policies (only the trigger writes).
--
-- Scope choices:
--   - Billing fields only (email + address). name + logo_url not logged.
--   - No retention TTL (audit logs are evidence; tiny table).
--   - Optional revoke-link notification to OLD email DEFERRED — separate
--     follow-up action will integrate with the email send infra.
--   - Service-role direct UPDATEs (DB-surgery, migration backfills) still
--     fire the trigger; captured with actor_email='service_role' for
--     traceability.
--
-- Pattern references:
--   mig 241 (organizations_immutable_fields_guard) — SET search_path shape
--   mig 290 (dup_review_log) — audit-table RLS + index pattern
--   mig 275 (atlas_chain_audit_log) — SECURITY DEFINER + revoke/grant

-- ── 1. Audit table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_billing_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  field_name          text NOT NULL CHECK (field_name IN ('billing_email','billing_address')),
  before_value        text,
  after_value         text,
  actor_auth_user_id  uuid NOT NULL,
  actor_email         text,
  changed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_billing_audit_org_changed_at
  ON public.org_billing_audit (org_id, changed_at DESC);

COMMENT ON TABLE public.org_billing_audit IS
  'Append-only audit log of billing_email + billing_address changes on '
  'public.organizations. BEC pivot defense — detect/revert unauthorized '
  'changes that would redirect ACH wire or AR mail. Writes only via '
  'organizations_billing_audit_trigger (AFTER UPDATE). Reads via RLS: '
  'super_admin sees all; org_admin sees own org. No row-level INSERT/'
  'UPDATE/DELETE policy by design.';

ALTER TABLE public.org_billing_audit ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS policies ───────────────────────────────────────────────────
-- Read-only via two SELECT policies. No write policies — only the
-- SECURITY DEFINER trigger writes.

DROP POLICY IF EXISTS org_billing_audit_select_super ON public.org_billing_audit;
CREATE POLICY org_billing_audit_select_super ON public.org_billing_audit
  FOR SELECT
  TO authenticated
  USING (auth_is_super_admin());

DROP POLICY IF EXISTS org_billing_audit_select_org_admin ON public.org_billing_audit;
CREATE POLICY org_billing_audit_select_org_admin ON public.org_billing_audit
  FOR SELECT
  TO authenticated
  USING (auth_is_org_admin(org_id));

-- ── 3. Trigger function ───────────────────────────────────────────────
-- AFTER UPDATE. Fires only when one of the two billing fields actually
-- changed (the trigger's WHEN clause below short-circuits the call).
-- Inside the function we still re-check IS DISTINCT FROM per field
-- because the trigger fires once per row but we want one audit row per
-- changed field.
--
-- Actor capture: prefer auth.uid() / auth.email() (set when a request
-- arrives via PostgREST or the JS client). When called via service-role
-- (direct DB-surgery, migration backfills), auth.uid() is NULL — we
-- log a sentinel actor so the row is still traceable.

CREATE OR REPLACE FUNCTION public.organizations_billing_audit_capture()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_uid    uuid;
  v_actor_email  text;
BEGIN
  v_actor_uid := auth.uid();
  IF v_actor_uid IS NULL THEN
    v_actor_uid := '00000000-0000-0000-0000-000000000000'::uuid;
    v_actor_email := 'service_role';
  ELSE
    v_actor_email := auth.email();
  END IF;

  IF NEW.billing_email IS DISTINCT FROM OLD.billing_email THEN
    INSERT INTO public.org_billing_audit
      (org_id, field_name, before_value, after_value, actor_auth_user_id, actor_email)
    VALUES
      (NEW.id, 'billing_email', OLD.billing_email, NEW.billing_email, v_actor_uid, v_actor_email);
  END IF;

  IF NEW.billing_address IS DISTINCT FROM OLD.billing_address THEN
    INSERT INTO public.org_billing_audit
      (org_id, field_name, before_value, after_value, actor_auth_user_id, actor_email)
    VALUES
      (NEW.id, 'billing_address', OLD.billing_address, NEW.billing_address, v_actor_uid, v_actor_email);
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.organizations_billing_audit_capture() IS
  'AFTER UPDATE trigger function that captures billing_email + '
  'billing_address changes on public.organizations into '
  'public.org_billing_audit. SECURITY DEFINER + service-role-only EXECUTE. '
  'Auth.uid()=NULL paths (service-role direct UPDATE) log a sentinel '
  'actor_auth_user_id + actor_email=service_role for traceability.';

-- ── 4. Trigger ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS organizations_billing_audit_trigger ON public.organizations;
CREATE TRIGGER organizations_billing_audit_trigger
  AFTER UPDATE ON public.organizations
  FOR EACH ROW
  WHEN (
    NEW.billing_email IS DISTINCT FROM OLD.billing_email
    OR NEW.billing_address IS DISTINCT FROM OLD.billing_address
  )
  EXECUTE FUNCTION public.organizations_billing_audit_capture();

-- ── 5. Grants ─────────────────────────────────────────────────────────
-- Function executes only as part of the trigger; revoke direct EXECUTE
-- from PUBLIC/anon/authenticated. Triggers run with the function owner's
-- rights regardless of caller, but a tight grant surface is defense-in-
-- depth against future code paths that might call the function directly.

REVOKE EXECUTE ON FUNCTION public.organizations_billing_audit_capture() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.organizations_billing_audit_capture() FROM anon;
REVOKE EXECUTE ON FUNCTION public.organizations_billing_audit_capture() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.organizations_billing_audit_capture() TO service_role;
