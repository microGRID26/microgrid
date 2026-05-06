-- #534 — Drop the 99x / 9x markup workarounds on engineering rows.
--
-- Two templates currently encode their final dollar amount as raw × markup:
--   sort_order 150 (Engineering/CAD/Design/Stamps): raw=$100, K=99 → $10,000
--   sort_order 160 (Third-Party Inspection):       raw=$350, K=9  → $3,500
--
-- Math works (final distro is correct) but reads as catastrophic inflation
-- to an external auditor seeing the K=99 column. Refactor to express the
-- final dollar as raw_cost with K=0 — same outcome, clean signal.
--
-- Net change: raw_cost moves UP for these two lines, markup_to_distro moves
-- to 0. distro_price = raw_cost × (1 + markup_to_distro) is unchanged
-- ($10,000 and $3,500 respectively). epc_price (= distro × 1.005 for chain
-- equipment) is also unchanged because markup_distro_to_epc was already 0
-- on these rows (engineering doesn't carry the chain spread).
--
-- Existing project_cost_line_items rows derived from these templates retain
-- their old raw=$100 / $350 + K=99 / K=9 numbers until a catalog regen runs.
-- Distro / EPC prices on already-derived rows are correct as-is. New
-- projects, and any project regenerated from templates after this migration,
-- pick up the cleaner numbers.
--
-- Profit-transfer impact: these lines fire on engineering→epc, NOT
-- direct_supply_equity_corp→newco_distribution, so shouldTriggerProfitTransfer
-- excludes them. SPE2 reinvest math unaffected by this refactor.

UPDATE public.project_cost_line_item_templates
SET default_raw_cost = 10000.00,
    default_markup_to_distro = 0.0
WHERE sort_order = 150
  AND name = 'Engineering / CAD / Design / Stamps'
  AND default_raw_cost = 100.00
  AND default_markup_to_distro = 99.0;

UPDATE public.project_cost_line_item_templates
SET default_raw_cost = 3500.00,
    default_markup_to_distro = 0.0
WHERE sort_order = 160
  AND name = 'Third-Party Inspection / Plan Review'
  AND default_raw_cost = 350.00
  AND default_markup_to_distro = 9.0;
