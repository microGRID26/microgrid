-- Audit follow-up #575 M3.
--
-- Today's behavior (mig 241): when record_attempt stamps fanned_out_at (either
-- because allOk OR delivery_attempts hit the 5-attempt cap), claimed_at is
-- left at whatever value the most recent claim_batch set. The row stays
-- "claimed by a worker that's no longer working on it." Pollutes the
-- diagnostics view — anything that joins on claimed_at to see "what's still
-- being worked on?" gets false positives on finalized rows.
--
-- Fix: NULL claimed_at in the same UPDATE branch that stamps fanned_out_at.
-- Once fanned_out_at IS NOT NULL, claimed_at carries no meaning anyway —
-- the row is terminal (either delivered or DLQed).
--
-- This is non-breaking:
--   * The stale-reclaim WHERE in claim_batch checks `fanned_out_at IS NULL`
--     first (mig 226 line 71), so a finalized row never goes back into the
--     claim pool regardless of claimed_at value.
--   * The cap-race guard in record_attempt itself depends on the IN-FLIGHT
--     value of claimed_at (worker A's UPDATE bails if a stale-reclaim swapped
--     it under A's feet). NULLing it AFTER the UPDATE wins doesn't affect
--     the guard — by then A has already committed and B's record_attempt is
--     the only one that could fire next.
--   * The partial index `idx_outbox_retrying` (mig 227) filters on
--     `fanned_out_at IS NULL AND delivery_attempts > 0`, doesn't reference
--     claimed_at, so its postings aren't affected.

BEGIN;

DROP FUNCTION IF EXISTS public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz);

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
  UPDATE public.partner_event_outbox
  SET delivery_attempts = delivery_attempts + 1,
      fanned_out_at = CASE
        WHEN p_all_ok OR delivery_attempts + 1 >= p_max_attempts THEN p_now
        ELSE fanned_out_at
      END,
      -- #575 M3: when the row reaches a terminal state (delivered or DLQed)
      -- clear claimed_at so diagnostics joins don't see ghost claims on
      -- finalized rows. On non-terminal updates leave claimed_at alone so
      -- stale-reclaim semantics continue to function.
      claimed_at = CASE
        WHEN p_all_ok OR delivery_attempts + 1 >= p_max_attempts THEN NULL
        ELSE claimed_at
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
  'Atomic increment + conditional fanned_out_at stamp. Guarded by claimed_at to defeat stale-reclaim cap-race (#574). Returns true iff this call DLQ-capped the row (#573). NULLs claimed_at on terminal transition so diagnostics joins do not see ghost claims (#575 M3). Service-role only.';

REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.partner_event_outbox_record_attempt(uuid, boolean, timestamptz, int, timestamptz) TO service_role;

COMMIT;
