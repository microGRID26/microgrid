-- Phase 7a — per-project opt-in flag for the sld-v2 PDF/SVG pipeline.
-- Phase 6 wired the v2 route behind URL ?sld=v2 / env SLD_V2_DEFAULT=1.
-- This column gives the third opt-in path for production rollout
-- (one project at a time, no env-wide blast radius).

ALTER TABLE projects
  ADD COLUMN use_sld_v2 boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN projects.use_sld_v2 IS
  'When true, this project renders SLDs via the v2 pipeline '
  '(lib/sld-v2/* + components/planset-v2/*). Default false keeps v1.';
