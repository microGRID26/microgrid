-- 185-atlas-hq-get-user-role-explicit-trusted-roles.sql
--
-- Defensive tightening surfaced during R1 audit on migration 183/184.
--
-- atlas_hq_get_user_role had a `auth.uid() IS NULL OR caller_email = p_email`
-- gate. The IS NULL branch was a proxy for "service_role / postgres trust"
-- (which have no auth context, so auth.uid() is NULL there) — used during
-- the HQ Google OAuth callback to look up a user's role before the auth
-- row is linked.
--
-- Under current grants (authenticated + postgres + service_role; NO anon)
-- the function is not exploitable. But the IS NULL branch is brittle: a
-- future migration that grants anon EXECUTE (Supabase default ACLs do
-- this on CREATE; only rescued by explicit REVOKE) would immediately
-- expose the full {role, active, name, id, auth_user_id, scope} payload
-- to any anon-key caller who guesses HQ emails — disclosure of HQ
-- membership and the auth_user_ids that the new atlas_hq_is_owner gate
-- (migration 183) keys on.
--
-- Replace the IS NULL branch with an explicit
-- `auth.role() IN ('service_role','postgres')` check, mirroring the
-- pattern from atlas_hq_is_owner (183). Anon-callable becomes
-- non-exploitable even if grants regress.

CREATE OR REPLACE FUNCTION public.atlas_hq_get_user_role(p_email text)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT json_build_object(
    'role', role, 'active', active, 'name', name,
    'id', id, 'auth_user_id', auth_user_id, 'scope', scope
  )
  FROM public.atlas_hq_users
  WHERE lower(email) = lower(p_email)
    AND (
      auth.role() IN ('service_role', 'postgres')
      OR lower((SELECT email FROM auth.users WHERE id = auth.uid())) = lower(p_email)
    )
  LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_get_user_role(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_get_user_role(text) FROM anon;
