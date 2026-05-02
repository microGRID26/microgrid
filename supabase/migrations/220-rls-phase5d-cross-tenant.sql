-- Phase 5d of the 7-phase multi-tenant RLS hardening plan.
-- Rewrites 80 RLS policies across 46 tables that have neither org_id nor
-- project_id, plus updates auth_can_see_project to add role-aware legacy
-- gating per Greg's Q4 design decision.
--
-- Plan:   docs/plans/2026-04-28-multi-tenant-rls-hardening-plan.md
-- Design: docs/plans/2026-05-02-rls-phase5-policy-bucket.md (Bucket C, all sub-buckets)
--
-- Sub-buckets:
--   C1 — cross-tenant reference (MG-org membership read; admin write)
--   C2 — FK indirection (uses helpers added in migration 217)
--   C3 — self-scoped (auth.uid() match)
--   C4 — internal admin / platform only
--   C5 — sensitive surfaces (users, legacy_projects, note_mentions, bread_of_life_feedback)
--
-- MG org uuid: 'a0000000-0000-0000-0000-000000000001' — matches Phase 1 backfill.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Snapshot every replaced policy into _rls_phase5_snapshot for rollback.
-- ---------------------------------------------------------------------------
INSERT INTO public._rls_phase5_snapshot
  (phase, schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check)
SELECT
  '5d-cross-tenant', schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual LIKE '%auth_is_internal_writer%' OR with_check LIKE '%auth_is_internal_writer%')
  AND tablename NOT IN (
    -- These are handled by 218 (Bucket A) and 219 (Bucket B); skip.
    'commission_config','commission_geo_modifiers','commission_hierarchy','commission_rates',
    'crew_rates','document_requirements','job_cost_labor','job_cost_materials','job_cost_overhead',
    'notification_rules','onboarding_requirements','pay_distribution','pay_scales',
    'queue_sections','schedule','task_reasons','ticket_categories','ticket_resolution_codes',
    'tickets','vendors','warehouse_stock',
    'audit_log','change_orders','custom_field_values','edge_sync_log','equipment_warranties',
    'funding_nf_changes','jsa','legacy_notes','material_requests','mention_notifications',
    'project_adders','project_documents','project_folders','project_materials','project_readiness',
    'purchase_orders','ramp_schedule','task_history','task_state','time_entries',
    'warranty_claims','welcome_call_logs','work_orders'
  )
  AND NOT (
    -- The 3 *_legacy_internal SELECT policies stay unmodified (covered by helper update below).
    (tablename, policyname) IN (
      ('notes', 'notes_select_legacy_internal'),
      ('project_folders', 'project_folders_select_legacy_internal'),
      ('stage_history', 'stage_history_select_legacy_internal')
    )
  );

-- ---------------------------------------------------------------------------
-- Pre-flight #1: legacy_projects rep-name match coverage.
--
-- Q4: sales reps see legacy_projects rows where their users.name matches
-- advisor / consultant / pm. TEXT match is fragile. Surface any sales rep
-- whose name doesn't appear in any legacy row they were attributed to in
-- /reports — they'd lose visibility post-migration. Aborts only if Greg
-- hasn't reviewed; today this is informational.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
DECLARE warn_count int := 0;
BEGIN
  FOR r IN
    SELECT u.id AS user_id, u.name, u.role,
           count(*) FILTER (
             WHERE lp.advisor   = u.name
                OR lp.consultant = u.name
                OR lp.pm         = u.name
           ) AS matched,
           count(*) AS total_legacy
    FROM public.users u
    CROSS JOIN public.legacy_projects lp
    WHERE u.role = 'sales' AND u.active
    GROUP BY u.id, u.name, u.role
  LOOP
    IF r.matched = 0 AND r.total_legacy > 0 THEN
      RAISE NOTICE 'Phase 5d notice: sales user % (%) has 0 legacy_projects matches by name. Post-migration they will see 0 legacy rows.',
        r.user_id, r.name;
      warn_count := warn_count + 1;
    END IF;
  END LOOP;
  IF warn_count > 0 THEN
    RAISE NOTICE 'Phase 5d: % sales users have 0 legacy name matches. Migration continues — fix users.name typos in a follow-up if needed.', warn_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Pre-flight #2: snapshot row count assertion (mirrors 218 / 219 pattern).
