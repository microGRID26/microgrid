-- Migration 300: Seer Phase 7A — curriculum_path rebuild as mixed-kind woven sequence
--
-- Replaces the 36-position concept-only Atlas Operator curriculum with a
-- 94-position woven curriculum: concepts + quizzes (retention checkpoint) +
-- flashcard sets (vocabulary checkpoint) + stories (optional enrichment).
-- Brainstormed end-to-end in the 2026-05-11 session (visual companion).
-- Full curated path captured at /tmp/seer-curation.json (preserved alongside).
--
-- Major changes:
--   1. seer_curriculum_path: relax position CHECK (1..36 → 1..200), relax
--      category CHECK (free string), add kind / gating / rank_id columns.
--      DELETE all 44 existing rows, INSERT 94 new woven rows.
--   2. seer_curriculum_progress: relax current_position CHECK (≤37 → ≤200),
--      add quizzes_passed / flashcard_sets_learned / stories_read text[]
--      columns (mirrors known/read/listened pattern, kind-aware).
--   3. seer_curriculum_next(): kind-aware joins. Returns title/subtitle from
--      learn_concepts / learn_stories / synthesized labels for quiz+flashcards.
--   4. seer_curriculum_advance(p_slug, p_kind, p_mode): broadened. Concepts
--      still use 'read'/'listened'; quizzes use 'passed'; flashcards use
--      'learned'; stories use 'read'. Routes to the appropriate completion array.
--   5. seer_curriculum_progress_summary(): denominator no longer hardcoded
--      to 36 — derives total_planned dynamically from the path size.
--      Adds badge_concept_count (concept-only completion, for badge meaning).
--   6. seer_curriculum_mark_known() — unchanged shape, but the slug now
--      maps to a path row of any kind; mark-known counts as advancing past.
--
-- Backwards compatibility:
--   - Existing user progress rows (current_position, known/read/listened_slugs)
--     carry over unchanged. New tracking columns default to empty arrays.
--   - learn/[slug] page calls useCurriculumNext + curriculumAdvance — both
--     continue to function. When next() returns kind != 'concept', the client
--     guards in a follow-up commit (kind-aware UI is Phase 7B).
--   - seer_today_summary (Today's "DO THIS NEXT") is INDEPENDENT of
--     curriculum_path and is untouched by this migration.
--
-- Verification: see DO $verify$ block at the end.

BEGIN;

-- =============================================================================
-- 1. seer_curriculum_path schema extension
-- =============================================================================

-- Drop the hardcoded position CHECK (1..36).
ALTER TABLE public.seer_curriculum_path
  DROP CONSTRAINT IF EXISTS seer_curriculum_path_position_check;

-- Drop the hardcoded category CHECK (4 values).
ALTER TABLE public.seer_curriculum_path
  DROP CONSTRAINT IF EXISTS seer_curriculum_path_category_check;

-- Add new columns (nullable for now; backfilled by INSERT, then NOT-NULL'd).
ALTER TABLE public.seer_curriculum_path
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS gating boolean,
  ADD COLUMN IF NOT EXISTS rank_id int;

-- Clear the table — the 44 old rows are replaced wholesale.
DELETE FROM public.seer_curriculum_path;

-- =============================================================================
-- 2. Insert the 94-row woven curriculum_path
-- =============================================================================

INSERT INTO public.seer_curriculum_path (position, slug, category, kind, gating, rank_id) VALUES
  -- Rank 1: Roswell (fundamentals) — 6 items
  (1,  'llm',                          'fundamentals',  'concept',    true,  1),
  (2,  'llm',                          'quiz',          'quiz',       true,  1),
  (3,  'tokens',                       'fundamentals',  'concept',    true,  1),
  (4,  'tokens',                       'quiz',          'quiz',       true,  1),
  (5,  'compaction',                   'fundamentals',  'concept',    true,  1),
  (6,  'compaction',                   'quiz',          'quiz',       true,  1),

  -- Rank 2: Rendlesham (agents) — 11 items
  (7,  'agent-loop',                   'agents',        'concept',    true,  2),
  (8,  'agent-loop',                   'quiz',          'quiz',       true,  2),
  (9,  'tool-use',                     'agents',        'concept',    true,  2),
  (10, 'tool-use',                     'quiz',          'quiz',       true,  2),
  (11, 'mcp',                          'agents',        'concept',    true,  2),
  (12, 'mcp',                          'quiz',          'quiz',       true,  2),
  (13, 'memory',                       'agents',        'concept',    true,  2),
  (14, 'memory',                       'quiz',          'quiz',       true,  2),
  (15, 'subagents',                    'agents',        'concept',    true,  2),
  (16, 'subagents',                    'quiz',          'quiz',       true,  2),
  (17, 'ai',                           'ai',            'flashcards', true,  2),

  -- Rank 3: Skinwalker (engineering + atlas) — 27 items
  (18, 'version-control-discipline',   'engineering',   'concept',    true,  3),
  (19, 'git',                          'git',           'flashcards', true,  3),
  (20, 'abstractions-tradeoff',        'engineering',   'concept',    true,  3),
  (21, 'yagni-vs-foresight',           'engineering',   'concept',    true,  3),
  (22, 'testing-strategy',             'engineering',   'concept',    true,  3),
  (23, 'refactor-vs-rewrite',          'engineering',   'concept',    true,  3),
  (24, 'tech-debt-economics',          'engineering',   'concept',    true,  3),
  (25, 'code-review-economics',        'engineering',   'concept',    true,  3),
  (26, 'dependency-supply-chain',      'engineering',   'concept',    true,  3),
  (27, 'code',                         'code',          'flashcards', true,  3),
  (28, 'atlas-protocol',               'atlas',         'concept',    true,  3),
  (29, 'atlas-protocol',               'quiz',          'quiz',       true,  3),
  (30, 'edge-portal-audit',            'story',         'story',      false, 3),
  (31, 'partner-api-platform',         'story',         'story',      false, 3),
  (32, 'shadow-row-save',              'story',         'story',      false, 3),
  (33, 'action-queue',                 'atlas',         'concept',    true,  3),
  (34, 'action-queue',                 'quiz',          'quiz',       true,  3),
  (35, 'hooks',                        'atlas',         'concept',    true,  3),
  (36, 'hooks',                        'quiz',          'quiz',       true,  3),
  (37, 'recaps',                       'atlas',         'concept',    true,  3),
  (38, 'recaps',                       'quiz',          'quiz',       true,  3),
  (39, 'atlas-harness',                'atlas',         'concept',    true,  3),
  (40, 'atlas',                        'atlas',         'flashcards', true,  3),
  (41, 'drive-folder-remediation',     'story',         'story',      false, 3),
  (42, 'roof-designer-reconcile',      'story',         'story',      false, 3),
  (43, 'webhook-audit',                'story',         'story',      false, 3),
  (44, 'partner-api-307',              'story',         'story',      false, 3),

  -- Rank 4: Dugway (system-design) — 9 items
  (45, 'database-tradeoffs',           'system-design', 'concept',    true,  4),
  (46, 'indexes-and-planners',         'system-design', 'concept',    true,  4),
  (47, 'transactions-and-isolation',   'system-design', 'concept',    true,  4),
  (48, 'consistency-models',           'system-design', 'concept',    true,  4),
  (49, 'cap-theorem',                  'system-design', 'concept',    true,  4),
  (50, 'database',                     'database',      'flashcards', true,  4),
  (51, 'caching-strategies',           'system-design', 'concept',    true,  4),
  (52, 'queues-and-async',             'system-design', 'concept',    true,  4),
  (53, 'monolith-vs-services',         'system-design', 'concept',    true,  4),

  -- Rank 5: Wright-Patt (system + infra) — 15 items
  (54, 'networking-basics',            'infrastructure','concept',    true,  5),
  (55, 'linux-posix-fluency',          'infrastructure','concept',    true,  5),
  (56, 'cloud-primitives',             'infrastructure','concept',    true,  5),
  (57, 'infra',                        'infra',         'flashcards', true,  5),
  (58, 'ci-cd-pipelines',              'infrastructure','concept',    true,  5),
  (59, 'observability-three-pillars',  'system-design', 'concept',    true,  5),
  (60, 'security-threat-model',        'infrastructure','concept',    true,  5),
  (61, 'security',                     'security',      'flashcards', true,  5),
  (62, 'auth-vs-authz',                'system-design', 'concept',    true,  5),
  (63, 'api-design-tradeoffs',         'system-design', 'concept',    true,  5),
  (64, 'web',                          'web',           'flashcards', true,  5),
  (65, 'event-driven-architecture',    'system-design', 'concept',    true,  5),
  (66, 'backups-and-dr',               'infrastructure','concept',    true,  5),
  (67, 'compliance-for-small-co',      'infrastructure','concept',    true,  5),
  (68, 'cloud-cost-optimization',      'infrastructure','concept',    true,  5),

  -- Rank 6: Los Alamos (leadership) — 8 items
  (69, 'hiring-signal',                'leadership',    'concept',    true,  6),
  (70, 'onboarding-economics',         'leadership',    'concept',    true,  6),
  (71, 'one-on-ones',                  'leadership',    'concept',    true,  6),
  (72, 'team-scaling',                 'leadership',    'concept',    true,  6),
  (73, 'rfc-culture',                  'leadership',    'concept',    true,  6),
  (74, 'build-vs-buy',                 'leadership',    'concept',    true,  6),
  (75, 'ship-vs-polish',               'leadership',    'concept',    true,  6),
  (76, 'on-call-discipline',           'leadership',    'concept',    true,  6),

  -- Rank 7: Area 51 (agent-fleet) — 9 items
  (77, 'agent-orchestration',          'agent-fleet',   'concept',    true,  7),
  (78, 'tool-design-for-agents',       'agent-fleet',   'concept',    true,  7),
  (79, 'prompt-as-code',               'agent-fleet',   'concept',    true,  7),
  (80, 'cli',                          'cli',           'flashcards', true,  7),
  (81, 'agent-failure-modes',          'agent-fleet',   'concept',    true,  7),
  (82, 'agent-evaluation',             'agent-fleet',   'concept',    true,  7),
  (83, 'agent-observability',          'agent-fleet',   'concept',    true,  7),
  (84, 'human-in-the-loop',            'agent-fleet',   'concept',    true,  7),
  (85, 'agent-cost-economics',         'agent-fleet',   'concept',    true,  7),

  -- Rank 8: S4 (economics + governance) — 9 items
  (86, 'economics',                    'economics',     'concept',    true,  8),
  (87, 'economics',                    'quiz',          'quiz',       true,  8),
  (88, 'prompt-caching',               'economics',     'concept',    true,  8),
  (89, 'prompt-caching',               'quiz',          'quiz',       true,  8),
  (90, 'governance',                   'governance',    'concept',    true,  8),
  (91, 'governance',                   'quiz',          'quiz',       true,  8),
  (92, 'atlas-anon-escalation',        'story',         'story',      false, 8),
  (93, 'silent-zero-rls',              'story',         'story',      false, 8),
  (94, 'rep-pii-rls',                  'story',         'story',      false, 8);

-- =============================================================================
-- 3. Finalize seer_curriculum_path schema (NOT NULL + CHECKs + FK)
-- =============================================================================

ALTER TABLE public.seer_curriculum_path
  ALTER COLUMN kind    SET NOT NULL,
  ALTER COLUMN gating  SET NOT NULL,
  ALTER COLUMN rank_id SET NOT NULL,
  ALTER COLUMN slug    SET NOT NULL;

-- Pre-flight H-2 fix: idempotent add — drop before add so re-apply doesn't
-- choke on "constraint already exists" after a partial earlier run.
ALTER TABLE public.seer_curriculum_path
  DROP CONSTRAINT IF EXISTS seer_curriculum_path_position_check;
ALTER TABLE public.seer_curriculum_path
  ADD CONSTRAINT seer_curriculum_path_position_check
    CHECK (position >= 1 AND position <= 200);

ALTER TABLE public.seer_curriculum_path
  DROP CONSTRAINT IF EXISTS seer_curriculum_path_kind_check;
ALTER TABLE public.seer_curriculum_path
  ADD CONSTRAINT seer_curriculum_path_kind_check
    CHECK (kind IN ('concept', 'quiz', 'flashcards', 'story'));

ALTER TABLE public.seer_curriculum_path
  DROP CONSTRAINT IF EXISTS seer_curriculum_path_rank_fk;
ALTER TABLE public.seer_curriculum_path
  ADD CONSTRAINT seer_curriculum_path_rank_fk
    FOREIGN KEY (rank_id) REFERENCES public.seer_ranks(id);

CREATE INDEX IF NOT EXISTS seer_curriculum_path_rank_idx
  ON public.seer_curriculum_path (rank_id, position);

COMMENT ON COLUMN public.seer_curriculum_path.kind
  IS 'Item type: concept (read), quiz (retention checkpoint), flashcards (vocab checkpoint), story (optional enrichment).';
COMMENT ON COLUMN public.seer_curriculum_path.gating
  IS 'true = blocks advancement until completed. false = optional (stories).';
COMMENT ON COLUMN public.seer_curriculum_path.rank_id
  IS 'Which rank this item belongs to. FK seer_ranks.id.';
COMMENT ON COLUMN public.seer_curriculum_path.slug
  IS 'kind=concept|quiz → concept_slug (lookup learn_concepts / learn_quizzes). kind=flashcards → flashcard category name (lookup learn_flashcards WHERE category=slug). kind=story → story slug (lookup learn_stories).';

-- =============================================================================
-- 4. seer_curriculum_progress schema extension
-- =============================================================================

ALTER TABLE public.seer_curriculum_progress
  DROP CONSTRAINT IF EXISTS seer_curriculum_progress_current_position_check;

ALTER TABLE public.seer_curriculum_progress
  ADD CONSTRAINT seer_curriculum_progress_current_position_check
    CHECK (current_position >= 1 AND current_position <= 200);

ALTER TABLE public.seer_curriculum_progress
  ADD COLUMN IF NOT EXISTS quizzes_passed         text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS flashcard_sets_learned text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS stories_read           text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.seer_curriculum_progress.quizzes_passed
  IS 'Concept slugs whose quiz at the curriculum_path position immediately after the concept was passed.';
COMMENT ON COLUMN public.seer_curriculum_progress.flashcard_sets_learned
  IS 'Flashcard category names (= path row slug for kind=flashcards) marked as "all cards known".';
COMMENT ON COLUMN public.seer_curriculum_progress.stories_read
  IS 'Story slugs the user opened. Stories are non-gating; this is for UX tracking, not advancement logic.';

-- =============================================================================
-- 5. seer_curriculum_next() — kind-aware rewrite
-- =============================================================================

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
AS $$
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
    RAISE EXCEPTION 'auth.uid() is null — curriculum requires authenticated user' USING ERRCODE = '42501';
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
  v_total_plan := v_total_auth;  -- no NULL-slug placeholders any more

  -- Walk forward from current_position, returning the first path row that's
  -- both (a) gating=true and not in the appropriate completion array, OR
  -- (b) gating=false (story — surfaces once, advance past it on view).
  FOR slug, title, subtitle, category, kind, gating, rank_id, position_num IN
    SELECT
      sp.slug,
      CASE sp.kind
        WHEN 'concept'    THEN lc.title
        WHEN 'quiz'       THEN 'Quiz · ' || COALESCE(lcq.title, sp.slug)
        WHEN 'flashcards' THEN 'Flashcards · ' || sp.slug
        WHEN 'story'      THEN ls.title
      END AS title,
      CASE sp.kind
        WHEN 'concept'    THEN lc.subtitle
        WHEN 'quiz'       THEN 'Retention check — ' || COALESCE(jsonb_array_length(lq.questions)::text, '?') || ' questions'
        WHEN 'flashcards' THEN (
          -- Pre-flight H-1 fix: dropped bogus `rank_id = sp.rank_id` clause;
          -- learn_flashcards has no rank_id column. Category alone identifies
          -- the set (each category currently lives in exactly one rank).
          SELECT count(*)::text || ' cards' FROM public.learn_flashcards WHERE category = sp.slug
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
        sp.gating = false  -- non-gating items surface once
        OR (sp.kind = 'concept'    AND NOT (sp.slug = ANY(v_read || v_listened || v_known)))
        OR (sp.kind = 'quiz'       AND NOT (sp.slug = ANY(v_quizzes)))
        OR (sp.kind = 'flashcards' AND NOT (sp.slug = ANY(v_flashcards)))
        OR (sp.kind = 'story')     -- always surfaces, advance() bumps past
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

  -- End of curriculum.
  slug := NULL; title := NULL; subtitle := NULL; category := NULL;
  kind := NULL; gating := NULL; rank_id := NULL; position_num := NULL;
  total_authored := v_total_auth; total_planned := v_total_plan;
  estimated_minutes := 0; at_end := true;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_next() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_next() FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_next() TO authenticated;

-- =============================================================================
-- 6. seer_curriculum_advance(p_slug, p_kind, p_mode) — kind-aware advancement
-- =============================================================================

-- Drop the old 2-arg signature; new is 3-arg.
DROP FUNCTION IF EXISTS public.seer_curriculum_advance(text, text);

CREATE OR REPLACE FUNCTION public.seer_curriculum_advance(
  p_slug text,
  p_kind text,
  p_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_position         int;
  v_today            date := public.seer_curriculum_logical_today();
  v_prev_date        date;
  v_streak           int;
  v_new_streak       int;
  v_advanced         boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null' USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('concept', 'quiz', 'flashcards', 'story') THEN
    RAISE EXCEPTION 'invalid_kind: % (must be concept|quiz|flashcards|story)', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'concept' AND COALESCE(p_mode, '') NOT IN ('read', 'listened') THEN
    RAISE EXCEPTION 'concept advance requires mode in (read|listened), got %', p_mode USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR length(p_slug) = 0 OR length(p_slug) > 200 THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.seer_curriculum_progress (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- Find the path row matching (slug, kind). For kinds with multiple
  -- positions per slug (concepts have a quiz with the same slug), we use
  -- (slug, kind) as the composite key. Multiple concept rows for the same
  -- slug shouldn't exist; if they did, we take the smallest position.
  SELECT sp.position INTO v_position
  FROM public.seer_curriculum_path sp
  WHERE sp.slug = p_slug AND sp.kind = p_kind
  ORDER BY sp.position
  LIMIT 1;

  IF v_position IS NULL THEN
    RETURN jsonb_build_object(
      'in_curriculum', false, 'advanced', false,
      'note', format('slug %L (kind %L) not in curriculum_path', p_slug, p_kind)
    );
  END IF;

  -- Record completion in the kind-appropriate array.
  IF p_kind = 'concept' AND p_mode = 'read' THEN
    UPDATE public.seer_curriculum_progress
       SET read_slugs = ARRAY(SELECT DISTINCT unnest(array_append(read_slugs, p_slug)))
     WHERE user_id = v_uid;
  ELSIF p_kind = 'concept' AND p_mode = 'listened' THEN
    UPDATE public.seer_curriculum_progress
       SET listened_slugs = ARRAY(SELECT DISTINCT unnest(array_append(listened_slugs, p_slug)))
     WHERE user_id = v_uid;
  ELSIF p_kind = 'quiz' THEN
    UPDATE public.seer_curriculum_progress
       SET quizzes_passed = ARRAY(SELECT DISTINCT unnest(array_append(quizzes_passed, p_slug)))
     WHERE user_id = v_uid;
  ELSIF p_kind = 'flashcards' THEN
    UPDATE public.seer_curriculum_progress
       SET flashcard_sets_learned = ARRAY(SELECT DISTINCT unnest(array_append(flashcard_sets_learned, p_slug)))
     WHERE user_id = v_uid;
  ELSIF p_kind = 'story' THEN
    UPDATE public.seer_curriculum_progress
       SET stories_read = ARRAY(SELECT DISTINCT unnest(array_append(stories_read, p_slug)))
     WHERE user_id = v_uid;
  END IF;

  -- Advance current_position past this row.
  UPDATE public.seer_curriculum_progress
     SET current_position = GREATEST(current_position, v_position + 1),
         last_advance_at  = now()
   WHERE user_id = v_uid
     AND current_position <= v_position
  RETURNING true INTO v_advanced;

  -- Streak update (same logic as before — every advance counts, regardless of kind).
  SELECT curriculum_streak_last_date, curriculum_streak_count
  INTO v_prev_date, v_streak
  FROM public.seer_curriculum_progress
  WHERE user_id = v_uid;

  IF v_prev_date IS NULL THEN
    v_new_streak := 1;
  ELSIF v_prev_date = v_today THEN
    v_new_streak := v_streak;
  ELSIF v_prev_date = v_today - 1 THEN
    v_new_streak := v_streak + 1;
  ELSE
    v_new_streak := 1;
  END IF;

  UPDATE public.seer_curriculum_progress
     SET curriculum_streak_count     = v_new_streak,
         curriculum_streak_last_date = v_today
   WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'in_curriculum',    true,
    'advanced',         COALESCE(v_advanced, false),
    'position_passed',  v_position,
    'kind',             p_kind,
    'streak_count',     v_new_streak
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text, text) TO authenticated;

-- Backwards-compat shim: old 2-arg advance(slug, mode) calls — fielded by
-- OTA-versioned clients that haven't picked up the 3-arg signature yet.
-- Calls forward to the 3-arg with p_kind='concept'. Safe to drop after
-- a full OTA rollout has propagated.
CREATE OR REPLACE FUNCTION public.seer_curriculum_advance(
  p_slug text,
  p_mode text
)
RETURNS jsonb
LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.seer_curriculum_advance(p_slug, 'concept', p_mode);
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text) TO authenticated;

-- =============================================================================
-- 6b. seer_curriculum_mark_known() — kind-aware (pre-flight H-3 fix)
-- =============================================================================
-- mig 277's version did `WHERE sp.slug = p_slug LIMIT 1`. After mig 300, slugs
-- duplicate (e.g. concept 'llm' at pos 1, quiz with slug 'llm' at pos 2). The
-- old query could non-deterministically pick the quiz row, advancing past the
-- concept the user is trying to mark-known. Filter on kind='concept' to lock it.

CREATE OR REPLACE FUNCTION public.seer_curriculum_mark_known(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_position  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null' USING ERRCODE = '42501';
  END IF;
  IF p_slug IS NULL OR length(p_slug) = 0 OR length(p_slug) > 200 THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.seer_curriculum_progress (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- Concept-only lookup (mark-known is a per-concept skip-ahead). If/when
  -- mark-known semantics expand to other kinds, add a kind parameter.
  SELECT sp.position INTO v_position
  FROM public.seer_curriculum_path sp
  WHERE sp.slug = p_slug AND sp.kind = 'concept'
  ORDER BY sp.position
  LIMIT 1;

  IF v_position IS NULL THEN
    RETURN jsonb_build_object('in_curriculum', false, 'marked', false,
                              'note', 'slug not a concept in curriculum_path');
  END IF;

  UPDATE public.seer_curriculum_progress
     SET known_slugs = ARRAY(SELECT DISTINCT unnest(array_append(known_slugs, p_slug))),
         current_position = GREATEST(current_position, v_position + 1),
         last_advance_at  = now()
   WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'in_curriculum',   true,
    'marked',          true,
    'position_passed', v_position
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_mark_known(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_mark_known(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_mark_known(text) TO authenticated;

-- =============================================================================
-- 7. seer_curriculum_progress_summary() — dynamic denominator
-- =============================================================================

DROP FUNCTION IF EXISTS public.seer_curriculum_progress_summary();

CREATE OR REPLACE FUNCTION public.seer_curriculum_progress_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid                uuid := auth.uid();
  v_completed_total    int;
  v_completed_concepts int;
  v_total_path         int;
  v_total_concepts     int;
  v_position           int;
  v_streak             int;
  v_streak_date        date;
  v_today              date := public.seer_curriculum_logical_today();
  v_active_streak      boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null' USING ERRCODE = '42501';
  END IF;

  SELECT cp.current_position, cp.curriculum_streak_count, cp.curriculum_streak_last_date,
         cardinality(ARRAY(
           SELECT DISTINCT unnest(
             cp.read_slugs || cp.listened_slugs || cp.known_slugs ||
             cp.quizzes_passed || cp.flashcard_sets_learned || cp.stories_read
           )
         )),
         cardinality(ARRAY(
           SELECT DISTINCT unnest(cp.read_slugs || cp.listened_slugs || cp.known_slugs)
         ))
  INTO v_position, v_streak, v_streak_date, v_completed_total, v_completed_concepts
  FROM public.seer_curriculum_progress cp
  WHERE cp.user_id = v_uid;

  IF v_position IS NULL THEN
    v_position := 1; v_completed_total := 0; v_completed_concepts := 0;
    v_streak := 0; v_streak_date := NULL;
  END IF;

  SELECT count(*)::int INTO v_total_path     FROM public.seer_curriculum_path;
  SELECT count(*)::int INTO v_total_concepts FROM public.seer_curriculum_path WHERE kind = 'concept';

  v_active_streak := v_streak_date IS NOT NULL
                     AND (v_streak_date = v_today OR v_streak_date = v_today - 1);

  RETURN jsonb_build_object(
    'current_position',       v_position,
    'completed_count',        v_completed_total,
    'completed_concepts',     v_completed_concepts,
    'total_authored',         v_total_path,
    'total_planned',          v_total_path,
    'total_concepts',         v_total_concepts,
    'badge_percent',          ROUND((v_completed_concepts::numeric / NULLIF(v_total_concepts,0)) * 100, 1),
    'path_percent',           ROUND((v_completed_total::numeric    / NULLIF(v_total_path,0))    * 100, 1),
    'streak_count',           CASE WHEN v_active_streak THEN v_streak ELSE 0 END,
    'streak_last_date',       v_streak_date,
    'streak_is_active',       v_active_streak,
    'badge_name',             'Atlas Operator',
    'logical_today',          v_today
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_progress_summary() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_progress_summary() FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_progress_summary() TO authenticated;

-- =============================================================================
-- 8. Verification
-- =============================================================================

DO $verify$
DECLARE
  v_path_n        int;
  v_concept_n     int;
  v_quiz_n        int;
  v_flash_n       int;
  v_story_n       int;
  v_orphan_slugs  text[];
BEGIN
  SELECT count(*)::int INTO v_path_n    FROM public.seer_curriculum_path;
  SELECT count(*)::int INTO v_concept_n FROM public.seer_curriculum_path WHERE kind = 'concept';
  SELECT count(*)::int INTO v_quiz_n    FROM public.seer_curriculum_path WHERE kind = 'quiz';
  SELECT count(*)::int INTO v_flash_n   FROM public.seer_curriculum_path WHERE kind = 'flashcards';
  SELECT count(*)::int INTO v_story_n   FROM public.seer_curriculum_path WHERE kind = 'story';

  IF v_path_n  <> 94 THEN RAISE EXCEPTION 'expected 94 path rows, got %', v_path_n; END IF;
  IF v_concept_n <> 60 THEN RAISE EXCEPTION 'expected 60 concept rows, got %', v_concept_n; END IF;
  IF v_quiz_n    <> 15 THEN RAISE EXCEPTION 'expected 15 quiz rows, got %', v_quiz_n; END IF;
  IF v_flash_n   <> 9  THEN RAISE EXCEPTION 'expected 9 flashcards rows, got %', v_flash_n; END IF;
  IF v_story_n   <> 10 THEN RAISE EXCEPTION 'expected 10 story rows, got %', v_story_n; END IF;

  -- Every concept slug in path must exist in learn_concepts.
  SELECT array_agg(sp.slug) INTO v_orphan_slugs
  FROM public.seer_curriculum_path sp
  LEFT JOIN public.learn_concepts lc ON lc.slug = sp.slug
  WHERE sp.kind = 'concept' AND lc.slug IS NULL;
  IF v_orphan_slugs IS NOT NULL THEN
    RAISE EXCEPTION 'concept rows reference unknown learn_concepts slugs: %', v_orphan_slugs;
  END IF;

  -- Every quiz slug must have a quiz row in learn_quizzes.
  SELECT array_agg(sp.slug) INTO v_orphan_slugs
  FROM public.seer_curriculum_path sp
  LEFT JOIN public.learn_quizzes lq ON lq.concept_slug = sp.slug
  WHERE sp.kind = 'quiz' AND lq.concept_slug IS NULL;
  IF v_orphan_slugs IS NOT NULL THEN
    RAISE EXCEPTION 'quiz rows reference concepts without quizzes: %', v_orphan_slugs;
  END IF;

  -- Every story slug must exist in learn_stories.
  SELECT array_agg(sp.slug) INTO v_orphan_slugs
  FROM public.seer_curriculum_path sp
  LEFT JOIN public.learn_stories ls ON ls.slug = sp.slug
  WHERE sp.kind = 'story' AND ls.slug IS NULL;
  IF v_orphan_slugs IS NOT NULL THEN
    RAISE EXCEPTION 'story rows reference unknown stories: %', v_orphan_slugs;
  END IF;

  -- Every flashcards row must have ≥1 matching flashcard in learn_flashcards.
  SELECT array_agg(sp.slug) INTO v_orphan_slugs
  FROM public.seer_curriculum_path sp
  WHERE sp.kind = 'flashcards'
    AND NOT EXISTS (
      SELECT 1 FROM public.learn_flashcards lf
      WHERE lf.category = sp.slug
    );
  IF v_orphan_slugs IS NOT NULL THEN
    RAISE EXCEPTION 'flashcards rows reference empty categories: %', v_orphan_slugs;
  END IF;

  RAISE NOTICE 'OK: path=%, concepts=%, quizzes=%, flashcards=%, stories=%.',
    v_path_n, v_concept_n, v_quiz_n, v_flash_n, v_story_n;
END
$verify$;

COMMIT;
