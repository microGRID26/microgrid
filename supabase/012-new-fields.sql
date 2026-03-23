-- ============================================================================
-- 012-new-fields.sql — Add follow_up_date, reinspection_fee, task notes
-- ============================================================================

-- Follow-up date for PM follow-up queue
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS follow_up_date DATE;

-- Re-inspection fee
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS reinspection_fee NUMERIC;

-- Per-task notes
ALTER TABLE public.task_state ADD COLUMN IF NOT EXISTS notes TEXT;

-- Remove not_eligible default from funding status columns
ALTER TABLE public.project_funding ALTER COLUMN m1_status DROP DEFAULT;
ALTER TABLE public.project_funding ALTER COLUMN m2_status DROP DEFAULT;
ALTER TABLE public.project_funding ALTER COLUMN m3_status DROP DEFAULT;

-- Record migration
INSERT INTO migrations_log (name, description) VALUES
  ('012_new_fields', 'Add follow_up_date, reinspection_fee on projects; notes on task_state; drop not_eligible defaults on funding')
ON CONFLICT (name) DO NOTHING;