-- ---------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public._rls_phase5_snapshot WHERE phase = '5d-cross-tenant';
  IF n < 75 OR n > 90 THEN
    RAISE EXCEPTION 'Phase 5d abort: expected 75-90 snapshotted policies (live count was 80 at draft time), got %. Pre-existing drift suspected; re-bucket before applying.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helper update: auth_can_see_project gains role-aware legacy gating.
-- For sales role: legacy_projects branch only matches if user's name appears
-- in advisor/consultant/pm. Other internal roles see all legacy. Platform
-- bypass unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_can_see_project(p_project_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.auth_is_platform_user()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = p_project_id
        AND p.org_id = ANY(public.auth_user_org_ids())
    )
    OR (
      public.auth_is_internal_writer()
      AND EXISTS (
        SELECT 1
        FROM public.legacy_projects lp
        WHERE lp.id = p_project_id
          AND (
            public.auth_user_role() <> 'sales'
            OR EXISTS (
              SELECT 1 FROM public.users u
              WHERE u.id = (SELECT auth.uid())
                AND (
                     lower(trim(lp.advisor))    = lower(trim(u.name))
                  OR lower(trim(lp.consultant)) = lower(trim(u.name))
                  OR lower(trim(lp.pm))         = lower(trim(u.name))
                )
            )
          )
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.customer_accounts ca
      WHERE ca.project_id = p_project_id
        AND ca.auth_user_id = (SELECT auth.uid())
        AND ca.status = 'active'
    );
$$;

-- Re-affirm grants. CREATE OR REPLACE preserves existing privileges, but
-- restating REVOKE PUBLIC + GRANT authenticated keeps the migration self-
-- documenting and satisfies the Atlas Migration Guard static check.
REVOKE EXECUTE ON FUNCTION public.auth_can_see_project(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_can_see_project(text) TO authenticated;

-- ===========================================================================
-- C1 — Cross-tenant reference data (MG-org read; admin/platform write)
-- ===========================================================================

-- ahjs
DROP POLICY IF EXISTS ahjs_read   ON public.ahjs;
CREATE POLICY ahjs_read ON public.ahjs
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS ahjs_insert ON public.ahjs;
CREATE POLICY ahjs_insert ON public.ahjs
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS ahjs_update ON public.ahjs;
CREATE POLICY ahjs_update ON public.ahjs
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- ahj_messages (FK to ahjs — same scope as ahjs)
DROP POLICY IF EXISTS ahj_messages_read   ON public.ahj_messages;
CREATE POLICY ahj_messages_read ON public.ahj_messages
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS ahj_messages_insert ON public.ahj_messages;
CREATE POLICY ahj_messages_insert ON public.ahj_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS ahj_messages_update ON public.ahj_messages;
CREATE POLICY ahj_messages_update ON public.ahj_messages
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- utilities
DROP POLICY IF EXISTS utilities_read   ON public.utilities;
CREATE POLICY utilities_read ON public.utilities
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS utilities_insert ON public.utilities;
CREATE POLICY utilities_insert ON public.utilities
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS utilities_update ON public.utilities;
CREATE POLICY utilities_update ON public.utilities
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- utility_messages (FK to utilities)
DROP POLICY IF EXISTS utility_messages_read   ON public.utility_messages;
CREATE POLICY utility_messages_read ON public.utility_messages
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS utility_messages_insert ON public.utility_messages;
CREATE POLICY utility_messages_insert ON public.utility_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS utility_messages_update ON public.utility_messages;
CREATE POLICY utility_messages_update ON public.utility_messages
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- financiers
DROP POLICY IF EXISTS fin_read  ON public.financiers;
CREATE POLICY fin_read ON public.financiers
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS fin_write ON public.financiers;
CREATE POLICY fin_write ON public.financiers
  FOR ALL TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- hoas
DROP POLICY IF EXISTS hoas_read  ON public.hoas;
CREATE POLICY hoas_read ON public.hoas
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

DROP POLICY IF EXISTS hoas_write ON public.hoas;
CREATE POLICY hoas_write ON public.hoas
  FOR ALL TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- nonfunded_codes
DROP POLICY IF EXISTS nf_codes_read ON public.nonfunded_codes;
CREATE POLICY nf_codes_read ON public.nonfunded_codes
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- sla_thresholds
DROP POLICY IF EXISTS sla_read ON public.sla_thresholds;
CREATE POLICY sla_read ON public.sla_thresholds
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- commission_tiers
DROP POLICY IF EXISTS comm_tiers_select ON public.commission_tiers;
CREATE POLICY comm_tiers_select ON public.commission_tiers
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- equipment
DROP POLICY IF EXISTS equipment_select ON public.equipment;
CREATE POLICY equipment_select ON public.equipment
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- feature_flags
DROP POLICY IF EXISTS ff_select ON public.feature_flags;
CREATE POLICY ff_select ON public.feature_flags
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- engineering_config
DROP POLICY IF EXISTS eng_config_select ON public.engineering_config;
CREATE POLICY eng_config_select ON public.engineering_config
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- invoice_rules
DROP POLICY IF EXISTS inv_rules_select ON public.invoice_rules;
CREATE POLICY inv_rules_select ON public.invoice_rules
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- ramp_config
DROP POLICY IF EXISTS ramp_config_select ON public.ramp_config;
CREATE POLICY ramp_config_select ON public.ramp_config
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- permission_matrix
DROP POLICY IF EXISTS perm_matrix_select ON public.permission_matrix;
CREATE POLICY perm_matrix_select ON public.permission_matrix
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- custom_field_definitions
DROP POLICY IF EXISTS cfd_select ON public.custom_field_definitions;
CREATE POLICY cfd_select ON public.custom_field_definitions
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- project_cost_line_item_templates
DROP POLICY IF EXISTS pcli_templates_select ON public.project_cost_line_item_templates;
CREATE POLICY pcli_templates_select ON public.project_cost_line_item_templates
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND ('a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- ===========================================================================
-- C2 — FK indirection (uses helpers from migration 217)
-- ===========================================================================

-- po_line_items (FK po_id → purchase_orders.project_id)
DROP POLICY IF EXISTS poli_select ON public.po_line_items;
CREATE POLICY poli_select ON public.po_line_items
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_purchase_order(po_id));

DROP POLICY IF EXISTS poli_insert ON public.po_line_items;
CREATE POLICY poli_insert ON public.po_line_items
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_purchase_order(po_id));

DROP POLICY IF EXISTS poli_update ON public.po_line_items;
CREATE POLICY poli_update ON public.po_line_items
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_purchase_order(po_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_purchase_order(po_id));

DROP POLICY IF EXISTS poli_delete ON public.po_line_items;
CREATE POLICY poli_delete ON public.po_line_items
  FOR DELETE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_purchase_order(po_id));

