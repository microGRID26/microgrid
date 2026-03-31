-- Migration 058: Saved queries for Atlas reports
-- Users can save, name, and re-run queries from the reports page

CREATE TABLE IF NOT EXISTS saved_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  query_text TEXT NOT NULL, -- the natural language question
  created_by TEXT NOT NULL,
  created_by_name TEXT,
  shared BOOLEAN DEFAULT false, -- visible to all users
  run_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sq_created_by ON saved_queries(created_by);
CREATE INDEX IF NOT EXISTS idx_sq_shared ON saved_queries(shared) WHERE shared = true;

ALTER TABLE saved_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY sq_select ON saved_queries FOR SELECT TO authenticated
  USING (created_by = auth.uid()::text OR shared = true OR auth_is_admin());
CREATE POLICY sq_insert ON saved_queries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sq_update ON saved_queries FOR UPDATE TO authenticated
  USING (created_by = auth.uid()::text OR auth_is_admin());
CREATE POLICY sq_delete ON saved_queries FOR DELETE TO authenticated
  USING (created_by = auth.uid()::text OR auth_is_admin());
