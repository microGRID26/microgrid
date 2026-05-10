-- Phase 4 Sprint 0 — Curated learning program (Atlas Operator track)
--
-- Greg's 2026-05-10 demo feedback (seer_feedback row 49c98d49) asked for a
-- "guided learning to be more intentional ... funneled through a curated
-- program." Spec §11 + greg_action #764 locked the shape:
--   - Shape C with A floor: one linear path, mark-known acts as skip-ahead
--   - Badge: "Atlas Operator", 36 software-fluency concepts
--   - Curriculum order: Engineering (8) → System Design (12) → Leadership (8)
--     → Infrastructure (8). Atlas Internals (16) stays available, uncounted.
--   - Soft daily-target enforcement (visible streak, no hard lock)
--   - 4am-CT streak reset (late-night counts as same day)
--   - Read/listened tracked separately, both count toward completion
--   - Mark-known counts as completed (denominator stays 36)
--
-- Adds:
--   1. seer_curriculum_path — canonical ordered slug list (36 positions, with
--      positions 21-36 NULL until Sprint 1D / 1E author Leadership +
--      Infrastructure content).
--   2. seer_curriculum_progress — per-user state (current position, read /
--      listened / known slug arrays, streak counter).
--   3. seer_curriculum_next() RPC — returns the next unblocked concept,
--      skipping known/read/listened slugs, capping at end-of-authored.
--   4. seer_curriculum_advance(slug, mode) RPC — advances past a concept,
--      adding to read_slugs or listened_slugs.
--   5. seer_curriculum_mark_known(slug) RPC — adds to known_slugs, advances.
--   6. seer_curriculum_unmark_known(slug) RPC — Greg-said-no recovery path.
--   7. seer_curriculum_progress_summary() RPC — { position, completed_count,
--      total_authored, total_planned, streak_count, badge_percent }.

BEGIN;

