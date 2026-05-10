-- atlas_codebase_maturity_snapshots
-- One row per (project, axis, captured_at). Idempotent INSERT via the (captured_at, project_slug, axis) unique constraint.

create table if not exists public.atlas_codebase_maturity_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null,
  project_slug text not null,
  project_tier text not null check (project_tier in ('core','ops','personal','dormant')),
  axis text not null check (axis in ('typecheck','rls','audit','velocity','ci')),
  raw_value jsonb not null,
  score int,
  weighted_score int,
  source text not null check (source in ('collector','manual_refresh','gh_actions')),
  created_at timestamptz not null default now(),
  unique (captured_at, project_slug, axis)
);

create index if not exists idx_maturity_snap_project_time
  on public.atlas_codebase_maturity_snapshots (project_slug, captured_at desc);

create index if not exists idx_maturity_snap_captured_at
  on public.atlas_codebase_maturity_snapshots (captured_at);

alter table public.atlas_codebase_maturity_snapshots enable row level security;
-- Default deny: no policies. Service role bypasses; SECURITY DEFINER RPCs are the read path.
revoke all on public.atlas_codebase_maturity_snapshots from anon, authenticated;
