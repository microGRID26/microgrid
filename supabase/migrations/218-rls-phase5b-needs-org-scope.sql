-- Phase 5b of the 7-phase multi-tenant RLS hardening plan.
-- Rewrites 28 RLS policies across 21 tables that have an `org_id` column to
-- conjoin org-scope onto the existing `auth_is_internal_writer()` predicate.
--
-- Plan:   docs/plans/2026-04-28-multi-tenant-rls-hardening-plan.md
-- Design: docs/plans/2026-05-02-rls-phase5-policy-bucket.md (Bucket A)
--
-- The new policy shape on every USING clause:
--   auth_is_internal_writer()
--   AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
-- Same conjunction on every WITH CHECK clause.
--
-- Pre-mutation snapshot of every replaced policy goes into
-- public._rls_phase5_snapshot so rollback is INSERT-from-snapshot.

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Snapshot table (created once; reused by 218 / 219 / 220).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._rls_phase5_snapshot (
  snapshotted_at timestamptz NOT NULL DEFAULT now(),
  phase          text         NOT NULL,
  schemaname     text         NOT NULL,
  tablename      text         NOT NULL,
  policyname     text         NOT NULL,
  cmd            text,
  permissive     text,
  roles          text[],
  qual           text,
  with_check     text
);

ALTER TABLE public._rls_phase5_snapshot ENABLE ROW LEVEL SECURITY;
-- No policy = nobody can SELECT it through PostgREST. Service role + admin
-- console bypass RLS, which is exactly what we want for a rollback artifact.

INSERT INTO public._rls_phase5_snapshot
  (phase, schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check)
SELECT
  '5b-needs-org-scope', schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename, policyname) IN (
    ('commission_config',         'cc_select'),
    ('commission_geo_modifiers',  'comm_geo_select'),
    ('commission_hierarchy',      'comm_hier_select'),
    ('commission_rates',          'comm_rates_select'),
    ('crew_rates',                'crew_rates_read'),
    ('document_requirements',     'doc_requirements_delete'),
    ('document_requirements',     'doc_requirements_insert'),
    ('document_requirements',     'doc_requirements_update'),
    ('job_cost_labor',            'job_cost_labor_read'),
    ('job_cost_materials',        'job_cost_materials_read'),
    ('job_cost_overhead',         'job_cost_overhead_read'),
    ('notification_rules',        'rules_read'),
    ('notification_rules',        'rules_write'),
    ('onboarding_requirements',   'or_select'),
    ('pay_distribution',          'pd_select'),
    ('pay_scales',                'ps_select'),
    ('queue_sections',            'qs_read'),
    ('queue_sections',            'qs_write'),
    ('schedule',                  'schedule_select'),
    ('task_reasons',              'reasons_read'),
    ('task_reasons',              'reasons_write'),
    ('ticket_categories',         'ticket_categories_select'),
    ('ticket_resolution_codes',   'ticket_resolution_codes_select'),
    ('tickets',                   'tickets_insert'),
    ('tickets',                   'tickets_update'),
    ('vendors',                   'Authenticated users can manage vendors'),
    ('warehouse_stock',           'warehouse_stock_insert'),
    ('warehouse_stock',           'warehouse_stock_update')
  );

-- Defensive: confirm we snapshotted exactly 28 policies.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public._rls_phase5_snapshot WHERE phase = '5b-needs-org-scope';
  IF n <> 28 THEN
    RAISE EXCEPTION 'Phase 5b abort: expected 28 snapshotted policies, got %. Pre-existing drift suspected.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- DROP and re-CREATE every Bucket A policy with org-scope conjunction.
-- ---------------------------------------------------------------------------

-- commission_config
DROP POLICY IF EXISTS cc_select ON public.commission_config;
CREATE POLICY cc_select ON public.commission_config
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- commission_geo_modifiers
DROP POLICY IF EXISTS comm_geo_select ON public.commission_geo_modifiers;
CREATE POLICY comm_geo_select ON public.commission_geo_modifiers
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- commission_hierarchy
DROP POLICY IF EXISTS comm_hier_select ON public.commission_hierarchy;
CREATE POLICY comm_hier_select ON public.commission_hierarchy
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- commission_rates
DROP POLICY IF EXISTS comm_rates_select ON public.commission_rates;
CREATE POLICY comm_rates_select ON public.commission_rates
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- crew_rates
DROP POLICY IF EXISTS crew_rates_read ON public.crew_rates;
CREATE POLICY crew_rates_read ON public.crew_rates
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- document_requirements (DELETE)
DROP POLICY IF EXISTS doc_requirements_delete ON public.document_requirements;
CREATE POLICY doc_requirements_delete ON public.document_requirements
  FOR DELETE TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- document_requirements (INSERT)
DROP POLICY IF EXISTS doc_requirements_insert ON public.document_requirements;
CREATE POLICY doc_requirements_insert ON public.document_requirements
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- document_requirements (UPDATE)
DROP POLICY IF EXISTS doc_requirements_update ON public.document_requirements;
CREATE POLICY doc_requirements_update ON public.document_requirements
  FOR UPDATE TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- job_cost_labor
