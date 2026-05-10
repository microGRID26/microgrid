create table if not exists public.atlas_codebase_maturity_dependencies (
  id uuid primary key default gen_random_uuid(),
  from_slug text not null,
  to_slug text not null,
  kind text not null check (kind in ('auth','webhook','shared_db','fan_out','read_only')),
  intensity smallint not null check (intensity between 1 and 5),
  established_at date not null,
  retired_at date,
  unique (from_slug, to_slug, kind)
);

alter table public.atlas_codebase_maturity_dependencies enable row level security;
revoke all on public.atlas_codebase_maturity_dependencies from anon, authenticated;

-- Seed real edges Atlas knows about today
insert into public.atlas_codebase_maturity_dependencies (from_slug, to_slug, kind, intensity, established_at) values
  ('edge','microgrid','webhook',4,'2025-08-01'),
  ('spark','microgrid','fan_out',5,'2025-09-15'),
  ('spark','microgrid','auth',3,'2025-09-15'),
  ('atlas-hq','microgrid','read_only',3,'2025-12-01'),
  ('atlas-hq','edge','read_only',2,'2025-12-01'),
  ('atlas-hq','spark','read_only',2,'2025-12-01'),
  ('paul-hq','microgrid','read_only',2,'2026-02-01'),
  ('paul-hq','edge','read_only',2,'2026-02-01'),
  ('sentinel','microgrid','shared_db',2,'2025-11-01'),
  ('edge-model','edge','read_only',2,'2026-04-01')
on conflict (from_slug, to_slug, kind) do nothing;
