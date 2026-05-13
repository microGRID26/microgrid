-- Migration 323 — exclude /feed screen from atlas_list_seer_feedback
--
-- Greg's policy 2026-05-13: items submitted from Seer's /feed screen are
-- notes-to-self, not actionable feedback. They should never enter the
-- triage pipeline (no greg_action, no atlas_feedback_actions row).
--
-- CREATE OR REPLACE preserves existing grants; the REVOKE/GRANT block below
-- is belt-and-suspenders for atlas-fn-grant-guard. Current grants: postgres
-- + service_role only (verified via information_schema.role_routine_grants
-- prior to apply).

CREATE OR REPLACE FUNCTION public.atlas_list_seer_feedback(
  p_since timestamp with time zone DEFAULT (now() - '7 days'::interval),
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  id uuid,
  category text,
  message text,
  screen text,
  app_version text,
  device_info text,
  photo_url text,
  status text,
  created_at timestamp with time zone
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
    AND (screen IS NULL OR screen <> '/feed')
  ORDER BY created_at DESC
  LIMIT p_limit
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) TO service_role;
