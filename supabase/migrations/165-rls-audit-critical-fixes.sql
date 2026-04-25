-- Migration 165 — close 3 Criticals + 1 High from the 2026-04-25
-- monthly audit rotation of `rls-auth-helpers` on MG prod.
--
-- Every fix here closes an exploit path reachable today by any
-- authenticated MG user (including external EPC reps and SPARK reps
-- holding a valid Supabase JWT against the MG tenant). None required
-- a bug in another layer — all reachable via REST /rpc directly.
--
-- ── Critical 1-3: EDGE model RPCs granted to `authenticated` with
-- zero caller auth check ─────────────────────────────────────────────
-- atlas_{upload,set_live,delete}_edge_model_source all accepted a
-- `requester/uploader` text arg that was never validated. Next.js
-- middleware on EDGE-MODEL gated the admin UI to Paul / Mark / Greg
-- emails, but the RPCs themselves were callable by any logged-in MG
-- user via REST. A hostile EPC rep could flip the live EDGE financial
-- model, upload a 10MB HTML blob that auto-promotes to live, or delete
-- non-live versions.
--
-- Note: the EDGE-MODEL admin route calls these via an anon-key +
-- cookie client (getServerSupabase, not a service-role key), so the
-- caller role is `authenticated`. Revoking from authenticated would
-- break the legit admin UI. Instead: add auth_is_admin() guard inside
-- each function body so the DB enforces the same gate as Next
-- middleware. Paul = admin, Mark = admin, Greg = super_admin —
-- auth_is_admin() returns true for all three.

CREATE OR REPLACE FUNCTION public.atlas_upload_edge_model_source(p_filename text, p_html text, p_uploader text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_next_version int;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'atlas_upload_edge_model_source: admin role required'
      USING ERRCODE = '42501';
  END IF;

  IF coalesce(trim(p_filename), '') = '' THEN
    RAISE EXCEPTION 'filename required';
  END IF;
  IF coalesce(p_html, '') = '' THEN
    RAISE EXCEPTION 'html required';
  END IF;
  IF octet_length(p_html) > 10 * 1024 * 1024 THEN
    RAISE EXCEPTION 'html too large (> 10MB)';
  END IF;

  SELECT coalesce(max(version), 0) + 1
    INTO v_next_version
    FROM public.edge_model_sources;

  UPDATE public.edge_model_sources
     SET is_live = false
   WHERE is_live = true;

  INSERT INTO public.edge_model_sources (
    version, filename, html, uploaded_by, is_live, build_status
  ) VALUES (
    v_next_version, p_filename, p_html, p_uploader, true, 'pending'
  );

  RETURN v_next_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.atlas_set_live_edge_model_source(p_version integer, p_requester text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'atlas_set_live_edge_model_source: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT id
    INTO v_target_id
    FROM public.edge_model_sources
   WHERE version = p_version;

  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'version % not found', p_version;
  END IF;

  UPDATE public.edge_model_sources
     SET is_live = false
   WHERE is_live = true
     AND version <> p_version;

  UPDATE public.edge_model_sources
     SET is_live = true,
         build_status = 'pending'
   WHERE version = p_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.atlas_delete_edge_model_source(p_version integer, p_requester text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_is_live boolean;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'atlas_delete_edge_model_source: admin role required'
      USING ERRCODE = '42501';
  END IF;

  SELECT is_live
    INTO v_is_live
    FROM public.edge_model_sources
   WHERE version = p_version;

  IF v_is_live IS NULL THEN
    RAISE EXCEPTION 'version % not found', p_version;
  END IF;
  IF v_is_live = true THEN
    RAISE EXCEPTION 'cannot delete the live version — rollback first';
  END IF;

  DELETE FROM public.edge_model_sources WHERE version = p_version;
END;
$function$;

-- Re-assert grants after CREATE OR REPLACE (Postgres resets EXECUTE
-- to PUBLIC defaults on every redefinition, which the migration guard
-- correctly flags).
REVOKE EXECUTE ON FUNCTION public.atlas_upload_edge_model_source(text, text, text)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_set_live_edge_model_source(integer, text)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_delete_edge_model_source(integer, text)     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_upload_edge_model_source(text, text, text)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.atlas_set_live_edge_model_source(integer, text)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.atlas_delete_edge_model_source(integer, text)     TO authenticated, service_role;

-- ── Critical 4: atlas_hq_link_auth_user allowed relinking any HQ row
-- to any auth.uid() — Atlas HQ account takeover ──────────────────────
-- Old body: UPDATE ... WHERE lower(email)=lower(p_email) AND
-- (auth_user_id IS NULL OR auth_user_id <> p_auth_user_id). The `<>`
-- clause only prevents idempotent no-ops, NOT takeover: an attacker
-- could pass (email='greg@gomicrogridenergy.com', p_auth_user_id=own
-- uid) and the update would rewrite Greg's HQ row.
--
-- Fix: self-link only. Caller must supply their own auth.uid() AND
-- the target HQ row must be unclaimed OR already bound to the caller.

CREATE OR REPLACE FUNCTION public.atlas_hq_link_auth_user(p_email text, p_auth_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_auth_user_id IS NULL OR p_auth_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'atlas_hq_link_auth_user: self-link only (p_auth_user_id must equal auth.uid())'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.atlas_hq_users
     SET auth_user_id   = p_auth_user_id,
         last_sign_in_at = now()
   WHERE lower(email) = lower(p_email)
     AND (auth_user_id IS NULL OR auth_user_id = p_auth_user_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_link_auth_user(text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.atlas_hq_link_auth_user(text, uuid) TO authenticated, service_role;

-- ── High 5: projects + project_funding permissive auth_full_access
-- policy short-circuited org scoping ────────────────────────────────
-- USING ((SELECT auth.role()) = 'authenticated') for ALL / {public}.
-- PostgreSQL combines permissive policies with OR, so this clause
-- nullified the org-scoped v2 policies. Any authenticated user read
-- every project across every org. Tenant bypass on the flagship CRM.
--
-- The v2 policies (projects_select_v2, projects_insert_v2,
-- projects_update_v2, projects_delete_v2, pf_select_v2, funding_write,
-- customer_project_read) already cover legitimate reps / admins /
-- platform users / customers. Dropping the permissive override
-- restores the intended org boundary.

DROP POLICY IF EXISTS auth_full_access ON public.projects;
DROP POLICY IF EXISTS auth_full_access ON public.project_funding;
