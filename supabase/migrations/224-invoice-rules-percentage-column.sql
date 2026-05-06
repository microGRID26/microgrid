-- #532 — Move percentage off rule.name regex, onto its own column.
--
-- Today, lib/invoices/calculate.ts:parsePercentageFromRuleName regex-extracts
-- "(30%)" / "(50%)" / "(20%)" from the rule name. Renaming a rule and dropping
-- the suffix silently breaks NTP/Install/PTO billing — the calculator returns
-- 'percentage_parse_failed' and the milestone fires no invoice.
--
-- Fix: add `percentage` column. Backfill from current rule names. Code reads
-- column first, falls back to regex (transitional) so any rules created by
-- direct DB inserts that didn't get the column populated still work. After
-- this lands and is verified, the regex path can be retired.

ALTER TABLE public.invoice_rules
  ADD COLUMN IF NOT EXISTS percentage numeric;

-- Backfill from existing rule names. Only touches rows where the name has a
-- (NN%) suffix and the column is currently NULL — idempotent re-run safe.
UPDATE public.invoice_rules
SET percentage = (regexp_match(name, '\((\d+(?:\.\d+)?)%\)'))[1]::numeric / 100
WHERE percentage IS NULL
  AND name ~ '\(\d+(?:\.\d+)?%\)';

COMMENT ON COLUMN public.invoice_rules.percentage IS
  'Percentage of project.contract billed by this rule (0..1). Used for
   percentage-mode milestone rules (NTP, Install, PTO). NULL means rule is
   flat-rate or chain. Source-of-truth column; rule.name "(NN%)" suffix is
   display-only after #532.';