-- wo_checklist_items (FK work_order_id → work_orders.project_id)
DROP POLICY IF EXISTS woci_insert ON public.wo_checklist_items;
CREATE POLICY woci_insert ON public.wo_checklist_items
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_work_order(work_order_id));

DROP POLICY IF EXISTS woci_update ON public.wo_checklist_items;
CREATE POLICY woci_update ON public.wo_checklist_items
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_work_order(work_order_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_work_order(work_order_id));

DROP POLICY IF EXISTS woci_delete ON public.wo_checklist_items;
CREATE POLICY woci_delete ON public.wo_checklist_items
  FOR DELETE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_work_order(work_order_id));

-- jsa_acknowledgements (FK jsa_id → jsa.project_id)
DROP POLICY IF EXISTS "Authenticated users can manage JSA acknowledgements" ON public.jsa_acknowledgements;
CREATE POLICY "Authenticated users can manage JSA acknowledgements" ON public.jsa_acknowledgements
  FOR ALL TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_jsa(jsa_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_jsa(jsa_id));

-- jsa_activities (FK jsa_id → jsa.project_id)
DROP POLICY IF EXISTS "Authenticated users can manage JSA activities" ON public.jsa_activities;
CREATE POLICY "Authenticated users can manage JSA activities" ON public.jsa_activities
  FOR ALL TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_jsa(jsa_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_jsa(jsa_id));

-- ticket_comments (FK ticket_id → tickets.project_id)
DROP POLICY IF EXISTS ticket_comments_select ON public.ticket_comments;
CREATE POLICY ticket_comments_select ON public.ticket_comments
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_ticket(ticket_id));

