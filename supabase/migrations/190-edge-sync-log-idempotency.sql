-- Migration 190: edge_sync_log idempotency hardening
--
-- Closes greg_action #378 (audit-rotation 2026-04-28 webhook-signing-replay,
-- High #2). The EDGE webhook handler at app/api/webhooks/edge/route.ts
-- previously did a racy SELECT-then-INSERT against edge_sync_log; concurrent
-- replays of a valid signed payload within the 5-min window both passed the
-- SELECT and wrote duplicate audit_log + edge_sync_log rows.
--
-- Fix: add a `request_id` column + partial unique index on
-- (project_id, event_type, request_id) WHERE direction='inbound' AND
-- request_id IS NOT NULL. App computes request_id server-side as
-- X-EDGE-Event-Id header if present, else sha256(bodyText). Handler switches
-- to INSERT ... ON CONFLICT DO NOTHING. The partial predicate matches zero
-- existing rows (all 23 are direction='outbound' with NULL request_id) so
-- the schema is forward-compatible — schema can ship before app code.
--
-- Migration-planner verdict (2026-04-28): SAFE. ALTER TABLE ADD COLUMN text
-- NULL is metadata-only at PG 11+. CREATE UNIQUE INDEX on 8kB heap completes
-- sub-millisecond. No CONCURRENTLY needed.

ALTER TABLE public.edge_sync_log
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS edge_sync_log_inbound_request_id_uniq
  ON public.edge_sync_log (project_id, event_type, request_id)
  WHERE direction = 'inbound' AND request_id IS NOT NULL;
