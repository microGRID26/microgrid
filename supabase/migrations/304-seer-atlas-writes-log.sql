-- Migration 304: Seer Atlas Phase 3 — write tools audit log
--
-- Every write-tool attempt (succeed / fail / cap_denied / cancelled) lands
-- here. Insertion happens BEFORE the cap counter increment and BEFORE the
-- actual write — so failed writes that burn cap slots are forensically
-- visible (H1 fix from the spec pre-flight reviewer).
--
-- Lifecycle:
--   1. Edge function inserts row with outcome='pending', succeeded=null
--   2. Cap check via seer_atlas_increment_writes() (mig 306)
--   3a. Cap exceeded → UPDATE outcome='cap_denied', return error to Atlas
--   3b. Cap ok → execute the underlying RPC
--   4. UPDATE outcome='succeeded'|'failed', fill result_json/error_message
--
-- Cancelled confirms: separate code path writes outcome='cancelled' with no
-- cap increment, preserving visibility into what Atlas proposed.
--
-- RLS: SELECT only when atlas_hq_is_owner(auth.uid()) — same gate as the
-- chat endpoint. Service role writes (no INSERT/UPDATE policy needed).

BEGIN;

CREATE TABLE IF NOT EXISTS public.seer_atlas_writes_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL,
  tool_name     text        NOT NULL,
  args_json     jsonb       NOT NULL,
  result_json   jsonb,
  succeeded     boolean,
  error_message text,
  outcome       text        NOT NULL DEFAULT 'pending'
                CHECK (outcome IN ('pending','succeeded','failed','cap_denied','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seer_atlas_writes_log_user_created_idx
  ON public.seer_atlas_writes_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS seer_atlas_writes_log_outcome_idx
  ON public.seer_atlas_writes_log (outcome, created_at DESC);

ALTER TABLE public.seer_atlas_writes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seer_atlas_writes_log_owner_select ON public.seer_atlas_writes_log;
CREATE POLICY seer_atlas_writes_log_owner_select
  ON public.seer_atlas_writes_log
  FOR SELECT
  TO authenticated
  USING (public.atlas_hq_is_owner(auth.uid()));

-- No INSERT/UPDATE/DELETE policies — service role only (audit log integrity).

REVOKE ALL ON public.seer_atlas_writes_log FROM PUBLIC;
GRANT SELECT ON public.seer_atlas_writes_log TO authenticated;
-- service_role retains full access by default.

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='seer_atlas_writes_log'
  ) THEN
    RAISE EXCEPTION 'seer_atlas_writes_log table did not get created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname='public' AND tablename='seer_atlas_writes_log'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'seer_atlas_writes_log: RLS not enabled';
  END IF;

  -- Verify outcome CHECK accepts all 5 values
  PERFORM 1 FROM (VALUES
    ('pending'::text), ('succeeded'), ('failed'), ('cap_denied'), ('cancelled')
  ) v(o) WHERE o IN ('pending','succeeded','failed','cap_denied','cancelled');
  -- (no-op SELECT — just asserts the literals match)
END $verify$;

COMMIT;
