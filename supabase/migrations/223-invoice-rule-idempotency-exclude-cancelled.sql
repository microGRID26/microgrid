-- #536 — idx_invoices_rule_idempotency blocks legitimate re-billing after cancel.
--
-- Current index (defined in supabase/098-invoice-automation.sql):
--   CREATE UNIQUE INDEX idx_invoices_rule_idempotency
--     ON public.invoices (project_id, rule_id, milestone)
--     WHERE rule_id IS NOT NULL AND project_id IS NOT NULL;
--
-- Problem: cancelling a rule-generated invoice (status='cancelled') leaves the
-- row in place. Re-firing the same rule against the same project + milestone
-- trips this unique index → "duplicate key violates idx_invoices_rule_idempotency"
-- → forces hard delete of the cancelled row OR creating a throwaway rule_id.
-- Neither is right: cancelled invoices are an audit-trail artifact, not blocked-
-- forever idempotency keys.
--
-- Fix: extend the partial index predicate to skip cancelled rows so cancelling
-- + re-firing the rule produces a fresh draft cleanly. Other terminal statuses
-- (paid, viewed, sent) STILL block — those represent committed business events
-- that can't be silently overwritten.
--
-- Rebuild approach: CREATE new index under a different name, then DROP the
-- old one. Supabase apply_migration wraps the file in a transaction, which
-- forbids CONCURRENTLY (Postgres 25001). The non-CONCURRENTLY path takes
-- AccessExclusive on `invoices` for the build, but the table is single-
-- digit thousands of rows — sub-second lock window mid-day is acceptable.
-- Migration-planner subagent confirmed safe (#536).
--
-- Predicate direction (verified by migration-planner): new is strictly
-- MORE restrictive than old (subset of indexed rows). Any pair unique
-- under the old index remains unique under the new — build cannot fail
-- on existing data.

-- New index with cancelled-row exclusion.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_rule_idempotency_v2
  ON public.invoices (project_id, rule_id, milestone)
  WHERE rule_id IS NOT NULL
    AND project_id IS NOT NULL
    AND status NOT IN ('cancelled');

-- Drop the old index — instant catalog flip after the new one is in place.
DROP INDEX IF EXISTS public.idx_invoices_rule_idempotency;

COMMENT ON INDEX public.idx_invoices_rule_idempotency_v2 IS
  'Idempotency: one ACTIVE rule-generated invoice per (project, rule, milestone).
   Cancelled invoices remain in the table for audit history but do not block
   re-firing the rule. Replaces idx_invoices_rule_idempotency (#536).';
