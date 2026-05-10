-- Phase 4 Sprint 1B — Extend seer_close_read_ring + seer_close_quiz_ring
-- with axis mappings for the four Software Fluency categories.
--
-- Before: only fundamentals/agents/atlas/economics/governance push axes;
-- engineering/system-design/leadership/infrastructure hit the ELSE branch
-- and emit RAISE WARNING every time Greg reads/quizzes a Phase 4 concept.
--
-- After: all 9 categories push real axes. Mapping (confirmed by Greg
-- 2026-05-10):
--   engineering    → Fundamentals (5 read / 10 quiz)
--   system-design  → Tooling (3/6) + Frontier (2/4)
--   leadership     → Workflow (5/10)
--   infrastructure → Tooling (3/6) + Workflow (2/4)
--
-- Multi-statement DDL wrapped in a transaction (M4 from Sprint 1A: avoid
-- the small constraint-gap window seen on the prior CHECK constraint
-- relax migration).

BEGIN;

CREATE OR REPLACE FUNCTION public.seer_close_read_ring(p_concept_slug text)
 RETURNS seer_rings_daily
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );

  SELECT category INTO v_category FROM public.learn_concepts WHERE slug = p_concept_slug;
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
      WHEN 'engineering' THEN PERFORM public.seer_push_radar_axis(v_uid, 'Fundamentals', 5, 'concept:'||p_concept_slug);
      WHEN 'system-design' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Frontier', 2, 'concept:'||p_concept_slug);
      WHEN 'leadership' THEN PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 5, 'concept:'||p_concept_slug);
      WHEN 'infrastructure' THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.seer_close_quiz_ring(p_concept_slug text, p_score integer)
 RETURNS seer_rings_daily
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid            uuid;
  v_today          date;
  v_category       text;
  v_already_passed bool := false;
  v_row            public.seer_rings_daily;
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || v_today::text, 0)
  );

  SELECT category INTO v_category FROM public.learn_concepts WHERE slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_concept: %', p_concept_slug USING ERRCODE = '22023';
  END IF;

  SELECT (p_concept_slug = ANY (quiz_concepts)) INTO v_already_passed
    FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  v_already_passed := COALESCE(v_already_passed, false);

  INSERT INTO public.seer_rings_daily (user_id, date, quiz_score, quiz_concepts)
  VALUES (
    v_uid, v_today, p_score,
    CASE WHEN p_score >= 80 THEN ARRAY[p_concept_slug] ELSE ARRAY[]::text[] END
  )
  ON CONFLICT (user_id, date) DO UPDATE
    SET quiz_score = GREATEST(public.seer_rings_daily.quiz_score, p_score),
        quiz_concepts = CASE
          WHEN p_score < 80 THEN public.seer_rings_daily.quiz_concepts
          WHEN p_concept_slug = ANY (public.seer_rings_daily.quiz_concepts)
            THEN public.seer_rings_daily.quiz_concepts
          ELSE array_append(public.seer_rings_daily.quiz_concepts, p_concept_slug)
        END,
        updated_at = now()
  RETURNING * INTO v_row;

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
      WHEN 'engineering' THEN PERFORM public.seer_push_radar_axis(v_uid, 'Fundamentals', 10, 'quiz:'||p_concept_slug);
      WHEN 'system-design' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Frontier', 4, 'quiz:'||p_concept_slug);
      WHEN 'leadership' THEN PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 10, 'quiz:'||p_concept_slug);
      WHEN 'infrastructure' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 4, 'quiz:'||p_concept_slug);
      ELSE
        RAISE WARNING 'seer_close_quiz_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_uid, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$function$;

COMMIT;
