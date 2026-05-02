-- Phase 5c of the 7-phase multi-tenant RLS hardening plan.
-- Adds project-scope conjunction (`auth_can_see_project(project_id)`) to 45
-- internal-writer policies on 22 tables that have project_id but no org_id.
--
-- Plan:   docs/plans/2026-04-28-multi-tenant-rls-hardening-plan.md
-- Design: docs/plans/2026-05-02-rls-phase5-policy-bucket.md (Bucket B)
--
-- Standard rewrite shape:
--   USING / WITH CHECK : auth_is_internal_writer() AND auth_can_see_project(project_id)
--
-- Special cases NOT modified by this migration (covered elsewhere or already gated):
--   * notes.notes_select_legacy_internal
--   * project_folders.project_folders_select_legacy_internal
--   * stage_history.stage_history_select_legacy_internal
-- These already have an EXISTS-legacy_projects gate; they inherit name-match
-- scope via legacy_projects' own RLS once migration 220 rewrites it.
--
-- Special case PRESERVED:
--   * mention_notifications.mentions_insert keeps its email-binding check
--     (`lower(mentioned_by) = lower(auth.email())`) and adds project-scope.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Supporting indexes for the new auth_can_see_project EXISTS predicates.
-- These are normally Phase 7's job but ship here so 219's policies don't
-- regress SELECT performance on the 288k-row legacy_notes table the moment
-- they apply. Non-CONCURRENT build is acceptable inside the txn — largest
-- target (legacy_notes 73 MB) builds in seconds and is only exclusively
-- locked during the build itself.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_legacy_notes_project_id    ON public.legacy_notes    (project_id);
CREATE INDEX IF NOT EXISTS idx_notes_project_id           ON public.notes           (project_id);
CREATE INDEX IF NOT EXISTS idx_project_folders_project_id ON public.project_folders (project_id);
CREATE INDEX IF NOT EXISTS idx_task_state_project_id      ON public.task_state      (project_id);
CREATE INDEX IF NOT EXISTS idx_stage_history_project_id   ON public.stage_history   (project_id);
CREATE INDEX IF NOT EXISTS idx_welcome_call_logs_project_id ON public.welcome_call_logs (project_id);

-- ---------------------------------------------------------------------------
-- Snapshot every replaced policy into _rls_phase5_snapshot for rollback.
-- (Table created in migration 218.)
-- ---------------------------------------------------------------------------
INSERT INTO public._rls_phase5_snapshot
  (phase, schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check)
SELECT
  '5c-needs-project-scope', schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename, policyname) IN (
    ('audit_log',             'audit_write'),
    ('change_orders',         'Authenticated users can insert change_orders'),
    ('change_orders',         'Authenticated users can read change_orders'),
    ('change_orders',         'Authenticated users can update change_orders'),
    ('custom_field_values',   'cfv_insert'),
    ('custom_field_values',   'cfv_select'),
    ('custom_field_values',   'cfv_update'),
    ('edge_sync_log',         'edge_sync_insert'),
    ('equipment_warranties',  'ew_delete'),
    ('equipment_warranties',  'ew_insert'),
    ('equipment_warranties',  'ew_update'),
    ('funding_nf_changes',    'funding_nf_changes_insert'),
    ('funding_nf_changes',    'funding_nf_changes_update'),
    ('jsa',                   'Authenticated users can manage JSAs'),
    ('legacy_notes',          'legacy_notes_insert'),
    ('legacy_notes',          'legacy_notes_select'),
    ('material_requests',     'Auth users manage MRFs'),
    ('mention_notifications', 'mentions_insert'),
    ('project_adders',        'adders_write'),
    ('project_documents',     'project_documents_insert'),
    ('project_documents',     'project_documents_update'),
    ('project_folders',       'anon_read_project_folders'),
    ('project_materials',     'project_materials_delete'),
    ('project_materials',     'project_materials_insert'),
    ('project_materials',     'project_materials_update'),
    ('project_readiness',     'readiness_insert'),
    ('project_readiness',     'readiness_select'),
    ('project_readiness',     'readiness_update'),
    ('purchase_orders',       'po_insert'),
    ('purchase_orders',       'po_update'),
    ('ramp_schedule',         'ramp_insert'),
    ('ramp_schedule',         'ramp_select'),
    ('ramp_schedule',         'ramp_update'),
    ('task_history',          'task_history_write'),
    ('task_state',            'task_state_write'),
    ('time_entries',          'te_insert'),
    ('time_entries',          'te_select'),
    ('time_entries',          'te_update'),
    ('warranty_claims',       'wc_delete'),
    ('warranty_claims',       'wc_insert'),
    ('warranty_claims',       'wc_update'),
    ('welcome_call_logs',     'wcl_insert'),
    ('welcome_call_logs',     'wcl_read'),
    ('work_orders',           'wo_insert'),
    ('work_orders',           'wo_update')
  );

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public._rls_phase5_snapshot WHERE phase = '5c-needs-project-scope';
  IF n <> 45 THEN
    RAISE EXCEPTION 'Phase 5c abort: expected 45 snapshotted policies, got %.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- audit_log (INSERT-only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_write ON public.audit_log;