DROP POLICY IF EXISTS ticket_comments_insert ON public.ticket_comments;
CREATE POLICY ticket_comments_insert ON public.ticket_comments
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_ticket(ticket_id));

-- ticket_history (FK ticket_id → tickets.project_id)
DROP POLICY IF EXISTS ticket_history_select ON public.ticket_history;
CREATE POLICY ticket_history_select ON public.ticket_history
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_ticket(ticket_id));

DROP POLICY IF EXISTS ticket_history_insert ON public.ticket_history;
CREATE POLICY ticket_history_insert ON public.ticket_history
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_ticket(ticket_id));

-- material_request_items (FK request_id → material_requests.project_id)
DROP POLICY IF EXISTS "Auth users manage MRF items" ON public.material_request_items;
CREATE POLICY "Auth users manage MRF items" ON public.material_request_items
  FOR ALL TO authenticated
  USING (
    auth_is_internal_writer()
    AND EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id = material_request_items.request_id
        AND auth_can_see_project(mr.project_id)
    )
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id = material_request_items.request_id
        AND auth_can_see_project(mr.project_id)
    )
  );

-- vendor_onboarding_docs (FK vendor_id → vendors.org_id)
DROP POLICY IF EXISTS "Authenticated users can manage vendor docs" ON public.vendor_onboarding_docs;
CREATE POLICY "Authenticated users can manage vendor docs" ON public.vendor_onboarding_docs
  FOR ALL TO authenticated
  USING (
    auth_is_internal_writer()
    AND EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_onboarding_docs.vendor_id
        AND (v.org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
    )
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_onboarding_docs.vendor_id
        AND (v.org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
    )
  );

-- rep_notes (FK rep_id → sales_reps; sales_reps has org-scoped RLS)
DROP POLICY IF EXISTS rep_notes_select ON public.rep_notes;
CREATE POLICY rep_notes_select ON public.rep_notes
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = rep_notes.rep_id)
  );

-- ===========================================================================
-- C3 — Self-scoped (auth.uid match)
-- ===========================================================================

