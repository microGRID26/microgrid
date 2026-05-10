-- greg_actions.project
-- Adds a nullable text column tagging each action with its owning project slug.
--
-- Stage 1 (this migration, ships now): nullable column + partial index on open rows.
--   Helper script ~/.claude/scripts/greg_actions.py enforces the tag at the CLI layer.
-- Stage 2 (after 7 days of clean writes, separate migration):
--   add CHECK (project IS NOT NULL OR created_at < '2026-05-16') to grandfather legacy nulls.
-- Stage 3 (after 30 days, separate migration):
--   bulk-tag remaining nulls to 'unsorted' + ALTER COLUMN project SET NOT NULL.
--
-- Lock profile for Stage 1: ADD COLUMN with no default + nullable is metadata-only since
-- Postgres 11 (no table rewrite, brief AccessExclusive on catalog only).
-- Partial-index CREATE without CONCURRENTLY takes ShareLock — blocks writes briefly but
-- is fast against current row count (~hundreds, not millions). Acceptable.

alter table public.greg_actions
  add column if not exists project text;

create index if not exists idx_greg_actions_project_open
  on public.greg_actions (project)
  where status = 'open';
