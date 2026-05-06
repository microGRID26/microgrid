-- #527 — Profit-transfer correctness.
--
-- Before: profit-transfer.ts loaded raw_cost per line from invoice_rules.line_items
-- (a STATIC JSONB pre-scaled to default 80 kWh / 16 batteries / 24.2 kW). The chain
-- orchestrator REPLACES rule.line_items in memory with project-scaled catalog rows
-- at invoice-generation time, but never persists those scaled rows. Profit recorder
-- re-reads from DB → gets stale static values → SPE2 reinvest amounts are wrong on
-- every non-default-sized project.
--
-- After: invoice_line_items carries `raw_cost` per row (project-scaled at insert
-- time). Profit recorder reads from the line item rows it already loads — no
-- round-trip through the static rule JSONB.
--
-- Schema impact: ADD COLUMN nullable, no DEFAULT, no NOT NULL → metadata-only
-- in Postgres 11+ (no row rewrites, no table lock beyond AccessExclusive flip).
-- Historical rows backfill to NULL; profit-transfer treats NULL as 0 raw_cost,
-- which matches the existing "missing description in lookup defaults to 0"
-- behaviour at lib/invoices/profit-transfer.ts:82 — NO REGRESSION on rows
-- written before this column exists. New chain invoices will populate it.
--
-- Backfill of historical rows is a separate prod-data operation (see followup
-- action). Reconciliation of entity_profit_transfers rows already written at
-- wrong cost basis is also separate.

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS raw_cost numeric;

COMMENT ON COLUMN public.invoice_line_items.raw_cost IS
  'Project-scaled raw cost basis for this line. Written at invoice-generation
   time from project_cost_line_items.raw_cost (chain rules) or null (flat-rate
   rules without a cost basis). Read by profit-transfer.ts to compute SPE2
   reinvestment amounts. NULL = treat as 0 cost (line is pure markup/fee).';
