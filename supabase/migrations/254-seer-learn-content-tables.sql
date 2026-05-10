-- 254-seer-learn-content-tables.sql
--
-- Phase 0 step 7 of Seer elite rebuild — create the Supabase tables that hold
-- concept / story / flashcard / quiz content. Per spec §3.2, these become the
-- single source of truth for both HQ web AND Seer mobile. Diagrams + Sandboxes
-- remain TSX components per surface (web in HQ, native in Seer Phase 3).
--
-- Tables created EMPTY here. A separate sync script (~/repos/ATLAS-HQ/scripts/
-- sync-content-to-supabase.ts) reads the existing TS modules at:
--   ~/repos/ATLAS-HQ/lib/explainer/concepts/<slug>/content.ts  (16 concepts)
--   ~/repos/ATLAS-HQ/lib/stories/content/<slug>.ts             (10 stories)
--   ~/repos/ATLAS-HQ/lib/learn/flashcards.ts                   (FLASHCARDS array)
--   ~/repos/ATLAS-HQ/lib/explainer/quiz-data.ts                (QUIZZES array)
-- and upserts rows. Phase 0 step 8 (HQ web refactor) wires the existing
-- registry.ts to fetch from these tables instead of importing the TS data.
--
-- RLS pattern matches existing HQ tables (greg_actions, atlas_*):
--   * deny-all to anon AND authenticated
--   * read access via SECURITY DEFINER RPCs gated by atlas_hq_is_owner(auth.uid())
--   * write access via separate owner-gated upsert RPCs (called by sync script
--     running as service_role, NOT from any user-facing path)
--
-- Future: when/if a concept needs to go public (e.g. Greg shares /learn URLs
-- externally), add an `is_public boolean DEFAULT false` column to learn_concepts
-- + a separate `seer_public_get_concept(slug)` RPC that bypasses owner check
-- ONLY when is_public=true. Out of scope this migration.

BEGIN;

-- =============================================================
-- 1. learn_concepts — port of ConceptContent shape
-- =============================================================

