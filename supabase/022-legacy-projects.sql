-- 022: LEGACY PROJECTS & LEGACY NOTES TABLES
-- Retroactive migration — these tables were created directly in production Supabase.
-- This file documents the schema for version control purposes.
--
-- legacy_projects: 14,705 In Service projects imported from TriSMART/NetSuite
-- legacy_notes: 150,633 BluChat messages for 8,299 legacy projects
--
-- Import scripts: scripts/import-legacy-projects.ts, scripts/upload-legacy-projects.ts,
--                 scripts/upload-legacy-notes.ts

-- ── legacy_projects ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.legacy_projects (
  id              TEXT PRIMARY KEY,            -- PROJ-XXXXX format
  ns_internal_id  TEXT,                        -- NetSuite internal ID
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  lat             NUMERIC,
  lon             NUMERIC,
  systemkw        NUMERIC,
  module          TEXT,
  module_qty      NUMERIC,
  inverter        TEXT,
  inverter_qty    NUMERIC,
  battery         TEXT,
  battery_qty     NUMERIC,
  contract        NUMERIC,
  financier       TEXT,
  financing_type  TEXT,
  dealer          TEXT,
  advisor         TEXT,
  consultant      TEXT,
  pm              TEXT,
  sale_date       TEXT,                        -- stored as text (ISO date string)
  survey_date     TEXT,
  install_date    TEXT,
  pto_date        TEXT,
  in_service_date TEXT,
  disposition     TEXT,
  ahj             TEXT,
  utility         TEXT,
  hoa             TEXT,
  permit_number   TEXT,
  utility_app_number TEXT,
  voltage         TEXT,
  msp_bus_rating  TEXT,
  main_breaker    TEXT,
  stage           TEXT NOT NULL,
  stage_date      TEXT,
  -- Funding fields (merged from project_funding)
  m2_amount       NUMERIC,
  m2_funded_date  TEXT,
  m3_amount       NUMERIC,
  m3_funded_date  TEXT
);

-- RLS: read-only for all authenticated users
ALTER TABLE public.legacy_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "legacy_projects_select" ON public.legacy_projects
  FOR SELECT TO authenticated USING (true);

-- ── legacy_notes ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.legacy_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  TEXT NOT NULL REFERENCES public.legacy_projects(id),
  author      TEXT,
  message     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS: read for all authenticated, insert for all authenticated
ALTER TABLE public.legacy_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "legacy_notes_select" ON public.legacy_notes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "legacy_notes_insert" ON public.legacy_notes
  FOR INSERT TO authenticated WITH CHECK (true);

-- Indexes for search and lookup
CREATE INDEX IF NOT EXISTS idx_legacy_projects_name ON public.legacy_projects (name);
CREATE INDEX IF NOT EXISTS idx_legacy_projects_city ON public.legacy_projects (city);
CREATE INDEX IF NOT EXISTS idx_legacy_notes_project_id ON public.legacy_notes (project_id);
