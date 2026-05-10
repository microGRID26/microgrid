-- atlas_audit_rotation_state
-- Mirror of ~/.claude/data/audit_rotation.json so the on-deck route can read
-- audit-rotation status from Postgres instead of needing filesystem access.
-- Collector script (Phase 1) keeps this in sync via the ingest endpoint.

create table if not exists public.atlas_audit_rotation_state (
  slug text primary key,
  last_audited_at date,
  next_due_at date,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.atlas_audit_rotation_state enable row level security;
-- Default deny: no policies. Service role bypasses; SECURITY DEFINER RPCs are the read path.
revoke all on public.atlas_audit_rotation_state from anon, authenticated;
