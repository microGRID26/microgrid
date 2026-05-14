-- 326-atlas-maturity-webhook-deliveries-ttl.sql
--
-- Codebase Maturity chain v1.45 — TTL + index on atlas_maturity_webhook_deliveries.
--
-- The table grows monotonically (PK on GitHub's delivery-id, one row per
-- push webhook). Without sweep it will accrete forever; deferred at v1.44
-- as "schedule when >30K rows." Proactive sweep is cheaper than reactive.
--
-- Retention: 14 days. The table's only job is replay-defense for any
-- given delivery-id; 14d is well past GitHub's redelivery window (max 24h
-- per their docs) and past any reasonable attacker-replay scenario.
--
-- Sweep: pg_cron daily at 03:17 UTC (offset off cron-busy minutes).
--
-- Index: received_at supports the cleanup scan; without it the daily
-- DELETE seq-scans the whole table.

-- 1. Index (idempotent)
CREATE INDEX IF NOT EXISTS idx_atlas_maturity_webhook_deliveries_received_at
  ON public.atlas_maturity_webhook_deliveries (received_at);

-- 2. Schedule the daily sweep. Idempotent via pre-check on cron.job: only
-- unschedule when the job actually exists (R1 narrowed from blanket
-- EXCEPTION WHEN OTHERS, which would have swallowed permission/syntax
-- errors instead of just the missing-job case).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'atlas-maturity-webhook-deliveries-ttl') THEN
    PERFORM cron.unschedule('atlas-maturity-webhook-deliveries-ttl');
  END IF;
END
$$;

-- R1 (migration-planner) edit: prepend `SET LOCAL search_path = public, pg_temp;`
-- to the scheduled command string, matching the sibling job convention.
-- Defense-in-depth against search_path hijack at cron-fire time.
SELECT cron.schedule(
  'atlas-maturity-webhook-deliveries-ttl',
  '17 3 * * *',
  $$SET LOCAL search_path = public, pg_temp; DELETE FROM public.atlas_maturity_webhook_deliveries WHERE received_at < now() - interval '14 days'$$
);