CREATE TABLE IF NOT EXISTS public.learn_concepts (
  slug              text PRIMARY KEY,
  title             text NOT NULL,
  subtitle          text NOT NULL,
  summary           text NOT NULL,
  category          text NOT NULL CHECK (category IN ('fundamentals','agents','atlas','economics','governance')),
  display_order     int  NOT NULL,
  intro             text NOT NULL,
  cfo_explanation   text NOT NULL,
  -- Section[]: [{heading, body}]
  sections          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- SkepticQA[]: [{question, answer}]
  skeptic_qa        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- WhereInAtlas[]: [{title, detail}]
  where_in_atlas    jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_slugs     text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.learn_concepts IS
  'Concept content (16 concepts as of 2026-05-10). Single source of truth for both HQ web /learn and Seer mobile Learn tab. Diagrams + Sandboxes remain TSX components per surface. Seeded by ~/repos/ATLAS-HQ/scripts/sync-content-to-supabase.ts.';

CREATE INDEX IF NOT EXISTS learn_concepts_category_idx ON public.learn_concepts (category, display_order);

ALTER TABLE public.learn_concepts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learn_concepts_deny_all ON public.learn_concepts;
CREATE POLICY learn_concepts_deny_all ON public.learn_concepts
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- =============================================================
-- 2. learn_stories — port of StoryContent shape
-- =============================================================

CREATE TABLE IF NOT EXISTS public.learn_stories (
  slug                  text PRIMARY KEY,
  title                 text NOT NULL,
  subtitle              text NOT NULL,
  summary               text NOT NULL,
  story_date            text NOT NULL,
  project               text NOT NULL,
  duration              text NOT NULL,
  -- StoryStake[]: text array, e.g. ['security','data-integrity']
  stakes                text[] NOT NULL DEFAULT ARRAY[]::text[],
  display_order         int  NOT NULL,
  headline              text NOT NULL,
  -- StoryImpact[]: [{label, value}]
  impact                jsonb NOT NULL DEFAULT '[]'::jsonb,
  situation             text NOT NULL,
  -- StorySection[]: [{heading, body}]
  sections              jsonb NOT NULL DEFAULT '[]'::jsonb,
  lessons               text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- SkepticQA[]: [{q, a}]
  skeptic_qa            jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_concept_slugs text[] NOT NULL DEFAULT ARRAY[]::text[],
  related_story_slugs   text[] NOT NULL DEFAULT ARRAY[]::text[],
  commit_shas           text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.learn_stories IS
  'Case-study content (10 stories as of 2026-05-10). Real production work with commit SHAs. Same RPC-gated access pattern as learn_concepts.';

CREATE INDEX IF NOT EXISTS learn_stories_order_idx ON public.learn_stories (display_order);

ALTER TABLE public.learn_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learn_stories_deny_all ON public.learn_stories;
CREATE POLICY learn_stories_deny_all ON public.learn_stories
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- =============================================================
-- 3. learn_flashcards — port of Flashcard shape
-- =============================================================

CREATE TABLE IF NOT EXISTS public.learn_flashcards (
  id            text PRIMARY KEY,
  term          text NOT NULL,
  category      text NOT NULL CHECK (category IN ('cli','git','web','database','ai','security','code','infra','atlas')),
  technical     text NOT NULL,
  simple        text NOT NULL,
  example       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.learn_flashcards IS
  '100+ flashcards each with technical answer + plain-English answer. Source: ~/repos/ATLAS-HQ/lib/learn/flashcards.ts FLASHCARDS array.';

CREATE INDEX IF NOT EXISTS learn_flashcards_category_idx ON public.learn_flashcards (category);

ALTER TABLE public.learn_flashcards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learn_flashcards_deny_all ON public.learn_flashcards;
CREATE POLICY learn_flashcards_deny_all ON public.learn_flashcards
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- =============================================================
-- 4. learn_quizzes — one row per concept-slug, jsonb questions array
-- =============================================================

CREATE TABLE IF NOT EXISTS public.learn_quizzes (
  concept_slug  text PRIMARY KEY,
  -- QuizQuestion[]: [{question, options:[text], correctIndex, explanation}]
  questions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- soft FK to learn_concepts.slug; not enforced because quiz can ship before concept (rare) or vice versa
  CONSTRAINT learn_quizzes_questions_array CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) > 0)
);

COMMENT ON TABLE public.learn_quizzes IS
  'Quiz questions per concept. Source: ~/repos/ATLAS-HQ/lib/explainer/quiz-data.ts QUIZZES array. Each row is one concept''s questions.';

ALTER TABLE public.learn_quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS learn_quizzes_deny_all ON public.learn_quizzes;
CREATE POLICY learn_quizzes_deny_all ON public.learn_quizzes
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- =============================================================
-- 5. updated_at triggers (one per table — bump on every UPDATE)
-- =============================================================

CREATE OR REPLACE FUNCTION public.seer_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learn_concepts_set_updated_at ON public.learn_concepts;
CREATE TRIGGER learn_concepts_set_updated_at BEFORE UPDATE ON public.learn_concepts
  FOR EACH ROW EXECUTE FUNCTION public.seer_set_updated_at();

DROP TRIGGER IF EXISTS learn_stories_set_updated_at ON public.learn_stories;
CREATE TRIGGER learn_stories_set_updated_at BEFORE UPDATE ON public.learn_stories
  FOR EACH ROW EXECUTE FUNCTION public.seer_set_updated_at();

DROP TRIGGER IF EXISTS learn_flashcards_set_updated_at ON public.learn_flashcards;
CREATE TRIGGER learn_flashcards_set_updated_at BEFORE UPDATE ON public.learn_flashcards
  FOR EACH ROW EXECUTE FUNCTION public.seer_set_updated_at();

DROP TRIGGER IF EXISTS learn_quizzes_set_updated_at ON public.learn_quizzes;
CREATE TRIGGER learn_quizzes_set_updated_at BEFORE UPDATE ON public.learn_quizzes
  FOR EACH ROW EXECUTE FUNCTION public.seer_set_updated_at();

-- =============================================================
-- 6. Read RPCs — owner-gated via atlas_hq_is_owner(auth.uid())
--    Mobile + HQ web both call these to fetch content.
-- =============================================================

CREATE OR REPLACE FUNCTION public.seer_learn_list_concepts()
RETURNS SETOF public.learn_concepts
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  RETURN QUERY SELECT * FROM public.learn_concepts ORDER BY display_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_get_concept(p_slug text)
RETURNS public.learn_concepts
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_concepts;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  SELECT * INTO v_row FROM public.learn_concepts WHERE slug = p_slug;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_list_stories()
RETURNS SETOF public.learn_stories
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  RETURN QUERY SELECT * FROM public.learn_stories ORDER BY display_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_get_story(p_slug text)
RETURNS public.learn_stories
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_stories;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  SELECT * INTO v_row FROM public.learn_stories WHERE slug = p_slug;
  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.seer_learn_list_flashcards(p_category text DEFAULT NULL)
RETURNS SETOF public.learn_flashcards
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
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
RETURNS public.learn_quizzes
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_quizzes;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege', MESSAGE = 'owner only';
  END IF;
  SELECT * INTO v_row FROM public.learn_quizzes WHERE concept_slug = p_concept_slug;
  RETURN v_row;
END;
$function$;

-- =============================================================
-- 7. Write RPCs — owner-gated upserts called by sync script as service_role.
--    The sync script imports the TS modules and calls these RPCs to write.
-- =============================================================

CREATE OR REPLACE FUNCTION public.seer_learn_upsert_concept(p_concept jsonb)
RETURNS public.learn_concepts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.learn_concepts;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
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
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
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
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
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
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
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

-- =============================================================
-- 8. REVOKE EXECUTE from PUBLIC on every new RPC, then GRANT to authenticated.
--    Mobile calls these as authenticated; the inner atlas_hq_is_owner check is
--    the actual gate. Service-role bypasses RLS so the sync script works
--    without explicit grant.
-- =============================================================

REVOKE EXECUTE ON FUNCTION public.seer_learn_list_concepts()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_concept(text)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_stories()            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_story(text)           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_list_flashcards(text)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_get_quiz(text)            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_upsert_concept(jsonb)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_upsert_story(jsonb)       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_upsert_flashcard(jsonb)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_learn_upsert_quiz(text, jsonb)  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.seer_learn_list_concepts()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_get_concept(text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_list_stories()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_get_story(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_list_flashcards(text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.seer_learn_get_quiz(text)          TO authenticated;
-- Upsert RPCs are NOT granted to authenticated — only callable as service_role
-- (the sync script's auth context). atlas_hq_is_owner gate inside the function
-- is belt-and-suspenders, but the grant pattern is the actual lock.
GRANT EXECUTE ON FUNCTION public.seer_learn_upsert_concept(jsonb)   TO service_role;
GRANT EXECUTE ON FUNCTION public.seer_learn_upsert_story(jsonb)     TO service_role;
GRANT EXECUTE ON FUNCTION public.seer_learn_upsert_flashcard(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.seer_learn_upsert_quiz(text, jsonb) TO service_role;

-- =============================================================
-- 9. Post-checks
--    Verify (a) tables exist with RLS enabled (b) read RPCs exist and are
--    callable for Greg via simulated service_role context.
-- =============================================================

DO $$
DECLARE
  v_greg_uid uuid;
  v_count int;
BEGIN
  -- Confirm RLS is on for all 4 new tables
  SELECT count(*) INTO v_count
  FROM pg_tables
  WHERE schemaname='public'
    AND tablename IN ('learn_concepts','learn_stories','learn_flashcards','learn_quizzes')
    AND rowsecurity = true;
  IF v_count <> 4 THEN
    RAISE EXCEPTION USING MESSAGE = format('Expected 4 RLS-enabled new tables; found %s', v_count);
  END IF;

  -- Confirm Greg can call list RPCs under simulated service_role context.
  -- Modern Supabase auth.uid()/auth.role() reads `request.jwt.claims` (JSON
  -- object), NOT the legacy `request.jwt.claim.*` per-key GUCs. Migration-
  -- planner audit caught this — without the JSON shim, post-check would
  -- raise insufficient_privilege and roll back the whole transaction.
  SELECT id INTO v_greg_uid
  FROM auth.users
  WHERE lower(email) = 'greg@gomicrogridenergy.com'
    AND email_confirmed_at IS NOT NULL
  ORDER BY created_at LIMIT 1;

  IF v_greg_uid IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Post-check: no confirmed Greg auth.users row';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_greg_uid::text, 'role', 'service_role')::text,
    true
  );

  -- Just calling the function — empty result is expected (tables not seeded yet).
  PERFORM public.seer_learn_list_concepts();
  PERFORM public.seer_learn_list_stories();
  PERFORM public.seer_learn_list_flashcards();
END $$;

COMMIT;