-- =============================================================================
-- 1. seer_curriculum_path — canonical ordered slug list
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.seer_curriculum_path (
  position    int  PRIMARY KEY CHECK (position >= 1 AND position <= 36),
  slug        text NULL,                -- NULL allowed for unauthored Sprint 1D/1E positions
  category    text NOT NULL CHECK (category IN ('engineering', 'system-design', 'leadership', 'infrastructure')),
  added_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.seer_curriculum_path IS 'Canonical 36-position ordered slug list for the Atlas Operator badge curriculum. Positions 21-36 may have NULL slug at Sprint 0 launch (Leadership + Infrastructure not yet authored); future migrations fill them in.';
COMMENT ON COLUMN public.seer_curriculum_path.slug IS 'NULL means "this position is reserved for an unauthored concept" — next() RPC skips past it gracefully.';

ALTER TABLE public.seer_curriculum_path ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS curriculum_path_public_read ON public.seer_curriculum_path;
CREATE POLICY curriculum_path_public_read ON public.seer_curriculum_path
  FOR SELECT TO authenticated USING (true);

-- Seed: Engineering (1-8), System Design (9-20), Leadership (21-28, NULL slugs), Infrastructure (29-36, NULL slugs)

INSERT INTO public.seer_curriculum_path (position, slug, category) VALUES
  (1,  'abstractions-tradeoff',         'engineering'),
  (2,  'yagni-vs-foresight',            'engineering'),
  (3,  'tech-debt-economics',           'engineering'),
  (4,  'testing-strategy',              'engineering'),
  (5,  'refactor-vs-rewrite',           'engineering'),
  (6,  'code-review-economics',         'engineering'),
  (7,  'dependency-supply-chain',       'engineering'),
  (8,  'version-control-discipline',    'engineering'),
  (9,  'monolith-vs-services',          'system-design'),
  (10, 'database-tradeoffs',            'system-design'),
  (11, 'indexes-and-planners',          'system-design'),
  (12, 'transactions-and-isolation',    'system-design'),
  (13, 'consistency-models',            'system-design'),
  (14, 'cap-theorem',                   'system-design'),
  (15, 'caching-strategies',            'system-design'),
  (16, 'queues-and-async',              'system-design'),
  (17, 'event-driven-architecture',     'system-design'),
  (18, 'api-design-tradeoffs',          'system-design'),
  (19, 'auth-vs-authz',                 'system-design'),
  (20, 'observability-three-pillars',   'system-design'),
  (21, NULL, 'leadership'),
  (22, NULL, 'leadership'),
  (23, NULL, 'leadership'),
  (24, NULL, 'leadership'),
  (25, NULL, 'leadership'),
  (26, NULL, 'leadership'),
  (27, NULL, 'leadership'),
  (28, NULL, 'leadership'),
  (29, NULL, 'infrastructure'),
  (30, NULL, 'infrastructure'),
  (31, NULL, 'infrastructure'),
  (32, NULL, 'infrastructure'),
  (33, NULL, 'infrastructure'),
  (34, NULL, 'infrastructure'),
  (35, NULL, 'infrastructure'),
  (36, NULL, 'infrastructure')
ON CONFLICT (position) DO NOTHING;

-- =============================================================================
-- 2. seer_curriculum_progress — per-user state
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.seer_curriculum_progress (
  user_id                        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_position               int         NOT NULL DEFAULT 1 CHECK (current_position >= 1 AND current_position <= 37),
  known_slugs                    text[]      NOT NULL DEFAULT '{}'::text[],
  read_slugs                     text[]      NOT NULL DEFAULT '{}'::text[],
  listened_slugs                 text[]      NOT NULL DEFAULT '{}'::text[],
  curriculum_streak_count        int         NOT NULL DEFAULT 0 CHECK (curriculum_streak_count >= 0),
  curriculum_streak_last_date    date        NULL,
  started_at                     timestamptz NOT NULL DEFAULT now(),
  last_advance_at                timestamptz NULL
);

COMMENT ON TABLE  public.seer_curriculum_progress IS 'Per-user state for the Atlas Operator curriculum. One row per user. current_position 37 = badge achieved (advanced past final concept). No DELETE policy is deliberate — users should not be able to wipe their own progress; service-role can still clean up for testing.';
COMMENT ON COLUMN public.seer_curriculum_progress.current_position IS 'INVARIANT: ceiling is path-size + 1. Path is currently 36 positions, so ceiling is 37. If a future migration extends seer_curriculum_path beyond 36, this CHECK constraint must also be updated or the table redefined with a dynamic ceiling.';
COMMENT ON COLUMN public.seer_curriculum_progress.known_slugs IS 'Concepts the user marked "I already know this" — count as completed, do NOT reduce the 36 denominator.';
COMMENT ON COLUMN public.seer_curriculum_progress.curriculum_streak_last_date IS 'Logical date (4am-CT-reset) of last day the user advanced. Same-day repeat advances do not break or extend the streak.';

ALTER TABLE public.seer_curriculum_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS curriculum_progress_self_select ON public.seer_curriculum_progress;
DROP POLICY IF EXISTS curriculum_progress_self_insert ON public.seer_curriculum_progress;
DROP POLICY IF EXISTS curriculum_progress_self_update ON public.seer_curriculum_progress;

CREATE POLICY curriculum_progress_self_select ON public.seer_curriculum_progress
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY curriculum_progress_self_insert ON public.seer_curriculum_progress
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY curriculum_progress_self_update ON public.seer_curriculum_progress
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- Helpers
-- =============================================================================

-- 4am-CT logical-date helper: shift now() back 4h in CT, take date.
-- Late-night sessions (e.g., 11pm-3:59am CT) count as the previous calendar day.
-- STABLE (not IMMUTABLE) because now() is STABLE — IMMUTABLE would let the
-- planner fold stale values across long-lived plans.
CREATE OR REPLACE FUNCTION public.seer_curriculum_logical_today()
RETURNS date
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ((now() AT TIME ZONE 'America/Chicago') - INTERVAL '4 hours')::date;
$$;

COMMENT ON FUNCTION public.seer_curriculum_logical_today() IS '4am-CT reset boundary. Returns the logical date for streak accounting. Late-night before 4am rolls back to previous day.';

-- =============================================================================
-- 3. seer_curriculum_next() — next unblocked concept for the caller
-- =============================================================================

-- SECURITY DEFINER required: this function joins public.learn_concepts, which
-- has an RLS policy denying SELECT to authenticated. SECURITY INVOKER would
-- inherit the caller's RLS and return zero rows for every call. The DEFINER
-- promotion bypasses learn_concepts' RLS only — user-scoping is still enforced
-- by reading auth.uid() at the top and querying seer_curriculum_progress with
-- WHERE user_id = v_uid. Cross-user reads remain impossible.
CREATE OR REPLACE FUNCTION public.seer_curriculum_next()
RETURNS TABLE(
  slug              text,
  title             text,
  subtitle          text,
  category          text,
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
  v_completed    text[];
  v_total_auth   int;
  v_total_plan   int := 36;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null — curriculum requires authenticated user' USING ERRCODE = '42501';
  END IF;

  -- Read progress; if no row exists yet, default to position 1 with no
  -- completions. Bootstrap of the actual row happens in advance() / mark_known()
  -- which are VOLATILE. Keeping next() STABLE means it cannot INSERT here.
  SELECT cp.current_position,
         array_cat(array_cat(cp.known_slugs, cp.read_slugs), cp.listened_slugs)
  INTO v_pos, v_completed
  FROM public.seer_curriculum_progress cp
  WHERE cp.user_id = v_uid;

  IF v_pos IS NULL THEN
    v_pos := 1;
    v_completed := '{}'::text[];
  END IF;

  SELECT count(*)::int INTO v_total_auth
  FROM public.seer_curriculum_path
  WHERE seer_curriculum_path.slug IS NOT NULL;

  -- Walk forward from current_position, skipping NULL-slug positions and
  -- already-completed slugs, until we find one or run out.
  FOR slug, title, subtitle, category, position_num IN
    SELECT lc.slug,
           lc.title,
           lc.subtitle,
           lc.category,
           sp.position
    FROM public.seer_curriculum_path sp
    JOIN public.learn_concepts lc ON lc.slug = sp.slug
    WHERE sp.position >= v_pos
      AND sp.slug IS NOT NULL
      AND NOT (sp.slug = ANY(v_completed))
    ORDER BY sp.position ASC
    LIMIT 1
  LOOP
    total_authored := v_total_auth;
    total_planned  := v_total_plan;
    estimated_minutes := 7;  -- baseline; tune later from actual read-time data
    at_end := false;
    RETURN NEXT;
    RETURN;
  END LOOP;

  -- No row found: either user has completed everything authored, or the
  -- remaining positions are NULL-slug (unauthored Leadership/Infrastructure).
  slug := NULL;
  title := NULL;
  subtitle := NULL;
  category := NULL;
  position_num := NULL;
  total_authored := v_total_auth;
  total_planned  := v_total_plan;
  estimated_minutes := 0;
  at_end := true;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_next() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_next() FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_next() TO authenticated;

-- =============================================================================
-- 4. seer_curriculum_advance(slug, mode) — record a completion (read | listened)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seer_curriculum_advance(
  p_slug text,
  p_mode text
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
  IF p_mode NOT IN ('read', 'listened') THEN
    RAISE EXCEPTION 'invalid_mode: % (must be read or listened)', p_mode USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR length(p_slug) = 0 OR length(p_slug) > 200 THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
  END IF;

  -- Ensure progress row exists.
  INSERT INTO public.seer_curriculum_progress (user_id)
  VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  -- Look up the slug's position (must be in the curriculum path).
  SELECT sp.position INTO v_position
  FROM public.seer_curriculum_path sp
  WHERE sp.slug = p_slug
  LIMIT 1;

  IF v_position IS NULL THEN
    -- Slug not in curriculum (e.g., Atlas Internals concept). Reading it is
    -- fine but doesn't advance the curriculum or count toward badge.
    RETURN jsonb_build_object(
      'in_curriculum',    false,
      'advanced',         false,
      'note',             'slug not part of Atlas Operator curriculum (Atlas Internals or similar)'
    );
  END IF;

  -- Add slug to the appropriate completion array. Use DISTINCT unnest to be
  -- idempotent under concurrent same-user calls (double-tap, retry).
  IF p_mode = 'read' THEN
    UPDATE public.seer_curriculum_progress
       SET read_slugs = ARRAY(SELECT DISTINCT unnest(array_append(read_slugs, p_slug)))
     WHERE user_id = v_uid;
  ELSE  -- listened
    UPDATE public.seer_curriculum_progress
       SET listened_slugs = ARRAY(SELECT DISTINCT unnest(array_append(listened_slugs, p_slug)))
     WHERE user_id = v_uid;
  END IF;

  -- Advance current_position past this slug if user is at or before it.
  UPDATE public.seer_curriculum_progress
     SET current_position = GREATEST(current_position, v_position + 1),
         last_advance_at  = now()
   WHERE user_id = v_uid
     AND current_position <= v_position
  RETURNING true INTO v_advanced;

  -- Streak update.
  SELECT curriculum_streak_last_date, curriculum_streak_count
  INTO v_prev_date, v_streak
  FROM public.seer_curriculum_progress
  WHERE user_id = v_uid;

  IF v_prev_date IS NULL THEN
    v_new_streak := 1;
  ELSIF v_prev_date = v_today THEN
    v_new_streak := v_streak;          -- already advanced today
  ELSIF v_prev_date = v_today - 1 THEN
    v_new_streak := v_streak + 1;      -- consecutive day
  ELSE
    v_new_streak := 1;                 -- missed a day, reset
  END IF;

  UPDATE public.seer_curriculum_progress
     SET curriculum_streak_count     = v_new_streak,
         curriculum_streak_last_date = v_today
   WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'in_curriculum',    true,
    'advanced',         COALESCE(v_advanced, false),
    'position_passed',  v_position,
    'streak_count',     v_new_streak,
    'mode',             p_mode
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_advance(text, text) TO authenticated;

-- =============================================================================
-- 5. seer_curriculum_mark_known(slug) — skip-ahead (Shape C's adaptive lever)
-- =============================================================================

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

  SELECT sp.position INTO v_position
  FROM public.seer_curriculum_path sp
  WHERE sp.slug = p_slug
  LIMIT 1;

  IF v_position IS NULL THEN
    RETURN jsonb_build_object('in_curriculum', false, 'marked', false, 'note', 'slug not in curriculum');
  END IF;

  -- DISTINCT unnest for idempotency under concurrent same-user calls.
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
-- 6. seer_curriculum_unmark_known(slug) — recovery path for accidental skips
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seer_curriculum_unmark_known(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null' USING ERRCODE = '42501';
  END IF;

  UPDATE public.seer_curriculum_progress
     SET known_slugs = array_remove(known_slugs, p_slug)
   WHERE user_id = v_uid;

  -- Note: we deliberately do NOT roll back current_position. If the user has
  -- already advanced past this slug via mark-known, undoing the mark surfaces
  -- the concept in their "completed but worth revisiting" list rather than
  -- rewinding the program. Recovery, not regression.

  RETURN jsonb_build_object('unmarked', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_unmark_known(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_unmark_known(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_unmark_known(text) TO authenticated;

-- =============================================================================
-- 7. seer_curriculum_progress_summary() — for the /today and Profile rings
-- =============================================================================

-- STABLE (no writes). Returns defaults when no progress row exists. Bootstrap
-- of the actual row happens in advance() / mark_known().
CREATE OR REPLACE FUNCTION public.seer_curriculum_progress_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_completed     int;
  v_total_auth    int;
  v_total_plan    int := 36;
  v_position      int;
  v_streak        int;
  v_streak_date   date;
  v_today         date := public.seer_curriculum_logical_today();
  v_active_streak boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null' USING ERRCODE = '42501';
  END IF;

  SELECT cp.current_position,
         cardinality(
           ARRAY(SELECT DISTINCT unnest(array_cat(array_cat(cp.known_slugs, cp.read_slugs), cp.listened_slugs)))
         ),
         cp.curriculum_streak_count,
         cp.curriculum_streak_last_date
  INTO v_position, v_completed, v_streak, v_streak_date
  FROM public.seer_curriculum_progress cp
  WHERE cp.user_id = v_uid;

  IF v_position IS NULL THEN
    v_position := 1;
    v_completed := 0;
    v_streak := 0;
    v_streak_date := NULL;
  END IF;

  SELECT count(*)::int INTO v_total_auth
  FROM public.seer_curriculum_path
  WHERE seer_curriculum_path.slug IS NOT NULL;

  -- Active streak = streak last advanced today or yesterday (4am-CT logic).
  -- Anything older than yesterday is a dead streak that hasn't been reset yet
  -- because the user hasn't advanced since.
  v_active_streak := v_streak_date IS NOT NULL
                     AND (v_streak_date = v_today OR v_streak_date = v_today - 1);

  RETURN jsonb_build_object(
    'current_position',     v_position,
    'completed_count',      v_completed,
    'total_authored',       v_total_auth,
    'total_planned',        v_total_plan,
    'badge_percent',        ROUND((v_completed::numeric / v_total_plan) * 100, 1),
    'streak_count',         CASE WHEN v_active_streak THEN v_streak ELSE 0 END,
    'streak_last_date',     v_streak_date,
    'streak_is_active',     v_active_streak,
    'badge_name',           'Atlas Operator',
    'logical_today',        v_today
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_curriculum_progress_summary() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_curriculum_progress_summary() FROM anon;
GRANT  EXECUTE ON FUNCTION public.seer_curriculum_progress_summary() TO authenticated;

COMMIT;
