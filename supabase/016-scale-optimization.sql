-- ============================================================================
-- 016-scale-optimization.sql — Indexes, helper functions, materialized view
-- for handling 10K+ projects without loading everything into the browser
-- ============================================================================

-- ── Phase 1A: Indexes ───────────────────────────────────────────────────────

-- Task state (biggest bottleneck — every page joins on it)
CREATE INDEX IF NOT EXISTS idx_task_state_project_id ON public.task_state (project_id);
CREATE INDEX IF NOT EXISTS idx_task_state_status ON public.task_state (status);
CREATE INDEX IF NOT EXISTS idx_task_state_project_status ON public.task_state (project_id, status);
CREATE INDEX IF NOT EXISTS idx_task_state_follow_up ON public.task_state (follow_up_date) WHERE follow_up_date IS NOT NULL;

-- Projects filtering
CREATE INDEX IF NOT EXISTS idx_projects_pm_id ON public.projects (pm_id);
CREATE INDEX IF NOT EXISTS idx_projects_stage_disposition ON public.projects (stage, disposition);
CREATE INDEX IF NOT EXISTS idx_projects_blocker ON public.projects (blocker) WHERE blocker IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_stage_date ON public.projects (stage_date);

-- Funding
CREATE INDEX IF NOT EXISTS idx_project_funding_status ON public.project_funding (m2_status);

-- Search (trigram for ILIKE performance at scale)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_projects_name_trgm ON public.projects USING gin (name gin_trgm_ops);

-- ── Phase 1B: Helper Functions ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION days_ago(d date)
RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT GREATEST(0, CURRENT_DATE - COALESCE(d, CURRENT_DATE));
$$;

CREATE OR REPLACE FUNCTION cycle_days(sale_date date, stage_date date)
RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN sale_date IS NOT NULL AND (CURRENT_DATE - sale_date) > 0
      THEN CURRENT_DATE - sale_date
    ELSE GREATEST(0, CURRENT_DATE - COALESCE(stage_date, CURRENT_DATE))
  END;
$$;

CREATE OR REPLACE FUNCTION sla_status(p_stage text, p_stage_date date)
RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  d int;
  tgt int; rsk int; crt int;
BEGIN
  d := GREATEST(0, CURRENT_DATE - COALESCE(p_stage_date, CURRENT_DATE));
  SELECT target, risk, crit INTO tgt, rsk, crt
    FROM public.sla_thresholds WHERE stage = p_stage;
  IF NOT FOUND THEN tgt := 999; rsk := 999; crt := 999; END IF;
  IF d >= crt THEN RETURN 'crit';
  ELSIF d >= rsk THEN RETURN 'risk';
  ELSIF d >= tgt THEN RETURN 'warn';
  ELSE RETURN 'ok';
  END IF;
END;
$$;

-- ── Phase 1C: Funding Dashboard View ────────────────────────────────────────

CREATE OR REPLACE VIEW funding_dashboard AS
SELECT
  p.id, p.name, p.city, p.address, p.financier, p.ahj,
  p.install_complete_date, p.pto_date, p.contract, p.sale_date,
  p.stage, p.disposition,
  f.m1_amount, f.m1_funded_date, f.m1_status, f.m1_notes, f.m1_cb, f.m1_cb_credit,
  f.m2_amount, f.m2_funded_date, f.m2_status, f.m2_notes, f.m2_cb, f.m2_cb_credit,
  f.m3_amount, f.m3_funded_date, f.m3_status, f.m3_notes, f.m3_projected,
  f.nonfunded_code_1, f.nonfunded_code_2, f.nonfunded_code_3
FROM projects p
LEFT JOIN project_funding f ON f.project_id = p.id
WHERE p.disposition IS NULL OR p.disposition NOT IN ('In Service', 'Loyalty', 'Cancelled');

-- ── Record migration ────────────────────────────────────────────────────────
INSERT INTO migrations_log (name, description) VALUES
  ('016_scale_optimization', 'Performance indexes, helper functions (days_ago, cycle_days, sla_status), funding_dashboard view')
ON CONFLICT (name) DO NOTHING;
