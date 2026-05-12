-- v1.42 #952 — manual Close button for Seer feedback rows (lives on MG).
-- Mirror of Quest mig 084: status column + resolve RPC + updated list RPC.
--
-- Intentional state-machine quirk (R1 M1, 2026-05-12): list RPC filters
-- status<>'closed', meaning manually-closed rows escape autonomous
-- classification. Acceptable since Close implies operator-resolved.
--
-- All references schema-qualified; pg_temp last in search_path.

ALTER TABLE public.seer_feedback
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

CREATE OR REPLACE FUNCTION public.atlas_resolve_seer_feedback(
  p_id uuid,
  p_status text DEFAULT 'closed'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_status NOT IN ('new','reviewing','responded','closed') THEN
    RAISE EXCEPTION 'invalid_status: %', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE public.seer_feedback
     SET status = p_status
   WHERE id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_resolve_seer_feedback(uuid, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_resolve_seer_feedback(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_resolve_seer_feedback(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_resolve_seer_feedback(uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.atlas_list_seer_feedback(timestamptz, integer);

CREATE OR REPLACE FUNCTION public.atlas_list_seer_feedback(
  p_since timestamptz DEFAULT (now() - '25:00:00'::interval),
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  id uuid, category text, message text, screen text,
  app_version text, device_info text, photo_url text, status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT id, category::text, message, screen, app_version, device_info, photo_url, status,
         created_at
  FROM public.seer_feedback
  WHERE (p_since IS NULL OR created_at >= p_since)
    AND status <> 'closed'
  ORDER BY created_at DESC
  LIMIT p_limit
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) TO service_role;
