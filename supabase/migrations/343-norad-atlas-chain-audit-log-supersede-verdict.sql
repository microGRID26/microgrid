-- 343-norad-atlas-chain-audit-log-supersede-verdict.sql
--
-- NORAD v1.9: add 'superseded' to atlas_chain_audit_log.verdict CHECK so the
-- supersede mechanism can write sibling rows that mark an older non-A row as
-- closed-by-later-work. Mirrors the verdict='override' pattern from v1.6.
--
-- Why: non_a_gates rows have no closure path today. Findings fixed inline
-- (no accepted-risk lane needed) re-surface in NORAD's SITREP forever. The
-- v1.7 R1 H1 keyword-stuffable scoring finding got fixed weeks ago but still
-- ranks #1 in TARGETS because nothing told the boot helper it's closed.
--
-- Shape: pure CHECK widen, no data motion, no fn/grant/RLS surface.
-- Drop + recreate is the standard Postgres pattern; ALTER CONSTRAINT CHECK
-- is not supported.

ALTER TABLE public.atlas_chain_audit_log
  DROP CONSTRAINT atlas_chain_audit_log_verdict_check;

ALTER TABLE public.atlas_chain_audit_log
  ADD CONSTRAINT atlas_chain_audit_log_verdict_check
  CHECK (
    verdict IS NULL
    OR verdict = ANY (ARRAY['go', 'hold', 'indeterminate', 'override', 'superseded'])
  );

-- Sanity: confirm 'superseded' is now in the allowed set.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conrelid = 'public.atlas_chain_audit_log'::regclass
    AND conname = 'atlas_chain_audit_log_verdict_check';
  IF def NOT LIKE '%superseded%' THEN
    RAISE EXCEPTION 'atlas_chain_audit_log_verdict_check did not widen: %', def;
  END IF;
END
$$;
