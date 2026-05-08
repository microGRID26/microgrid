-- 243: PCS pull from EDGE-MODEL scenario — wire MG cost-basis raw_cost
-- to read live values from Paul's model scenario instead of the local
-- catalog defaults.
--
-- Architecture:
--   • Paul edits his model at model.energydevelopmentgroup.com (EDGE-MODEL).
--   • EDGE-MODEL persists scenarios into public.edge_model_scenarios.
--   • One scenario row is marked is_active_for_pull = true → that's the
--     canonical "live" PCS for MG cost-basis pulls.
--   • MG cost-basis loadActiveTemplates() overlays scenario.config values
--     onto template metadata at read time. Per-project line items already
--     persisted in project_cost_line_items keep their snapshot — chain
--     orchestration uses snapshots; cost-basis tab shows current.
--
-- This migration:
--   1. Adds pcs_key text on project_cost_line_item_templates → maps
--      template rows to scenario JSONB keys (e.g. "Battery Modules" →
--      "batteryModules"). NULL means template has no scenario-side
--      counterpart and uses default_raw_cost as-is.
--   2. Backfills pcs_key for the 28 currently-active templates from
--      Paul's source-of-truth (v43-0-custom-element.txt:2278-2329).
--   3. Adds is_active_for_pull boolean on edge_model_scenarios with a
--      partial unique index so at most one scenario is "active" at a time.
--
-- Both repos (MG + EDGE-MODEL) share this Supabase project. This migration
-- lives in MG/supabase/migrations because protocol-guard + audit pipeline
-- run from MG; EDGE-MODEL doesn't have its own migration cadence yet.

-- ── 1. project_cost_line_item_templates.pcs_key ────────────────────────

ALTER TABLE public.project_cost_line_item_templates
  ADD COLUMN IF NOT EXISTS pcs_key text;

COMMENT ON COLUMN public.project_cost_line_item_templates.pcs_key IS
  'Maps to a key in edge_model_scenarios.config (Paul''s model PCS state). '
  'NULL = no scenario counterpart, use default_* columns directly. '
  'Anchored to v43-0-custom-element.txt:2278-2329 (pcsUnitRates state object).';

-- Backfill the 28 active templates. Mapping derived from Paul's source.
UPDATE public.project_cost_line_item_templates SET pcs_key = 'batteryModules'      WHERE item_name = 'Battery Modules';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'hybridInverters'     WHERE item_name = 'Hybrid Inverters';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'pvModules'           WHERE item_name = 'PV Modules';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'pvMountingHardware'  WHERE item_name = 'PV Mounting Hardware';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'batteryMounting'     WHERE item_name = 'Battery Mounting / Brackets / ESS Mounting Hardware';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'gatewayControls'     WHERE item_name = 'Gateway / Controls Interface';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'batteryAccKtPcw'     WHERE item_name = 'Battery ACC KT PCW';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'moduleLevelRsd'      WHERE item_name = 'Module-Level Electronics RSD';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'monitoringComms'     WHERE item_name = 'Monitoring / Communications Hardware';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'deliveryFee'         WHERE item_name = 'Equipment Delivery Fee';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'servicePanel'        WHERE item_name = 'Service Panel / Meter-Main / Enclosures';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'conductorsWiring'    WHERE item_name = 'Conductors / Wiring';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'acDcDisconnects'     WHERE item_name = 'AC/DC Disconnects';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'breakersOcpd'        WHERE item_name = 'Breakers / OCPD';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'engCadDesign'        WHERE item_name = 'Engineering / CAD / Design / Stamps';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'thirdPartyInspection' WHERE item_name = 'Third-Party Inspection / Plan Review';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'batteryInstallLabor' WHERE item_name = 'Battery Installation Labor';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'pvInstallLabor'      WHERE item_name = 'PV Installation Labor';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'projectMgmt'         WHERE item_name = 'Project Management / Supervision';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'elecServicePanel'    WHERE item_name = 'Electrical Service Panel Upgrade Labor';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'commissioning'       WHERE item_name = 'Commissioning / Startup / Programming';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'inspectionCoord'     WHERE item_name = 'Inspection Coordination / Closeout';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'siteSurvey'          WHERE item_name = 'Site Survey';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'customerAcquisition' WHERE item_name = 'Customer Acquisition / Origination (Sales Commission)';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'warrantyService'     WHERE item_name = 'Warranty and Service Contract';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'changeOrder'         WHERE item_name = 'Change Order / Addtl SOW (if applicable)';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'epcOverhead'         WHERE item_name = 'Assumed EPC Overhead/Profit/Residual';
UPDATE public.project_cost_line_item_templates SET pcs_key = 'gpu'                 WHERE item_name = 'GPU';

