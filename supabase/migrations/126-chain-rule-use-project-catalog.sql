-- Migration 126 — Tier 2 Phase 1.5: chain rules can source line items from project catalog
--
-- Before this migration, chain rules carried static proforma reference line items
-- in invoice_rules.line_items JSONB. Every project's chain invoices rendered with
-- the same 24.2 kW / 80 kWh boat regardless of the project's actual sizing. This
-- migration adds a flag so 3 of the 5 chain rules (DSE→NewCo, NewCo→EPC, EPC→EDGE)
-- can draw from per-project cost line items backfilled in Session 47 (migration 103).
-- The remaining 2 (Rush Engineering, MG Sales commission) stay on flat embedded
-- line items because they aren't in the 28-row catalog.

ALTER TABLE public.invoice_rules
  ADD COLUMN IF NOT EXISTS use_project_catalog boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoice_rules.use_project_catalog IS
  'When true, the chain orchestrator ignores line_items JSONB and rebuilds line items from project_cost_line_items joined to the catalog, using raw_cost/distro_price/epc_price keyed on (from_org_type, to_org_type). Phase 1.5.';

-- Flag the three catalog-sourced rules. Match on (from_org_type, to_org_type)
-- rather than name so a future rename of the rule doesn't silently drop the flag.
UPDATE public.invoice_rules
   SET use_project_catalog = true
 WHERE rule_kind = 'chain'
   AND (
     (from_org_type = 'direct_supply_equity_corp' AND to_org_type = 'newco_distribution') OR
     (from_org_type = 'newco_distribution'        AND to_org_type = 'epc')                OR
     (from_org_type = 'epc'                       AND to_org_type = 'platform')
   );