-- email_onboarding (user_id is uuid)
DROP POLICY IF EXISTS eo_insert ON public.email_onboarding;
CREATE POLICY eo_insert ON public.email_onboarding
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_admin()
    OR auth_is_platform_user()
    OR (auth_is_internal_writer() AND user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS eo_select ON public.email_onboarding;
CREATE POLICY eo_select ON public.email_onboarding
  FOR SELECT TO authenticated
  USING (
    auth_is_admin()
    OR auth_is_platform_user()
    OR (auth_is_internal_writer() AND user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS eo_update ON public.email_onboarding;
CREATE POLICY eo_update ON public.email_onboarding
  FOR UPDATE TO authenticated
  USING (
    auth_is_admin()
    OR auth_is_platform_user()
    OR (auth_is_internal_writer() AND user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    auth_is_admin()
    OR auth_is_platform_user()
    OR (auth_is_internal_writer() AND user_id = (SELECT auth.uid()))
  );

-- user_sessions (user_id is text — cast auth.uid to text)
DROP POLICY IF EXISTS "Authenticated can insert sessions" ON public.user_sessions;
CREATE POLICY "Authenticated can insert sessions" ON public.user_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "Authenticated can read sessions" ON public.user_sessions;
CREATE POLICY "Authenticated can read sessions" ON public.user_sessions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())::text OR auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS "Authenticated can update sessions" ON public.user_sessions;
CREATE POLICY "Authenticated can update sessions" ON public.user_sessions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

-- ===========================================================================
-- C4 — Internal admin / platform only (stop-gap until Phase 5b adds proper scope)
-- ===========================================================================

-- atlas_metric_snapshots (already service-role; preserve)
DROP POLICY IF EXISTS service_role_all ON public.atlas_metric_snapshots;
CREATE POLICY service_role_all ON public.atlas_metric_snapshots
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- vehicles (no scope column — stop-gap)
DROP POLICY IF EXISTS veh_select ON public.vehicles;
CREATE POLICY veh_select ON public.vehicles
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS veh_insert ON public.vehicles;
CREATE POLICY veh_insert ON public.vehicles
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS veh_update ON public.vehicles;
CREATE POLICY veh_update ON public.vehicles
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- vehicle_maintenance (no scope column — stop-gap)
DROP POLICY IF EXISTS vm_select ON public.vehicle_maintenance;
CREATE POLICY vm_select ON public.vehicle_maintenance
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS vm_insert ON public.vehicle_maintenance;
CREATE POLICY vm_insert ON public.vehicle_maintenance
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS vm_update ON public.vehicle_maintenance;
CREATE POLICY vm_update ON public.vehicle_maintenance
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- qa_runs (test infra — stop-gap)
DROP POLICY IF EXISTS qa_runs_read   ON public.qa_runs;
CREATE POLICY qa_runs_read ON public.qa_runs
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS qa_runs_insert ON public.qa_runs;
CREATE POLICY qa_runs_insert ON public.qa_runs
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS qa_runs_update ON public.qa_runs;
CREATE POLICY qa_runs_update ON public.qa_runs
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- qa_run_events
DROP POLICY IF EXISTS qa_run_events_read   ON public.qa_run_events;
CREATE POLICY qa_run_events_read ON public.qa_run_events
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS qa_run_events_insert ON public.qa_run_events;
CREATE POLICY qa_run_events_insert ON public.qa_run_events
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- test_cases
DROP POLICY IF EXISTS test_cases_read ON public.test_cases;
CREATE POLICY test_cases_read ON public.test_cases
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

-- test_plans
DROP POLICY IF EXISTS test_plans_read ON public.test_plans;
CREATE POLICY test_plans_read ON public.test_plans
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

-- test_assignments
DROP POLICY IF EXISTS test_assignments_read ON public.test_assignments;
CREATE POLICY test_assignments_read ON public.test_assignments
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

-- test_results
DROP POLICY IF EXISTS test_results_read   ON public.test_results;
CREATE POLICY test_results_read ON public.test_results
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS test_results_insert ON public.test_results;
CREATE POLICY test_results_insert ON public.test_results
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS test_results_update ON public.test_results;
CREATE POLICY test_results_update ON public.test_results
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- test_comments
DROP POLICY IF EXISTS test_comments_read   ON public.test_comments;
CREATE POLICY test_comments_read ON public.test_comments
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS test_comments_insert ON public.test_comments;
CREATE POLICY test_comments_insert ON public.test_comments
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- calendar_settings (per-crew, no per-user scope — admin only)
DROP POLICY IF EXISTS cset_select ON public.calendar_settings;
CREATE POLICY cset_select ON public.calendar_settings
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

-- calendar_sync (auto-sync infrastructure — admin/platform only)
DROP POLICY IF EXISTS cs_select ON public.calendar_sync;
CREATE POLICY cs_select ON public.calendar_sync
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS cs_insert ON public.calendar_sync;
CREATE POLICY cs_insert ON public.calendar_sync
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS cs_update ON public.calendar_sync;
CREATE POLICY cs_update ON public.calendar_sync
  FOR UPDATE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user())
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

DROP POLICY IF EXISTS cs_delete ON public.calendar_sync;
CREATE POLICY cs_delete ON public.calendar_sync
  FOR DELETE TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

-- saved_queries (admin tools — no clear ownership scope on text created_by)
DROP POLICY IF EXISTS sq_insert ON public.saved_queries;
CREATE POLICY sq_insert ON public.saved_queries
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- feedback (insert: any authenticated; select: admin/platform)
DROP POLICY IF EXISTS "Authenticated users can insert feedback" ON public.feedback;
CREATE POLICY "Authenticated users can insert feedback" ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read feedback" ON public.feedback;
CREATE POLICY "Authenticated users can read feedback" ON public.feedback
  FOR SELECT TO authenticated
  USING (auth_is_admin() OR auth_is_platform_user());

-- ===========================================================================
-- C5 — Sensitive surfaces
-- ===========================================================================

-- users.users_read — share-an-org scope via org_memberships self-join
DROP POLICY IF EXISTS users_read ON public.users;
CREATE POLICY users_read ON public.users
  FOR SELECT TO authenticated
  USING (
    auth_is_platform_user()
    OR users.id = (SELECT auth.uid())  -- always allow self-read
    OR EXISTS (
      SELECT 1
      FROM public.org_memberships me
      JOIN public.org_memberships them ON them.org_id = me.org_id
      WHERE me.user_id = (SELECT auth.uid())
        AND them.user_id = users.id
    )
  );

-- legacy_projects.legacy_select — all internal MG users; sales reps name-match only
DROP POLICY IF EXISTS legacy_select ON public.legacy_projects;
CREATE POLICY legacy_select ON public.legacy_projects
  FOR SELECT TO authenticated
  USING (
    auth_is_platform_user()
    OR (
      auth_is_internal_writer()
      AND 'a0000000-0000-0000-0000-000000000001'::uuid = ANY(auth_user_org_ids())  -- MG-org member
      AND (
        auth_user_role() <> 'sales'
        OR EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = (SELECT auth.uid())
            AND (
                 lower(trim(legacy_projects.advisor))    = lower(trim(u.name))
              OR lower(trim(legacy_projects.consultant)) = lower(trim(u.name))
              OR lower(trim(legacy_projects.pm))         = lower(trim(u.name))
            )
        )
      )
    )
  );

-- legacy_projects.legacy_insert — admin/platform only
DROP POLICY IF EXISTS legacy_insert ON public.legacy_projects;
CREATE POLICY legacy_insert ON public.legacy_projects
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_admin() OR auth_is_platform_user());

