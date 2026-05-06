-- Audit-rotation 2026-05 cron-jobs-fanout — Critical 1.
--
-- Before: lib/partner-api/events/fanout.ts:40-89 reads up to 100 unfanned
-- rows, fans out, then UPDATEs each. Two concurrent fanout workers (Vercel
-- routinely double-fires the same cron + retries on 5xx) can both read the
-- SAME 100 rows and double-deliver every event. Subscribers depending on
-- `event_id` for idempotency catch the double; subscribers that aren't
-- strictly idempotent fire side effects twice.
--
-- The audit scope brief asserted the code uses FOR UPDATE SKIP LOCKED. It
-- does not — there is no lock at all today.
--
-- Fix:
--   1. Add `claimed_at` to track in-flight (separate from `fanned_out_at`
--      which marks success).
--   2. RPC partner_event_outbox_claim_batch atomically claims a batch via
--      FOR UPDATE SKIP LOCKED inside a CTE. Concurrent callers see disjoint
--      batches.
--   3. Stale-claim re-take: a row claimed > 5 minutes ago without a
--      fanned_out_at is treated as orphaned (Vercel killed mid-delivery)
--      and eligible for re-claim. Bounds blast radius on worker crashes
--      without introducing a full DLQ.
--
-- A proper persistent retry queue + DLQ is High 1 from the same audit and
-- needs its own design + table.

ALTER TABLE public.partner_event_outbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_partner_event_outbox_claimable
  ON public.partner_event_outbox (emitted_at)
  WHERE fanned_out_at IS NULL;

COMMENT ON COLUMN public.partner_event_outbox.claimed_at IS
  'Set when a fanout worker claims the row for delivery. Cleared (well, ignored)
   once fanned_out_at is set. A row with claimed_at older than 5 minutes and
   fanned_out_at NULL is treated as orphaned (worker crashed) and re-claimable.';

-- Atomic batch claim. Concurrent callers get disjoint batches via
-- FOR UPDATE SKIP LOCKED. Stale-claim window: 5 minutes.
CREATE OR REPLACE FUNCTION public.partner_event_outbox_claim_batch(
  p_limit int DEFAULT 100,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  id uuid,
  event_type text,
  event_id uuid,
  payload jsonb,
  emitted_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT eo.id
    FROM public.partner_event_outbox eo
    WHERE eo.fanned_out_at IS NULL
      AND (eo.claimed_at IS NULL OR eo.claimed_at < p_now - interval '5 minutes')
    ORDER BY eo.emitted_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.partner_event_outbox eo
  SET claimed_at = p_now
  FROM claimed
  WHERE eo.id = claimed.id
  RETURNING eo.id, eo.event_type, eo.event_id, eo.payload, eo.emitted_at;
END;
$$;

-- Service-role only. Anon / authenticated must not be able to drain the
-- outbox; this RPC is for the cron worker via SUPABASE_SECRET_KEY.
REVOKE ALL ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) FROM authenticated;

COMMENT ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) IS
  'Atomically claim a batch of unfanned outbox rows via FOR UPDATE SKIP LOCKED.
   Stale claims (>5min old, still no fanned_out_at) are re-claimable. Service-
   role only — never expose to anon/authenticated. (Audit 2026-05 cron-fanout C1.)';
