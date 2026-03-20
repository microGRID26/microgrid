-- ============================================================================
-- 011-rls-roles.sql — Update RLS policies for role-based permissions
--
-- Changes:
--   1. Manager+ can write to any project (not just PM owner)
--   2. Finance+ can write to project_funding
--   3. DELETE on projects = super_admin only
--   4. Add RLS to task_history table
--   5. Add helper: auth_role_level() for role comparisons
-- ============================================================================

-- Helper: returns numeric role level for comparisons
CREATE OR REPLACE FUNCTION public.auth_role_level()
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT CASE role
      WHEN 'super_admin' THEN 5
      WHEN 'admin' THEN 4
      WHEN 'finance' THEN 3
      WHEN 'manager' THEN 2
      ELSE 1
    END FROM public.users WHERE email = auth.email() LIMIT 1),
    1
  );
$$;

-- Helper: check if user is finance or above
CREATE OR REPLACE FUNCTION public.auth_is_finance()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.auth_role_level() >= 3;
$$;

-- Helper: check if user is manager or above
CREATE OR REPLACE FUNCTION public.auth_is_manager()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT public.auth_role_level() >= 2;
$$;

-- ── Projects: manager+ can update any, delete = super_admin only ──────────

DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE TO authenticated
  USING (pm_id = public.auth_user_id() OR public.auth_is_manager())
  WITH CHECK (pm_id = public.auth_user_id() OR public.auth_is_manager());

DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated
  USING (public.auth_is_super_admin());

-- ── Task State: manager+ or PM owner ─────────────────────────────────────

DROP POLICY IF EXISTS "task_state_write" ON task_state;
CREATE POLICY "task_state_write" ON task_state FOR ALL TO authenticated
  USING (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = task_state.project_id
    AND projects.pm_id = public.auth_user_id()))
  WITH CHECK (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = task_state.project_id
    AND projects.pm_id = public.auth_user_id()));

-- ── Notes: manager+ or PM owner ──────────────────────────────────────────

DROP POLICY IF EXISTS "notes_write" ON notes;
CREATE POLICY "notes_write" ON notes FOR ALL TO authenticated
  USING (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = notes.project_id
    AND projects.pm_id = public.auth_user_id()))
  WITH CHECK (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = notes.project_id
    AND projects.pm_id = public.auth_user_id()));

-- ── Schedule: manager+ or PM owner ───────────────────────────────────────

DROP POLICY IF EXISTS "schedule_write" ON schedule;
CREATE POLICY "schedule_write" ON schedule FOR ALL TO authenticated
  USING (public.auth_is_manager() OR pm_id = public.auth_user_id()
    OR EXISTS (SELECT 1 FROM projects WHERE projects.id = schedule.project_id
    AND projects.pm_id = public.auth_user_id()))
  WITH CHECK (public.auth_is_manager() OR pm_id = public.auth_user_id()
    OR EXISTS (SELECT 1 FROM projects WHERE projects.id = schedule.project_id
    AND projects.pm_id = public.auth_user_id()));

-- ── Stage History: manager+ or PM owner ──────────────────────────────────

DROP POLICY IF EXISTS "stage_history_write" ON stage_history;
CREATE POLICY "stage_history_write" ON stage_history FOR ALL TO authenticated
  USING (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = stage_history.project_id
    AND projects.pm_id = public.auth_user_id()))
  WITH CHECK (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = stage_history.project_id
    AND projects.pm_id = public.auth_user_id()));

-- ── Project Funding: finance+ or PM owner ────────────────────────────────

DROP POLICY IF EXISTS "funding_write" ON project_funding;
CREATE POLICY "funding_write" ON project_funding FOR ALL TO authenticated
  USING (public.auth_is_finance() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = project_funding.project_id
    AND projects.pm_id = public.auth_user_id()))
  WITH CHECK (public.auth_is_finance() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = project_funding.project_id
    AND projects.pm_id = public.auth_user_id()));

-- ── Service Calls: manager+ or PM owner ──────────────────────────────────

DROP POLICY IF EXISTS "service_calls_write" ON service_calls;
CREATE POLICY "service_calls_write" ON service_calls FOR ALL TO authenticated
  USING (public.auth_is_manager() OR pm_id = public.auth_user_id()
    OR EXISTS (SELECT 1 FROM projects WHERE projects.id = service_calls.project_id
    AND projects.pm_id = public.auth_user_id()))
  WITH CHECK (public.auth_is_manager() OR pm_id = public.auth_user_id()
    OR EXISTS (SELECT 1 FROM projects WHERE projects.id = service_calls.project_id
    AND projects.pm_id = public.auth_user_id()));

-- ── Project Folders: manager+ or PM owner ────────────────────────────────

DROP POLICY IF EXISTS "folders_write" ON project_folders;
CREATE POLICY "folders_write" ON project_folders FOR ALL TO authenticated
  USING (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = project_folders.project_id
    AND projects.pm_id = public.auth_user_id()))
  WITH CHECK (public.auth_is_manager() OR EXISTS (
    SELECT 1 FROM projects WHERE projects.id = project_folders.project_id
    AND projects.pm_id = public.auth_user_id()));

-- ── Task History: RLS (all read, all insert — audit trail) ───────────────

ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_history_read" ON public.task_history;
DROP POLICY IF EXISTS "task_history_write" ON public.task_history;
CREATE POLICY "task_history_read" ON public.task_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_history_write" ON public.task_history FOR INSERT TO authenticated WITH CHECK (true);

-- ── Record migration ─────────────────────────────────────────────────────

INSERT INTO migrations_log (name, description) VALUES
  ('011_rls_roles', 'Update RLS policies for 5-level role system: manager+ project write, finance+ funding write, super_admin delete')
ON CONFLICT (name) DO NOTHING;
