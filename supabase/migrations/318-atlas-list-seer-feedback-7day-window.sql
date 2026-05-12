-- 318 — atlas_list_seer_feedback: extend p_since default 25h → 7 days
--
-- Anchor: Atlas HQ chain Phase 2A (2026-05-12). Pre-flight review (red-teamer
-- subagent) Critical C2; Atlas Protocol R1 = GO grade A.
--
-- BUG
-- ---
-- HQ /feedback page reports 0 Seer rows. Source data exists:
--   open_rows=4, within_25h=0, within_7d=4, oldest=2026-05-10 22:36 UTC.
-- The 4 rows are 46–47 hours old and fall outside the RPC's 25-hour default
-- `p_since` window. The HQ fetcher in lib/feedback/fetch.ts calls the RPC
-- with NO p_since argument, so the default kicks in and silently drops every
-- row past 25 hours.
--
-- FIX
-- ---
-- Change p_since default to `now() - interval '7 days'`. Body, search_path
-- lock, SECURITY DEFINER posture, return shape, and column list are unchanged
-- from mig 313. Explicit REVOKE/GRANT block added per atlas-fn-grant-guard
-- (anon + authenticated auto-grants must be revoked; service_role is the
-- only intended caller).
--
-- ROLLBACK
-- --------
-- Re-apply mig 313 to restore the 25-hour default. No data is affected —
-- this is a read-only RPC default.

CREATE OR REPLACE FUNCTION public.atlas_list_seer_feedback(
    p_since timestamp with time zone DEFAULT (now() - interval '7 days'),
    p_limit integer DEFAULT 200
)
RETURNS TABLE (
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
  ORDER BY created_at DESC
  LIMIT p_limit
$function$;

-- Lock down execute ACL — service_role is the only intended caller.
-- Mirrors mig 313's posture so a re-apply of mig 313 cleanly reverts.
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) TO service_role;

COMMENT ON FUNCTION public.atlas_list_seer_feedback(timestamp with time zone, integer) IS
  'HQ /feedback Seer source. Default window 7 days (changed from 25h in mig 318, 2026-05-12). SECURITY DEFINER over public.seer_feedback. service_role only.';
