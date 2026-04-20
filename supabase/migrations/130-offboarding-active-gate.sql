-- Migration 130: single-signal offboarding via users.active = false
--
-- Closes greg_actions #138. Deferred MEDIUM from R1 on migration 127.
--
-- Problem: offboarding a user was not a defined operation today.
--   (a) provision_user re-inserts org_memberships on every OAuth login for any
--       internal-domain email. Deleting rows to "offboard" was silently undone
--       on next login.
--   (b) auth_user_org_ids() / auth_is_platform_user() / auth_is_org_member() /
--       auth_is_org_admin() walk org_memberships with NO users.active filter.
--       Flipping users.active = false did NOT lock anyone out of RLS either.
--   (c) auth_is_admin() / auth_is_super_admin() / auth_user_role() read the
--       users.role column but also never checked active. A deactivated admin
--       kept admin privileges until their row was deleted.
--
-- Only auth_is_internal_writer() (migration 117) already had the active gate.
-- The rest never got it.
--
-- Fix: make users.active = false the single canonical offboarding lever. One
-- UPDATE, fully locked out. Convention: never delete rows to offboard; always
-- flip active. Helpers enforce it.
--
-- No per-org offboarding today (internal users have 1-2 memberships; would be
-- premature). If that changes, add org_memberships.offboarded_at later.
--
-- Cached GUCs in 044 use set_config(..., true) = transaction-scoped, so a flip
-- takes effect on the very next HTTP request. No logout required.

-- ── 1. provision_user: short-circuit if an existing row is inactive ────────
-- Important: the users upsert runs BEFORE the active check today, and uses
-- ON CONFLICT DO NOTHING so it does NOT resurrect a deactivated row. But it
-- does still proceed to insert org_memberships. Add an explicit early-return
-- on active=false so the membership INSERT is skipped too.
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
BEGIN
  -- Identity check (from migration 129): the RPC can only self-provision.
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
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Offboarding gate: a deactivated user must not be silently re-privileged.
  -- ops convention: UPDATE users SET active=false WHERE email=... to offboard.
  -- Without this check, a subsequent login would re-insert memberships the
  -- admin had intentionally revoked.
  IF v_active = false THEN
    RETURN;
  END IF;

  v_domain := lower(split_part(p_email, '@', 2));
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

-- ── 2. auth_user_org_ids: gate on users.active ────────────────────────────
-- Membership-walking helper. Preserve the transaction-scoped cache and the
-- auth.uid() key; add an active-email gate up front so an inactive user sees
-- an empty org list regardless of what org_memberships contains.
CREATE OR REPLACE FUNCTION public.auth_user_org_ids()
RETURNS UUID[] LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  cached   TEXT;
  result   UUID[];
  v_active BOOLEAN;
BEGIN
  BEGIN
    cached := current_setting('app.user_org_ids', true);
  EXCEPTION WHEN OTHERS THEN
    cached := NULL;
  END;

  IF cached IS NOT NULL AND cached != '' THEN
    RETURN cached::UUID[];
  END IF;

  -- Active gate: inactive (or absent) users get an empty org list.
  SELECT COALESCE(u.active, true) INTO v_active
    FROM public.users u
    WHERE u.email = auth.email()
    LIMIT 1;
  IF v_active IS NULL OR v_active = false THEN
    PERFORM set_config('app.user_org_ids', '{}', true);
    RETURN '{}'::UUID[];
  END IF;

  SELECT COALESCE(
    ARRAY(SELECT org_id FROM org_memberships WHERE user_id = auth.uid()),
    '{}'::UUID[]
  ) INTO result;

  PERFORM set_config('app.user_org_ids', result::TEXT, true);
  RETURN result;
END;
$$;

-- ── 3. auth_is_platform_user: gate on users.active ────────────────────────
CREATE OR REPLACE FUNCTION public.auth_is_platform_user()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  cached   TEXT;
  result   BOOLEAN;
  v_active BOOLEAN;
BEGIN
  BEGIN
    cached := current_setting('app.is_platform_user', true);
  EXCEPTION WHEN OTHERS THEN
    cached := NULL;
  END;

  IF cached IS NOT NULL AND cached != '' THEN
    RETURN cached::BOOLEAN;
  END IF;

  SELECT COALESCE(u.active, true) INTO v_active
    FROM public.users u
    WHERE u.email = auth.email()
    LIMIT 1;
  IF v_active IS NULL OR v_active = false THEN
    PERFORM set_config('app.is_platform_user', 'false', true);
    RETURN false;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM org_memberships om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = auth.uid() AND o.org_type = 'platform'
  ) OR auth_is_super_admin() INTO result;

  PERFORM set_config('app.is_platform_user', result::TEXT, true);
  RETURN result;
END;
$$;

-- ── 4. auth_is_org_member / auth_is_org_admin: gate on users.active ───────
-- These are the uncached variants in 042. Keep signatures + shape; add gate.
CREATE OR REPLACE FUNCTION public.auth_is_org_member(target_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1
    FROM org_memberships om
    JOIN public.users u ON u.email = auth.email()
    WHERE om.user_id = auth.uid()
      AND om.org_id = target_org_id
      AND COALESCE(u.active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_org_admin(target_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1
    FROM org_memberships om
    JOIN public.users u ON u.email = auth.email()
    WHERE om.user_id = auth.uid()
      AND om.org_id = target_org_id
      AND om.org_role IN ('owner', 'admin')
      AND COALESCE(u.active, true) = true
  ) OR auth_is_super_admin();
$$;

-- ── 5. auth_is_admin / auth_is_super_admin / auth_user_role: active gate ──
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

CREATE OR REPLACE FUNCTION public.auth_is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role = 'super_admin'
       FROM public.users
      WHERE email = auth.email()
        AND COALESCE(active, true) = true
      LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role
       FROM public.users
      WHERE email = auth.email()
        AND COALESCE(active, true) = true
      LIMIT 1),
    'user'
  );
$$;

-- ── 6. Keep rls-migration.sql's auth_is_admin in sync (boolean admin col) ─
-- The rls-migration.sql copy reads the legacy boolean `admin` column, not
-- `role`. Gate both pre-migration-010 and post-migration-010 shapes.
-- (This CREATE OR REPLACE above already handles post-010 role column; the
-- legacy boolean shape in rls-migration.sql is superseded — leaving the file
-- alone, since migrations/010-roles.sql.CREATE OR REPLACE wins at runtime.)

COMMENT ON FUNCTION public.auth_user_org_ids() IS
  'RLS helper: org ids for the active authenticated user. Returns empty array when users.active = false. Transaction-cached via app.user_org_ids GUC.';
COMMENT ON FUNCTION public.auth_is_platform_user() IS
  'RLS helper: true when the authenticated user is active AND has a platform-org membership OR is a super admin. Transaction-cached via app.is_platform_user GUC.';
COMMENT ON FUNCTION public.auth_is_admin() IS
  'RLS helper: true when auth.email() maps to an active users row with role admin|super_admin. Offboarding via users.active=false flips this to false.';
