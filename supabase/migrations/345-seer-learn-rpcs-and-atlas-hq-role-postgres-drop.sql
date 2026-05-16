-- Mig 345 — Seer Learn RPC hardening + atlas_hq_* sister-fn postgres drop.
-- Closes greg_action #699 (R2 audit on migs 253-255 deferred 1 High + 2 Mediums).
-- Red-teamer R1 (2026-05-16) caught the "fix them all" gap: atlas_hq_get_user_role
-- (mig 185) and atlas_hq_resolve_owner_id (mig 310) carry the same role=postgres
-- trust pattern. Folded into this migration so the entire bypass surface closes
-- in one shot rather than leaving sibling holes open.
--
-- Fixes:
-- H1: atlas_hq_is_owner accepted any JWT with role=postgres. Real superusers
--     never reach PostgREST; service_role is the only legitimate caller.
--     Drop 'postgres' from the auth.role() IN-list.
-- H2: atlas_hq_get_user_role + atlas_hq_resolve_owner_id — same pattern, same drop.
-- M1: 6 read RPCs gated solely on atlas_hq_is_owner(auth.uid()) — service-role
--     callers (sync verification, future server-side reads) hit "owner only".
--     Mig 255 added the shim to the 4 upsert RPCs; this completes the surface.
-- M2: seer_learn_get_* returned silently empty row on miss (SELECT INTO leaves
--     v_row NULL). Add IF NOT FOUND RAISE so callers get an explicit error.
--     Per red-teamer: slug moved into HINT (PostgREST suppresses by default)
--     instead of MESSAGE so Sentry/log capture can't enumerate slugs.

BEGIN;

-- ---------------------------------------------------------------------------
-- H1: atlas_hq_is_owner — drop 'postgres' from the auth.role() IN-list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atlas_hq_is_owner(p_uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_match boolean;
BEGIN
  -- INTENTIONAL: auth.role() and auth.uid() read invoker GUCs (request.jwt.claim.*),
  -- NOT definer context, despite SECURITY DEFINER. service_role callers pass the
  -- gate; authenticated callers must pass p_uid = auth.uid() (no cross-user owner
  -- queries). STABLE is safe under pgbouncer transaction-pooler.
  -- 'postgres' was removed from the IN-list (mig 266): no legitimate PostgREST
  -- caller arrives with role=postgres; only direct DB superuser connections do,
  -- which never go through auth.role() at all.
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
        auth.role() = 'service_role'
        OR p_uid = auth.uid()
      )
  ) INTO v_match;
  RETURN v_match;
END;
$function$;

-- ---------------------------------------------------------------------------
-- M1 + M2: 6 read RPCs — add service_role shim + RAISE on get_* miss.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seer_learn_list_concepts()
 RETURNS SETOF learn_concepts
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() = 'service_role'
     OR public.atlas_hq_is_owner(auth.uid()) THEN
    RETURN QUERY SELECT * FROM public.learn_concepts ORDER BY display_order;
    RETURN;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_get_concept(p_slug text)
 RETURNS learn_concepts
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.learn_concepts;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.atlas_hq_is_owner(auth.uid())) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  SELECT * INTO v_row FROM public.learn_concepts WHERE slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found',
      MESSAGE = 'concept not found',
      HINT = 'slug=' || p_slug;
  END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_list_stories()
 RETURNS SETOF learn_stories
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.role() = 'service_role'
     OR public.atlas_hq_is_owner(auth.uid()) THEN
    RETURN QUERY SELECT * FROM public.learn_stories ORDER BY display_order;
    RETURN;
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_get_story(p_slug text)
 RETURNS learn_stories
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.learn_stories;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.atlas_hq_is_owner(auth.uid())) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  SELECT * INTO v_row FROM public.learn_stories WHERE slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found',
      MESSAGE = 'story not found',
      HINT = 'slug=' || p_slug;
  END IF;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_list_flashcards(p_category text DEFAULT NULL::text)
 RETURNS SETOF learn_flashcards
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.atlas_hq_is_owner(auth.uid())) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  IF p_category IS NULL THEN
    RETURN QUERY SELECT * FROM public.learn_flashcards ORDER BY category, term;
  ELSE
    RETURN QUERY SELECT * FROM public.learn_flashcards WHERE category = p_category ORDER BY term;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_get_quiz(p_concept_slug text)
 RETURNS learn_quizzes
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.learn_quizzes;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.atlas_hq_is_owner(auth.uid())) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  SELECT * INTO v_row FROM public.learn_quizzes WHERE concept_slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'no_data_found',
      MESSAGE = 'quiz not found',
      HINT = 'concept_slug=' || p_concept_slug;
  END IF;
  RETURN v_row;
