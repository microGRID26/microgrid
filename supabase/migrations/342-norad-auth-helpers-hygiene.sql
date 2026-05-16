-- NORAD R1 follow-up #1165 — close two latent risks on MG auth helpers
-- surfaced by red-teamer during the 2026-05-16 aggregate_earnings (mig 340)
-- review.
--
-- (1) auth_user_org_ids cached the org list in a session GUC
--     (app.user_org_ids) without binding the key to auth.uid(). PostgREST
--     blocks raw SET from clients today, so it's not currently exploitable;
--     but any future RPC that calls set_config('app.user_org_ids', ...)
--     before invoking another SECDEF in the same transaction spoofs the
--     org-membership check. Greg picked option (b) drop the cache —
--     operational simplicity wins over microseconds saved per RPC, and the
--     cross-call spoof primitive is removed entirely. The org_memberships
--     lookup is a single-row btree on (user_id) — sub-ms.
--
-- (2) auth_user_id derived caller from JWT but didn't apply the active=true
--     filter that auth_is_admin already uses. A deactivated rep with a
--     still-valid JWT resolved to a real v_user and could query their own
--     commissions until the JWT expired. Adds the same COALESCE(active,true)
--     filter auth_user_org_ids uses to match the deactivate-and-it-locks-out
--     intent.
--
-- ACL preserved as before (PUBLIC EXECUTE — these are RLS helpers, must be
-- callable from policy expressions evaluated under any role including anon).

CREATE OR REPLACE FUNCTION public.auth_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT id::text
    FROM public.users
   WHERE auth_user_id = auth.uid()
     AND lower(email) = lower(auth.email())
     AND COALESCE(active, true) = true
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.auth_user_org_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- No GUC cache — every call re-queries org_memberships. Single-row btree
  -- lookup, sub-ms. The previous cache used a non-namespaced session
  -- variable (app.user_org_ids) that any future in-txn set_config()
  -- could poison.
  SELECT COALESCE(
    ARRAY(
      SELECT om.org_id
      FROM public.org_memberships om
      JOIN public.users u ON u.id = om.user_id
      WHERE lower(u.email) = lower(auth.email())
        AND COALESCE(u.active, true) = true
    ),
    '{}'::uuid[]
  );
$function$;

-- ACL: re-assert the existing PUBLIC EXECUTE (RLS helpers, intentional).
REVOKE EXECUTE ON FUNCTION public.auth_user_id() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_user_id() TO PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auth_user_org_ids() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_user_org_ids() TO PUBLIC, anon, authenticated, service_role;
