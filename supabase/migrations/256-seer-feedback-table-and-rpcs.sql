-- 256-seer-feedback-table-and-rpcs.sql
--
-- Seer in-app feedback on HQ Supabase. Mirrors the pattern across MG /
-- Bloom / Quest where each app has a feedback FAB that posts to its own
-- table, and a service-role aggregator RPC that the HQ /feedback page
-- consumes to surface unread items.
--
-- The OLD Seer Supabase project had this exact table + atlas_list_seer_feedback
-- RPC. Since Seer rebuild joined the HQ project (per spec §3 / mig 253), we
-- recreate them here on the HQ project so the existing HQ aggregator code at
-- hq.gomicrogridenergy.com/feedback continues to work without changes on
-- its side — just point at this project instead of the retired one.
--
-- Surface:
--   * seer_feedback table — RLS deny-all-direct (matches HQ pattern)
--   * seer_submit_feedback(...) RPC — owner-gated insert; called by mobile FAB
--   * atlas_list_seer_feedback(p_since, p_limit) RPC — service_role only;
--     called by HQ aggregator. Exact column list match to old project's RPC
--     so the HQ side is a drop-in source swap (no code change in HQ
--     /feedback page logic).

BEGIN;

-- =============================================================
-- 1. seer_feedback table
-- =============================================================

CREATE TABLE IF NOT EXISTS public.seer_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  category      text NOT NULL DEFAULT 'general' CHECK (category IN ('general','bug','feature','content','other')),
  message       text NOT NULL CHECK (length(trim(message)) > 0 AND length(message) <= 5000),
  screen        text,                     -- pathname or screen name FAB was tapped from
  app_version   text,                     -- e.g. "1.0.0"
  device_info   text,                     -- "iPhone 17 Pro Max iOS 18.7.3"
  photo_url     text,                     -- nullable; photo attachments deferred (storage bucket comes later)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seer_feedback_created_idx ON public.seer_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS seer_feedback_user_idx    ON public.seer_feedback (user_id, created_at DESC);

ALTER TABLE public.seer_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seer_feedback_deny_all ON public.seer_feedback;
CREATE POLICY seer_feedback_deny_all ON public.seer_feedback
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.seer_feedback IS
  'In-app feedback submissions from Seer mobile. RLS deny-all-direct; access via seer_submit_feedback (owner mobile) and atlas_list_seer_feedback (service_role HQ aggregator) RPCs only.';

-- =============================================================
-- 2. seer_submit_feedback — owner-gated insert RPC
-- =============================================================

CREATE OR REPLACE FUNCTION public.seer_submit_feedback(
  p_message     text,
  p_category    text DEFAULT 'general',
  p_screen      text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_info text DEFAULT NULL
)
RETURNS public.seer_feedback
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid;
  v_row public.seer_feedback;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'auth required';
  END IF;
  IF NOT public.atlas_hq_is_owner(v_uid) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'message must be non-empty';
  END IF;
  IF length(p_message) > 5000 THEN
    RAISE EXCEPTION USING MESSAGE = 'message exceeds 5000 chars';
  END IF;

  INSERT INTO public.seer_feedback (user_id, category, message, screen, app_version, device_info)
  VALUES (
    v_uid,
    COALESCE(NULLIF(p_category, ''), 'general'),
    p_message,
    p_screen,
    p_app_version,
    p_device_info
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.seer_submit_feedback(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seer_submit_feedback(text, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.seer_submit_feedback(text, text, text, text, text) IS
  'Owner-gated feedback insert RPC — called by Seer mobile FeedbackFAB. Validates message length, auto-defaults category to general, stamps user_id from auth.uid().';

-- =============================================================
-- 3. atlas_list_seer_feedback — service_role aggregator RPC
--    Exact column shape match to the retired old-project version
--    so HQ /feedback page is a drop-in source swap.
-- =============================================================

CREATE OR REPLACE FUNCTION public.atlas_list_seer_feedback(
  p_since timestamptz DEFAULT now() - interval '25 hours',
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  id           uuid,
  category     text,
  message      text,
  screen       text,
  app_version  text,
  device_info  text,
  photo_url    text,
  created_at   timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT id, category::text, message, screen, app_version, device_info, photo_url, created_at
  FROM public.seer_feedback
  WHERE created_at >= p_since
  ORDER BY created_at DESC
  LIMIT p_limit
$function$;

REVOKE ALL ON FUNCTION public.atlas_list_seer_feedback(timestamptz, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_list_seer_feedback(timestamptz, int) TO service_role;

COMMENT ON FUNCTION public.atlas_list_seer_feedback(timestamptz, int) IS
  'Service-role aggregator RPC for HQ hq.gomicrogridenergy.com/feedback page. Exact column shape mirror of the retired old-Seer-project version so HQ code is a drop-in source swap (just point at HQ project instead of aapmlqbtzqhpvfouclow).';

-- =============================================================
-- 4. Post-check: verify the surface with simulated owner context
-- =============================================================

DO $$
DECLARE
  v_uid uuid;
  v_row public.seer_feedback;
  v_count int;
BEGIN
  SELECT id INTO v_uid FROM auth.users
  WHERE lower(email)='greg@gomicrogridenergy.com' AND email_confirmed_at IS NOT NULL
  ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Post-check: no Greg auth.users row';
  END IF;

  -- Simulate authenticated owner
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
    true
  );

  -- Insert via RPC
  SELECT * INTO v_row FROM public.seer_submit_feedback(
    p_message := 'Phase 0 R2 post-check feedback row — auto-generated, safe to delete',
    p_category := 'other',
    p_screen := 'migration-256-postcheck',
    p_app_version := '1.0.0',
    p_device_info := 'postgres-postcheck'
  );

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Post-check: seer_submit_feedback returned null id';
  END IF;

  -- Aggregator readback under service_role
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'service_role')::text,
    true
  );
  SELECT count(*) INTO v_count FROM public.atlas_list_seer_feedback();
  IF v_count < 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Post-check: atlas_list_seer_feedback returned 0 rows';
  END IF;

  -- Clean up the post-check row so we don't pollute the queue
  DELETE FROM public.seer_feedback WHERE id = v_row.id;
END $$;

COMMIT;
