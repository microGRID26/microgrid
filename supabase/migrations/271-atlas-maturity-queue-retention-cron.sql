-- 7-day retention prune for atlas_maturity_refresh_queue.
-- Closes greg_actions #743 (filed v1.2 batch deferred).
--
-- Why pg_cron and not a Vercel cron on atlas-hq:
--   The queue table is in MG (where the SECURITY DEFINER queue RPCs live).
--   Routing the prune through atlas-hq would mean an extra HMAC round-trip and
--   a public-route exemption for a job that's pure SQL on one tenant. pg_cron
--   keeps it in-database, single-statement, with no auth surface to leak.
--
-- Cadence: weekly Sunday 04:00 UTC. Daily would also be fine; weekly matches
-- the handoff ask and limits per-run lock contention. Each request row is
-- ~200 bytes, so even a queue saturated to 1 req/min would fit ~10K rows in
-- a week — the bulk delete is trivial.
--
-- Idempotent: unschedule any prior incarnation before re-creating, so a
-- replay of this migration on a project that already has the job doesn't
-- error or duplicate the entry.
--
-- Naming convention: matches existing seer-feed-prune-daily / seer-daily-reset.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'atlas-maturity-queue-prune-weekly') THEN
    PERFORM cron.unschedule('atlas-maturity-queue-prune-weekly');
  END IF;
END $$;

-- SET LOCAL search_path inside the cron body for parity with the queue SECDEF
-- RPCs (request/claim/complete). pg_cron runs as `postgres` so it's not at risk
-- of search-path hijack today, but explicit > implicit on a job that runs unattended.
SELECT cron.schedule(
  'atlas-maturity-queue-prune-weekly',
  '0 4 * * 0',
  $cron$SET LOCAL search_path = public, pg_temp; DELETE FROM public.atlas_maturity_refresh_queue WHERE requested_at < now() - interval '7 days'$cron$
);
