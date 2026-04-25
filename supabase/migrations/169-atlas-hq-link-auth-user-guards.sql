-- 169: harden atlas_hq_link_auth_user against email pre-claim takeover
-- greg_actions #293 (P0). Audit-rotation 2026-04-25 / security-definer-rpcs.
--
-- Three guards added inside the function body:
--   1. email_confirmed_at must be non-null (no pre-claim before verification)
--   2. first-link-only (atlas_hq_users.auth_user_id IS NULL)
--   3. caller's auth.users.email must equal lower(p_email) AND domain in allow-list

CREATE OR REPLACE FUNCTION public.atlas_hq_link_auth_user(p_email text, p_auth_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_email          text;
  v_caller_confirmed_at   timestamptz;
  v_caller_domain         text;
  v_target_existing_uid   uuid;
  v_allowed_domains       text[] := ARRAY['gomicrogridenergy.com', 'energydevelopmentgroup.com', 'trismartsolar.com'];
BEGIN
  -- self-link only (existing guard, unchanged)
  IF p_auth_user_id IS NULL OR p_auth_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'atlas_hq_link_auth_user: self-link only (p_auth_user_id must equal auth.uid())'
      USING ERRCODE = '42501';
  END IF;

  -- look up the caller's auth.users row
  SELECT lower(u.email), u.email_confirmed_at
    INTO v_caller_email, v_caller_confirmed_at
    FROM auth.users u
   WHERE u.id = p_auth_user_id;

  IF v_caller_email IS NULL THEN
    RAISE EXCEPTION 'atlas_hq_link_auth_user: caller has no auth.users row'
      USING ERRCODE = '42501';
  END IF;

  -- guard 1: email must be confirmed
  IF v_caller_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'atlas_hq_link_auth_user: email not confirmed'
      USING ERRCODE = '42501';
  END IF;

  -- the email being linked must match the caller's verified email
  IF v_caller_email <> lower(p_email) THEN
    RAISE EXCEPTION 'atlas_hq_link_auth_user: p_email must match caller verified email'
      USING ERRCODE = '42501';
  END IF;

  -- guard 3: domain allow-list
  v_caller_domain := lower(split_part(v_caller_email, '@', 2));
  IF v_caller_domain IS NULL OR v_caller_domain = '' OR NOT (v_caller_domain = ANY(v_allowed_domains)) THEN
    RAISE EXCEPTION 'atlas_hq_link_auth_user: email domain not in HQ allow-list'
      USING ERRCODE = '42501';
  END IF;

  -- guard 2: first-link only (no overwriting an already-linked HQ row)
  SELECT auth_user_id INTO v_target_existing_uid
    FROM public.atlas_hq_users
   WHERE lower(email) = lower(p_email)
   LIMIT 1;

  IF v_target_existing_uid IS NOT NULL AND v_target_existing_uid <> p_auth_user_id THEN
    RAISE EXCEPTION 'atlas_hq_link_auth_user: row already linked to a different auth.uid'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.atlas_hq_users
     SET auth_user_id    = p_auth_user_id,
         last_sign_in_at = now()
   WHERE lower(email) = lower(p_email)
     AND (auth_user_id IS NULL OR auth_user_id = p_auth_user_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_link_auth_user(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_hq_link_auth_user(text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atlas_hq_link_auth_user(text, uuid) IS
  'HQ first-link self-link only. Guards: email_confirmed_at, caller-email-matches-p_email, domain allow-list, first-link-only. Hardened in migration 169 (greg_actions #293).';
