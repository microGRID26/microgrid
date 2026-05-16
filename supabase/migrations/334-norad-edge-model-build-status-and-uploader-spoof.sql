-- 334: NORAD — close confused-deputy on atlas_update_edge_model_build_status (C1)
--      + spoofable-uploader attribution on atlas_upload_edge_model_source (H2)
--
-- R1 source: NORAD 2026-05-15 broad MG SECDEF sweep (grade D).
-- Companion to mig 329 (atlas_shared_kb_* same-family fix).
--
-- C1: atlas_update_edge_model_build_status is SECURITY DEFINER, granted to
-- authenticated, with NO authz check. Any logged-in MG user can flip the
-- live EDGE banker-model build_status to 'failed' with arbitrary p_error,
-- or pin a broken version. Sole legitimate callers are
-- ~/repos/EDGE-MODEL/scripts/{compile-model,mark-build-live}.js using
-- MICROGRID_SUPABASE_SERVICE_KEY (service_role). Zero authenticated callers
-- anywhere in ATLAS-HQ / MicroGRID / EDGE / EDGE-MODEL. Mig 172's
-- "EDGE model UI runs as authenticated; KEEP grant" comment was incorrect
-- for THIS function (correct for the sibling upload/set-live/delete fns
-- which DO have admin UI callers via ATLAS HQ).
--
-- In-function `auth_is_admin()` gate would block service_role (auth.uid()
-- is NULL on service-role calls). So the right fix is REVOKE EXECUTE
-- from authenticated; service_role retains EXECUTE; postgres unchanged.
--
-- H2: atlas_upload_edge_model_source already has auth_is_admin() gate,
-- but writes the caller-supplied `p_uploader` text to
-- edge_model_sources.uploaded_by without cross-check vs auth.email().
-- Admin A can call with p_uploader => 'mark@…' and forever attribute
-- the row to Mark. Fix: ignore p_uploader (kept for signature stability),
-- source attribution from auth.email() inside the function.

-- =============================================================================
-- (1) C1: revoke authenticated EXECUTE on update_build_status
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.atlas_update_edge_model_build_status(integer, text, text, text)
  FROM authenticated;

-- belt-and-suspenders: re-grant service_role + postgres (no-op if already granted, defensive)
GRANT EXECUTE ON FUNCTION public.atlas_update_edge_model_build_status(integer, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.atlas_update_edge_model_build_status(integer, text, text, text) IS
  'Server-side only. Called by EDGE-MODEL compile pipeline via service_role. authenticated revoked in mig 334 (NORAD R1).';

-- =============================================================================
-- (2) H2: rewrite upload to force attribution from auth.email()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.atlas_upload_edge_model_source(
  p_filename text,
  p_html text,
  p_uploader text  -- IGNORED — retained for signature stability; auth.email() is the real attribution
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_next_version int;
  v_real_uploader text;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'atlas_upload_edge_model_source: admin role required'
      USING ERRCODE = '42501';
  END IF;

  -- Force attribution from auth context. p_uploader is intentionally ignored.
  -- auth.email() is guaranteed non-NULL here because auth_is_admin() above
  -- only returns true for rows matched on auth.uid() AND auth.email().
  v_real_uploader := auth.email();

  IF coalesce(trim(p_filename), '') = '' THEN
    RAISE EXCEPTION 'filename required';
  END IF;
  IF coalesce(p_html, '') = '' THEN
    RAISE EXCEPTION 'html required';
  END IF;
  IF octet_length(p_html) > 10 * 1024 * 1024 THEN
    RAISE EXCEPTION 'html too large (> 10MB)';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_next_version FROM public.edge_model_sources;
  UPDATE public.edge_model_sources SET is_live = false WHERE is_live = true;
  INSERT INTO public.edge_model_sources (version, filename, html, uploaded_by, is_live, build_status)
  VALUES (v_next_version, p_filename, p_html, v_real_uploader, true, 'pending');
  RETURN v_next_version;
END;
$function$;

-- GRANTs unchanged: authenticated + postgres + service_role retain EXECUTE.
