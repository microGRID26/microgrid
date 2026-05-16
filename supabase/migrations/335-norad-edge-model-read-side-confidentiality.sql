-- 335: NORAD R3 follow-up — close the READ-side confidentiality leak in the
-- EDGE banker-model SECDEF family. Surfaced by R3 (general-purpose) on
-- 2026-05-15 during the mig-334 fresh-eyes verify. R1 (red-teamer)
-- 2026-05-15 sample caught the WRITE side (C1 update_build_status zero-authz,
-- H2 upload_source p_uploader spoof — both closed by mig 334). R3 caught the
-- read side that R1 missed:
--
--   atlas_get_live_edge_model_source() RETURNS TABLE(version, filename, html)
--     SECDEF, granted to authenticated, NO authz body — any logged-in MG user
--     can SELECT and exfiltrate the full ~2.6 MB live banker-model HTML (Paul
--     EDGE CFO model). Confidentiality-class Critical.
--
--   atlas_list_edge_model_sources() RETURNS TABLE(id, version, filename,
--     uploaded_by, uploaded_at, is_live, build_status, build_error, deploy_id,
--     bytes)
--     SECDEF, granted to authenticated, NO authz body — leaks metadata of
--     all banker-model versions (uploader emails, version history, sizes).
--
-- Caller analysis (verified by grep across MG/ATLAS-HQ/EDGE/EDGE-MODEL repos):
--   atlas_get_live_edge_model_source:
--     Sole caller: ~/repos/EDGE-MODEL/scripts/compile-model.js:936 via
--     MICROGRID_SUPABASE_SERVICE_KEY (service_role only). Zero authenticated
--     callers.
--   atlas_list_edge_model_sources:
--     Sole caller: ~/repos/EDGE-MODEL/lib/admin/sources.ts:20 via
--     getServerSupabase() (admin UI as authenticated cookie session).
--
-- Fix shape (matches mig 334's pattern split):
--   GET:  REVOKE EXECUTE FROM authenticated. No in-function gate because
--         service_role calls have NULL auth.uid() → auth_is_admin() would
--         falsely block them.
--   LIST: CREATE OR REPLACE with auth_is_admin() gate inline; keep
--         authenticated grant for the admin UI path. Mirror the sibling
--         pattern from atlas_set_live_edge_model_source.

-- =============================================================================
-- (1) atlas_get_live_edge_model_source — revoke authenticated
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.atlas_get_live_edge_model_source()
  FROM authenticated;

GRANT EXECUTE ON FUNCTION public.atlas_get_live_edge_model_source()
  TO service_role;

COMMENT ON FUNCTION public.atlas_get_live_edge_model_source() IS
  'Server-side only. Called by EDGE-MODEL compile pipeline via service_role to fetch live HTML for rendering. authenticated revoked in mig 335 (NORAD R3 follow-up to mig 334 — closes read-side confidentiality leak on EDGE banker model).';

-- =============================================================================
-- (2) atlas_list_edge_model_sources — add inline auth_is_admin() gate
-- =============================================================================

CREATE OR REPLACE FUNCTION public.atlas_list_edge_model_sources()
RETURNS TABLE(
  id uuid,
  version integer,
  filename text,
  uploaded_by text,
  uploaded_at timestamp with time zone,
  is_live boolean,
  build_status text,
  build_error text,
  deploy_id text,
  bytes integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'atlas_list_edge_model_sources: admin role required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.version,
    s.filename,
    s.uploaded_by,
    s.uploaded_at,
    s.is_live,
    s.build_status,
    s.build_error,
    s.deploy_id,
    octet_length(s.html)::integer AS bytes
  FROM public.edge_model_sources s
  ORDER BY s.version DESC;
END;
$function$;

-- Explicit per-role ACL block for atlas-fn-grant-guard
REVOKE EXECUTE ON FUNCTION public.atlas_list_edge_model_sources() FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_list_edge_model_sources() FROM anon;
GRANT  EXECUTE ON FUNCTION public.atlas_list_edge_model_sources()
  TO authenticated, service_role;
