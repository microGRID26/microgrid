-- 319 — Atlas HQ self-feedback retire of mig 247: dedicated atlas_hq_feedback table + 5 RPCs
--
-- Anchor: Atlas HQ chain Phase 2B (2026-05-12). P1 #969 Tier 2.7.
--
-- WHY
-- ---
-- Mig 247's `app_feedback` was a unified-table architecture (Architecture B):
-- one table on MG holding feedback from every app, discriminated by `app_id`.
-- The chain switched to Architecture A (per-app sinks on per-app tenants;
-- HQ aggregates via SECDEF `atlas_list_<app>_feedback` RPCs). app_feedback
-- has 1 surviving row (Greg's own atlas-hq test submission) and no attachments.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Creates `public.atlas_hq_feedback` — Atlas-HQ-specific feedback sink on
--    MG (the only tenant HQ uses). Schema mirrors `app_feedback` minus the
--    `app_id` discriminator (no longer needed; this table is atlas-hq-only).
--    KEEPS the triage workflow columns (triage_decision, triage_severity,
--    greg_action_id, pr_url, updated_at) because the existing HQ /feedback
--    triage UX depends on them.
-- 2. Creates `public.atlas_hq_feedback_attachments` mirroring
--    `app_feedback_attachments` minus the app_id-prefix path check.
-- 3. Creates 5 RPCs cloned from `atlas_*_app_feedback`, minus the p_app_id
--    parameter:
--      atlas_add_atlas_hq_feedback
--      atlas_get_atlas_hq_feedback
--      atlas_list_atlas_hq_feedback
--      atlas_resolve_atlas_hq_feedback
--      atlas_set_atlas_hq_feedback_triage
-- 4. Copies the 1 surviving `app_feedback` row (where app_id='atlas-hq') to
--    `atlas_hq_feedback` with explicit column mapping.
--
-- WHAT THIS MIGRATION DOES *NOT* DO
-- ---------------------------------
-- - Does NOT drop `app_feedback`, `app_feedback_attachments`, `app_feedback_apps`,
--   or the 5 old `atlas_*_app_feedback` RPCs. The old surfaces stay live
--   while the consumer flip soaks. Phase 2C drops them ~7 days from now.
--   IMPORTANT for Phase 2C planner: must include `DROP TABLE public.app_feedback_apps;`
--   in the cleanup migration (11-row dictionary table; no consumer post-retire).
--   Migration-planner R1 audit (mig-319-audit, M2) flagged this.
-- - Does NOT change the `app-feedback` storage bucket. Existing object paths
--   start with `atlas-hq/...` which is fine for both old and new RPCs (the
--   new atlas_add RPC validates path prefix `atlas-hq/`).
-- - Does NOT touch `atlas_is_feedback_processed` or
--   `atlas_count_recent_feedback_dispatches` — those read
--   `atlas_feedback_actions` (not app_feedback) and are source-agnostic.
--
-- SECURITY MODEL
-- --------------
-- Service-role-only access. Atlas HQ runs against MG Supabase with the MG
-- service-role key; anon/authenticated never touch these tables or RPCs.
-- The 5 new RPCs use SECURITY DEFINER + locked search_path + explicit
-- REVOKE-then-GRANT-to-service_role (atlas-fn-grant-guard requirement).
-- The tables enable RLS but define NO policies — that means anon and
-- authenticated have zero access; only the service_role bypasses RLS.
--
-- ROLLBACK
-- --------
-- DROP TABLE atlas_hq_feedback CASCADE; (the 5 RPCs + attachments table fall
-- with it). The 1 row in app_feedback is unchanged so no data is lost on
-- rollback. App-side code can flip back to the old RPC names trivially.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.atlas_hq_feedback (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category        text,
    status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','reviewing','responded','closed')),
    message         text NOT NULL CHECK (length(trim(message)) > 0),
    rating          integer CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
    screen_path     text,
    screen_w        integer,
    screen_h        integer,
    viewport_w      integer,
    viewport_h      integer,
    user_agent      text,
    user_email      text,
    user_role       text,
    app_version     text,
    triage_decision text CHECK (
        triage_decision IS NULL OR triage_decision IN
        ('unclassified','duplicate','wontfix','queued','auto-fixed','escalated')
    ),
    triage_severity text CHECK (
        triage_severity IS NULL OR triage_severity IN ('low','medium','high','critical')
    ),
    greg_action_id  integer,
    pr_url          text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_hq_feedback_created_at_idx ON public.atlas_hq_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS atlas_hq_feedback_status_idx     ON public.atlas_hq_feedback (status) WHERE status <> 'closed';

COMMENT ON TABLE public.atlas_hq_feedback IS
  'Atlas HQ self-feedback sink. Replaces app_feedback (mig 247) for the atlas-hq app_id. Phase 2C drops app_feedback after this flip soaks.';

CREATE TABLE IF NOT EXISTS public.atlas_hq_feedback_attachments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id       uuid NOT NULL REFERENCES public.atlas_hq_feedback(id) ON DELETE CASCADE,
    storage_bucket    text NOT NULL DEFAULT 'app-feedback',
    storage_path      text NOT NULL CHECK (length(storage_path) > 0),
    mime_type         text,
    size_bytes        integer CHECK (size_bytes IS NULL OR size_bytes >= 0),
    original_filename text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS atlas_hq_feedback_attachments_feedback_idx
    ON public.atlas_hq_feedback_attachments (feedback_id);

COMMENT ON TABLE public.atlas_hq_feedback_attachments IS
  'Attachments for atlas_hq_feedback rows. Storage paths live in the existing app-feedback bucket under the atlas-hq/ prefix.';

-- ---------------------------------------------------------------------------
-- 2. RLS — service-role-only by design
-- ---------------------------------------------------------------------------

ALTER TABLE public.atlas_hq_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_hq_feedback_attachments ENABLE ROW LEVEL SECURITY;
-- No policies created intentionally — anon/authenticated have zero access.
-- service_role bypasses RLS via Postgres default. HQ aggregation goes through
-- the SECDEF RPCs below.

-- ---------------------------------------------------------------------------
-- 3. Trigger — keep updated_at fresh
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._atlas_hq_feedback_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS atlas_hq_feedback_updated_at ON public.atlas_hq_feedback;
CREATE TRIGGER atlas_hq_feedback_updated_at
    BEFORE UPDATE ON public.atlas_hq_feedback
    FOR EACH ROW
    EXECUTE FUNCTION public._atlas_hq_feedback_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RPCs — clones of atlas_*_app_feedback minus p_app_id parameter
-- ---------------------------------------------------------------------------

-- 4.1 ADD
CREATE OR REPLACE FUNCTION public.atlas_add_atlas_hq_feedback(
    p_message       text,
    p_category      text    DEFAULT NULL,
    p_rating        integer DEFAULT NULL,
    p_screen_path   text    DEFAULT NULL,
    p_screen_w      integer DEFAULT NULL,
    p_screen_h      integer DEFAULT NULL,
    p_viewport_w    integer DEFAULT NULL,
    p_viewport_h    integer DEFAULT NULL,
    p_user_agent    text    DEFAULT NULL,
    p_user_email    text    DEFAULT NULL,
    p_user_role     text    DEFAULT NULL,
    p_app_version   text    DEFAULT NULL,
    p_attachments   jsonb   DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
  v_att jsonb;
  v_path text;
  v_recent_count int;
BEGIN
  IF p_message IS NULL OR length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'message is required';
  END IF;

  IF p_user_email IS NOT NULL THEN
    SELECT count(*) INTO v_recent_count
      FROM public.atlas_hq_feedback
      WHERE user_email = p_user_email
        AND created_at > now() - interval '1 hour';
    IF v_recent_count >= 20 THEN
      RAISE EXCEPTION 'rate limit exceeded: % per hour for %', v_recent_count, p_user_email;
    END IF;
  END IF;

  IF p_attachments IS NOT NULL AND jsonb_array_length(p_attachments) > 20 THEN
    RAISE EXCEPTION 'too many attachments (max 20)';
  END IF;

  INSERT INTO public.atlas_hq_feedback (
    message, category, rating,
    screen_path, screen_w, screen_h, viewport_w, viewport_h,
    user_agent, user_email, user_role, app_version
  ) VALUES (
    p_message, p_category, p_rating,
    p_screen_path, p_screen_w, p_screen_h, p_viewport_w, p_viewport_h,
    p_user_agent, p_user_email, p_user_role, p_app_version
  )
  RETURNING id INTO v_id;

  IF p_attachments IS NOT NULL AND jsonb_array_length(p_attachments) > 0 THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments)
    LOOP
      v_path := v_att->>'storage_path';
      IF v_path IS NULL OR v_path !~ '^atlas-hq/' THEN
        RAISE EXCEPTION 'attachment storage_path must start with atlas-hq/...';
      END IF;

      INSERT INTO public.atlas_hq_feedback_attachments (
        feedback_id, storage_bucket, storage_path,
        mime_type, size_bytes, original_filename
      ) VALUES (
        v_id,
        coalesce(v_att->>'storage_bucket', 'app-feedback'),
        v_path,
        v_att->>'mime_type',
        nullif(v_att->>'size_bytes','')::int,
        v_att->>'original_filename'
      );
    END LOOP;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_add_atlas_hq_feedback(text,text,integer,text,integer,integer,integer,integer,text,text,text,text,jsonb) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_add_atlas_hq_feedback(text,text,integer,text,integer,integer,integer,integer,text,text,text,text,jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_add_atlas_hq_feedback(text,text,integer,text,integer,integer,integer,integer,text,text,text,text,jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_add_atlas_hq_feedback(text,text,integer,text,integer,integer,integer,integer,text,text,text,text,jsonb) TO service_role;

COMMENT ON FUNCTION public.atlas_add_atlas_hq_feedback(text,text,integer,text,integer,integer,integer,integer,text,text,text,text,jsonb) IS
  'Insert a new atlas_hq_feedback row + its attachments. Service-role only. Phase 2B replacement for atlas_add_app_feedback(p_app_id="atlas-hq",...).';

-- 4.2 GET
CREATE OR REPLACE FUNCTION public.atlas_get_atlas_hq_feedback(p_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'feedback', jsonb_build_object(
      'id', f.id,
      'category', f.category,
      'status', f.status,
      'message', f.message,
      'rating', f.rating,
      'screen_path', f.screen_path,
      'screen_w', f.screen_w,
      'screen_h', f.screen_h,
      'viewport_w', f.viewport_w,
      'viewport_h', f.viewport_h,
      'user_agent', f.user_agent,
      'user_email', f.user_email,
      'user_role', f.user_role,
      'app_version', f.app_version,
      'triage_decision', f.triage_decision,
      'triage_severity', f.triage_severity,
      'greg_action_id', f.greg_action_id,
      'pr_url', f.pr_url,
      'created_at', f.created_at,
      'updated_at', f.updated_at
    ),
    'attachments', coalesce(
      (SELECT jsonb_agg(jsonb_build_object(
                'id', a.id,
                'storage_bucket', a.storage_bucket,
                'storage_path', a.storage_path,
                'mime_type', a.mime_type,
                'size_bytes', a.size_bytes,
                'original_filename', a.original_filename,
                'created_at', a.created_at
              ) ORDER BY a.created_at)
       FROM public.atlas_hq_feedback_attachments a
       WHERE a.feedback_id = f.id),
      '[]'::jsonb
    )
  )
  FROM public.atlas_hq_feedback f
  WHERE f.id = p_id;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_get_atlas_hq_feedback(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_get_atlas_hq_feedback(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_get_atlas_hq_feedback(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_get_atlas_hq_feedback(uuid) TO service_role;

COMMENT ON FUNCTION public.atlas_get_atlas_hq_feedback(uuid) IS
  'Fetch one atlas_hq_feedback row + its attachments as jsonb. Service-role only.';

-- 4.3 LIST
CREATE OR REPLACE FUNCTION public.atlas_list_atlas_hq_feedback(
    p_status text DEFAULT NULL,
    p_limit  integer DEFAULT 50
)
RETURNS TABLE (
    id              uuid,
    category        text,
    status          text,
    message         text,
    rating          integer,
    screen_path     text,
    user_email      text,
    user_role       text,
    app_version     text,
    triage_decision text,
    triage_severity text,
    greg_action_id  integer,
    pr_url          text,
    attachment_count bigint,
    created_at      timestamptz,
    updated_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    f.id, f.category, f.status, f.message, f.rating,
    f.screen_path, f.user_email, f.user_role, f.app_version,
    f.triage_decision, f.triage_severity, f.greg_action_id, f.pr_url,
    (SELECT count(*) FROM public.atlas_hq_feedback_attachments a WHERE a.feedback_id = f.id) AS attachment_count,
    f.created_at, f.updated_at
  FROM public.atlas_hq_feedback f
  WHERE (p_status IS NULL OR f.status = p_status)
  ORDER BY f.created_at DESC
  LIMIT greatest(1, least(p_limit, 500));
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_list_atlas_hq_feedback(text,integer) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_list_atlas_hq_feedback(text,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_list_atlas_hq_feedback(text,integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_atlas_hq_feedback(text,integer) TO service_role;

COMMENT ON FUNCTION public.atlas_list_atlas_hq_feedback(text,integer) IS
  'List atlas_hq_feedback rows for HQ /feedback aggregation. Service-role only.';

-- 4.4 RESOLVE
CREATE OR REPLACE FUNCTION public.atlas_resolve_atlas_hq_feedback(
    p_id     uuid,
    p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_updated int;
BEGIN
  IF p_status NOT IN ('new','reviewing','responded','closed') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;
  UPDATE public.atlas_hq_feedback
    SET status = p_status
    WHERE id = p_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'feedback not found: id=%', p_id;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_resolve_atlas_hq_feedback(uuid,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_resolve_atlas_hq_feedback(uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_resolve_atlas_hq_feedback(uuid,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_resolve_atlas_hq_feedback(uuid,text) TO service_role;

COMMENT ON FUNCTION public.atlas_resolve_atlas_hq_feedback(uuid,text) IS
  'Status transition on an atlas_hq_feedback row. Service-role only.';

-- 4.5 SET TRIAGE
CREATE OR REPLACE FUNCTION public.atlas_set_atlas_hq_feedback_triage(
    p_id              uuid,
    p_decision        text,
    p_severity        text    DEFAULT NULL,
    p_greg_action_id  integer DEFAULT NULL,
    p_pr_url          text    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_updated int;
BEGIN
  IF p_decision NOT IN ('unclassified','duplicate','wontfix','queued','auto-fixed','escalated') THEN
    RAISE EXCEPTION 'invalid triage_decision: %', p_decision;
  END IF;
  IF p_severity IS NOT NULL AND p_severity NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'invalid triage_severity: %', p_severity;
  END IF;
  UPDATE public.atlas_hq_feedback
    SET triage_decision = p_decision,
        triage_severity = coalesce(p_severity, triage_severity),
        greg_action_id  = coalesce(p_greg_action_id, greg_action_id),
        pr_url          = coalesce(p_pr_url, pr_url)
    WHERE id = p_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'feedback not found: id=%', p_id;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_set_atlas_hq_feedback_triage(uuid,text,text,integer,text) FROM public;
REVOKE EXECUTE ON FUNCTION public.atlas_set_atlas_hq_feedback_triage(uuid,text,text,integer,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_set_atlas_hq_feedback_triage(uuid,text,text,integer,text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_set_atlas_hq_feedback_triage(uuid,text,text,integer,text) TO service_role;

COMMENT ON FUNCTION public.atlas_set_atlas_hq_feedback_triage(uuid,text,text,integer,text) IS
  'Triage workflow update on an atlas_hq_feedback row. Service-role only.';

-- ---------------------------------------------------------------------------
-- 5. Data migration — copy the surviving app_feedback row(s) where app_id='atlas-hq'
-- ---------------------------------------------------------------------------

INSERT INTO public.atlas_hq_feedback (
    id, category, status, message, rating,
    screen_path, screen_w, screen_h, viewport_w, viewport_h,
    user_agent, user_email, user_role, app_version,
    triage_decision, triage_severity, greg_action_id, pr_url,
    created_at, updated_at
)
SELECT
    af.id, af.category, af.status, af.message, af.rating,
    af.screen_path, af.screen_w, af.screen_h, af.viewport_w, af.viewport_h,
    af.user_agent, af.user_email, af.user_role, af.app_version,
    af.triage_decision, af.triage_severity, af.greg_action_id, af.pr_url,
    af.created_at, af.updated_at
FROM public.app_feedback af
WHERE af.app_id = 'atlas-hq'
ON CONFLICT (id) DO NOTHING;  -- idempotent: re-apply safe

-- Also mirror any existing attachments (count = 0 today; idempotent if re-applied).
INSERT INTO public.atlas_hq_feedback_attachments (
    id, feedback_id, storage_bucket, storage_path,
    mime_type, size_bytes, original_filename, created_at
)
SELECT
    afa.id, afa.feedback_id, afa.storage_bucket, afa.storage_path,
    afa.mime_type, afa.size_bytes, afa.original_filename, afa.created_at
FROM public.app_feedback_attachments afa
JOIN public.app_feedback af ON af.id = afa.feedback_id
WHERE af.app_id = 'atlas-hq'
ON CONFLICT (id) DO NOTHING;
