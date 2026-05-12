-- v1.42 codebase-maturity chain — null-safety on atlas_list_seer_feedback p_since.
-- Same bug as the Quest RPC (mig 083): cron's feedback-monitor passes
-- p_since=NULL when no watermark exists, `WHERE created_at >= NULL` evaluates
-- NULL → 0 rows. SPARK's RPC has the correct `p_since IS NULL OR ...` guard.
--
-- All references must be schema-qualified; pg_temp is LAST in search_path.
-- Do NOT add unqualified function calls below — they would resolve through
-- pg_temp first.

CREATE OR REPLACE FUNCTION public.atlas_list_seer_feedback(
  p_since timestamptz DEFAULT (now() - '25:00:00'::interval),
  p_limit integer DEFAULT 200
)
RETURNS TABLE(
  id uuid, category text, message text, screen text,
  app_version text, device_info text, photo_url text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT id, category::text, message, screen, app_version, device_info, photo_url, created_at
  FROM public.seer_feedback
  WHERE p_since IS NULL OR created_at >= p_since
  ORDER BY created_at DESC
  LIMIT p_limit
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, integer) TO service_role;