END;
$function$;

-- ---------------------------------------------------------------------------
-- ACLs — explicit per-role grants on all 7 CREATE OR REPLACE'd functions.
-- atlas_hq_is_owner: callable by authenticated (Greg owner UI) + service_role.
-- 6 read RPCs: callable by authenticated (Seer mobile via supabase-js owner
-- session) + service_role. PUBLIC + anon always revoked.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.seer_learn_list_concepts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_concepts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_concepts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_list_concepts() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.seer_learn_get_concept(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_concept(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_concept(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_get_concept(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.seer_learn_list_stories() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_stories() FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_stories() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_list_stories() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.seer_learn_get_story(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_story(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_story(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_get_story(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.seer_learn_list_flashcards(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_flashcards(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_flashcards(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_list_flashcards(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.seer_learn_get_quiz(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_quiz(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_quiz(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_get_quiz(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- H2: atlas_hq_get_user_role + atlas_hq_resolve_owner_id — sister-fn drop
-- of 'postgres' from auth.role() IN-list. Bodies preserved verbatim except
-- the IN-list / OR clause.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.atlas_hq_get_user_role(p_email text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT json_build_object(
    'role', role, 'active', active, 'name', name,
    'id', id, 'auth_user_id', auth_user_id, 'scope', scope
  )
  FROM public.atlas_hq_users
  WHERE lower(email) = lower(p_email)
    AND (
      auth.role() = 'service_role'
      OR lower((SELECT email FROM auth.users WHERE id = auth.uid())) = lower(p_email)
    )
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.atlas_hq_resolve_owner_id(p_uid uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  IF p_uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR p_uid = auth.uid()) THEN
    RAISE EXCEPTION 'cross_user_resolve_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT hu.id INTO v_owner_id
    FROM public.atlas_hq_users hu
   WHERE hu.role = 'owner' AND hu.active
     AND (
       hu.auth_user_id = p_uid
       OR (hu.provider_subs ? 'bound_user_ids'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(hu.provider_subs->'bound_user_ids') v(uid_text)
                        WHERE v.uid_text = p_uid::text))
     )
   ORDER BY hu.id
   LIMIT 1;
  RETURN v_owner_id;
END;
$function$;

-- ACLs for the 2 sister fns (atlas_hq_get_user_role is called by HQ Google
-- OAuth callback as authenticated; atlas_hq_resolve_owner_id is server-only).
REVOKE EXECUTE ON FUNCTION public.atlas_hq_get_user_role(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_get_user_role(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_get_user_role(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_hq_get_user_role(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) TO service_role;

-- Post-apply verification:
-- 1. SELECT pg_get_functiondef('public.atlas_hq_is_owner(uuid)'::regprocedure)
--    -> auth.role() IN-list now reads only 'service_role'.
-- 2. SELECT public.seer_learn_list_concepts() as service_role
--    -> returns rows (was returning rows already because of postgres-in-IN-list
--    bug; this verifies the shim path is the legitimate route now).
-- 3. SELECT public.seer_learn_get_concept('nonexistent-slug')
--    -> raises no_data_found instead of returning empty row.

COMMIT;