CREATE POLICY audit_write ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- change_orders
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can insert change_orders" ON public.change_orders;
CREATE POLICY "Authenticated users can insert change_orders" ON public.change_orders
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS "Authenticated users can read change_orders" ON public.change_orders;
CREATE POLICY "Authenticated users can read change_orders" ON public.change_orders
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS "Authenticated users can update change_orders" ON public.change_orders;
CREATE POLICY "Authenticated users can update change_orders" ON public.change_orders
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- custom_field_values
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS cfv_insert ON public.custom_field_values;
CREATE POLICY cfv_insert ON public.custom_field_values
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS cfv_select ON public.custom_field_values;
CREATE POLICY cfv_select ON public.custom_field_values
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS cfv_update ON public.custom_field_values;
CREATE POLICY cfv_update ON public.custom_field_values
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- edge_sync_log (INSERT-only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS edge_sync_insert ON public.edge_sync_log;
CREATE POLICY edge_sync_insert ON public.edge_sync_log
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- equipment_warranties
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ew_delete ON public.equipment_warranties;
CREATE POLICY ew_delete ON public.equipment_warranties
  FOR DELETE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS ew_insert ON public.equipment_warranties;
CREATE POLICY ew_insert ON public.equipment_warranties
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS ew_update ON public.equipment_warranties;
CREATE POLICY ew_update ON public.equipment_warranties
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- funding_nf_changes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS funding_nf_changes_insert ON public.funding_nf_changes;
CREATE POLICY funding_nf_changes_insert ON public.funding_nf_changes
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS funding_nf_changes_update ON public.funding_nf_changes;
CREATE POLICY funding_nf_changes_update ON public.funding_nf_changes
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- jsa (ALL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can manage JSAs" ON public.jsa;
CREATE POLICY "Authenticated users can manage JSAs" ON public.jsa
  FOR ALL TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- legacy_notes (the #352 leak — 288k rows)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS legacy_notes_insert ON public.legacy_notes;
CREATE POLICY legacy_notes_insert ON public.legacy_notes
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS legacy_notes_select ON public.legacy_notes;
CREATE POLICY legacy_notes_select ON public.legacy_notes
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- material_requests (ALL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Auth users manage MRFs" ON public.material_requests;
CREATE POLICY "Auth users manage MRFs" ON public.material_requests
  FOR ALL TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- mention_notifications.mentions_insert — PRESERVE email-binding check
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS mentions_insert ON public.mention_notifications;
CREATE POLICY mentions_insert ON public.mention_notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_internal_writer()
    AND lower(mentioned_by) = lower(auth.email())
    AND auth_can_see_project(project_id)
  );

-- ---------------------------------------------------------------------------
-- project_adders (ALL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS adders_write ON public.project_adders;
CREATE POLICY adders_write ON public.project_adders
  FOR ALL TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- project_documents
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS project_documents_insert ON public.project_documents;
CREATE POLICY project_documents_insert ON public.project_documents
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS project_documents_update ON public.project_documents;
CREATE POLICY project_documents_update ON public.project_documents
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- project_folders.anon_read_project_folders (note: `roles=public` but qual
-- already gates via auth_is_internal_writer; effective for authenticated only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS anon_read_project_folders ON public.project_folders;
CREATE POLICY anon_read_project_folders ON public.project_folders
  FOR SELECT TO public
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- project_materials
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS project_materials_delete ON public.project_materials;
CREATE POLICY project_materials_delete ON public.project_materials
  FOR DELETE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS project_materials_insert ON public.project_materials;
CREATE POLICY project_materials_insert ON public.project_materials
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS project_materials_update ON public.project_materials;
CREATE POLICY project_materials_update ON public.project_materials
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- project_readiness
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS readiness_insert ON public.project_readiness;
CREATE POLICY readiness_insert ON public.project_readiness
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS readiness_select ON public.project_readiness;
CREATE POLICY readiness_select ON public.project_readiness
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS readiness_update ON public.project_readiness;
CREATE POLICY readiness_update ON public.project_readiness
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- purchase_orders
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS po_insert ON public.purchase_orders;
CREATE POLICY po_insert ON public.purchase_orders
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS po_update ON public.purchase_orders;
CREATE POLICY po_update ON public.purchase_orders
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- ramp_schedule
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ramp_insert ON public.ramp_schedule;
CREATE POLICY ramp_insert ON public.ramp_schedule
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS ramp_select ON public.ramp_schedule;
CREATE POLICY ramp_select ON public.ramp_schedule
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS ramp_update ON public.ramp_schedule;
CREATE POLICY ramp_update ON public.ramp_schedule
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- task_history (INSERT-only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS task_history_write ON public.task_history;
CREATE POLICY task_history_write ON public.task_history
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- task_state (ALL)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS task_state_write ON public.task_state;
CREATE POLICY task_state_write ON public.task_state
  FOR ALL TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- time_entries
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS te_insert ON public.time_entries;
CREATE POLICY te_insert ON public.time_entries
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS te_select ON public.time_entries;
CREATE POLICY te_select ON public.time_entries
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS te_update ON public.time_entries;
CREATE POLICY te_update ON public.time_entries
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- warranty_claims
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS wc_delete ON public.warranty_claims;
CREATE POLICY wc_delete ON public.warranty_claims
  FOR DELETE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS wc_insert ON public.warranty_claims;
CREATE POLICY wc_insert ON public.warranty_claims
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS wc_update ON public.warranty_claims;
CREATE POLICY wc_update ON public.warranty_claims
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- welcome_call_logs (the #352 leak — 3,107 rows of customer call recordings)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS wcl_insert ON public.welcome_call_logs;
CREATE POLICY wcl_insert ON public.welcome_call_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS wcl_read ON public.welcome_call_logs;
CREATE POLICY wcl_read ON public.welcome_call_logs
  FOR SELECT TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- work_orders
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS wo_insert ON public.work_orders;
CREATE POLICY wo_insert ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

DROP POLICY IF EXISTS wo_update ON public.work_orders;
CREATE POLICY wo_update ON public.work_orders
  FOR UPDATE TO authenticated
  USING (auth_is_internal_writer() AND auth_can_see_project(project_id))
  WITH CHECK (auth_is_internal_writer() AND auth_can_see_project(project_id));

-- ---------------------------------------------------------------------------
-- Post-flight: confirm every Bucket B policy now references auth_can_see_project
-- ---------------------------------------------------------------------------
DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND (p.tablename, p.policyname) IN (
      ('audit_log',             'audit_write'),
      ('change_orders',         'Authenticated users can insert change_orders'),
      ('change_orders',         'Authenticated users can read change_orders'),
      ('change_orders',         'Authenticated users can update change_orders'),
      ('custom_field_values',   'cfv_insert'),
      ('custom_field_values',   'cfv_select'),
      ('custom_field_values',   'cfv_update'),
      ('edge_sync_log',         'edge_sync_insert'),
      ('equipment_warranties',  'ew_delete'),
      ('equipment_warranties',  'ew_insert'),
      ('equipment_warranties',  'ew_update'),
      ('funding_nf_changes',    'funding_nf_changes_insert'),
      ('funding_nf_changes',    'funding_nf_changes_update'),
      ('jsa',                   'Authenticated users can manage JSAs'),
      ('legacy_notes',          'legacy_notes_insert'),
      ('legacy_notes',          'legacy_notes_select'),
      ('material_requests',     'Auth users manage MRFs'),
      ('mention_notifications', 'mentions_insert'),
      ('project_adders',        'adders_write'),
      ('project_documents',     'project_documents_insert'),
      ('project_documents',     'project_documents_update'),
      ('project_folders',       'anon_read_project_folders'),
      ('project_materials',     'project_materials_delete'),
      ('project_materials',     'project_materials_insert'),
      ('project_materials',     'project_materials_update'),
      ('project_readiness',     'readiness_insert'),
      ('project_readiness',     'readiness_select'),
      ('project_readiness',     'readiness_update'),
      ('purchase_orders',       'po_insert'),
      ('purchase_orders',       'po_update'),
      ('ramp_schedule',         'ramp_insert'),
      ('ramp_schedule',         'ramp_select'),
      ('ramp_schedule',         'ramp_update'),
      ('task_history',          'task_history_write'),
      ('task_state',            'task_state_write'),
      ('time_entries',          'te_insert'),
      ('time_entries',          'te_select'),
      ('time_entries',          'te_update'),
      ('warranty_claims',       'wc_delete'),
      ('warranty_claims',       'wc_insert'),
      ('warranty_claims',       'wc_update'),
      ('welcome_call_logs',     'wcl_insert'),
      ('welcome_call_logs',     'wcl_read'),
      ('work_orders',           'wo_insert'),
      ('work_orders',           'wo_update')
    )
    AND NOT (
         COALESCE(p.qual,'')       LIKE '%auth_can_see_project%'
      OR COALESCE(p.with_check,'') LIKE '%auth_can_see_project%'
    );
  IF missing > 0 THEN
    RAISE EXCEPTION 'Phase 5c abort: % of 45 policies missing auth_can_see_project() conjunction post-rewrite.', missing;
  END IF;
END $$;

COMMIT;
