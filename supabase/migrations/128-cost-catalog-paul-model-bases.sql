-- Migration 128: align cost-catalog scaling to Paul's v43-20 financial model
--
-- Background: the 28-row catalog (project_cost_line_item_templates) used only
-- {flat, per_kw, per_kwh} as basis types. The original seed mapped Paul's
-- per-battery / per-inverter / per-panel / per-watt rates onto per_kw / per_kwh
-- equivalents under hard-coded assumptions (5 kWh-per-battery for the rate
-- derivation, 16 kWh-per-battery in the backfill multiplier — the two cancel
-- at default sizing but diverge wildly on any non-default project).
--
-- Paul confirmed the source-of-truth rates today (2026-04-20). Match his
-- structure exactly so a project's Cost Basis tab reproduces his Project Cost
-- Schedule to the cent regardless of system size.
--
-- Six items move from {flat, per_kwh} to per-unit bases:
--   Battery Modules                           per_kwh   ->  per_battery       $2,340.80
--   Hybrid Inverters                          per_kw    ->  per_inverter      $6,748.50
--   Module-Level Electronics RSD              flat      ->  per_panel_pair    $50.00
--   Battery Installation Labor                flat      ->  per_battery       $250.00
--   PV Installation Labor                     flat      ->  per_panel         $56.00
--   Customer Acquisition (Sales Commission)   flat      ->  per_watt          $1.00
--
-- The other 22 templates keep their bases (flat / per_kw / per_kwh) and rates.
--
-- Existing chain invoices are immutable per the unique idempotency index on
-- (project_id, rule_id, milestone). Only newly-generated chain invoices pick up
-- the corrected math. Cost Basis tab numbers update for all 925 projects on
-- regenerate (delete + reinsert from templates is safe per drift-check:
-- 0 user-edited rows across 25,900 — proof_of_payment_status untouched on every
-- row, no FK references, all derived columns).

-- ── 1. Extend the basis CHECK to allow the new per-unit types ───────────────
ALTER TABLE public.project_cost_line_item_templates
  DROP CONSTRAINT IF EXISTS project_cost_line_item_templates_default_unit_basis_check;

ALTER TABLE public.project_cost_line_item_templates
  ADD CONSTRAINT project_cost_line_item_templates_default_unit_basis_check
  CHECK (default_unit_basis = ANY (ARRAY[
    'flat', 'per_kw', 'per_kwh',
    'per_battery', 'per_inverter', 'per_panel', 'per_panel_pair', 'per_watt'
  ]));

-- ── 2. Update the 6 templates ───────────────────────────────────────────────
UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_battery', default_raw_cost = 2340.80
 WHERE item_name = 'Battery Modules';

UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_inverter', default_raw_cost = 6748.50
 WHERE item_name = 'Hybrid Inverters';

UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_panel_pair', default_raw_cost = 50.00
 WHERE item_name = 'Module-Level Electronics RSD';

UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_battery', default_raw_cost = 250.00
 WHERE item_name = 'Battery Installation Labor';

UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_panel', default_raw_cost = 56.00
 WHERE item_name = 'PV Installation Labor';

UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_watt', default_raw_cost = 1.00
 WHERE item_name = 'Customer Acquisition / Origination (Sales Commission)';

-- ── 3. Rewrite the backfill function to handle the new bases ───────────────
-- Defaults match Paul's v43-20 model defaults (55 panels @ 440W = 24.2 kW,
-- 16 batteries @ 5 kWh = 80 kWh, 2 inverters). Real projects override via
-- their projects.module_qty / battery_qty / inverter_qty / systemkw fields.
CREATE OR REPLACE FUNCTION public.backfill_project_cost_line_items(p_project_id text)
RETURNS TABLE(inserted_count integer, skipped_count integer)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_systemkw      numeric;
  v_systemwatts   numeric;
  v_battery_qty   numeric;
  v_battery_kwh   numeric;   -- battery_qty * 5 (Paul's bomKwPerBattery default)
  v_inverter_qty  numeric;
  v_panel_qty     numeric;
  v_panel_pairs   numeric;
  v_inserted      int := 0;
  v_skipped       int := 0;
BEGIN
  SELECT
    COALESCE(NULLIF(NULLIF(systemkw::text, '')::numeric, 0), 24.2),
    COALESCE(NULLIF(NULLIF(battery_qty::text, '')::numeric, 0), 16),
    COALESCE(NULLIF(NULLIF(inverter_qty::text, '')::numeric, 0), 2),
    COALESCE(NULLIF(NULLIF(module_qty::text, '')::numeric, 0), 55)
  INTO v_systemkw, v_battery_qty, v_inverter_qty, v_panel_qty
  FROM projects WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found: %', p_project_id;
  END IF;

  v_systemwatts := v_systemkw * 1000;
  v_battery_kwh := v_battery_qty * 5;
  v_panel_pairs := ceil(v_panel_qty / 2);

  WITH new_rows AS (
    INSERT INTO project_cost_line_items (
      project_id, template_id, sort_order, section, category, system_bucket, item_name,
      raw_cost, markup_to_distro, distro_price, markup_distro_to_epc, epc_price,
      battery_pct, pv_pct, battery_cost, pv_cost,
      proof_of_payment_status, proof_type, basis_eligibility,
      is_epc_internal, is_itc_excluded
    )
    SELECT
      p_project_id, t.id,
      t.sort_order, t.section, t.category, t.system_bucket, t.item_name,
      ROUND(scale * 1::numeric, 2)                                                                AS raw_cost,
      t.default_markup_to_distro,
      ROUND(scale * (1 + t.default_markup_to_distro), 2)                                          AS distro_price,
      t.default_markup_distro_to_epc,
      ROUND(scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc), 2)   AS epc_price,
      t.default_battery_pct,
      t.default_pv_pct,
      ROUND(scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc) * t.default_battery_pct, 2) AS battery_cost,
      ROUND(scale * (1 + t.default_markup_to_distro) * (1 + t.default_markup_distro_to_epc) * t.default_pv_pct, 2)      AS pv_cost,
      'Pending'::text, t.default_proof_type, t.default_basis_eligibility,
      t.is_epc_internal, t.is_itc_excluded
    FROM project_cost_line_item_templates t,
    LATERAL (
      SELECT t.default_raw_cost * (CASE t.default_unit_basis
        WHEN 'flat'           THEN 1
        WHEN 'per_kw'         THEN v_systemkw
        WHEN 'per_kwh'        THEN v_battery_kwh
        WHEN 'per_battery'    THEN v_battery_qty
        WHEN 'per_inverter'   THEN v_inverter_qty
        WHEN 'per_panel'      THEN v_panel_qty
        WHEN 'per_panel_pair' THEN v_panel_pairs
        WHEN 'per_watt'       THEN v_systemwatts
      END)::numeric AS scale
    ) s
    WHERE t.active = true
      AND NOT EXISTS (
        SELECT 1 FROM project_cost_line_items existing
        WHERE existing.project_id = p_project_id AND existing.template_id = t.id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM new_rows;

  v_skipped := 28 - v_inserted;
  RETURN QUERY SELECT v_inserted, v_skipped;
END;
$function$;
