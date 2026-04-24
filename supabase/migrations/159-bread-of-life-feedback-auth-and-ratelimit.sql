-- Migration 159 — bread_of_life_feedback authenticated-only INSERT + rate limit.
-- Doubles as bug fix: the pre-existing "anon_insert" policy used
-- with_check=auth_is_internal_writer() which denies the public-keyed client.
-- Anne's feedback has been silently dropped (0 rows). This migration replaces
-- that broken policy with one that actually works once bread-of-life adds
-- anonymous sign-in (Part D of Phase 4). Text-only — no bucket work.
--
-- NOTE: the bread_of_life_feedback_rate_limit() function defined in this
-- migration is SUPERSEDED by migration 160 (adds advisory-xact lock + a
-- submitter_uid = auth.uid() assertion). Read migration 160 for the current
-- live body.
-- (R1 advisory-lock + submitter_uid assert added in migration 160.)

ALTER TABLE public.bread_of_life_feedback
  ADD COLUMN IF NOT EXISTS submitter_uid uuid;

CREATE INDEX IF NOT EXISTS idx_bread_of_life_feedback_submitter_created
  ON public.bread_of_life_feedback (submitter_uid, created_at DESC);

DROP POLICY IF EXISTS "anon_insert" ON public.bread_of_life_feedback;

CREATE POLICY "bread_of_life_feedback_authenticated_insert"
ON public.bread_of_life_feedback FOR INSERT TO authenticated
WITH CHECK (
  auth.role() = 'authenticated'
  AND auth.uid() IS NOT NULL
  AND submitter_uid = auth.uid()
  AND char_length(message) BETWEEN 1 AND 5000
);

-- SUPERSEDED BY MIGRATION 160 — the body below is stale. Read
-- supabase/migrations/160-feedback-ratelimit-advisory-lock-and-uid-check.sql
-- for the current live function body.
CREATE OR REPLACE FUNCTION public.bread_of_life_feedback_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
-- SUPERSEDED BY MIGRATION 160 — see 160 for live body.
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'bread_of_life_feedback: authentication required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bread_of_life_feedback b
    WHERE b.submitter_uid = v_uid
      AND b.created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'bread_of_life_feedback: rate limit (60s/uid) exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF (
    SELECT count(*) FROM public.bread_of_life_feedback b
    WHERE b.created_at > now() - interval '60 seconds'
  ) >= 20 THEN
    RAISE EXCEPTION 'bread_of_life_feedback: global rate limit (20/min) exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bread_of_life_feedback_rate_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bread_of_life_feedback_rate_limit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.bread_of_life_feedback_rate_limit() FROM authenticated;

DROP TRIGGER IF EXISTS trg_bread_of_life_feedback_rate_limit ON public.bread_of_life_feedback;
CREATE TRIGGER trg_bread_of_life_feedback_rate_limit
BEFORE INSERT ON public.bread_of_life_feedback
FOR EACH ROW EXECUTE FUNCTION public.bread_of_life_feedback_rate_limit();
