-- ============================================================================
-- RLS Migration for NOVA / MicroGRID CRM
-- This file documents what was run in production. Safe to re-run (idempotent).
--
-- BEFORE RUNNING: Verify all PM names have matching users rows:
--   SELECT DISTINCT p.pm FROM projects p
--   LEFT JOIN users u ON u.name = p.pm
--   WHERE p.pm IS NOT NULL AND u.name IS NULL;
--
-- ROLLBACK: ALTER TABLE public.<table_name> DISABLE ROW LEVEL SECURITY;
-- ============================================================================

-- ── Step 1: Indexes ─────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_projects_pm ON public.projects (pm);

-- ── Step 2: Helper Functions ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_user_name()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT name FROM public.users WHERE email = auth.email() LIMIT 1;
$$;

-- auth_is_admin / provision_user: canonical shape per migration 130
-- (offboarding via users.active=false). Keep in sync with migrations/130.
CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin', 'super_admin')
       FROM public.users
      WHERE email = auth.email()
        AND COALESCE(active, true) = true
      LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.provision_user(p_email TEXT, p_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id      uuid;
  v_active       boolean;
  v_domain       text;
  v_caller_email text;
BEGIN
  v_caller_email := auth.email();
  IF v_caller_email IS NULL OR lower(p_email) <> lower(v_caller_email) THEN
    RAISE EXCEPTION 'provision_user: email mismatch (caller=%, requested=%)',
      v_caller_email, p_email
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.users (email, name, active, admin)
  VALUES (p_email, p_name, true, false)
  ON CONFLICT (email) DO NOTHING;

  SELECT id, COALESCE(active, true) INTO v_user_id, v_active
    FROM public.users WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN RETURN; END IF;
  IF v_active = false THEN RETURN; END IF;

  v_domain := lower(split_part(p_email, '@', 2));
  IF v_domain IS NULL OR v_domain = '' THEN RETURN; END IF;

  INSERT INTO public.org_memberships (user_id, org_id)
  SELECT v_user_id, o.id
  FROM public.organizations o
  WHERE o.active = true
    AND o.allowed_domains IS NOT NULL
    AND v_domain = ANY (o.allowed_domains)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.cascade_user_name_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name THEN
    UPDATE projects SET pm = NEW.name WHERE pm = OLD.name;
    UPDATE notes SET pm = NEW.name WHERE pm = OLD.name;
    UPDATE schedule SET pm = NEW.name WHERE pm = OLD.name;
    UPDATE service_calls SET pm = NEW.name WHERE pm = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_user_name ON public.users;
CREATE TRIGGER trg_cascade_user_name
  AFTER UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.cascade_user_name_change();

-- ── Step 3: Drop existing policies (idempotent) ────────────────────────────

DO $$ BEGIN
  DROP POLICY IF EXISTS "ahjs_read" ON public.ahjs;
  DROP POLICY IF EXISTS "ahjs_write" ON public.ahjs;
  DROP POLICY IF EXISTS "utilities_read" ON public.utilities;
  DROP POLICY IF EXISTS "utilities_write" ON public.utilities;
  DROP POLICY IF EXISTS "crews_read" ON public.crews;
  DROP POLICY IF EXISTS "crews_write" ON public.crews;
  DROP POLICY IF EXISTS "sla_read" ON public.sla_thresholds;
  DROP POLICY IF EXISTS "sla_write" ON public.sla_thresholds;
  DROP POLICY IF EXISTS "users_read" ON public.users;
  DROP POLICY IF EXISTS "users_write" ON public.users;
  DROP POLICY IF EXISTS "nf_codes_read" ON public.nonfunded_codes;
  DROP POLICY IF EXISTS "nf_codes_write" ON public.nonfunded_codes;
  DROP POLICY IF EXISTS "projects_read" ON public.projects;
  DROP POLICY IF EXISTS "projects_update" ON public.projects;
  DROP POLICY IF EXISTS "projects_insert" ON public.projects;
  DROP POLICY IF EXISTS "projects_delete" ON public.projects;
  DROP POLICY IF EXISTS "task_state_read" ON public.task_state;
  DROP POLICY IF EXISTS "task_state_write" ON public.task_state;
  DROP POLICY IF EXISTS "notes_read" ON public.notes;
  DROP POLICY IF EXISTS "notes_write" ON public.notes;
  DROP POLICY IF EXISTS "schedule_read" ON public.schedule;
  DROP POLICY IF EXISTS "schedule_write" ON public.schedule;
  DROP POLICY IF EXISTS "stage_history_read" ON public.stage_history;
  DROP POLICY IF EXISTS "stage_history_write" ON public.stage_history;
  DROP POLICY IF EXISTS "funding_read" ON public.project_funding;
  DROP POLICY IF EXISTS "funding_write" ON public.project_funding;
  DROP POLICY IF EXISTS "service_calls_read" ON public.service_calls;
  DROP POLICY IF EXISTS "service_calls_write" ON public.service_calls;
  DROP POLICY IF EXISTS "folders_read" ON public.project_folders;
  DROP POLICY IF EXISTS "folders_write" ON public.project_folders;
END $$;

-- ── Step 4: Reference Tables (all read, admin write) ───────────────────────

ALTER TABLE public.ahjs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ahjs_read" ON public.ahjs FOR SELECT TO authenticated USING (true);
CREATE POLICY "ahjs_write" ON public.ahjs FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

ALTER TABLE public.utilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "utilities_read" ON public.utilities FOR SELECT TO authenticated USING (true);
CREATE POLICY "utilities_write" ON public.utilities FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crews_read" ON public.crews FOR SELECT TO authenticated USING (true);
CREATE POLICY "crews_write" ON public.crews FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

ALTER TABLE public.sla_thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sla_read" ON public.sla_thresholds FOR SELECT TO authenticated USING (true);
CREATE POLICY "sla_write" ON public.sla_thresholds FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_read" ON public.users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_write" ON public.users FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

ALTER TABLE public.nonfunded_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nf_codes_read" ON public.nonfunded_codes FOR SELECT TO authenticated USING (true);
CREATE POLICY "nf_codes_write" ON public.nonfunded_codes FOR ALL TO authenticated USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

-- ── Step 5: Project-Scoped Tables (all read, PM/admin write) ───────────────

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_read" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_update" ON public.projects FOR UPDATE TO authenticated USING (pm = public.auth_user_name() OR public.auth_is_admin()) WITH CHECK (pm = public.auth_user_name() OR public.auth_is_admin());
CREATE POLICY "projects_insert" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.auth_is_admin());
CREATE POLICY "projects_delete" ON public.projects FOR DELETE TO authenticated USING (public.auth_is_admin());