-- ── 2. edge_model_scenarios.is_active_for_pull ─────────────────────────

ALTER TABLE public.edge_model_scenarios
  ADD COLUMN IF NOT EXISTS is_active_for_pull boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.edge_model_scenarios.is_active_for_pull IS
  'True iff this scenario is the canonical PCS source for MG cost-basis pulls. '
  'Partial unique index enforces at most one active scenario at a time. '
  'Flip via UPDATE; the previous active row should be flipped false in the '
  'same transaction (or use the atlas_set_active_pcs_scenario RPC).';

-- At most one active scenario at a time
CREATE UNIQUE INDEX IF NOT EXISTS edge_model_scenarios_one_active
  ON public.edge_model_scenarios (is_active_for_pull)
  WHERE is_active_for_pull = true;

-- Lock-aware setter RPC: marks one scenario active and unmarks all others
-- in a single transaction. SUPER_ADMIN ONLY — owner-based gate is a
-- privilege-escalation vector (any authenticated user could create their
-- own scenario via atlas_save_edge_model_scenario and self-promote it to
-- the canonical PCS source for the entire MG fleet, corrupting all cost
-- basis pulls). Audit-driven: red-teamer R1 2026-05-08 Critical.
CREATE OR REPLACE FUNCTION public.atlas_set_active_pcs_scenario(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_old_active uuid;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- super_admin gate — collapsed-error pattern: a non-super_admin gets the
  -- same 42501 regardless of whether the target id exists or not, so the
  -- RPC is not an existence oracle. Inversely, non-existence after the
  -- gate is signaled with a distinct error.
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'super_admin required to set active PCS scenario'
      USING ERRCODE = '42501';
  END IF;

  -- Advisory lock so concurrent activations serialize cleanly without
  -- bubbling up a 23505 unique-constraint error to the caller.
  PERFORM pg_advisory_xact_lock(hashtext('atlas-pcs-active-scenario'));

  SELECT owner_id INTO v_owner
  FROM public.edge_model_scenarios
  WHERE id = p_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'scenario not found: %', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Capture the prior active id for the audit row.
  SELECT id INTO v_old_active
  FROM public.edge_model_scenarios
  WHERE is_active_for_pull = true
  LIMIT 1;

  -- Atomic flip
  UPDATE public.edge_model_scenarios SET is_active_for_pull = false WHERE is_active_for_pull = true AND id <> p_id;
  UPDATE public.edge_model_scenarios SET is_active_for_pull = true  WHERE id = p_id;

  -- Audit: who flipped what, when. Reuses the generic public.audit_log
  -- table that other money-path mutations write to.
  INSERT INTO public.audit_log (project_id, field, old_value, new_value, changed_by, changed_by_id, reason)
  VALUES (
    NULL,
    'pcs_active_scenario',
    COALESCE(v_old_active::text, 'none'),
    p_id::text,
    auth.email(),
    v_caller::text,
    'atlas_set_active_pcs_scenario RPC'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) TO authenticated;

COMMENT ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) IS
  'Atomically promote one edge_model_scenarios row to is_active_for_pull = true '
  'and demote all others. SUPER_ADMIN ONLY — owner-based gate would let any '
  'authenticated user self-promote a malicious scenario. Writes audit_log row. '
  'Anchor: red-teamer R1 2026-05-08 Critical finding.';