DROP POLICY IF EXISTS job_cost_labor_read ON public.job_cost_labor;
CREATE POLICY job_cost_labor_read ON public.job_cost_labor
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- job_cost_materials
DROP POLICY IF EXISTS job_cost_materials_read ON public.job_cost_materials;
CREATE POLICY job_cost_materials_read ON public.job_cost_materials
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- job_cost_overhead
DROP POLICY IF EXISTS job_cost_overhead_read ON public.job_cost_overhead;
CREATE POLICY job_cost_overhead_read ON public.job_cost_overhead
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- notification_rules (read)
DROP POLICY IF EXISTS rules_read ON public.notification_rules;
CREATE POLICY rules_read ON public.notification_rules
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- notification_rules (write — ALL = qual + with_check)
DROP POLICY IF EXISTS rules_write ON public.notification_rules;
CREATE POLICY rules_write ON public.notification_rules
  FOR ALL TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- onboarding_requirements
DROP POLICY IF EXISTS or_select ON public.onboarding_requirements;
CREATE POLICY or_select ON public.onboarding_requirements
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- pay_distribution
DROP POLICY IF EXISTS pd_select ON public.pay_distribution;
CREATE POLICY pd_select ON public.pay_distribution
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- pay_scales
DROP POLICY IF EXISTS ps_select ON public.pay_scales;
CREATE POLICY ps_select ON public.pay_scales
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- queue_sections (read)
DROP POLICY IF EXISTS qs_read ON public.queue_sections;
CREATE POLICY qs_read ON public.queue_sections
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- queue_sections (write)
DROP POLICY IF EXISTS qs_write ON public.queue_sections;
CREATE POLICY qs_write ON public.queue_sections
  FOR ALL TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- schedule
DROP POLICY IF EXISTS schedule_select ON public.schedule;
CREATE POLICY schedule_select ON public.schedule
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- task_reasons (read)
DROP POLICY IF EXISTS reasons_read ON public.task_reasons;
CREATE POLICY reasons_read ON public.task_reasons
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- task_reasons (write)
DROP POLICY IF EXISTS reasons_write ON public.task_reasons;
CREATE POLICY reasons_write ON public.task_reasons
  FOR ALL TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- ticket_categories
DROP POLICY IF EXISTS ticket_categories_select ON public.ticket_categories;
CREATE POLICY ticket_categories_select ON public.ticket_categories
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- ticket_resolution_codes
DROP POLICY IF EXISTS ticket_resolution_codes_select ON public.ticket_resolution_codes;
CREATE POLICY ticket_resolution_codes_select ON public.ticket_resolution_codes
  FOR SELECT TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- tickets (insert)
DROP POLICY IF EXISTS tickets_insert ON public.tickets;
CREATE POLICY tickets_insert ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- tickets (update)
DROP POLICY IF EXISTS tickets_update ON public.tickets;
CREATE POLICY tickets_update ON public.tickets
  FOR UPDATE TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- vendors
DROP POLICY IF EXISTS "Authenticated users can manage vendors" ON public.vendors;
CREATE POLICY "Authenticated users can manage vendors" ON public.vendors
  FOR ALL TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- warehouse_stock (insert)
DROP POLICY IF EXISTS warehouse_stock_insert ON public.warehouse_stock;
CREATE POLICY warehouse_stock_insert ON public.warehouse_stock
  FOR INSERT TO authenticated
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- warehouse_stock (update)
DROP POLICY IF EXISTS warehouse_stock_update ON public.warehouse_stock;
CREATE POLICY warehouse_stock_update ON public.warehouse_stock
  FOR UPDATE TO authenticated
  USING (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  )
  WITH CHECK (
    auth_is_internal_writer()
    AND (org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user())
  );

-- ---------------------------------------------------------------------------
-- Post-flight: confirm every Bucket A policy now references auth_user_org_ids
-- ---------------------------------------------------------------------------
DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND (p.tablename, p.policyname) IN (
      ('commission_config',         'cc_select'),
      ('commission_geo_modifiers',  'comm_geo_select'),
      ('commission_hierarchy',      'comm_hier_select'),
      ('commission_rates',          'comm_rates_select'),
      ('crew_rates',                'crew_rates_read'),
      ('document_requirements',     'doc_requirements_delete'),
      ('document_requirements',     'doc_requirements_insert'),
      ('document_requirements',     'doc_requirements_update'),
      ('job_cost_labor',            'job_cost_labor_read'),
      ('job_cost_materials',        'job_cost_materials_read'),
      ('job_cost_overhead',         'job_cost_overhead_read'),
      ('notification_rules',        'rules_read'),
      ('notification_rules',        'rules_write'),
      ('onboarding_requirements',   'or_select'),
      ('pay_distribution',          'pd_select'),
      ('pay_scales',                'ps_select'),
      ('queue_sections',            'qs_read'),
      ('queue_sections',            'qs_write'),
      ('schedule',                  'schedule_select'),
      ('task_reasons',              'reasons_read'),
      ('task_reasons',              'reasons_write'),
      ('ticket_categories',         'ticket_categories_select'),
      ('ticket_resolution_codes',   'ticket_resolution_codes_select'),
      ('tickets',                   'tickets_insert'),
      ('tickets',                   'tickets_update'),
      ('vendors',                   'Authenticated users can manage vendors'),
      ('warehouse_stock',           'warehouse_stock_insert'),
      ('warehouse_stock',           'warehouse_stock_update')
    )
    AND NOT (
         COALESCE(p.qual,'')       LIKE '%auth_user_org_ids%'
      OR COALESCE(p.with_check,'') LIKE '%auth_user_org_ids%'
    );
  IF missing > 0 THEN
    RAISE EXCEPTION 'Phase 5b abort: % of 28 policies missing auth_user_org_ids() conjunction post-rewrite.', missing;
  END IF;
END $$;

COMMIT;
