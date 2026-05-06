-- Audit 2026-05 cron-fanout High 1 / action #553.
--
-- Cheapest viable DLQ: track delivery attempt count per outbox row, and let
-- the existing claim-RPC stale-reclaim window (5 min, migration 226) drive
-- retries. Today fanout.ts unconditionally stamps fanned_out_at after the
-- per-event loop — so a partner 5xx / timeout means the event is permanently
-- lost. After this migration + the fanout.ts change in the same commit:
--
--   - Each fanout pass over an event increments delivery_attempts
--   - fanned_out_at is stamped only when ALL deliveries succeed OR
--     delivery_attempts >= 5 (effective give-up: status='failed_permanent'
--     in the action body's option-2 vocabulary)
--   - Failed events stay claimable on the next stale-reclaim cycle (every
--     5 min) until they succeed or hit the cap
--
-- Trades: per-event retries (not per-(event, partner)). If partner A
-- succeeded but partner B failed, the next attempt re-delivers to BOTH —
-- partners are required to be idempotent on event_id, which the signed
-- payload already enables. This is acknowledged in the action body's
-- option-1 description.
--
-- The richer per-(event, partner) DLQ table from migration 109 exists but
-- is unused (registry is env-driven, not subscription-driven). Wiring that
-- up is a Phase 4 follow-up; today's job is to stop losing events.

BEGIN;

ALTER TABLE public.partner_event_outbox
  ADD COLUMN IF NOT EXISTS delivery_attempts int NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.partner_event_outbox.delivery_attempts IS
  'Count of fanout-cron passes. fanout.ts increments per pass and stamps fanned_out_at after all deliveries succeed OR after 5 attempts (effective give-up). #553.';

-- Observability: how many events are stuck retrying right now?
CREATE INDEX IF NOT EXISTS idx_outbox_retrying
  ON public.partner_event_outbox (delivery_attempts)
  WHERE fanned_out_at IS NULL AND delivery_attempts > 0;

-- Helper RPC: atomically increment attempts and conditionally stamp
-- fanned_out_at. Called by fanout.ts after each per-event delivery loop.
-- Atomicity matters because delivery_attempts is read+written.
CREATE OR REPLACE FUNCTION public.partner_event_outbox_record_attempt(
  p_id uuid,
  p_all_ok boolean,
  p_max_attempts int DEFAULT 5,
  p_now timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.partner_event_outbox
  SET delivery_attempts = delivery_attempts + 1,
      fanned_out_at = CASE
        WHEN p_all_ok OR delivery_attempts + 1 >= p_max_attempts THEN p_now
        ELSE fanned_out_at
      END
  WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, int, timestamptz) IS
  'Atomic increment + conditional fanned_out_at stamp. Service-role only. #553.';

REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, int, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, int, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, int, timestamptz) TO service_role;

COMMIT;
