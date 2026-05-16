-- NORAD broad-sweep R1 red-teamer 2026-05-16 caught Medium on
-- `public.atlas_hq_create_user(p_caller uuid, p_email text, p_role text, p_name text)`.
--
-- Function is SECDEF + granted to authenticated. The only authorization gate
-- today is `atlas_hq_is_owner(p_caller)`, which internally enforces
-- `p_uid = auth.uid()` (or service_role / postgres). So the function is SAFE
-- today against a non-owner authenticated caller passing a known-owner UUID
-- — `atlas_hq_is_owner` returns false because `p_uid != auth.uid()`.
--
-- Latent risk: any future refactor of `atlas_hq_is_owner` that drops the
-- `p_uid = auth.uid()` clause (e.g. to support admin-impersonation) silently
-- promotes this Medium to a Critical privilege-escalation — any authenticated
-- user could pass `p_caller = <known-owner-uuid>` and self-promote to `owner`
-- role on `atlas_hq_users`.
--
-- Fix: add a defense-in-depth guard mirroring mig 340's aggregate_earnings
-- pattern. Enforce `p_caller = auth.uid()` directly at the call site so the
-- binding does NOT depend on the helper. Service_role / postgres bypasses
-- preserve provisioning flows.
--
-- Pure CREATE OR REPLACE — no signature change, no ACL change. Authenticated
-- + service_role + postgres grants preserved by REPLACE semantics.

CREATE OR REPLACE FUNCTION public.atlas_hq_create_user(
  p_caller uuid,
  p_email text,
  p_role text,
  p_name text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_row atlas_hq_users%ROWTYPE;
BEGIN
  -- NORAD defense-in-depth: bind p_caller to auth.uid() at the call site so
  -- the auth-spoof guard does not depend on atlas_hq_is_owner's internal
  -- check. service_role + postgres callers (provisioning flows) bypass.
  IF auth.role() NOT IN ('service_role', 'postgres')
     AND (auth.uid() IS NULL OR p_caller <> auth.uid()) THEN
    RAISE EXCEPTION 'spoofed_caller' USING ERRCODE = '42501';
  END IF;

  IF NOT public.atlas_hq_is_owner(p_caller) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('owner', 'work', 'viewer') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023';
  END IF;
  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RAISE EXCEPTION 'invalid_email' USING ERRCODE = '22023';
  END IF;
  INSERT INTO atlas_hq_users (email, name, role, active, invited_by)
  VALUES (lower(trim(p_email)), p_name, p_role, true, p_caller)
  ON CONFLICT (email) DO UPDATE
    SET role = EXCLUDED.role,
        name = COALESCE(EXCLUDED.name, atlas_hq_users.name),
        active = true
  RETURNING * INTO v_row;
  RETURN row_to_json(v_row);
END;
$function$;

-- Explicit ACL block per grant-guard hook: CREATE OR REPLACE preserves
-- existing privileges but the lint requires intent to be visible in source.
-- Current live ACL is postgres + service_role + authenticated; anon never had access.
REVOKE EXECUTE ON FUNCTION public.atlas_hq_create_user(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_create_user(uuid, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.atlas_hq_create_user(uuid, text, text, text) TO authenticated, service_role;
