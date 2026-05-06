-- Audit R1 high #1 / action #549.
--
-- Atomic claim RPC for the pending_auth_deletions cron. Eliminates the
-- read-modify-write race on `attempts` where two concurrent runs could
-- both read attempts=N and both write N+1, halving the effective retry
-- budget. Same pattern as partner_event_outbox_claim_batch (mig 226).

BEGIN;

CREATE OR REPLACE FUNCTION public.pending_auth_deletions_claim_batch(
  p_limit int DEFAULT 50,
  p_max_attempts int DEFAULT 5,
  p_now timestamptz DEFAULT now()
) RETURNS TABLE (
  auth_user_id uuid,
  customer_account_id uuid,
  reason text,
  attempts int,
  last_attempt_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT pad.auth_user_id AS claimed_id
      FROM public.pending_auth_deletions pad
     WHERE pad.attempts < p_max_attempts
     ORDER BY pad.last_attempt_at ASC NULLS FIRST, pad.auth_user_id ASC
     LIMIT p_limit
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.pending_auth_deletions pad
     SET attempts = pad.attempts + 1,
         last_attempt_at = p_now
    FROM claimed
   WHERE pad.auth_user_id = claimed.claimed_id
  RETURNING pad.auth_user_id, pad.customer_account_id, pad.reason,
            pad.attempts, pad.last_attempt_at, pad.created_at;
END;
$$;

COMMENT ON FUNCTION public.pending_auth_deletions_claim_batch(int, int, timestamptz) IS
  'Atomically claim + bump attempts on due retry rows. SECURITY DEFINER, service-role only. #549.';

REVOKE ALL ON FUNCTION public.pending_auth_deletions_claim_batch(int, int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pending_auth_deletions_claim_batch(int, int, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.pending_auth_deletions_claim_batch(int, int, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pending_auth_deletions_claim_batch(int, int, timestamptz) TO service_role;

COMMIT;
