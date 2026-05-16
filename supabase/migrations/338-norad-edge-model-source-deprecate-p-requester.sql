-- 338: NORAD #1154 drain — deprecate caller-supplied p_requester on the
-- atlas_*_edge_model_source admin mutators. Backwards-compat variant
-- (DEFAULT NULL + body ignores it + COMMENT documenting the contract)
-- so existing ATLAS-HQ admin UI callers continue to work without a
-- coordinated deploy. Future cleanup can drop the arg from callers and
-- a follow-up mig can drop the signature.
--
-- DEVIATION from #1154 recommended default (a) "drop p_requester from both
-- function signatures": the literal drop would break ABI mid-flight —
-- ~/repos/EDGE-MODEL/lib/admin/sources.ts:44+60 still pass p_requester, and
-- per the no-mid-session-push rule we're not deploying the TS today. So:
--
--   Phase A (this mig): make p_requester DEFAULT NULL, ignore inside body,
--                       COMMENT the new contract. ABI-preserving.
--   Phase B (follow-up): drop p_requester from EDGE-MODEL TS callers
--                       (sources.ts:44 / sources.ts:60). After deploy.
--   Phase C (follow-up): mig 33X — DROP FUNCTION old (integer, text)
--                       overload once telemetry confirms zero callers
--                       still pass the arg.
--
-- Audit anchor: NORAD wide-net R1 2026-05-15 (chain norad-mg-secdef-sweep
-- version mig-336-2026-05-15) flagged this as Class-E (spoofable
-- attribution) but verify showed p_requester is unused in body today.
-- The threat is forward-looking: if a future audit-logging mig adds
-- `INSERT INTO audit VALUES (..., p_requester)`, spoofing surface
-- re-appears. This mig closes the door by making p_requester ignored.

-- =============================================================================
-- (1) atlas_delete_edge_model_source — DEFAULT NULL + ignore p_requester
-- =============================================================================

CREATE OR REPLACE FUNCTION public.atlas_delete_edge_model_source(
  p_version integer,
  p_requester text DEFAULT NULL  -- IGNORED; retained for ABI backwards-compat
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_live boolean;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'atlas_delete_edge_model_source: admin role required'
      USING ERRCODE = '42501';
  END IF;

  -- p_requester is intentionally ignored. DO NOT write it to any audit
  -- column. Future audit attribution MUST derive from auth.email() inside
  -- this function to prevent admin-spoofs-admin attribution attacks.

  SELECT is_live INTO v_is_live FROM public.edge_model_sources WHERE version = p_version;
  IF v_is_live IS NULL THEN
    RAISE EXCEPTION 'version % not found', p_version;
  END IF;
  IF v_is_live = true THEN
    RAISE EXCEPTION 'cannot delete the live version — rollback first';
  END IF;
  DELETE FROM public.edge_model_sources WHERE version = p_version;
END;
$function$;

-- Re-declare ACLs explicitly so atlas-fn-grant-guard accepts as intentional
REVOKE EXECUTE ON FUNCTION public.atlas_delete_edge_model_source(integer, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_delete_edge_model_source(integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.atlas_delete_edge_model_source(integer, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.atlas_delete_edge_model_source(integer, text) IS
  'p_requester is IGNORED (NORAD mig 338 — closes #1154 forward-looking spoof surface). Future audit-logging code MUST derive attribution from auth.email() inside the function, NOT from p_requester. The param is retained for ABI backwards-compat with existing ATLAS-HQ admin UI callers; planned removal in a follow-up after EDGE-MODEL/lib/admin/sources.ts is updated to drop the arg.';

-- =============================================================================
-- (2) atlas_set_live_edge_model_source — DEFAULT NULL + ignore p_requester
-- =============================================================================

CREATE OR REPLACE FUNCTION public.atlas_set_live_edge_model_source(
  p_version integer,
  p_requester text DEFAULT NULL  -- IGNORED; retained for ABI backwards-compat
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_target_id uuid;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'atlas_set_live_edge_model_source: admin role required'
      USING ERRCODE = '42501';
  END IF;

  -- p_requester intentionally ignored — see sibling delete fn comment.

  SELECT id INTO v_target_id FROM public.edge_model_sources WHERE version = p_version;
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'version % not found', p_version;
  END IF;
  UPDATE public.edge_model_sources SET is_live = false WHERE is_live = true AND version <> p_version;
  UPDATE public.edge_model_sources SET is_live = true, build_status = 'pending' WHERE version = p_version;
END;
$function$;

-- Re-declare ACLs explicitly so atlas-fn-grant-guard accepts as intentional
REVOKE EXECUTE ON FUNCTION public.atlas_set_live_edge_model_source(integer, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_set_live_edge_model_source(integer, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.atlas_set_live_edge_model_source(integer, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.atlas_set_live_edge_model_source(integer, text) IS
  'p_requester is IGNORED (NORAD mig 338 — closes #1154 forward-looking spoof surface). Same contract as atlas_delete_edge_model_source.';
