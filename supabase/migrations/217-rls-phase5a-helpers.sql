-- Phase 5a of the 7-phase multi-tenant RLS hardening plan.
-- Adds 4 SECURITY DEFINER helpers used by Phase 5d (cross-tenant policy
-- rewrites) for FK-indirection scope checks. Same pattern as the Phase 2
-- helper auth_can_see_project: STABLE, search_path locked, REVOKE PUBLIC,
-- GRANT authenticated.
--
-- Plan:   docs/plans/2026-04-28-multi-tenant-rls-hardening-plan.md
-- Design: docs/plans/2026-05-02-rls-phase5-policy-bucket.md (Bucket C2)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- auth_can_see_purchase_order(uuid) — for po_line_items + future PO children
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_can_see_purchase_order(p_po_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.auth_is_platform_user()
    OR EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      WHERE po.id = p_po_id
        AND public.auth_can_see_project(po.project_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_can_see_purchase_order(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_can_see_purchase_order(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- auth_can_see_work_order(uuid) — for wo_checklist_items + future WO children
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_can_see_work_order(p_wo_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.auth_is_platform_user()
    OR EXISTS (
      SELECT 1
      FROM public.work_orders wo
      WHERE wo.id = p_wo_id
        AND public.auth_can_see_project(wo.project_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_can_see_work_order(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_can_see_work_order(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- auth_can_see_jsa(uuid) — for jsa_acknowledgements, jsa_activities
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_can_see_jsa(p_jsa_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.auth_is_platform_user()
    OR EXISTS (
      SELECT 1
      FROM public.jsa j
      WHERE j.id = p_jsa_id
        AND public.auth_can_see_project(j.project_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_can_see_jsa(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_can_see_jsa(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- auth_can_see_ticket(uuid) — for ticket_comments, ticket_history
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_can_see_ticket(p_ticket_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.auth_is_platform_user()
    OR EXISTS (
      SELECT 1
      FROM public.tickets t
      WHERE t.id = p_ticket_id
        AND public.auth_can_see_project(t.project_id)
    );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_can_see_ticket(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_can_see_ticket(uuid) TO authenticated;

COMMIT;
