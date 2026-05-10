-- ─────────────────────────────────────────────────────────────────────────
-- mig 265 · Seer · Phase 3 Sprint 4.5 — per-concept quiz tracking
-- ─────────────────────────────────────────────────────────────────────────
-- Sprint 4 shipped quiz closure but quiz_score is a single per-day max
-- across ALL quizzes the user takes. UI consequence: passing ONE quiz
-- makes the "Quiz passed today" badge appear on every concept's CTA,
-- short-circuiting the "do more concepts" daily loop.
--
-- Fix: add seer_rings_daily.quiz_concepts text[] mirror of read_concepts,
-- and update seer_close_quiz_ring to append on each pass + gate the
-- doubled-bonus on per-concept-first-pass (not per-day-first-pass).
--
-- Behavior changes:
--   - quiz_score (per-day max) — unchanged. Daily QUIZ ring still closes
--     on the first ≥80% pass of the day per spec §6.1.
--   - quiz_concepts (NEW per-day per-pass log) — append on every ≥80%
--     pass that wasn't yet in the array.
--   - Doubled axis bonus — fires on FIRST per-concept ≥80% pass (was:
--     first per-day ≥80% pass; broken for any subsequent concept).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.seer_rings_daily
  ADD COLUMN IF NOT EXISTS quiz_concepts text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Replace seer_close_quiz_ring with the per-concept-aware version.
DROP FUNCTION IF EXISTS public.seer_close_quiz_ring(text, int);
CREATE OR REPLACE FUNCTION public.seer_close_quiz_ring(
  p_concept_slug text,
  p_score        int
)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid               uuid;
  v_today             date;
  v_category          text;
  v_already_passed    bool := false;
  v_row               public.seer_rings_daily;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_score < 0 OR p_score > 100 THEN
    RAISE EXCEPTION 'invalid_score: %', p_score USING ERRCODE = '22023';
  END IF;
  IF p_concept_slug IS NULL OR length(p_concept_slug) = 0 OR length(p_concept_slug) > 200 THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();
  v_today := public.seer_today_chicago();

  -- Race fix (red-teamer R1 H-1): two parallel quiz submissions for the
  -- same (user, slug, today) could both observe v_already_passed=false
  -- before either upsert commits, double-firing the doubled-bonus axis
  -- push. Per-(user, date) advisory lock serializes them; auto-released
  -- at tx commit.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );

  SELECT category INTO v_category FROM public.learn_concepts WHERE slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_concept: %', p_concept_slug USING ERRCODE = '22023';
  END IF;

  -- Per-concept-first-pass gate: capture pre-upsert state
  SELECT (p_concept_slug = ANY (quiz_concepts)) INTO v_already_passed
    FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  v_already_passed := COALESCE(v_already_passed, false);

  -- Upsert: bump quiz_score (max wins), append slug to quiz_concepts iff
  -- score >= 80 AND not already in the array.
  INSERT INTO public.seer_rings_daily (user_id, date, quiz_score, quiz_concepts)
  VALUES (
    v_uid, v_today, p_score,
    CASE WHEN p_score >= 80 THEN ARRAY[p_concept_slug] ELSE ARRAY[]::text[] END
  )
  ON CONFLICT (user_id, date) DO UPDATE
    SET quiz_score = GREATEST(public.seer_rings_daily.quiz_score, p_score),
        quiz_concepts = CASE
          WHEN p_score < 80
            THEN public.seer_rings_daily.quiz_concepts
          WHEN p_concept_slug = ANY (public.seer_rings_daily.quiz_concepts)
            THEN public.seer_rings_daily.quiz_concepts
          ELSE array_append(public.seer_rings_daily.quiz_concepts, p_concept_slug)
        END,
        updated_at = now()
  RETURNING * INTO v_row;

  -- Doubled-bonus axis push: fires only on FIRST per-concept ≥80% pass.
  IF p_score >= 80 AND NOT v_already_passed THEN
    CASE v_category
      WHEN 'fundamentals' THEN PERFORM public.seer_push_radar_axis(v_uid, 'Fundamentals', 10, 'quiz:'||p_concept_slug);
      WHEN 'agents'       THEN PERFORM public.seer_push_radar_axis(v_uid, 'Agents', 10, 'quiz:'||p_concept_slug);
      WHEN 'atlas' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 4, 'quiz:'||p_concept_slug);
      WHEN 'economics' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Frontier', 4, 'quiz:'||p_concept_slug);
      WHEN 'governance' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 4, 'quiz:'||p_concept_slug);
      ELSE
        -- Drift fix (red-teamer R1 M-1): unknown category would otherwise
        -- raise CASE_NOT_FOUND and roll back the upsert. Match the
        -- read-ring path's behavior: warn + continue, ring still closes.
        RAISE WARNING 'seer_close_quiz_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_uid, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$$;

