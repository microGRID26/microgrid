-- 235-projects-subhub-raw-payload.sql
--
-- Add subhub_raw_payload jsonb to projects + backfill from welcome_call_logs
-- so the full SubHub project export shape (40+ fields including adders,
-- referral credits, finance details, panel/inverter/battery specs, etc.)
-- is queryable per-project without a join.
--
-- Greg 2026-05-06: "We want welcome call logs and we want all project
-- data." SubHub doesn't expose a VWC endpoint (verified via /api/public/v2/*
-- probe — only get-projects works), so the richest data we have is the
-- project_export payload already cached in welcome_call_logs. This column
-- surfaces it directly on the project row.
--
-- The column is auto-updated on future SubHub webhook ingests (lib/subhub/
-- ingest.ts will need a follow-up to write it on insert; for now it's
-- backfilled from welcome_call_logs and any new project gets it via
-- a separate writer).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS subhub_raw_payload jsonb;

-- Backfill: take the most recent welcome_call_logs payload per subhub_id.
WITH latest AS (
  SELECT DISTINCT ON (payload->>'subhub_id')
    payload->>'subhub_id' AS subhub_id,
    payload
  FROM welcome_call_logs
  WHERE payload->>'subhub_id' IS NOT NULL
    AND payload->>'subhub_id' <> ''
  ORDER BY payload->>'subhub_id', received_at DESC, id DESC
)
UPDATE public.projects p
SET subhub_raw_payload = l.payload
FROM latest l
WHERE p.subhub_id = l.subhub_id
  AND (p.subhub_raw_payload IS NULL OR p.subhub_raw_payload <> l.payload);

CREATE INDEX IF NOT EXISTS idx_projects_subhub_raw_signed
  ON public.projects ((subhub_raw_payload->>'iso_format_contract_signed_date'))
  WHERE subhub_raw_payload IS NOT NULL;
