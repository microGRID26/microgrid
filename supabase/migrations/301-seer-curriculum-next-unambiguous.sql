-- Migration 301: hotfix for mig 300's seer_curriculum_next() — the inner
-- subquery `WHERE category = sp.slug` collided with the OUT param named
-- `category` (PL/pgSQL ambiguity 42702). Caught at post-apply smoke 2026-05-12.
-- Qualify the table reference so the planner unambiguously resolves to
-- learn_flashcards.category.
--
-- Pre-flight reviewer (mig 300 cycle) did NOT catch this — the conflict only
-- triggers at execution time when the FOR loop OUT variables are in scope.
-- Static SQL inspection couldn't have flagged it without running the function.

BEGIN;

DROP FUNCTION IF EXISTS public.seer_curriculum_next();

CREATE OR REPLACE FUNCTION public.seer_curriculum_next()
RETURNS TABLE(
  slug              text,
  title             text,
  subtitle          text,
  category          text,
  kind              text,
  gating            boolean,
  rank_id           int,
  position_num      int,
  total_authored    int,
  total_planned     int,
  estimated_minutes int,
  at_end            boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_pos          int;
  v_read         text[];
  v_listened     text[];
  v_known        text[];
  v_quizzes      text[];
  v_flashcards   text[];
  v_total_auth   int;
  v_total_plan   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - curriculum requires authenticated user' USING ERRCODE = '42501';
  END IF;

  SELECT cp.current_position,
         cp.read_slugs, cp.listened_slugs, cp.known_slugs,
         cp.quizzes_passed, cp.flashcard_sets_learned
  INTO v_pos, v_read, v_listened, v_known, v_quizzes, v_flashcards
  FROM public.seer_curriculum_progress cp
  WHERE cp.user_id = v_uid;

  IF v_pos IS NULL THEN
    v_pos := 1;
    v_read := '{}'::text[]; v_listened := '{}'::text[]; v_known := '{}'::text[];
    v_quizzes := '{}'::text[]; v_flashcards := '{}'::text[];
  END IF;

  SELECT count(*)::int INTO v_total_auth FROM public.seer_curriculum_path;
  v_total_plan := v_total_auth;

  FOR slug, title, subtitle, category, kind, gating, rank_id, position_num IN
    SELECT
      sp.slug,
      CASE sp.kind
        WHEN 'concept'    THEN lc.title
        WHEN 'quiz'       THEN 'Quiz - ' || COALESCE(lcq.title, sp.slug)
        WHEN 'flashcards' THEN 'Flashcards - ' || sp.slug
        WHEN 'story'      THEN ls.title
      END AS title,
      CASE sp.kind
        WHEN 'concept'    THEN lc.subtitle
        WHEN 'quiz'       THEN 'Retention check - ' || COALESCE(jsonb_array_length(lq.questions)::text, '?') || ' questions'
        WHEN 'flashcards' THEN (
          SELECT count(*)::text || ' cards'
          FROM public.learn_flashcards lf
          WHERE lf.category = sp.slug
        )
        WHEN 'story'      THEN ls.subtitle
      END AS subtitle,
      sp.category,
      sp.kind,
      sp.gating,
      sp.rank_id,
      sp.position
    FROM public.seer_curriculum_path sp
    LEFT JOIN public.learn_concepts lc  ON sp.kind = 'concept' AND lc.slug = sp.slug
    LEFT JOIN public.learn_quizzes  lq  ON sp.kind = 'quiz'    AND lq.concept_slug = sp.slug
    LEFT JOIN public.learn_concepts lcq ON sp.kind = 'quiz'    AND lcq.slug = sp.slug
    LEFT JOIN public.learn_stories  ls  ON sp.kind = 'story'   AND ls.slug = sp.slug
    WHERE sp.position >= v_pos
      AND (
        sp.gating = false
        OR (sp.kind = 'concept'    AND NOT (sp.slug = ANY(v_read || v_listened || v_known)))
        OR (sp.kind = 'quiz'       AND NOT (sp.slug = ANY(v_quizzes)))
        OR (sp.kind = 'flashcards' AND NOT (sp.slug = ANY(v_flashcards)))
        OR (sp.kind = 'story')
      )
    ORDER BY sp.position ASC
    LIMIT 1
  LOOP
    total_authored := v_total_auth;
    total_planned  := v_total_plan;
    estimated_minutes := CASE kind
                           WHEN 'concept'    THEN 7
                           WHEN 'quiz'       THEN 3
                           WHEN 'flashcards' THEN 5
                           WHEN 'story'      THEN 6
                         END;
    at_end := false;
    RETURN NEXT;
    RETURN;
  END LOOP;

  slug := NULL; title := NULL; subtitle := NULL; category := NULL;
  kind := NULL; gating := NULL; rank_id := NULL; position_num := NULL;
  total_authored := v_total_auth; total_planned := v_total_plan;
  estimated_minutes := 0; at_end := true;
  RETURN NEXT;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_next() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_next() FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_next() TO authenticated;

COMMIT;
