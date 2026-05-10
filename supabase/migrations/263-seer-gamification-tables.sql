-- ─────────────────────────────────────────────────────────────────────────
-- mig 263 · Seer · Phase 1 — Today + gamification schema
-- ─────────────────────────────────────────────────────────────────────────
-- Per spec §6 + §10 Phase 1 + §6.2 source-category → axis mapping:
--   - seer_rings_daily   (READ / QUIZ / FEED rings, per-day)
--   - seer_radar_state   (5 axes, decay-on-read per §6.3)
--   - seer_streak        (perfect-week ring closure tracker)
--   - 7 owner-gated RPCs: get_today_rings, close_read_ring, close_quiz_ring,
--     close_feed_ring (placeholder, full axis push lands Phase 2),
--     get_radar (decay computed at read time, no mutation), get_streak
--   - Internal helper: seer_push_radar_axis (SECURITY DEFINER, owner-checked)
--   - Concept-category → axis mapping is hardcoded in the RPC body (§6.2)
--
-- RLS: deny-all-direct on all three tables (matches Phase 0 R3 fix M-9
-- pattern — RPC is the only path). Service-role shim retained per Phase 0
-- pattern so atlas-hq aggregators / cron edge functions can read-through.
-- ─────────────────────────────────────────────────────────────────────────

-- ────────────── seer_rings_daily ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seer_rings_daily (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- DEFAULT is server-tz CURRENT_DATE; the RPCs always pass Chicago date
  -- explicitly via seer_today_chicago() so this DEFAULT is belt-and-braces.
  date           date NOT NULL DEFAULT CURRENT_DATE,
  read_count     int  NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  quiz_score     int  NOT NULL DEFAULT 0 CHECK (quiz_score BETWEEN 0 AND 100),
  feed_opened    int  NOT NULL DEFAULT 0 CHECK (feed_opened >= 0),
  all_closed     bool NOT NULL DEFAULT false,
  read_concepts  text[] NOT NULL DEFAULT ARRAY[]::text[],
  feed_items     uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.seer_rings_daily ENABLE ROW LEVEL SECURITY;
-- Composite PK (user_id, date) already covers user-prefix scans; no
-- secondary index needed for Phase 1 access patterns (mig-planner L-2).

-- ────────────── seer_radar_state ────────────────────────────────────────
-- One row per (user, axis). Score 0..100. last_pushed_at is the last time
-- a push fired — used by get_radar() to compute decay on read (no mutation
-- on read; cheap + idempotent).
CREATE TABLE IF NOT EXISTS public.seer_radar_state (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  axis           text NOT NULL CHECK (axis IN ('Fundamentals','Tooling','Workflow','Agents','Frontier')),
  score          int  NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  last_pushed_at timestamptz NOT NULL DEFAULT now(),
  history_jsonb  jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, axis)
);

ALTER TABLE public.seer_radar_state ENABLE ROW LEVEL SECURITY;

-- ────────────── seer_streak ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seer_streak (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak   int  NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  longest_streak   int  NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
  last_perfect_day date,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seer_streak ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- RPCs · all SECURITY DEFINER + owner-gated
-- ─────────────────────────────────────────────────────────────────────────

-- Helper: today's date in America/Chicago (Greg's tz; daily reset boundary
-- per spec §10 Phase 1 = "4am Central". The 4am offset is enforced by the
-- cron edge fn — at read time, "today" is calendar-day Chicago.)
CREATE OR REPLACE FUNCTION public.seer_today_chicago()
RETURNS date
LANGUAGE sql
STABLE  -- now() varies between transactions; same within a statement.
SET search_path = pg_catalog  -- advisor lint: function_search_path_mutable
AS $$
  SELECT (now() AT TIME ZONE 'America/Chicago')::date;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_today_chicago() FROM PUBLIC;
-- Internal helper — only the SECURITY DEFINER RPCs need it; they inherit
-- postgres-role privileges so REVOKE FROM PUBLIC doesn't break them.

