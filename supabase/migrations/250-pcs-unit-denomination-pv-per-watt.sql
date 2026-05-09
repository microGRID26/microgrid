-- Migration 250 — PCS unit-denomination alignment for PV Modules + PV Mounting
--
-- Action: Mark/Greg call 2026-05-08 follow-through, M4 spot-check 2026-05-09.
--
-- Problem
-- -------
-- Templates `PV Modules` and `PV Mounting Hardware` were stored with
-- default_unit_basis='per_kw' and default_raw_cost in $/kW ($300, $120).
--
-- Paul's v43 PCS source (~/repos/EDGE-MODEL/source/v43-0-custom-element.txt:2278-2306)
-- expresses the same rates in $/W (perWatt): pvModules=0.30, pvMountingHardware=0.12.
-- Same dollar economics — different unit denomination.
--
-- The mig-249 PCS overlay function `backfill_project_cost_line_items` does:
--   eff_raw_cost = COALESCE(pcsUnitRates[key], template.default_raw_cost)
--   scale        = eff_raw_cost × CASE basis ...
--
-- Critically, the basis is NOT overlaid — it stays the template's per_kw.
-- Result: M2 substitutes 0.30 into per_kw scaling → 0.30 × 29.97 kW = $8.99
-- (should be $8,991 — off by 1000x).
--
-- Verified end-to-end on PROJ-28619 (Edward Taylor, 29.97 kW): pre-mig-250
-- the M2 overlay would silently produce a $8,000+ understatement on PV
-- Modules alone. The bug never surfaced because line items for the 10
-- Thrive-Unfunded customers were materialized BEFORE M2 PCS was populated,
-- so the overlay never actually ran for these items.
--
-- Fix
-- ---
-- Convert the two templates to per_watt basis with $/W rates. Mathematically
-- equivalent (300 $/kW = 0.30 $/W; 120 $/kW = 0.12 $/W), but now matches
-- the PCS scenario's denomination so the overlay applies cleanly.
--
-- Side effects
-- ------------
--   • EXISTING line items unchanged — this only changes the template the
--     overlay reads from. Re-backfill is a separate destructive op (caller
--     decides per-project).
--   • Reference TS calculator (lib/cost/calculator.ts) `scaleRawCost`
--     supports per_watt — no code change needed.
--   • Audit anchor: M4 batch validation 2026-05-09 (Edward Taylor diff
--     query traced to per_kw vs per_watt mismatch).
--
-- Out of scope (deferred — not in chain)
-- --------------------------------------
--   • Bulk re-backfill of 923 active snapshots system-wide. M5 (chain item)
--     surfaces drift on per-project regen — natural unwind.
--   • M2 import script `scripts/import-edge-model-pcs.ts` could be tightened
--     to refuse PCS rates whose unit doesn't match the template basis.

UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_watt',
       default_raw_cost   = 0.30
 WHERE item_name = 'PV Modules'
   AND active = true;

UPDATE public.project_cost_line_item_templates
   SET default_unit_basis = 'per_watt',
       default_raw_cost   = 0.12
 WHERE item_name = 'PV Mounting Hardware'
   AND active = true;
