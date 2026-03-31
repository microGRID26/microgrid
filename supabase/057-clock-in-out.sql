-- Migration 057: Clock In/Out for field crews
-- Tracks crew arrival/departure at job sites with GPS coordinates

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_name TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  schedule_id UUID,
  work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  clock_in_lat NUMERIC(10,7),
  clock_in_lng NUMERIC(10,7),
  clock_out_lat NUMERIC(10,7),
  clock_out_lng NUMERIC(10,7),
  duration_minutes INTEGER, -- computed on clock_out
  notes TEXT,
  job_type TEXT, -- survey/install/inspection/service
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_date ON time_entries(clock_in DESC);
CREATE INDEX IF NOT EXISTS idx_time_open ON time_entries(user_id) WHERE clock_out IS NULL;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY te_select ON time_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY te_insert ON time_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY te_update ON time_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
