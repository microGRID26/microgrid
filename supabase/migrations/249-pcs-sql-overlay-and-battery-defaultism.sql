-- 249: PCS SQL overlay + battery defaultism fix
-- (Renamed from 248 mid-session: file 248 was concurrently claimed by
-- atlas_append_greg_action_note in another parallel session. Supabase tracks
-- by timestamp version, so both applied cleanly; renaming the file avoids
-- future confusion under `supabase db push`.)
--
-- Two changes to backfill_project_cost_line_items(text, uuid), bundled because
-- they touch the same function body:
--
--   1. PORT THE OVERLAY (action #668, M2)
--      The TS overlay in lib/cost/api.ts:overlayScenarioOnTemplates substitutes
--      template default_* columns with values from the active scenario's
--      config->'pcs' JSONB. The SQL backfill bypasses that overlay entirely,
--      so chain-invoice generation always uses bare template defaults — even
--      after Paul edits his model. This migration ports the overlay logic into
--      PL/pgSQL via a CTE that wraps the templates table.
--
--   2. DROP THE BATTERY DEFAULTISM (action #678, Raymond Sunday + others)
--      Line 166 of mig 246 had:
--        COALESCE(NULLIF(NULLIF(battery_qty::text, '')::numeric, 0), 16)
--      which silently treats 0-battery (PV-only) projects as 16-battery,
--      inflating their snapshot. Drop the 0→16 fallback. Default for NULL/'' is
--      now 0 — same as the project's actual value. systemkw/inverter_qty/
--      module_qty defaults are LEFT IN PLACE — that's a separate question.
--
-- Overlay semantics (matches lib/cost/api.ts:122-140):
--   • For each active template, look up t.pcs_key in:
--       config.pcs.pcsUnitRates    → eff_raw_cost
--       config.pcs.pcsSupplyMarkup → eff_markup_to_distro
--       config.pcs.pcsBatteryAlloc → eff_battery_pct
--   • config.pcs.pcsDistroMarkup is a scalar → eff_markup_distro_to_epc.
--   • If t.pcs_key is NULL or the JSONB key is absent, fall back to template
--     default_*. Same fallback when no scenario is active_for_pull.
--   • pv_pct is intentionally NOT overlaid — TS overlay also doesn't touch it
--     (only battery_pct has a PCS-side counterpart per mig 243).
--
-- Compatibility:
--   • Function signature unchanged: (text, uuid) RETURNS TABLE(integer, uuid).
--   • Return columns unchanged.
--   • Existing snapshots not retroactively rewritten — caller must regen
--     (atlas_create_cost_basis_snapshot) to materialize the overlaid values.
--   • REVOKE/GRANT carried forward from mig 246 (PUBLIC + anon revoked,
--     service_role granted).
--
-- Anchors:
--   • Mark/Greg call 2026-05-08 transcript line 1144 ("pull from Paul's model")
--   • Action queue rows #668 (M2) + #678 (battery defaultism)
--   • TS reference impl: lib/cost/api.ts:122-140 (overlayScenarioOnTemplates)

DROP FUNCTION IF EXISTS public.backfill_project_cost_line_items(text, uuid);

CREATE OR REPLACE FUNCTION public.backfill_project_cost_line_items(
  p_project_id text,
  p_snapshot_id uuid DEFAULT NULL
)
RETURNS TABLE(inserted_count integer, snapshot_id uuid)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
DECLARE
  v_systemkw      numeric;
  v_systemwatts   numeric;
  v_battery_qty   numeric;
  v_battery_kwh   numeric;
  v_inverter_qty  numeric;
  v_panel_qty     numeric;
  v_panel_pairs   numeric;
  v_inserted      int := 0;
  v_unknown_basis text;
  v_snapshot      uuid := COALESCE(p_snapshot_id, gen_random_uuid());
  v_pcs           jsonb;
  v_distro_mk     numeric;
BEGIN
  -- Fail loudly if any active template has a basis the CASE below doesn't
  -- handle (mig 129 R1 anchor).
  SELECT default_unit_basis INTO v_unknown_basis
    FROM project_cost_line_item_templates
   WHERE active = true
     AND default_unit_basis NOT IN (
       'flat','per_kw','per_kwh','per_battery','per_inverter',
       'per_panel','per_panel_pair','per_watt'
     )
   LIMIT 1;
  IF v_unknown_basis IS NOT NULL THEN
    RAISE EXCEPTION
      'backfill_project_cost_line_items: unsupported default_unit_basis %s in active templates',
      quote_literal(v_unknown_basis);
  END IF;

  -- Load PCS overlay from the active scenario. NULL is a valid result —
  -- means "no overlay, use template defaults" — which is exactly the
  -- behavior of mig 246 prior to this change.
  SELECT config->'pcs' INTO v_pcs
    FROM edge_model_scenarios
   WHERE is_active_for_pull = true
   LIMIT 1;

  v_distro_mk := NULLIF((v_pcs->>'pcsDistroMarkup'), '')::numeric;

  -- Project sizing. Battery default changed from 16 to 0 (action #678) —
  -- PV-only projects must not synthesize phantom batteries.
  SELECT
    COALESCE(NULLIF(NULLIF(systemkw::text, '')::numeric, 0), 24.2),
    COALESCE(NULLIF(battery_qty::text, '')::numeric, 0),
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

  WITH overlaid AS (
    -- Per-template overlay: substitute default_* with PCS scenario values
    -- where present. Null-safe via COALESCE so missing keys fall back.
    -- pv_pct is intentionally not overlaid (no PCS counterpart in mig 243).
    SELECT
      t.id,
      t.sort_order, t.section, t.category, t.system_bucket, t.item_name,
      t.default_unit_basis,
      t.default_proof_type, t.default_basis_eligibility,
      t.is_epc_internal, t.is_itc_excluded,
      COALESCE(
        NULLIF((v_pcs->'pcsUnitRates'->>t.pcs_key), '')::numeric,
        t.default_raw_cost
      ) AS eff_raw_cost,
      COALESCE(
        NULLIF((v_pcs->'pcsSupplyMarkup'->>t.pcs_key), '')::numeric,
        t.default_markup_to_distro
      ) AS eff_markup_to_distro,
      COALESCE(v_distro_mk, t.default_markup_distro_to_epc) AS eff_markup_distro_to_epc,
      COALESCE(
        NULLIF((v_pcs->'pcsBatteryAlloc'->>t.pcs_key), '')::numeric,
        t.default_battery_pct
      ) AS eff_battery_pct,
      t.default_pv_pct
    FROM project_cost_line_item_templates t
    WHERE t.active = true
  ),
  new_rows AS (
    INSERT INTO project_cost_line_items (
      project_id, template_id, snapshot_id, sort_order, section, category, system_bucket, item_name,
      raw_cost, markup_to_distro, distro_price, markup_distro_to_epc, epc_price,
      battery_pct, pv_pct, battery_cost, pv_cost,
      proof_of_payment_status, proof_type, basis_eligibility,
      is_epc_internal, is_itc_excluded
    )
    SELECT
      p_project_id, o.id, v_snapshot,
      o.sort_order, o.section, o.category, o.system_bucket, o.item_name,
      ROUND(s.scale * 1::numeric, 2)                                                                AS raw_cost,
      o.eff_markup_to_distro,
      ROUND(s.scale * (1 + o.eff_markup_to_distro), 2)                                              AS distro_price,
      o.eff_markup_distro_to_epc,
      ROUND(s.scale * (1 + o.eff_markup_to_distro) * (1 + o.eff_markup_distro_to_epc), 2)           AS epc_price,
      o.eff_battery_pct,
      o.default_pv_pct,
      ROUND(s.scale * (1 + o.eff_markup_to_distro) * (1 + o.eff_markup_distro_to_epc) * o.eff_battery_pct, 2) AS battery_cost,
      ROUND(s.scale * (1 + o.eff_markup_to_distro) * (1 + o.eff_markup_distro_to_epc) * o.default_pv_pct, 2)  AS pv_cost,
      'Pending'::text, o.default_proof_type, o.default_basis_eligibility,
      o.is_epc_internal, o.is_itc_excluded
    FROM overlaid o,
    LATERAL (
      SELECT o.eff_raw_cost * (CASE o.default_unit_basis
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
    WHERE NOT EXISTS (
      SELECT 1 FROM project_cost_line_items existing
      WHERE existing.project_id = p_project_id
        AND existing.template_id = o.id
        AND existing.snapshot_id = v_snapshot
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM new_rows;

  RETURN QUERY SELECT v_inserted, v_snapshot;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.backfill_project_cost_line_items(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_project_cost_line_items(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.backfill_project_cost_line_items(text, uuid) TO service_role;

COMMENT ON FUNCTION public.backfill_project_cost_line_items(text, uuid) IS
  'Inserts per-project cost line items from active templates into the given '
  'snapshot. Templates are overlaid with the active edge_model_scenarios '
  'config.pcs JSONB (action #668, M2). Battery_qty default changed from 16 '
  'to 0 to honor PV-only projects (action #678). REVOKE/GRANT carried '
  'forward from mig 246: PUBLIC + anon revoked, service_role granted.';