-- ──────────── seer_get_today_rings ──────────────────────────────────────
-- Returns today's ring row for the calling owner. Auto-creates on first
-- read of the day so the client never sees an empty row.
DROP FUNCTION IF EXISTS public.seer_get_today_rings();
CREATE OR REPLACE FUNCTION public.seer_get_today_rings()
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_row public.seer_rings_daily;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  v_uid := auth.uid();

  INSERT INTO public.seer_rings_daily (user_id, date)
  VALUES (v_uid, public.seer_today_chicago())
  ON CONFLICT (user_id, date) DO NOTHING;

  SELECT * INTO v_row FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = public.seer_today_chicago();

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_get_today_rings() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_get_today_rings() TO authenticated;

-- ──────────── seer_push_radar_axis (internal) ───────────────────────────
-- Internal helper. Increments an axis by N points, capped at 100. Updates
-- last_pushed_at + appends a history entry. NOT exposed to authenticated;
-- only callable from the close_*_ring RPCs.
CREATE OR REPLACE FUNCTION public.seer_push_radar_axis(
  p_user_id uuid,
  p_axis    text,
  p_points  int,
  p_source  text   -- 'concept:<slug>', 'quiz:<slug>', 'feed:<id>'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_axis NOT IN ('Fundamentals','Tooling','Workflow','Agents','Frontier') THEN
    RAISE EXCEPTION 'invalid_axis: %', p_axis USING ERRCODE = '22023';
  END IF;
  IF p_points <= 0 OR p_points > 50 THEN
    RAISE EXCEPTION 'invalid_points: % (must be 1..50)', p_points USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.seer_radar_state (user_id, axis, score, last_pushed_at, history_jsonb)
  VALUES (
    p_user_id,
    p_axis,
    LEAST(100, p_points),
    now(),
    jsonb_build_array(jsonb_build_object('at', now(), 'points', p_points, 'source', p_source))
  )
  ON CONFLICT (user_id, axis) DO UPDATE
    SET score = LEAST(100, public.seer_radar_state.score + p_points),
        last_pushed_at = now(),
        history_jsonb = public.seer_radar_state.history_jsonb
                        || jsonb_build_object('at', now(), 'points', p_points, 'source', p_source);
END;
$$;

-- Internal helper. Hardening note: Supabase's `authenticated` and `anon`
-- roles hold non-PUBLIC default grants on schema public — REVOKE FROM
-- PUBLIC alone leaves the function callable. Explicit per-role revokes
-- are required to close the privilege-escalation surface (this fn takes
-- p_user_id + p_axis + p_points as params; an authenticated caller could
-- self-grant +50 on any axis if exec'able).
REVOKE ALL ON FUNCTION public.seer_push_radar_axis(uuid, text, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_push_radar_axis(uuid, text, int, text) FROM authenticated, anon;

-- ──────────── seer_close_read_ring ──────────────────────────────────────
-- Caller: client when user reads a concept. Increments read_count, dedupes
-- via read_concepts array, applies axis push per §6.2 mapping based on
-- the concept's category (fetched from learn_concepts).
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

  SELECT category INTO v_category
    FROM public.learn_concepts WHERE slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_concept: %', p_concept_slug USING ERRCODE = '22023';
  END IF;

  -- Capture pre-upsert dedup state. NULL (no row yet) → false. (red-teamer
  -- R1 H-1 fix: previous version compared post-upsert updated_at to
  -- v_row.updated_at, always empty → axis push fired on every dupe call.)
  SELECT (p_concept_slug = ANY (read_concepts)) INTO v_already_read
    FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  v_already_read := COALESCE(v_already_read, false);

  -- Idempotent — only count the first time today.
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

  -- Axis push only if this slug wasn't already counted today.
  IF NOT v_already_read THEN
    -- Apply mapping per §6.2
    CASE v_category
      WHEN 'fundamentals' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Fundamentals', 5, 'concept:'||p_concept_slug);
      WHEN 'agents' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Agents', 5, 'concept:'||p_concept_slug);
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
        -- Unknown category — concept exists but mapping missing. Don't fail
        -- the ring close; flag for follow-up.
        RAISE WARNING 'seer_close_read_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  -- Recompute all_closed
  PERFORM public.seer_recompute_all_closed(v_uid, v_today);

  SELECT * INTO v_row FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_close_read_ring(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_close_read_ring(text) TO authenticated;

-- ──────────── seer_close_quiz_ring ──────────────────────────────────────
-- Records a quiz score. Only counts if score >= 80 (per spec §6.1 — close
-- by scoring 80%+). On pass, doubles the bonus on the underlying concept's
-- axis push (per §6.2 quiz rule). Idempotent — re-takes only update score
-- if the new score is higher; bonus only applied on the first 80%+ pass.
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
  v_uid       uuid;
  v_today     date;
  v_category  text;
  v_prev_qs   int;
  v_row       public.seer_rings_daily;
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

  SELECT category INTO v_category FROM public.learn_concepts WHERE slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_concept: %', p_concept_slug USING ERRCODE = '22023';
  END IF;

  -- Capture pre-upsert quiz_score BEFORE the GREATEST() merge. (red-teamer
  -- R1 C-1 fix: previous version read v_prev_qs AFTER the upsert, so the
  -- bonus gate `prev < 80 AND new >= 80` was unreachable on the first
  -- 80%+ pass — quiz bonus never fired.)
  SELECT quiz_score INTO v_prev_qs FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  v_prev_qs := COALESCE(v_prev_qs, 0);

  INSERT INTO public.seer_rings_daily (user_id, date, quiz_score)
  VALUES (v_uid, v_today, p_score)
  ON CONFLICT (user_id, date) DO UPDATE
    SET quiz_score = GREATEST(public.seer_rings_daily.quiz_score, p_score),
        updated_at = now()
  RETURNING * INTO v_row;

  -- Axis push (doubled bonus per §6.2): only if THIS pass crossed the 80
  -- threshold AND prior quiz_score was below 80 (avoid double-bonus).
  IF p_score >= 80 AND v_prev_qs < 80 THEN
    CASE v_category
      WHEN 'fundamentals' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Fundamentals', 10, 'quiz:'||p_concept_slug);
      WHEN 'agents' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Agents', 10, 'quiz:'||p_concept_slug);
      WHEN 'atlas' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 4, 'quiz:'||p_concept_slug);
      WHEN 'economics' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Frontier', 4, 'quiz:'||p_concept_slug);
      WHEN 'governance' THEN
        PERFORM public.seer_push_radar_axis(v_uid, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_uid, 'Workflow', 4, 'quiz:'||p_concept_slug);
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_uid, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_close_quiz_ring(text, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_close_quiz_ring(text, int) TO authenticated;

-- ──────────── seer_close_feed_ring ──────────────────────────────────────
-- Phase 1: counts feed-item opens, dedupes via feed_items array.
-- Phase 2 (when seer_feed_items lands): looks up item.category and applies
-- axis push per §6.2 feed table. For now, push is omitted — counter only.
DROP FUNCTION IF EXISTS public.seer_close_feed_ring(uuid);
CREATE OR REPLACE FUNCTION public.seer_close_feed_ring(p_item_id uuid)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid   uuid;
  v_today date;
  v_row   public.seer_rings_daily;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'invalid_item_id' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();
  v_today := public.seer_today_chicago();

  INSERT INTO public.seer_rings_daily (user_id, date, feed_opened, feed_items)
  VALUES (v_uid, v_today, 1, ARRAY[p_item_id])
  ON CONFLICT (user_id, date) DO UPDATE
    SET feed_opened = CASE
          WHEN p_item_id = ANY (public.seer_rings_daily.feed_items)
            THEN public.seer_rings_daily.feed_opened
          ELSE public.seer_rings_daily.feed_opened + 1
        END,
        feed_items = CASE
          WHEN p_item_id = ANY (public.seer_rings_daily.feed_items)
            THEN public.seer_rings_daily.feed_items
          ELSE array_append(public.seer_rings_daily.feed_items, p_item_id)
        END,
        updated_at = now()
  RETURNING * INTO v_row;

  -- TODO Phase 2: lookup item category from seer_feed_items and push
  -- corresponding axis (frontier→Frontier+3 / workflow→Workflow+3 / etc.)

  PERFORM public.seer_recompute_all_closed(v_uid, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily
   WHERE user_id = v_uid AND date = v_today;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) TO authenticated;

-- ──────────── seer_recompute_all_closed (internal) ──────────────────────
-- Sets all_closed = true when READ ≥ 1 AND QUIZ ≥ 80 AND FEED ≥ 5.
-- Bumps streak on transition false→true.
CREATE OR REPLACE FUNCTION public.seer_recompute_all_closed(
  p_user_id uuid,
  p_date    date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_was_closed bool;
  v_now_closed bool;
  v_yesterday  date;
  v_streak_row public.seer_streak;
BEGIN
  SELECT all_closed,
         (read_count >= 1 AND quiz_score >= 80 AND feed_opened >= 5)
    INTO v_was_closed, v_now_closed
    FROM public.seer_rings_daily
   WHERE user_id = p_user_id AND date = p_date;

  IF NOT v_was_closed AND v_now_closed THEN
    UPDATE public.seer_rings_daily
       SET all_closed = true, updated_at = now()
     WHERE user_id = p_user_id AND date = p_date;

    -- Streak update — only fire on close-state transition
    SELECT * INTO v_streak_row FROM public.seer_streak WHERE user_id = p_user_id;
    v_yesterday := p_date - INTERVAL '1 day';

    IF v_streak_row IS NULL THEN
      INSERT INTO public.seer_streak (user_id, current_streak, longest_streak, last_perfect_day)
      VALUES (p_user_id, 1, 1, p_date);
    ELSIF v_streak_row.last_perfect_day = v_yesterday THEN
      UPDATE public.seer_streak
         SET current_streak = current_streak + 1,
             longest_streak = GREATEST(longest_streak, current_streak + 1),
             last_perfect_day = p_date,
             updated_at = now()
       WHERE user_id = p_user_id;
    ELSIF v_streak_row.last_perfect_day = p_date THEN
      -- Already credited today — no-op
      NULL;
    ELSE
      -- Streak broken; reset to 1
      UPDATE public.seer_streak
         SET current_streak = 1,
             longest_streak = GREATEST(longest_streak, 1),
             last_perfect_day = p_date,
             updated_at = now()
       WHERE user_id = p_user_id;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.seer_recompute_all_closed(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_recompute_all_closed(uuid, date) FROM authenticated, anon;

-- ──────────── seer_get_radar ────────────────────────────────────────────
-- Returns 5 rows (one per axis), with decay applied at read time per §6.3:
--   decayed_score = greatest(0, score - floor(weeks_since_last_pushed) * 1)
-- Cheap (no mutation on read; idempotent). Backfills missing axes as 0.
DROP FUNCTION IF EXISTS public.seer_get_radar();
CREATE OR REPLACE FUNCTION public.seer_get_radar()
RETURNS TABLE (
  axis           text,
  score          int,
  decayed_score  int,
  last_pushed_at timestamptz,
  weeks_inactive int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  v_uid := auth.uid();

  -- Canonical axis order per spec §6.2 (Fundamentals → Frontier),
  -- not alphabetical (red-teamer R1 L-1 fix).
  RETURN QUERY
  WITH all_axes AS (
    SELECT a, ord FROM (VALUES
      ('Fundamentals', 1),
      ('Tooling',      2),
      ('Workflow',     3),
      ('Agents',       4),
      ('Frontier',     5)
    ) AS t(a, ord)
  ),
  raw AS (
    SELECT a.a AS axis,
           a.ord AS ord,
           COALESCE(s.score, 0) AS score,
           -- NULL last_pushed_at preserved for never-pushed axes — UI can
           -- distinguish "never touched" from "freshly pushed" (red-teamer
           -- R1 M-3 fix).
           s.last_pushed_at AS last_pushed_at,
           CASE
             WHEN s.last_pushed_at IS NULL THEN 0
             ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - s.last_pushed_at)) / 604800)::int)
           END AS weeks_inactive
      FROM all_axes a
      LEFT JOIN public.seer_radar_state s
        ON s.user_id = v_uid AND s.axis = a.a
  )
  SELECT raw.axis,
         raw.score,
         GREATEST(0, raw.score - raw.weeks_inactive * 1)::int AS decayed_score,
         raw.last_pushed_at,
         raw.weeks_inactive
    FROM raw
   ORDER BY raw.ord;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_get_radar() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_get_radar() TO authenticated;

-- ──────────── seer_get_streak ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.seer_get_streak();
CREATE OR REPLACE FUNCTION public.seer_get_streak()
RETURNS public.seer_streak
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_row public.seer_streak;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  v_uid := auth.uid();

  -- Auto-seed empty streak row on first call
  INSERT INTO public.seer_streak (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.seer_streak WHERE user_id = v_uid;
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seer_get_streak() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_get_streak() TO authenticated;
