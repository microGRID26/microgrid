-- Action #526 (P0). TX sales tax was applied to the entire EPC→EDGE chain
-- subtotal, but ~$75k of a typical $300k chain invoice is non-TPP service
-- (TX §151 / Comptroller Rule 3.291): engineering, inspection, sales
-- commission, warranty contract, and the EPC's own overhead/residual line.
-- The over-collection was ~8.25% × $75k = $6,187.50 per project.
--
-- Paul confirmed the bug 2026-05-06 ("It charge taxes on non taxable costs.
-- There are no existing invoices so no need to adjust.") but did NOT classify
-- the full 28-row catalog. This migration ships the conservative Phase 1:
--
--   - is_taxable_tpp boolean DEFAULT true on templates and project rows
--   - Default-true means NO behavior change until rows flip to false
--   - Flip 5 unambiguous-service rows to false now (the rows Paul implicitly
--     confirmed as non-TPP via his "non taxable costs" reply)
--   - Per-row classification of remaining rows is a Paul follow-up (separate
--     action) — until then conservative default keeps current taxation
--
-- After this migration plus the chain.ts filter change shipping with it:
-- chain.ts taxes only the sum of taxable line items, not draft.subtotal.

-- ── Templates (28 rows) ─────────────────────────────────────────────────────

ALTER TABLE public.project_cost_line_item_templates
  ADD COLUMN IF NOT EXISTS is_taxable_tpp boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.project_cost_line_item_templates.is_taxable_tpp IS
  'TX sales-tax classification: true = taxable tangible personal property (TPP), false = non-TPP service (engineering, inspection, sales commission, warranty, EPC residual). Read by lib/invoices/chain.ts when building EPC→EDGE chain invoice tax. Conservative default true; only flip false with explicit Paul/CFO confirmation. Migration 233 / action #526.';

-- ── Per-project rows (~25,900 rows) ─────────────────────────────────────────
-- ADD COLUMN with constant DEFAULT is metadata-only in PG ≥ 11 (no row rewrite).
-- The column is mirrored from the template so chain materialization
-- (buildProjectLineItem in lib/cost/calculator.ts) carries the flag through.

ALTER TABLE public.project_cost_line_items
  ADD COLUMN IF NOT EXISTS is_taxable_tpp boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.project_cost_line_items.is_taxable_tpp IS
  'Mirrored from project_cost_line_item_templates.is_taxable_tpp at materialization time (buildProjectLineItem). Read by chain.ts to filter draft.line_items before computing TX sales tax. Migration 233 / action #526.';

-- ── Persist taxability on invoice line items (R1 H-1) ──────────────────────
-- Without this column, a TX auditor cannot reconstruct WHICH line items
-- formed the tax basis on a historical invoice — the catalog flag can drift
-- post-cut (Paul reclassifies a row, a template flips), making the question
-- "why does this $300k invoice carry $18,562.50 of tax instead of $24,750"
-- unanswerable from invoice data alone. Today there are 0 chain invoices
-- in prod (verified pre-migration), so this column needs no backfill.

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS is_taxable_tpp boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.invoice_line_items.is_taxable_tpp IS
  'Snapshot of project_cost_line_items.is_taxable_tpp at invoice creation. Frozen — does not track template/catalog changes after the invoice is cut. The TX-tax basis on invoices.tax can be reconstructed via SUM(quantity*unit_price) WHERE is_taxable_tpp = true. Migration 233 / action #526.';

-- ── Flip 5 obvious-service rows to false ────────────────────────────────────
-- These are the rows Paul implicitly confirmed in his 2026-05-06 reply ("It
-- charge taxes on non taxable costs"). Item names verified verbatim against
-- live templates 2026-05-06 — note the Customer Acquisition row has the
-- " (Sales Commission)" suffix on the canonical template name.

UPDATE public.project_cost_line_item_templates
SET is_taxable_tpp = false, updated_at = now()
WHERE item_name IN (
  'Assumed EPC Overhead/Profit/Residual',
  'Engineering / CAD / Design / Stamps',
  'Third-Party Inspection / Plan Review',
  'Customer Acquisition / Origination (Sales Commission)',
  'Warranty and Service Contract'
);

-- Mirror the template flip across already-materialized project rows. Each
-- name maps to ~925 rows (28 distinct names across 25,900 total rows), so
-- this UPDATE touches ~4,625 rows in one transaction. Small.

UPDATE public.project_cost_line_items
SET is_taxable_tpp = false, updated_at = now()
WHERE item_name IN (
  'Assumed EPC Overhead/Profit/Residual',
  'Engineering / CAD / Design / Stamps',
  'Third-Party Inspection / Plan Review',
  'Customer Acquisition / Origination (Sales Commission)',
  'Warranty and Service Contract'
);

-- ── Verification (run in psql to sanity-check after apply) ──────────────────
--
--   SELECT item_name, is_taxable_tpp
--     FROM project_cost_line_item_templates
--    WHERE is_taxable_tpp = false
--    ORDER BY item_name;
--   -- Expect 5 rows, the 5 names above.
--
--   SELECT item_name, COUNT(*)
--     FROM project_cost_line_items
--    WHERE is_taxable_tpp = false
--    GROUP BY item_name;
--   -- Expect 5 rows, ~925 each.