-- note_mentions.note_mentions_insert — bind mentioned_by to caller
DROP POLICY IF EXISTS note_mentions_insert ON public.note_mentions;
CREATE POLICY note_mentions_insert ON public.note_mentions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_internal_writer()
    AND mentioned_by = (SELECT auth.uid())
  );

-- bread_of_life_feedback — wrong project; lock to platform (Greg) only.
-- Cleanup tracked as greg_action #463 (migrate row to Bloom + DROP TABLE).
DROP POLICY IF EXISTS authenticated_select ON public.bread_of_life_feedback;
CREATE POLICY authenticated_select ON public.bread_of_life_feedback
  FOR SELECT TO authenticated
  USING (auth_is_platform_user());

-- ---------------------------------------------------------------------------
-- Post-flight: confirm no policy in scope still references auth_is_internal_writer
-- without an additional scope conjunction. (Reference reads keep auth_is_internal_writer
-- but compound it with the MG-org check; that's fine — they all gain scope.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE leftover int;
BEGIN
  SELECT count(*) INTO leftover
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (qual LIKE '%auth_is_internal_writer%' OR with_check LIKE '%auth_is_internal_writer%')
    AND NOT (
      COALESCE(qual,'')       LIKE '%auth_user_org_ids%'
      OR COALESCE(with_check,'') LIKE '%auth_user_org_ids%'
      OR COALESCE(qual,'')       LIKE '%auth_can_see_project%'
      OR COALESCE(with_check,'') LIKE '%auth_can_see_project%'
      OR COALESCE(qual,'')       LIKE '%auth_can_see_purchase_order%'
      OR COALESCE(with_check,'') LIKE '%auth_can_see_purchase_order%'
      OR COALESCE(qual,'')       LIKE '%auth_can_see_work_order%'
      OR COALESCE(with_check,'') LIKE '%auth_can_see_work_order%'
      OR COALESCE(qual,'')       LIKE '%auth_can_see_jsa%'
      OR COALESCE(with_check,'') LIKE '%auth_can_see_jsa%'
      OR COALESCE(qual,'')       LIKE '%auth_can_see_ticket%'
      OR COALESCE(with_check,'') LIKE '%auth_can_see_ticket%'
      OR COALESCE(qual,'')       LIKE '%auth_user_role%'    -- legacy_projects sales scope
      OR COALESCE(qual,'')       LIKE '%mentioned_by%'      -- note_mentions self-binding
      OR COALESCE(qual,'')       LIKE '%legacy_projects%'   -- *_legacy_internal kept as-is
      OR COALESCE(with_check,'') LIKE '%mentioned_by%'      -- mention_notifications email check (preserved)
      OR COALESCE(qual,'')       LIKE '%sales_reps%'        -- rep_notes_select scope through FK
      OR COALESCE(qual,'')       LIKE '%auth.uid%'          -- self-binding (email_onboarding, user_sessions)
      OR COALESCE(with_check,'') LIKE '%auth.uid%'          -- self-binding (with_check side)
    );
  IF leftover > 0 THEN
    RAISE EXCEPTION 'Phase 5d post-flight: % policies still rely solely on auth_is_internal_writer() without scope. Review pg_policies and patch.', leftover;
  END IF;
END $$;

COMMIT;
