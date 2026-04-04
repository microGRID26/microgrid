-- 072: Add org_id to schedule table for direct multi-tenant filtering
-- Currently schedule relies on EXISTS subquery via project_id → projects.org_id
-- Adding direct org_id enables faster filtering and catches orphaned entries

-- Add column
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id);

-- Backfill from projects table
UPDATE schedule s
SET org_id = p.org_id
FROM projects p
WHERE s.project_id = p.id
AND s.org_id IS NULL;

-- Backfill any remaining (orphaned entries) to default org
UPDATE schedule
SET org_id = 'a0000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;

-- Create index for org-scoped queries
CREATE INDEX IF NOT EXISTS idx_schedule_org_id ON schedule(org_id);

-- Update RLS: add direct org_id check alongside existing project-based policy
DROP POLICY IF EXISTS "schedule_select_v2" ON schedule;
CREATE POLICY "schedule_select_v3" ON schedule FOR SELECT TO authenticated
  USING (
    org_id IS NULL
    OR org_id = ANY(auth_user_org_ids())
    OR auth_is_platform_user()
  );
