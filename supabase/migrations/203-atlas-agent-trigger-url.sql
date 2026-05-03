-- Add `trigger_url` column to atlas_agents and backfill known crons.
--
-- Greg's ask 2026-04-29 (Phase-3 follow-up of /intel redesign): the
-- "Run now" button on the Agent Runs page only worked for 3 SENTINEL
-- agents because the trigger map was hardcoded in TypeScript. Greg
-- wants every cron agent to be triggerable from HQ. The hardcoded
-- map doesn't scale — moves to data.
--
-- Shape: `trigger_url` is the cron's path relative to its host project
-- (e.g. `/api/cron/morning-digest`). The trigger route resolves the
-- host base URL + secret based on `owner_project`. Storing the
-- relative path keeps the column stable across env (dev/preview/prod
-- only differ in base URL, not in the path).
--
-- NULL = not triggerable (reactive agents, or agents whose cron
-- endpoint hasn't been registered yet).
--
-- Reactive agents (hq-atlas-ambient, hq-atlas-chat, hq-release-summaries)
-- intentionally stay NULL — they fire on user/event activity, not on a
-- "run now" button.

ALTER TABLE atlas_agents
  ADD COLUMN IF NOT EXISTS trigger_url text;

-- Backfill ATLAS HQ self-hosted crons. Paths verified against
-- ATLAS-HQ/vercel.json `crons` block.
UPDATE atlas_agents SET trigger_url = '/api/cron/refresh-cache'      WHERE slug = 'hq-refresh-cache';
UPDATE atlas_agents SET trigger_url = '/api/cron/capture-snapshots'  WHERE slug = 'hq-capture-snapshots';
UPDATE atlas_agents SET trigger_url = '/api/cron/morning-digest'     WHERE slug = 'hq-morning-digest';
UPDATE atlas_agents SET trigger_url = '/api/cron/cost-monitor'       WHERE slug = 'hq-cost-monitor';
UPDATE atlas_agents SET trigger_url = '/api/cron/qa-autofix'         WHERE slug = 'hq-qa-autofix';
UPDATE atlas_agents SET trigger_url = '/api/cron/spark-test-failures' WHERE slug = 'hq-spark-test-failures';
UPDATE atlas_agents SET trigger_url = '/api/cron/feedback-monitor'   WHERE slug = 'hq-feedback-monitor';
UPDATE atlas_agents SET trigger_url = '/api/cron/feedback-fixer'     WHERE slug = 'hq-feedback-fixer';
UPDATE atlas_agents SET trigger_url = '/api/cron/meeting-ingest'     WHERE slug = 'hq-meeting-ingest';

-- SENTINEL crons (hosted on SENTINEL_URL; trigger route appends path).
UPDATE atlas_agents SET trigger_url = '/api/cron/collect' WHERE slug = 'sentinel-collect';
UPDATE atlas_agents SET trigger_url = '/api/cron/digest'  WHERE slug = 'sentinel-digest';

-- MicroGRID crons left NULL — different host, different cron secret
-- (MICROGRID_URL + MICROGRID_CRON_SECRET need to be set in Vercel env
-- before triggering remotely). Once those exist, backfill these slugs:
--   mg-email-digest               → /api/cron/email-digest
--   mg-email-onboarding-reminder  → /api/cron/email-onboarding-reminder
--   mg-email-send-daily           → /api/cron/email-send-daily
--   mg-qa-runs-cleanup            → /api/cron/qa-runs-cleanup
