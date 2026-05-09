-- Migration 251 — invoices.snapshot_id + per-snapshot chain idempotency
--
-- Action: Mark/Greg call 2026-05-08, M5 (#670). Mark explicit:
--   "every time I open the invoice... if [the model has] updated, give me a
--    little popup... Would you like me to generate a second invoice with the
--    updated model OR just leave this one as it is?"
--   "I just wanted to create another invoice. So now we have two invoices and
--    then we could choose if we want to delete one or just use the other."
--
-- Problem
-- -------
-- Chain invoices currently have NO link to the cost_basis_snapshot they were
-- generated from. The unique idempotency idx (`idx_invoices_rule_idempotency_v2`)
-- is keyed on (project_id, rule_id, milestone), so re-running
-- generateProjectChain on a project with existing draft invoices triggers
-- skippedExisting for every rule — no way to create a NEW chain invoice
-- alongside the OLD one.
--
-- Fix
-- ---
-- 1. Add `snapshot_id` to invoices (chain invoices populated; manual stay NULL).
-- 2. Backfill snapshot_id on existing chain invoices using the active
--    snapshot at invoice-creation time.
-- 3. Replace the idempotency idx to include snapshot_id, so each fresh
--    snapshot can produce its own (rule, milestone) tuple. Multiple
--    versions coexist as Mark wants.
--
-- Side effects
-- ------------
--   • Existing 40 M4 chain invoices (CHN-20260509-005..044) get backfilled
--     to their respective project's M4 active snapshot — no data lost.
--   • Manual invoices (rule_id IS NULL) keep snapshot_id NULL — drift banner
--     in M5 UI hides for them (drift undefined for non-chain).
--   • Pre-existing chain invoices that have NO matching cost_basis_snapshot
--     in their project's history will land snapshot_id NULL (unlikely given
--     mig 246's backfill, but possible for very old pre-snapshot rows).
--   • New chain invoices generated post-mig-251 will all carry snapshot_id
--     (chain.ts patched in same commit to stamp it).
--
-- Audit anchor
-- ------------
--   • migration-planner R1 against this mig before commit (mandatory per
--     Atlas Protocol sensitive-surface gate on `invoices` table).

BEGIN;

-- ── 1. Add nullable snapshot_id ───────────────────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS snapshot_id uuid;

COMMENT ON COLUMN public.invoices.snapshot_id IS
  'cost_basis_snapshots.id this invoice was generated from. NULL for manual '
  'invoices. Chain invoices (rule_id IS NOT NULL) MUST be populated post-M5 — '
  'used by the invoice-open drift banner to detect "Paul updated the model '
  'since this invoice was made". Mark/Greg call 2026-05-08, M5 (#670).';

-- ── 2. Backfill snapshot_id for existing chain invoices ───────────────────
-- For each chain invoice, find the most appropriate snapshot:
--   PRIMARY: most recent cost_basis_snapshots at-or-before the invoice's
--            created_at — the snapshot that was active when the invoice
--            was generated.
--   FALLBACK: earliest cost_basis_snapshots for the project — used when
--            the invoice was created BEFORE any snapshot existed (e.g.
--            pre-mig-246 chain invoices). At-or-after is still better
--            than NULL for drift comparison purposes.
--
-- migration-planner R1 anchor (2026-05-09): without the fallback, 14 of
-- 54 chain invoices (26%) would land NULL snapshot_id. NULL in a unique
-- idx is treated as distinct in postgres, opening a silent-duplicate
-- attack surface. The fallback closes that gap by ensuring every chain
-- invoice resolves to *some* snapshot in the project's history.
WITH backfill AS (
  SELECT inv.id AS invoice_id,
         COALESCE(
           (SELECT cbs.id
              FROM cost_basis_snapshots cbs
             WHERE cbs.project_id = inv.project_id
               AND cbs.created_at <= inv.created_at
             ORDER BY cbs.created_at DESC
             LIMIT 1),
           (SELECT cbs.id
              FROM cost_basis_snapshots cbs
             WHERE cbs.project_id = inv.project_id
             ORDER BY cbs.created_at ASC
             LIMIT 1)
         ) AS sid
    FROM invoices inv
   WHERE inv.rule_id IS NOT NULL
     AND inv.snapshot_id IS NULL
)
UPDATE invoices
   SET snapshot_id = backfill.sid
  FROM backfill
 WHERE invoices.id = backfill.invoice_id
   AND backfill.sid IS NOT NULL;

-- ── 3. Index for drift comparison + chain re-fetch ────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_snapshot_id
  ON public.invoices (snapshot_id)
 WHERE snapshot_id IS NOT NULL;

-- ── 4. Replace idempotency idx to include snapshot_id ─────────────────────
-- The OLD idx was (project_id, rule_id, milestone) WHERE status<>'cancelled'.
-- That blocked re-generation entirely. The NEW idx is keyed per snapshot, so
-- each fresh snapshot creates its own (rule, milestone) tuple — multiple
-- versions of chain invoices coexist on the same project.
--
-- Why include snapshot_id in the unique key:
--   • Each cost-basis snapshot represents a different version of the cost
--     numbers (rates, line items, totals). Generating chain invoices off a
--     fresh snapshot creates a NEW immutable record at that point in time.
--   • Mark explicit: "I don't want to write over the cost sag and invoice"
--     — old + new must coexist as separate rows.
--   • COALESCE not needed: chain invoices (rule_id IS NOT NULL, the only
--     rows the WHERE clause selects) will always have snapshot_id post-M5.
--     Pre-mig-251 backfilled rows already populated above; new inserts
--     stamped by chain.ts.

DROP INDEX IF EXISTS idx_invoices_rule_idempotency_v2;

CREATE UNIQUE INDEX idx_invoices_rule_idempotency_v3
  ON public.invoices (project_id, rule_id, milestone, snapshot_id)
 WHERE rule_id IS NOT NULL
   AND project_id IS NOT NULL
   AND status <> 'cancelled';

COMMENT ON INDEX public.idx_invoices_rule_idempotency_v3 IS
  'Per-snapshot chain idempotency. Replaces v2 (which keyed on '
  '(project_id, rule_id, milestone) only and blocked all re-generation). '
  'M5 needs new chain invoices alongside old when Paul updates the model '
  '— each fresh snapshot becomes its own (rule, milestone) tuple. '
  'Mark/Greg call 2026-05-08.';

-- ── 5. CHECK constraint enforcing snapshot_id on chain invoices ──────────
-- migration-planner R1 anchor: NULL snapshot_id on chain invoices opens a
-- silent-duplicate attack surface (NULL ≠ NULL in unique idx). Backfill
-- (step 2) populates all known chain invoices via the fallback path. New
-- inserts are stamped by chain.ts. NOT VALID skips the legacy check at
-- migration time but enforces on every future INSERT/UPDATE.
ALTER TABLE public.invoices
  ADD CONSTRAINT chain_invoice_has_snapshot
  CHECK (rule_id IS NULL OR snapshot_id IS NOT NULL) NOT VALID;

COMMIT;
