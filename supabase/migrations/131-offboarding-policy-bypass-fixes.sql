-- Migration 131: close offboarding bypasses surfaced by red-team audit on 130
--
-- Red-team pass on migration 130 found three live RLS policies that still
-- gate on users.role directly without checking users.active, and one case-
-- sensitivity bug in provision_user's email lookup. All three policies allow
-- a user with role='super_admin', active=false to keep full access to the
-- gated tables -- directly undermining the offboarding lever migration 130
-- was designed to make effective.
--
-- Live today: `greg@energydevelopmentgroup.com` and `gkelsch@trismartsolar.com`
-- are both role='super_admin', active=false. Without this migration those two
-- rows retain full access to atlas_kb_entries and atlas_questions.
--
-- Findings addressed:
--   C1a: atlas_kb_entries.kb_cio_full (cmd=ALL) -- inline super_admin lookup
--   C1b: atlas_kb_entries.kb_employees_read (SELECT, sales-audience branch) --
--        inline role-in-list lookup
--   C1c: atlas_questions.aq_super_admin_all (cmd=ALL) -- inline super_admin
--   H2:  provision_user's SELECT after INSERT uses case-sensitive match; the
--        users.email UNIQUE is case-sensitive (plus a separate lower(email)
--        index) so a mixed-case stored row + lowercase IdP email mints a new
--        row and re-provisions memberships, bypassing offboarding.
--
-- Not addressed in this migration (filed as separate P0 action):
--   H1: auth.uid() returns auth.users.id, but org_memberships.user_id keys on
--       public.users.id. Live probe confirmed Paul has 2 memberships on
--       public.users.id and 0 on auth.users.id. Every WHERE om.user_id =
--       auth.uid() branch in auth_user_org_ids / auth_is_platform_user /
--       auth_is_org_member|admin is dead code in production. Org-scoped RLS
--       (migration 043, 30 tables) has been inert since inception. Multi-
--       tenancy rides entirely on auth_is_admin / auth_is_super_admin today.
--       Fix is a bigger migration that backfills the join key; out of scope
--       for an offboarding close-out.

-- ── 1. atlas_kb_entries.kb_cio_full ────────────────────────────────────────
-- Swap inline super_admin lookup for auth_is_super_admin() helper, which now
-- gates on active=true per migration 130.
DROP POLICY IF EXISTS kb_cio_full ON public.atlas_kb_entries;
CREATE POLICY kb_cio_full ON public.atlas_kb_entries
  FOR ALL TO authenticated
  USING (public.auth_is_super_admin())
  WITH CHECK (public.auth_is_super_admin());

-- ── 2. atlas_kb_entries.kb_employees_read ─────────────────────────────────
-- Preserve the audience logic; gate the sales-audience branch on active too.
-- Kept inline (not via helper) because the role-list is a subset of
-- auth_is_internal_writer's (only super_admin/admin/sales here).
DROP POLICY IF EXISTS kb_employees_read ON public.atlas_kb_entries;
CREATE POLICY kb_employees_read ON public.atlas_kb_entries
  FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND (
      audience = 'all'
      OR (
        audience = 'sales'
        AND EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.email = auth.jwt() ->> 'email'
            AND u.role = ANY (ARRAY['super_admin','admin','sales'])
            AND COALESCE(u.active, true) = true
        )
      )
    )
  );

-- ── 3. atlas_questions.aq_super_admin_all ─────────────────────────────────
DROP POLICY IF EXISTS aq_super_admin_all ON public.atlas_questions;
CREATE POLICY aq_super_admin_all ON public.atlas_questions
  FOR ALL TO authenticated
  USING (public.auth_is_super_admin())
  WITH CHECK (public.auth_is_super_admin());

-- ── 4. provision_user: case-insensitive email lookup after INSERT ─────────
-- The INSERT ... ON CONFLICT (email) is still case-sensitive (bound by the
-- UNIQUE(email) index) so a mixed-case row will conflict differently than
-- a lowercase row. Normalize both sides at the SELECT step so an existing
-- inactive row is found regardless of casing, preventing the "Aruelas@" vs
-- "aruelas@" resurrection path. Uses the existing users_email_idx on
-- lower(email) so no new index needed.
CREATE OR REPLACE FUNCTION public.provision_user(p_email text, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id      uuid;
  v_active       boolean;
  v_domain       text;
  v_caller_email text;
  v_lookup_email text;
BEGIN
  v_caller_email := auth.email();
  IF v_caller_email IS NULL OR lower(p_email) <> lower(v_caller_email) THEN
    RAISE EXCEPTION 'provision_user: email mismatch (caller=%, requested=%)',
      v_caller_email, p_email
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_lookup_email := lower(p_email);

  INSERT INTO public.users (email, name, active, admin)
  VALUES (v_lookup_email, p_name, true, false)
  ON CONFLICT (email) DO NOTHING;

  -- Case-insensitive resolve: catches both a freshly-inserted lowercase row
  -- and a pre-existing mixed-case offboarded row. The lower(email) index
  -- makes this sargable.
  SELECT id, COALESCE(active, true) INTO v_user_id, v_active
    FROM public.users
   WHERE lower(email) = v_lookup_email
   LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  IF v_active = false THEN
    RETURN;
  END IF;

  v_domain := lower(split_part(v_lookup_email, '@', 2));
  IF v_domain IS NULL OR v_domain = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.org_memberships (user_id, org_id)
  SELECT v_user_id, o.id
  FROM public.organizations o
  WHERE o.active = true
    AND o.allowed_domains IS NOT NULL
    AND v_domain = ANY (o.allowed_domains)
  ON CONFLICT DO NOTHING;
END;
$function$;