-- Hardening: Supabase default-privileges grant `anon` directly (not via
-- PUBLIC inheritance) on new functions in schema public. REVOKE FROM
-- PUBLIC is a no-op there; the explicit `anon` revoke is what closes the
-- surface. Keep both so a re-apply is correct under either model.
REVOKE EXECUTE ON FUNCTION public.seer_close_quiz_ring(text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_close_quiz_ring(text, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_close_quiz_ring(text, int) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Carry-fix: same race exists in seer_close_read_ring (mig 263). Drop +
-- recreate with the per-(user, date) advisory lock at function entry.
-- Body otherwise identical to mig 263's version.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.seer_close_read_ring(text);
CREATE OR REPLACE FUNCTION public.seer_close_read_ring(p_concept_slug text)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid           uuid;
  v_today         date;
  v_category      text;
  v_already_read  bool := false;
  v_row           public.seer_rings_daily;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_concept_slug IS NULL OR length(p_concept_slug) = 0 OR length(p_concept_slug) > 200 THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();
  v_today := public.seer_today_chicago();

  -- Same race fix as quiz ring above. Per-(user, date) advisory lock so
  -- parallel reads of the same slug serialize through the gate.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );

  SELECT category INTO v_category
    FROM public.learn_concepts WHERE slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_concept: %', p_concept_slug USING ERRCODE = '22023';
  END IF;

  SELECT (p_concept_slug = ANY (read_concepts)) INTO v_already_read
    FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  v_already_read := COALESCE(v_already_read, false);

  INSERT INTO public.seer_rings_daily (user_id, date, read_count, read_concepts)
  VALUES (v_uid, v_today, 1, ARRAY[p_concept_slug])
  ON CONFLICT (user_id, date) DO UPDATE
    SET read_count = CASE
          WHEN p_concept_slug = ANY (public.seer_rings_daily.read_concepts)
            THEN public.seer_rings_daily.read_count
          ELSE public.seer_rings_daily.read_count + 1
        END,
        read_concepts = CASE
          WHEN p_concept_slug = ANY (public.seer_rings_daily.read_concepts)
            THEN public.seer_rings_daily.read_concepts
          ELSE array_append(public.seer_rings_daily.read_concepts, p_concept_slug)
        END,
        updated_at = now()
  RETURNING * INTO v_row;

  IF NOT v_already_read THEN
    CASE v_category
      WHEN 'fundamentals' THEN PERFORM public.seer_push_radar_axis(v_uid, 'Fundamentals', 5, 'concept:'||p_concept_slug);
      WHEN 'agents'       THEN PERFORM public.seer_push_radar_axis(v_uid, 'Agents', 5, 'concept:'||p_concept_slug);
      WHEN 'atlas' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 2, 'concept:'||p_concept_slug);
      WHEN 'economics' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Frontier', 2, 'concept:'||p_concept_slug);
      WHEN 'governance' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 2, 'concept:'||p_concept_slug);
      ELSE
        RAISE WARNING 'seer_close_read_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_uid, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_close_read_ring(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_close_read_ring(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_close_read_ring(text) TO authenticated;
