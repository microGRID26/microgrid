-- Migration 158 — spoke_feedback authenticated-only INSERT + per-uid 60s rate limit
-- + global 20/min floor + spoke-feedback bucket per-user path prefix.
-- Closes #233: bundle-inlined publishable key lets anyone spam rows + upload to bucket.
-- New: requires anonymous sign-in (authenticated JWT with auth.uid()) — rider spam
-- becomes bounded by session-creation rate, and the bucket is scoped to {uid}/filename.
-- Service role bypass preserved for HQ render + admin response writes.
--
-- NOTE: the spoke_feedback_rate_limit() function defined in this migration is
-- SUPERSEDED by migration 160. The current live definition adds an
-- advisory-xact lock (H2 fix) and a submitter_uid = auth.uid() assertion
-- (H4 defense-in-depth). If you're reading this file to understand the
-- rate-limit logic, read migration 160 — not the body below.
-- (R1 advisory-lock + submitter_uid assert added in migration 160.)

ALTER TABLE public.spoke_feedback
  ADD COLUMN IF NOT EXISTS submitter_uid uuid;

CREATE INDEX IF NOT EXISTS idx_spoke_feedback_submitter_created
  ON public.spoke_feedback (submitter_uid, created_at DESC);

DROP POLICY IF EXISTS "spoke_feedback_anon_insert" ON public.spoke_feedback;

CREATE POLICY "spoke_feedback_authenticated_insert"
ON public.spoke_feedback FOR INSERT TO authenticated
WITH CHECK (
  auth.role() = 'authenticated'
  AND auth.uid() IS NOT NULL
  AND submitter_uid = auth.uid()
  AND char_length(message) BETWEEN 1 AND 5000
);

-- SUPERSEDED BY MIGRATION 160 — the body below is stale. Read
-- supabase/migrations/160-feedback-ratelimit-advisory-lock-and-uid-check.sql
-- for the current live function body.
CREATE OR REPLACE FUNCTION public.spoke_feedback_rate_limit()
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
    RAISE EXCEPTION 'spoke_feedback: authentication required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.spoke_feedback sf
    WHERE sf.submitter_uid = v_uid
      AND sf.created_at > now() - interval '60 seconds'
  ) THEN
    RAISE EXCEPTION 'spoke_feedback: rate limit (60s/uid) exceeded' USING ERRCODE = 'P0001';
  END IF;
  IF (
    SELECT count(*) FROM public.spoke_feedback sf
    WHERE sf.created_at > now() - interval '60 seconds'
  ) >= 20 THEN
    RAISE EXCEPTION 'spoke_feedback: global rate limit (20/min) exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.spoke_feedback_rate_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spoke_feedback_rate_limit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.spoke_feedback_rate_limit() FROM authenticated;

DROP TRIGGER IF EXISTS trg_spoke_feedback_rate_limit ON public.spoke_feedback;
CREATE TRIGGER trg_spoke_feedback_rate_limit
BEFORE INSERT ON public.spoke_feedback
FOR EACH ROW EXECUTE FUNCTION public.spoke_feedback_rate_limit();

DROP POLICY IF EXISTS "spoke_feedback_anon_insert" ON storage.objects;

CREATE POLICY "spoke_feedback_insert_own_prefix"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'spoke-feedback'
  AND auth.uid() IS NOT NULL
  AND name ~ ('^' || auth.uid()::text || '/[^/]+$')
);

CREATE POLICY "spoke_feedback_select_own_prefix"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'spoke-feedback'
  AND auth.uid() IS NOT NULL
  AND name ~ ('^' || auth.uid()::text || '/[^/]+$')
);

CREATE POLICY "spoke_feedback_service_role_all"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'spoke-feedback')
WITH CHECK (bucket_id = 'spoke-feedback');
