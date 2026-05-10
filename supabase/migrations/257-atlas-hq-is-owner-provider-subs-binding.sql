-- 257-atlas-hq-is-owner-provider-subs-binding.sql
--
-- Real-world workaround discovered during Phase 0 R2 live test on 2026-05-10:
-- iPhone Apple Sign-In sheet does not always offer "Share My Email" — when
-- "Hide My Email" was set per-app on a previous signin, it sticks even after
-- the app is uninstalled. Apple's only fix is iPhone Settings → Apple ID →
-- Sign in with Apple → revoke app + restart, which doesn't always reset
-- cleanly across iOS versions.
--
-- Mig 253's email-based owner check rejects @privaterelay.appleid.com (correctly,
-- because we want the real email path). When Apple forces relay, the user gets
-- "Access Denied" — which IS the desired UX for non-owners but breaks the
-- legitimate owner who can't escape the relay path.
--
-- Solution: extend atlas_hq_is_owner with a THIRD path — accept p_uid if it
-- appears in atlas_hq_users.provider_subs->'bound_user_ids' for any active
-- owner row. Binding is admin-only (per the existing
-- atlas_hq_users_provider_subs_write_guard_trg trigger from mig 253), so a
-- random user can't self-elevate.
--
-- Three accepted paths in the new function:
--   1. Direct auth_user_id match (legacy — Greg's existing Google binding)
--   2. provider_subs.bound_user_ids contains p_uid (admin-bound — Apple relay)
--   3. Email match (verified, non-relay)
-- Plus the migration-183 cross-user guard (caller must be service_role or self).

BEGIN;

CREATE OR REPLACE FUNCTION public.atlas_hq_is_owner(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_match boolean;
BEGIN
  -- INTENTIONAL: auth.role() and auth.uid() read invoker GUCs (request.jwt.claim.*),
  -- NOT definer context, despite SECURITY DEFINER. service_role/postgres callers
  -- pass the gate; authenticated callers must pass p_uid = auth.uid() (no cross-
  -- user owner queries). STABLE is safe under pgbouncer transaction-pooler.
  SELECT EXISTS (
    SELECT 1
    FROM public.atlas_hq_users hu
    WHERE hu.role = 'owner'
      AND hu.active
      AND (
        -- Path 1: legacy direct auth_user_id binding (Google web flow)
        hu.auth_user_id = p_uid
        -- Path 2: admin-bound via provider_subs.bound_user_ids (Apple relay path)
        OR (
          hu.provider_subs ? 'bound_user_ids'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(hu.provider_subs->'bound_user_ids') v(uid_text)
            WHERE v.uid_text = p_uid::text
          )
        )
        -- Path 3: email match (verified, non-relay) — original mig 253 logic
        OR EXISTS (
          SELECT 1
          FROM auth.users au
          WHERE au.id = p_uid
            AND au.email IS NOT NULL
            AND au.email_confirmed_at IS NOT NULL
            AND lower(au.email) = lower(hu.email)
            AND lower(au.email) NOT LIKE '%@privaterelay.appleid.com'
        )
      )
      AND (
        auth.role() IN ('service_role', 'postgres')
        OR p_uid = auth.uid()
      )
  ) INTO v_match;
  RETURN v_match;
END;
$function$;

COMMENT ON FUNCTION public.atlas_hq_is_owner(uuid) IS
  'Email-based owner check (mig 253) extended (mig 257) with two more paths: '
  'direct auth_user_id match for legacy Google bindings, AND provider_subs.bound_user_ids '
  'array for admin-bound Apple relay paths. Apple Hide-My-Email relay addresses STILL '
  'rejected on the email-match path (path 3). To accept a relay binding, an admin must '
  'INSERT the auth.users.id into the owner row''s provider_subs.bound_user_ids array — '
  'gated by atlas_hq_users_provider_subs_write_guard_trg (service_role/postgres only).';

REVOKE EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) FROM PUBLIC;

-- Post-check: verify Greg's existing Google uid still passes owner check.
DO $$
DECLARE
  v_greg_uid uuid;
  v_result boolean;
BEGIN
  SELECT id INTO v_greg_uid
  FROM auth.users
  WHERE lower(email) = 'greg@gomicrogridenergy.com'
    AND email_confirmed_at IS NOT NULL
  ORDER BY created_at LIMIT 1;

  IF v_greg_uid IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Post-check: no confirmed Greg auth.users row';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_greg_uid::text, 'role', 'service_role')::text,
    true
  );

  SELECT public.atlas_hq_is_owner(v_greg_uid) INTO v_result;

  IF NOT v_result THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'Post-check failed: rewritten atlas_hq_is_owner returned FALSE for Greg Google uid=%s',
        v_greg_uid
      );
  END IF;
END $$;

COMMIT;
