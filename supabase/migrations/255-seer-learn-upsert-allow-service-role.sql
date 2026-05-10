-- 255-seer-learn-upsert-allow-service-role.sql
--
-- Fixup for migration 254 — the 4 upsert RPCs (`seer_learn_upsert_concept`,
-- `seer_learn_upsert_story`, `seer_learn_upsert_flashcard`,
-- `seer_learn_upsert_quiz`) call `atlas_hq_is_owner(auth.uid())` to gate
-- writes. Problem: service_role JWTs (which is what the sync script uses)
-- have NO `sub` claim — auth.uid() returns NULL — atlas_hq_is_owner(NULL)
-- returns false — every upsert raises "owner only". Caught when
-- `npm run sync-content` came back with 162/162 failures.
--
-- The GRANT pattern is already the actual security gate (these RPCs are
-- granted to service_role ONLY, not to authenticated). But the inner
-- function-level check needs to recognize service_role context so the
-- script can call them.
--
-- Pattern: `auth.role() IN ('service_role','postgres') OR
-- atlas_hq_is_owner(auth.uid())`. Same defense-in-depth as how mig 253
-- handles cross-context callers internally.
--
-- COALESCE on auth.role() so a NULL JWT context (no role claim) doesn't
-- silently bypass the owner check via NULL-IN evaluation. If neither role
-- is service_role/postgres AND uid is null, owner check fails as intended.

BEGIN;

CREATE OR REPLACE FUNCTION public.seer_learn_upsert_concept(p_concept jsonb)
RETURNS public.learn_concepts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_concepts;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('service_role', 'postgres')
     AND NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  INSERT INTO public.learn_concepts (
    slug, title, subtitle, summary, category, display_order, intro, cfo_explanation,
    sections, skeptic_qa, where_in_atlas, related_slugs
  ) VALUES (
    p_concept->>'slug',
    p_concept->>'title',
    p_concept->>'subtitle',
    p_concept->>'summary',
    p_concept->>'category',
    (p_concept->>'display_order')::int,
    p_concept->>'intro',
    p_concept->>'cfo_explanation',
    COALESCE(p_concept->'sections', '[]'::jsonb),
    COALESCE(p_concept->'skeptic_qa', '[]'::jsonb),
    COALESCE(p_concept->'where_in_atlas', '[]'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_concept->'related_slugs')), ARRAY[]::text[])
  )
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    summary = EXCLUDED.summary,
    category = EXCLUDED.category,
    display_order = EXCLUDED.display_order,
    intro = EXCLUDED.intro,
    cfo_explanation = EXCLUDED.cfo_explanation,
    sections = EXCLUDED.sections,
    skeptic_qa = EXCLUDED.skeptic_qa,
    where_in_atlas = EXCLUDED.where_in_atlas,
    related_slugs = EXCLUDED.related_slugs
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_upsert_story(p_story jsonb)
RETURNS public.learn_stories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_stories;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('service_role', 'postgres')
     AND NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  INSERT INTO public.learn_stories (
    slug, title, subtitle, summary, story_date, project, duration, stakes, display_order,
    headline, impact, situation, sections, lessons, skeptic_qa,
    related_concept_slugs, related_story_slugs, commit_shas
  ) VALUES (
    p_story->>'slug',
    p_story->>'title',
    p_story->>'subtitle',
    p_story->>'summary',
    p_story->>'story_date',
    p_story->>'project',
    p_story->>'duration',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_story->'stakes')), ARRAY[]::text[]),
    (p_story->>'display_order')::int,
    p_story->>'headline',
    COALESCE(p_story->'impact', '[]'::jsonb),
    p_story->>'situation',
    COALESCE(p_story->'sections', '[]'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_story->'lessons')), ARRAY[]::text[]),
    COALESCE(p_story->'skeptic_qa', '[]'::jsonb),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_story->'related_concept_slugs')), ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_story->'related_story_slugs')), ARRAY[]::text[]),
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_story->'commit_shas')), ARRAY[]::text[])
  )
  ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    subtitle = EXCLUDED.subtitle,
    summary = EXCLUDED.summary,
    story_date = EXCLUDED.story_date,
    project = EXCLUDED.project,
    duration = EXCLUDED.duration,
    stakes = EXCLUDED.stakes,
    display_order = EXCLUDED.display_order,
    headline = EXCLUDED.headline,
    impact = EXCLUDED.impact,
    situation = EXCLUDED.situation,
    sections = EXCLUDED.sections,
    lessons = EXCLUDED.lessons,
    skeptic_qa = EXCLUDED.skeptic_qa,
    related_concept_slugs = EXCLUDED.related_concept_slugs,
    related_story_slugs = EXCLUDED.related_story_slugs,
    commit_shas = EXCLUDED.commit_shas
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_upsert_flashcard(p_card jsonb)
RETURNS public.learn_flashcards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_flashcards;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('service_role', 'postgres')
     AND NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  INSERT INTO public.learn_flashcards (id, term, category, technical, simple, example) VALUES (
    p_card->>'id',
    p_card->>'term',
    p_card->>'category',
    p_card->>'technical',
    p_card->>'simple',
    p_card->>'example'
  )
  ON CONFLICT (id) DO UPDATE SET
    term = EXCLUDED.term,
    category = EXCLUDED.category,
    technical = EXCLUDED.technical,
    simple = EXCLUDED.simple,
    example = EXCLUDED.example
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_upsert_quiz(p_concept_slug text, p_questions jsonb)
RETURNS public.learn_quizzes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_quizzes;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('service_role', 'postgres')
     AND NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  IF jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'questions must be a non-empty jsonb array';
  END IF;
  INSERT INTO public.learn_quizzes (concept_slug, questions) VALUES (p_concept_slug, p_questions)
  ON CONFLICT (concept_slug) DO UPDATE SET questions = EXCLUDED.questions
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

COMMIT;
