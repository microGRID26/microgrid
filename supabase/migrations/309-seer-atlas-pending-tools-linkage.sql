-- Migration 309: Seer Atlas Phase 3B — pending-tools linkage columns
--
-- Adds two nullable columns to seer_atlas_pending_tools so the /confirm
-- handler can:
--   1. Finalize the matching seer_atlas_writes_log row (audit_id).
--   2. Write the paired Anthropic tool_result block keyed by the original
--      tool_use_id, satisfying the protocol invariant (assistant tool_use
--      must be followed by user tool_result with matching id).
--
-- Both columns are nullable + additive. Idempotent. Zero existing rows
-- (smoke data cleaned at v3A handoff), so backfill is a no-op.

BEGIN;

ALTER TABLE public.seer_atlas_pending_tools
  ADD COLUMN IF NOT EXISTS audit_id     uuid,
  ADD COLUMN IF NOT EXISTS tool_use_id  text;

-- No FK to seer_atlas_writes_log: the audit row may be GC'd separately
-- under a future retention policy, and a dangling pending row should NOT
-- block writes-log cleanup. Lookups by id are nullable joins.

COMMENT ON COLUMN public.seer_atlas_pending_tools.audit_id IS
  'FK-shape pointer to seer_atlas_writes_log(id). Not enforced; nullable.';
COMMENT ON COLUMN public.seer_atlas_pending_tools.tool_use_id IS
  'The Anthropic tool_use block id from the assistant message that proposed this tool call. Used by /confirm to write the matching tool_result row.';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='seer_atlas_pending_tools'
      AND column_name='audit_id'
  ) THEN
    RAISE EXCEPTION 'mig 309: audit_id column did not get added';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='seer_atlas_pending_tools'
      AND column_name='tool_use_id'
  ) THEN
    RAISE EXCEPTION 'mig 309: tool_use_id column did not get added';
  END IF;
END $verify$;

COMMIT;
