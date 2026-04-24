-- Migration 153 — Restore GRANT EXECUTE on aggregate_earnings to authenticated.
--
-- Context
-- -------
-- Migration 152 grouped aggregate_earnings with trigger helpers and revoked
-- anon+authenticated+public EXECUTE. R2 audit caught the error: this function
-- is NOT a trigger helper — it's a regular RPC called from lib/api/commissions.ts:283
-- via db().rpc('aggregate_earnings', ...) which runs as `authenticated`.
--
-- Restoring EXECUTE for authenticated only. Anon stays revoked — there's no
-- legitimate unauthenticated caller for earnings summary data.
--
-- Impact of the original 152 revoke: loadEarningsSummary() in the sales /
-- commissions UI would have returned rpcError on every call, forcing the
-- client-side fallback aggregation (which walks 10K+ rows into JS).
-- Functional regression, not data loss.

GRANT EXECUTE ON FUNCTION public.aggregate_earnings(text, uuid, text, text) TO authenticated;