ALTER TABLE public.task_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_state_read" ON public.task_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_state_write" ON public.task_state FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = task_state.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin()))) WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = task_state.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin())));

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_read" ON public.notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "notes_write" ON public.notes FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = notes.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin()))) WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = notes.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin())));

ALTER TABLE public.schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedule_read" ON public.schedule FOR SELECT TO authenticated USING (true);
CREATE POLICY "schedule_write" ON public.schedule FOR ALL TO authenticated USING (pm = public.auth_user_name() OR public.auth_is_admin() OR EXISTS (SELECT 1 FROM public.projects WHERE projects.id = schedule.project_id AND projects.pm = public.auth_user_name())) WITH CHECK (pm = public.auth_user_name() OR public.auth_is_admin() OR EXISTS (SELECT 1 FROM public.projects WHERE projects.id = schedule.project_id AND projects.pm = public.auth_user_name()));

ALTER TABLE public.stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stage_history_read" ON public.stage_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "stage_history_write" ON public.stage_history FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = stage_history.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin()))) WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = stage_history.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin())));

ALTER TABLE public.project_funding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funding_read" ON public.project_funding FOR SELECT TO authenticated USING (true);
CREATE POLICY "funding_write" ON public.project_funding FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = project_funding.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin()))) WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = project_funding.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin())));

ALTER TABLE public.service_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_calls_read" ON public.service_calls FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_calls_write" ON public.service_calls FOR ALL TO authenticated USING (pm = public.auth_user_name() OR public.auth_is_admin() OR EXISTS (SELECT 1 FROM public.projects WHERE projects.id = service_calls.project_id AND projects.pm = public.auth_user_name())) WITH CHECK (pm = public.auth_user_name() OR public.auth_is_admin() OR EXISTS (SELECT 1 FROM public.projects WHERE projects.id = service_calls.project_id AND projects.pm = public.auth_user_name()));

ALTER TABLE public.project_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "folders_read" ON public.project_folders FOR SELECT TO authenticated USING (true);
CREATE POLICY "folders_write" ON public.project_folders FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = project_folders.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin()))) WITH CHECK (EXISTS (SELECT 1 FROM public.projects WHERE projects.id = project_folders.project_id AND (projects.pm = public.auth_user_name() OR public.auth_is_admin())));

-- ============================================================================
-- Verify: SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
-- ============================================================================
