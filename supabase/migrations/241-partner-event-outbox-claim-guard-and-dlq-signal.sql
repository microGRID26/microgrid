-- Audit follow-ups #573 (silent DLQ) + #574 (cap-race via stale-reclaim).
--
-- Two co-dependent fixes to the partner_event_outbox fanout, paired in one
-- migration because the code change in lib/partner-api/events/fanout.ts has
-- to switch RPC contracts atomically.
--
-- ## #574 — claim-ownership guard
--
-- Today's race:
--   1. worker A claim_batch at T1 → sets claimed_at = T1
--   2. A hangs >5 min mid-fanout
--   3. worker B claim_batch at T2 (>T1+5m) → sees claimed_at < T2-5m, claims,
--      sets claimed_at = T2
--   4. A finally returns, calls record_attempt → unconditional UPDATE WHERE
--      id = p_id, double-increments delivery_attempts. Net: 4 real failures
--      hit the 5-attempt DLQ cap instead of 5.
--
-- Fix: claim_batch returns claimed_at; caller passes it to record_attempt as
-- p_expected_claimed_at; record_attempt UPDATE bails if claimed_at no longer
-- matches. A's record_attempt no-ops; B's record_attempt is the only one
-- that wins.
--
-- ## #573 — DLQ signal
--
-- Today record_attempt returns void. When it triggers the cap path
-- (delivery_attempts >= 5 with p_all_ok false → force-stamp fanned_out_at),
-- the caller can't distinguish that from a successful pass. Fleet status on
-- the partner-event-fanout cron reports 'success' even when N events were
-- silently abandoned.
--
-- Fix: record_attempt returns boolean dlqed (true iff this call hit the cap
-- path). fanout.ts aggregates events_dlqed; route.ts forces fleet status to
-- 'error' when events_dlqed > 0.
--
-- ## Backward compatibility
--
-- p_expected_claimed_at gets DEFAULT NULL so a deploy where the new RPC is
-- live but code is still on the old call shape no-ops the guard rather than
-- erroring out. Same trick for return type: supabase-js callers that ignored
-- `data` still work; new callers consume the boolean.

BEGIN;

-- ---------------------------------------------------------------------------
-- claim_batch: add claimed_at to RETURNS TABLE so the caller can guard.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.partner_event_outbox_claim_batch(int, timestamptz);

CREATE OR REPLACE FUNCTION public.partner_event_outbox_claim_batch(
  p_limit int DEFAULT 100,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  id uuid,
  event_type text,
  event_id uuid,
  payload jsonb,
  emitted_at timestamptz,
  claimed_at timestamptz
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
  RETURNING eo.id, eo.event_type, eo.event_id, eo.payload, eo.emitted_at, eo.claimed_at;
END;
$$;

COMMENT ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) IS
  'Atomic batch claim via FOR UPDATE SKIP LOCKED. Returns claimed_at so the caller can pass it to record_attempt as a stale-reclaim guard (#574).';

REVOKE ALL ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_event_outbox_claim_batch(int, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- record_attempt: add p_expected_claimed_at guard (#574) + return dlqed (#573).
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.partner_event_outbox_record_attempt(uuid, boolean, int, timestamptz);

CREATE OR REPLACE FUNCTION public.partner_event_outbox_record_attempt(
  p_id uuid,
  p_all_ok boolean,
  p_expected_claimed_at timestamptz DEFAULT NULL,
  p_max_attempts int DEFAULT 5,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dlqed boolean := false;
BEGIN
  -- Guards:
  --   * claimed_at IS NOT DISTINCT FROM p_expected_claimed_at — defeats #574
  --     stale-reclaim cap-race. NULL p_expected_claimed_at preserves the old
  --     unguarded behavior (transition window between RPC apply + code deploy).
  --   * fanned_out_at IS NULL — never re-process a finalized row. Pre-existing
  --     fix would have over-inflated delivery_attempts on retry of a capped
  --     row; cheap to add now.
  UPDATE public.partner_event_outbox
  SET delivery_attempts = delivery_attempts + 1,
      fanned_out_at = CASE
        WHEN p_all_ok OR delivery_attempts + 1 >= p_max_attempts THEN p_now
        ELSE fanned_out_at
      END
  WHERE id = p_id
    AND fanned_out_at IS NULL
    AND (p_expected_claimed_at IS NULL
         OR claimed_at IS NOT DISTINCT FROM p_expected_claimed_at)
  RETURNING (NOT p_all_ok AND delivery_attempts >= p_max_attempts)
  INTO v_dlqed;

  RETURN COALESCE(v_dlqed, false);
END;
$$;

COMMENT ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) IS
  'Atomic increment + conditional fanned_out_at stamp. Guarded by claimed_at to defeat stale-reclaim cap-race (#574). Returns true iff this call DLQ-capped the row (#573). Service-role only.';

REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) TO service_role;

COMMIT;
