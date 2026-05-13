-- Migration 305: Seer Atlas Phase 3 — confirmation-chip pending queue
--
-- When Atlas calls a confirm-chip tool (file_action, close_action,
-- mark_concept_known, add_recap), the edge function INSERTs a row here
-- with status='pending' and returns the tool_id to the client. The UI
-- renders a confirmation chip; on tap, the client POSTs to /confirm with
-- {tool_id, decision: 'confirm' | 'cancel'}.
--
-- The /confirm handler runs an ATOMIC CLAIM (C1 fix from spec pre-flight):
--   UPDATE seer_atlas_pending_tools
--      SET status='executing'
--    WHERE tool_id=$1
--      AND status='pending'
--      AND expires_at > now()
--      AND user_id = (JWT.sub from request)   -- H3 defense-in-depth
--   RETURNING tool_name, args_json;
--
-- Zero rows returned → handler returns cached result_json if status='executed'
-- (idempotent replay for double-taps / network retries), or error otherwise.
--
-- After successful execution, the row is UPDATEd to status='executed',
-- result_json=<result> — so replay returns the cached result without
-- re-executing the underlying RPC.

BEGIN;

CREATE TABLE IF NOT EXISTS public.seer_atlas_pending_tools (
  tool_id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name   text        NOT NULL,
  args_json   jsonb       NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','executing','executed','cancelled','expired')),
  result_json jsonb,
  summary     text,                            -- human-readable chip label
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seer_atlas_pending_tools_user_status_idx
  ON public.seer_atlas_pending_tools (user_id, status, expires_at);

ALTER TABLE public.seer_atlas_pending_tools ENABLE ROW LEVEL SECURITY;

-- RLS: user can see/update only their own pending rows. Service-role bypasses
-- (the edge function uses service-role client to insert + claim).
DROP POLICY IF EXISTS seer_atlas_pending_tools_owner_select
  ON public.seer_atlas_pending_tools;
CREATE POLICY seer_atlas_pending_tools_owner_select
  ON public.seer_atlas_pending_tools
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS seer_atlas_pending_tools_owner_update
  ON public.seer_atlas_pending_tools;
CREATE POLICY seer_atlas_pending_tools_owner_update
  ON public.seer_atlas_pending_tools
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.seer_atlas_pending_tools FROM PUBLIC;
GRANT SELECT, UPDATE ON public.seer_atlas_pending_tools TO authenticated;

-- Lightweight cleanup function — expired pending rows transition to status='expired'
-- (preserves the audit trail vs deletion). Caller is service-role via pg_cron
-- or an on-demand call during /confirm. Not scheduled in this migration; that's
-- a Phase 4 hygiene task.
CREATE OR REPLACE FUNCTION public.seer_atlas_expire_pending_tools()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_count int;
BEGIN
  UPDATE public.seer_atlas_pending_tools
     SET status = 'expired', updated_at = now()
   WHERE status = 'pending'
     AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.seer_atlas_expire_pending_tools() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_atlas_expire_pending_tools() TO service_role;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='seer_atlas_pending_tools'
  ) THEN
    RAISE EXCEPTION 'seer_atlas_pending_tools table did not get created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname='public' AND tablename='seer_atlas_pending_tools'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'seer_atlas_pending_tools: RLS not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname='seer_atlas_expire_pending_tools'
      AND pronamespace='public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'seer_atlas_expire_pending_tools RPC missing';
  END IF;
END $verify$;

COMMIT;
