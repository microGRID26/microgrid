-- ─────────────────────────────────────────────────────────────────────────
-- mig 310 · Seer · Phase 0 follow-up — re-key gamification on owner_id
-- ─────────────────────────────────────────────────────────────────────────
-- Closes greg_actions #721. mig 263 keyed seer_rings_daily / seer_radar_state
-- / seer_streak on user_id = auth.uid(). Greg has two auth.users rows
-- (Apple relay ccd8d3f0… bound via provider_subs.bound_user_ids + legacy
-- Google 395611ed…) that BOTH resolve to the same atlas_hq_users owner row
-- (6a5e168c…) per the mig 257 multi-path is_owner check. If Greg ever signs
-- in via the alternate provider — or if the Apple relay binding rotates —
-- his rings / streak / radar appear reset because a separate row exists keyed
-- on the OTHER auth.users uid.
--
-- Fix: re-key the three tables on owner_id = atlas_hq_users.id. Both
-- providers resolve to the same owner_id so the user's progress persists
-- across provider switches.
--
-- Surfaces touched:
--   • New helper public.atlas_hq_resolve_owner_id(p_uid uuid) returns the
--     canonical atlas_hq_users.id for the calling auth uid via the same
--     three resolution paths atlas_hq_is_owner uses (direct auth_user_id,
--     bound_user_ids in provider_subs JSON, confirmed-non-relay email match).
--   • seer_rings_daily / seer_radar_state / seer_streak gain owner_id uuid
--     NOT NULL + FK to atlas_hq_users(id) ON DELETE CASCADE.
--   • Primary key swap: rings_daily (owner_id,date), radar_state (owner_id,axis),
--     streak (owner_id).
--   • user_id column DROPPED on all three (any breadcrumb of the originating
--     auth row is preserved by the FK chain through atlas_hq_users.auth_user_id
--     and provider_subs.bound_user_ids — keeping the column would re-introduce
--     the ON DELETE CASCADE-to-auth.users hazard #721 was filed to remove).
--   • 12 RPCs rewritten to resolve owner_id from auth.uid() once at top and
--     key all reads/writes/locks on owner_id. The internal helpers
--     seer_push_radar_axis + seer_recompute_all_closed get their first
--     parameter renamed (p_user_id → p_owner_id); callers updated.
--
-- Pre-flight assertions:
--   1. Greg's owner row exists with at least one resolvable auth.users uid
--      among the existing rings/radar/streak data — otherwise backfill would
--      strand his rings on a NULL owner_id and abort.
--
-- Post-flight assertions:
--   1. Every row in all three tables has a non-NULL owner_id.
--   2. The owner_id FK points at a live atlas_hq_users row.
--   3. The new (owner_id, …) PKs reject duplicates.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 1. Helper · atlas_hq_resolve_owner_id                                ║
-- ╚══════════════════════════════════════════════════════════════════════╝
-- Returns the canonical atlas_hq_users.id for the calling auth uid, or
-- NULL if the caller is not an owner. RPCs check the return value and
-- RAISE not_owner uniformly.
--
-- INTENTIONALLY NARROWER THAN atlas_hq_is_owner: only the two EXPLICITLY
-- BOUND resolution paths are honored.
--
--   Path 1: hu.auth_user_id = p_uid          (Google legacy web binding)
--   Path 2: p_uid::text ∈ provider_subs.bound_user_ids   (Apple relay path)
--
-- The email-match Path 3 that atlas_hq_is_owner accepts is DROPPED here
-- (red-teamer R1 H-1, folded inline at mig-310 pre-apply). Rationale: any
-- future auth.users row whose email matches an owner email AND carries
-- email_confirmed_at IS NOT NULL would otherwise inherit the owner's
-- owner_id. OAuth IdPs (Google direct, custom OIDC/SAML) stamp
-- email_confirmed_at without inbox-control verification. The auto-grant
-- via email-match was a fallback for the original mig 253 design; mig 257
-- introduced Path 2 (bound_user_ids) which makes Path 3 redundant for
-- intended bindings. New providers can be bound by an admin appending to
-- bound_user_ids; we don't auto-grant on email-shape.
--
-- Volatility: STABLE — Postgres is free to memoize across rows within a
-- single statement. The 12 caller-facing RPCs each invoke this once at top
-- with auth.uid(); never invoke this in a correlated subquery or SET
-- expression on a multi-row table (it will silently cache).
--
-- Invoker-context guard matches atlas_hq_is_owner: service_role / postgres
-- can resolve any uid; authenticated callers can only resolve their own
-- auth.uid(). The COALESCE-to-empty-string on auth.role() (red-teamer M-2)
-- ensures a NULL JWT context falls into the "authenticated" branch instead
-- of skipping the RAISE via three-valued logic.
CREATE OR REPLACE FUNCTION public.atlas_hq_resolve_owner_id(p_uid uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  IF p_uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (COALESCE(auth.role(), '') IN ('service_role', 'postgres') OR p_uid = auth.uid()) THEN
    RAISE EXCEPTION 'cross_user_resolve_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT hu.id
    INTO v_owner_id
    FROM public.atlas_hq_users hu
   WHERE hu.role = 'owner'
     AND hu.active
     AND (
       -- Path 1: legacy direct auth_user_id binding (Google web flow)
       hu.auth_user_id = p_uid
       -- Path 2: admin-bound via provider_subs.bound_user_ids (Apple relay path)
       OR (
         hu.provider_subs ? 'bound_user_ids'
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements_text(hu.provider_subs->'bound_user_ids') v(uid_text)
            WHERE v.uid_text = p_uid::text
         )
       )
     )
   ORDER BY hu.id  -- deterministic if atlas_hq_users ever grows to multiple owners (red-teamer L-1)
   LIMIT 1;
  RETURN v_owner_id;
END;
$function$;

-- Per-role REVOKEs (atlas-fn-grant-guard hook requires separate role per stmt;
-- combined REVOKE … FROM anon, authenticated reads as missing-authenticated
-- to the hook regex). The atlas_* surface needs anon/authenticated explicitly
-- locked out — Supabase's default ACL grants both EXECUTE on public-schema
-- funcs, and REVOKE FROM PUBLIC alone is a no-op against those grants
-- (greg_actions #636, 2026-05-08 incident).
REVOKE EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_hq_resolve_owner_id(uuid) TO service_role;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 2. Pre-flight: confirm Greg's owner row resolves for every existing   ║
-- ║    user_id in the three tables before we trust the backfill.          ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DO $$
DECLARE
  v_owners      int;
  v_unresolved  int;
BEGIN
  SELECT count(*) INTO v_owners FROM public.atlas_hq_users WHERE active AND role='owner';
  IF v_owners < 1 THEN
    RAISE EXCEPTION 'mig 310 abort: no active owner row in atlas_hq_users — backfill cannot proceed';
  END IF;

  WITH all_uids AS (
    SELECT user_id FROM public.seer_rings_daily
    UNION SELECT user_id FROM public.seer_radar_state
    UNION SELECT user_id FROM public.seer_streak
  )
  SELECT count(*) INTO v_unresolved
    FROM all_uids u
   WHERE NOT EXISTS (
     SELECT 1 FROM public.atlas_hq_users hu
      WHERE hu.role='owner' AND hu.active
        AND (
          hu.auth_user_id = u.user_id
          OR (hu.provider_subs ? 'bound_user_ids'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(hu.provider_subs->'bound_user_ids') x(t)
                           WHERE x.t = u.user_id::text))
        )
   );
  IF v_unresolved > 0 THEN
    RAISE EXCEPTION 'mig 310 abort: % distinct user_id(s) in rings/radar/streak do not resolve to any owner row', v_unresolved;
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 3. Add owner_id column (nullable for backfill window), backfill,      ║
-- ║    then enforce NOT NULL + FK.                                        ║
-- ╚══════════════════════════════════════════════════════════════════════╝
ALTER TABLE public.seer_rings_daily ADD COLUMN owner_id uuid;
ALTER TABLE public.seer_radar_state ADD COLUMN owner_id uuid;
ALTER TABLE public.seer_streak      ADD COLUMN owner_id uuid;

-- Backfill: inline the resolution logic. Uses ONLY Path 1 + Path 2 (same as
-- the new helper). Path 3 email-match deliberately omitted (red-teamer R1
-- H-1, folded inline pre-apply) — every existing rings/radar/streak row was
-- pre-verified to resolve through Path 1 or Path 2 in the pre-flight DO
-- block above.
UPDATE public.seer_rings_daily t
   SET owner_id = (
     SELECT hu.id FROM public.atlas_hq_users hu
      WHERE hu.role='owner' AND hu.active
        AND (
          hu.auth_user_id = t.user_id
          OR (hu.provider_subs ? 'bound_user_ids'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(hu.provider_subs->'bound_user_ids') x(t2)
                           WHERE x.t2 = t.user_id::text))
        )
      ORDER BY hu.id
      LIMIT 1
   );

UPDATE public.seer_radar_state t
   SET owner_id = (
     SELECT hu.id FROM public.atlas_hq_users hu
      WHERE hu.role='owner' AND hu.active
        AND (
          hu.auth_user_id = t.user_id
          OR (hu.provider_subs ? 'bound_user_ids'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(hu.provider_subs->'bound_user_ids') x(t2)
                           WHERE x.t2 = t.user_id::text))
        )
      ORDER BY hu.id
      LIMIT 1
   );

UPDATE public.seer_streak t
   SET owner_id = (
     SELECT hu.id FROM public.atlas_hq_users hu
      WHERE hu.role='owner' AND hu.active
        AND (
          hu.auth_user_id = t.user_id
          OR (hu.provider_subs ? 'bound_user_ids'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(hu.provider_subs->'bound_user_ids') x(t2)
                           WHERE x.t2 = t.user_id::text))
        )
      ORDER BY hu.id
      LIMIT 1
   );

-- Hard-stop if backfill left any NULL owner_id (paranoia — pre-flight already
-- verified the cohort, but ensure the UPDATE actually ran for every row).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.seer_rings_daily WHERE owner_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.seer_radar_state WHERE owner_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.seer_streak WHERE owner_id IS NULL) THEN
    RAISE EXCEPTION 'mig 310 abort: backfill left at least one NULL owner_id';
  END IF;
END $$;

ALTER TABLE public.seer_rings_daily
  ALTER COLUMN owner_id SET NOT NULL,
  ADD CONSTRAINT seer_rings_daily_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.atlas_hq_users(id) ON DELETE CASCADE;

ALTER TABLE public.seer_radar_state
  ALTER COLUMN owner_id SET NOT NULL,
  ADD CONSTRAINT seer_radar_state_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.atlas_hq_users(id) ON DELETE CASCADE;

ALTER TABLE public.seer_streak
  ALTER COLUMN owner_id SET NOT NULL,
  ADD CONSTRAINT seer_streak_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.atlas_hq_users(id) ON DELETE CASCADE;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 4. Drop existing functions that reference user_id on these tables —   ║
-- ║    they must go before the DROP COLUMN. Recreated below on owner_id.  ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DROP FUNCTION IF EXISTS public.seer_get_today_rings();
DROP FUNCTION IF EXISTS public.seer_close_read_ring(text);
DROP FUNCTION IF EXISTS public.seer_close_quiz_ring(text, int);
DROP FUNCTION IF EXISTS public.seer_close_feed_ring(uuid);
DROP FUNCTION IF EXISTS public.seer_get_radar();
DROP FUNCTION IF EXISTS public.seer_get_streak();
DROP FUNCTION IF EXISTS public.seer_push_radar_axis(uuid, text, int, text);
DROP FUNCTION IF EXISTS public.seer_recompute_all_closed(uuid, date);
DROP FUNCTION IF EXISTS public.seer_feed_list(int);
DROP FUNCTION IF EXISTS public.seer_rank_concepts(text);
DROP FUNCTION IF EXISTS public.seer_rank_ladder();
DROP FUNCTION IF EXISTS public.seer_today_summary();

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 5. Swap primary keys; drop user_id column.                            ║
-- ╚══════════════════════════════════════════════════════════════════════╝
ALTER TABLE public.seer_rings_daily DROP CONSTRAINT seer_rings_daily_pkey;
ALTER TABLE public.seer_radar_state DROP CONSTRAINT seer_radar_state_pkey;
ALTER TABLE public.seer_streak      DROP CONSTRAINT seer_streak_pkey;

ALTER TABLE public.seer_rings_daily DROP COLUMN user_id;
ALTER TABLE public.seer_radar_state DROP COLUMN user_id;
ALTER TABLE public.seer_streak      DROP COLUMN user_id;

ALTER TABLE public.seer_rings_daily ADD PRIMARY KEY (owner_id, date);
ALTER TABLE public.seer_radar_state ADD PRIMARY KEY (owner_id, axis);
ALTER TABLE public.seer_streak      ADD PRIMARY KEY (owner_id);

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 6. Recreate the 12 affected functions, keying on owner_id.            ║
-- ║                                                                       ║
-- ║ Pattern for caller-facing RPCs:                                       ║
-- ║   - Resolve v_owner_id from auth.uid() ONCE at top                    ║
-- ║   - RAISE not_owner if NULL (preserves the same 42501 error contract  ║
-- ║     callers already handle; no client-side change required)           ║
-- ║   - All read/write/lock keys use v_owner_id instead of v_uid          ║
-- ║                                                                       ║
-- ║ Pattern for internal helpers seer_push_radar_axis +                   ║
-- ║ seer_recompute_all_closed:                                            ║
-- ║   - First parameter renamed p_user_id → p_owner_id                    ║
-- ║   - Body keys on owner_id                                             ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ─── seer_push_radar_axis (internal) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_push_radar_axis(p_owner_id uuid, p_axis text, p_points integer, p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF p_axis NOT IN ('Fundamentals','Tooling','Workflow','Agents','Frontier') THEN
    RAISE EXCEPTION 'invalid_axis: %', p_axis USING ERRCODE = '22023';
  END IF;
  IF p_points <= 0 OR p_points > 50 THEN
    RAISE EXCEPTION 'invalid_points: % (must be 1..50)', p_points USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.seer_radar_state (owner_id, axis, score, last_pushed_at, history_jsonb)
  VALUES (p_owner_id, p_axis, LEAST(100, p_points), now(),
          jsonb_build_array(jsonb_build_object('at', now(), 'points', p_points, 'source', p_source)))
  ON CONFLICT (owner_id, axis) DO UPDATE
    SET score = LEAST(100, public.seer_radar_state.score + p_points),
        last_pushed_at = now(),
        history_jsonb = public.seer_radar_state.history_jsonb
                        || jsonb_build_object('at', now(), 'points', p_points, 'source', p_source);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_push_radar_axis(uuid, text, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_push_radar_axis(uuid, text, int, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_push_radar_axis(uuid, text, int, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.seer_push_radar_axis(uuid, text, int, text) TO service_role;

-- ─── seer_recompute_all_closed (internal) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_recompute_all_closed(p_owner_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_was_closed bool;
  v_now_closed bool;
  v_yesterday  date;
  v_streak_row public.seer_streak;
BEGIN
  SELECT all_closed, (read_count >= 1 AND quiz_score >= 80 AND feed_opened >= 5)
    INTO v_was_closed, v_now_closed
    FROM public.seer_rings_daily WHERE owner_id = p_owner_id AND date = p_date;
  IF NOT v_was_closed AND v_now_closed THEN
    UPDATE public.seer_rings_daily SET all_closed = true, updated_at = now()
     WHERE owner_id = p_owner_id AND date = p_date;
    SELECT * INTO v_streak_row FROM public.seer_streak WHERE owner_id = p_owner_id;
    v_yesterday := p_date - INTERVAL '1 day';
    IF v_streak_row IS NULL THEN
      INSERT INTO public.seer_streak (owner_id, current_streak, longest_streak, last_perfect_day)
      VALUES (p_owner_id, 1, 1, p_date);
    ELSIF v_streak_row.last_perfect_day = v_yesterday THEN
      UPDATE public.seer_streak
         SET current_streak = current_streak + 1,
             longest_streak = GREATEST(longest_streak, current_streak + 1),
             last_perfect_day = p_date, updated_at = now()
       WHERE owner_id = p_owner_id;
    ELSIF v_streak_row.last_perfect_day = p_date THEN
      NULL;
    ELSE
      UPDATE public.seer_streak
         SET current_streak = 1, longest_streak = GREATEST(longest_streak, 1),
             last_perfect_day = p_date, updated_at = now()
       WHERE owner_id = p_owner_id;
    END IF;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_recompute_all_closed(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seer_recompute_all_closed(uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seer_recompute_all_closed(uuid, date) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.seer_recompute_all_closed(uuid, date) TO service_role;

-- ─── seer_get_today_rings ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_get_today_rings()
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE v_owner_id uuid; v_row public.seer_rings_daily;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.seer_rings_daily (owner_id, date)
  VALUES (v_owner_id, public.seer_today_chicago())
  ON CONFLICT (owner_id, date) DO NOTHING;
  SELECT * INTO v_row FROM public.seer_rings_daily
   WHERE owner_id = v_owner_id AND date = public.seer_today_chicago();
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_get_today_rings() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_get_today_rings() TO authenticated;

-- ─── seer_get_streak ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_get_streak()
RETURNS public.seer_streak
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE v_owner_id uuid; v_row public.seer_streak;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.seer_streak (owner_id) VALUES (v_owner_id)
  ON CONFLICT (owner_id) DO NOTHING;
  SELECT * INTO v_row FROM public.seer_streak WHERE owner_id = v_owner_id;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_get_streak() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_get_streak() TO authenticated;

-- ─── seer_get_radar ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_get_radar()
RETURNS TABLE(axis text, score integer, decayed_score integer, last_pushed_at timestamp with time zone, weeks_inactive integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE v_owner_id uuid;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH all_axes AS (
    SELECT a, ord FROM (VALUES
      ('Fundamentals', 1), ('Tooling', 2), ('Workflow', 3),
      ('Agents', 4), ('Frontier', 5)
    ) AS t(a, ord)
  ),
  raw AS (
    SELECT a.a AS axis, a.ord AS ord,
           COALESCE(s.score, 0) AS score,
           s.last_pushed_at AS last_pushed_at,
           CASE WHEN s.last_pushed_at IS NULL THEN 0
                ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - s.last_pushed_at)) / 604800)::int)
           END AS weeks_inactive
      FROM all_axes a
      LEFT JOIN public.seer_radar_state s ON s.owner_id = v_owner_id AND s.axis = a.a
  )
  SELECT raw.axis, raw.score,
         GREATEST(0, raw.score - raw.weeks_inactive * 1)::int AS decayed_score,
         raw.last_pushed_at, raw.weeks_inactive
    FROM raw ORDER BY raw.ord;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_get_radar() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_get_radar() TO authenticated;

-- ─── seer_close_read_ring ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_close_read_ring(p_concept_slug text)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id      uuid;
  v_today         date;
  v_category      text;
  v_already_read  bool := false;
  v_row           public.seer_rings_daily;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_concept_slug IS NULL OR length(p_concept_slug) = 0 OR length(p_concept_slug) > 200 THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
  END IF;

  v_today := public.seer_today_chicago();

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':' || v_today::text, 0)
  );

  SELECT category INTO v_category FROM public.learn_concepts WHERE slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_concept: %', p_concept_slug USING ERRCODE = '22023';
  END IF;

  SELECT (p_concept_slug = ANY (read_concepts)) INTO v_already_read
    FROM public.seer_rings_daily
   WHERE owner_id = v_owner_id AND date = v_today;
  v_already_read := COALESCE(v_already_read, false);

  INSERT INTO public.seer_rings_daily (owner_id, date, read_count, read_concepts)
  VALUES (v_owner_id, v_today, 1, ARRAY[p_concept_slug])
  ON CONFLICT (owner_id, date) DO UPDATE
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
      WHEN 'fundamentals' THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Fundamentals', 5, 'concept:'||p_concept_slug);
      WHEN 'agents'       THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Agents', 5, 'concept:'||p_concept_slug);
      WHEN 'agent-fleet' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Agents', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 2, 'concept:'||p_concept_slug);
      WHEN 'atlas' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 2, 'concept:'||p_concept_slug);
      WHEN 'economics' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Frontier', 2, 'concept:'||p_concept_slug);
      WHEN 'governance' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 2, 'concept:'||p_concept_slug);
      WHEN 'engineering' THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Fundamentals', 5, 'concept:'||p_concept_slug);
      WHEN 'system-design' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Frontier', 2, 'concept:'||p_concept_slug);
      WHEN 'leadership' THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 5, 'concept:'||p_concept_slug);
      WHEN 'infrastructure' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 3, 'concept:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 2, 'concept:'||p_concept_slug);
      ELSE
        RAISE WARNING 'seer_close_read_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_owner_id, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE owner_id = v_owner_id AND date = v_today;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_close_read_ring(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_close_read_ring(text) TO authenticated;

-- ─── seer_close_quiz_ring ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_close_quiz_ring(p_concept_slug text, p_score integer)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id       uuid;
  v_today          date;
  v_category       text;
  v_already_passed bool := false;
  v_row            public.seer_rings_daily;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_score < 0 OR p_score > 100 THEN
    RAISE EXCEPTION 'invalid_score: %', p_score USING ERRCODE = '22023';
  END IF;
  IF p_concept_slug IS NULL OR length(p_concept_slug) = 0 OR length(p_concept_slug) > 200 THEN
    RAISE EXCEPTION 'invalid_slug' USING ERRCODE = '22023';
  END IF;

  v_today := public.seer_today_chicago();

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':' || v_today::text, 0)
  );

  SELECT category INTO v_category FROM public.learn_concepts WHERE slug = p_concept_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_concept: %', p_concept_slug USING ERRCODE = '22023';
  END IF;

  SELECT (p_concept_slug = ANY (quiz_concepts)) INTO v_already_passed
    FROM public.seer_rings_daily
   WHERE owner_id = v_owner_id AND date = v_today;
  v_already_passed := COALESCE(v_already_passed, false);

  INSERT INTO public.seer_rings_daily (owner_id, date, quiz_score, quiz_concepts)
  VALUES (
    v_owner_id, v_today, p_score,
    CASE WHEN p_score >= 80 THEN ARRAY[p_concept_slug] ELSE ARRAY[]::text[] END
  )
  ON CONFLICT (owner_id, date) DO UPDATE
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
      WHEN 'fundamentals' THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Fundamentals', 10, 'quiz:'||p_concept_slug);
      WHEN 'agents'       THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Agents', 10, 'quiz:'||p_concept_slug);
      WHEN 'agent-fleet' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Agents', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 4, 'quiz:'||p_concept_slug);
      WHEN 'atlas' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 4, 'quiz:'||p_concept_slug);
      WHEN 'economics' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Frontier', 4, 'quiz:'||p_concept_slug);
      WHEN 'governance' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 4, 'quiz:'||p_concept_slug);
      WHEN 'engineering' THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Fundamentals', 10, 'quiz:'||p_concept_slug);
      WHEN 'system-design' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Frontier', 4, 'quiz:'||p_concept_slug);
      WHEN 'leadership' THEN PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 10, 'quiz:'||p_concept_slug);
      WHEN 'infrastructure' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 6, 'quiz:'||p_concept_slug);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 4, 'quiz:'||p_concept_slug);
      ELSE
        RAISE WARNING 'seer_close_quiz_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_owner_id, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE owner_id = v_owner_id AND date = v_today;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_close_quiz_ring(text, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_close_quiz_ring(text, int) TO authenticated;

-- ─── seer_close_feed_ring ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_close_feed_ring(p_item_id uuid)
RETURNS public.seer_rings_daily
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id        uuid;
  v_today           date;
  v_category        text;
  v_already_opened  bool := false;
  v_row             public.seer_rings_daily;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'invalid_item_id' USING ERRCODE = '22023';
  END IF;

  v_today := public.seer_today_chicago();

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_owner_id::text || ':' || v_today::text, 0)
  );

  SELECT i.category INTO v_category
    FROM public.seer_feed_items i
    JOIN public.seer_feed_sources s ON s.id = i.source_id
   WHERE i.id = p_item_id AND s.enabled = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_or_disabled_feed_item: %', p_item_id USING ERRCODE = '22023';
  END IF;

  SELECT (p_item_id = ANY (feed_items)) INTO v_already_opened
    FROM public.seer_rings_daily
   WHERE owner_id = v_owner_id AND date = v_today;
  v_already_opened := COALESCE(v_already_opened, false);

  INSERT INTO public.seer_rings_daily (owner_id, date, feed_opened, feed_items)
  VALUES (v_owner_id, v_today, 1, ARRAY[p_item_id])
  ON CONFLICT (owner_id, date) DO UPDATE
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

  IF NOT v_already_opened THEN
    CASE v_category
      WHEN 'frontier' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Frontier', 3, 'feed:'||p_item_id::text);
      WHEN 'workflow' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Workflow', 3, 'feed:'||p_item_id::text);
      WHEN 'tooling' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 3, 'feed:'||p_item_id::text);
      WHEN 'lab' THEN
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Frontier', 2, 'feed:'||p_item_id::text);
        PERFORM public.seer_push_radar_axis(v_owner_id, 'Tooling', 1, 'feed:'||p_item_id::text);
      ELSE
        RAISE WARNING 'seer_close_feed_ring: no axis mapping for category %', v_category;
    END CASE;
  END IF;

  PERFORM public.seer_recompute_all_closed(v_owner_id, v_today);
  SELECT * INTO v_row FROM public.seer_rings_daily WHERE owner_id = v_owner_id AND date = v_today;
  RETURN v_row;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_close_feed_ring(uuid) TO authenticated;

-- ─── seer_feed_list ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_feed_list(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, source_id uuid, source_name text, url text, title text, summary text, author text, published_at timestamp with time zone, category text, og_image_url text, opened_today boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id     uuid;
  v_today        date;
  v_today_items  uuid[];
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;

  v_today := public.seer_today_chicago();

  SELECT feed_items INTO v_today_items
    FROM public.seer_rings_daily
   WHERE owner_id = v_owner_id AND date = v_today;
  v_today_items := COALESCE(v_today_items, ARRAY[]::uuid[]);

  RETURN QUERY
  SELECT i.id, i.source_id, s.name AS source_name, i.url, i.title, i.summary,
         i.author, i.published_at, i.category, i.og_image_url,
         (i.id = ANY (v_today_items)) AS opened_today
    FROM public.seer_feed_items i
    JOIN public.seer_feed_sources s ON s.id = i.source_id
   WHERE s.enabled = true
   ORDER BY i.published_at DESC
   LIMIT p_limit;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_feed_list(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_feed_list(int) TO authenticated;

-- ─── seer_rank_concepts ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_rank_concepts(p_rank_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
  v_rank_id  integer;
  v_rows     jsonb;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;
  IF p_rank_slug IS NULL OR length(p_rank_slug) = 0 OR length(p_rank_slug) > 100 THEN
    RAISE EXCEPTION 'invalid_rank_slug' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_rank_id FROM public.seer_ranks WHERE slug = p_rank_slug;
  IF v_rank_id IS NULL THEN
    RAISE EXCEPTION 'unknown_rank: %', p_rank_slug USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
      'slug', c.slug,
      'title', c.title,
      'subtitle', c.subtitle,
      'category', c.category,
      'display_order', c.display_order,
      'done', EXISTS (
        SELECT 1 FROM public.seer_rings_daily rd
         WHERE rd.owner_id = v_owner_id AND c.slug = ANY (rd.read_concepts)
      )
    ) ORDER BY c.display_order)
    INTO v_rows
    FROM public.learn_concepts c
   WHERE c.rank_id = v_rank_id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_rank_concepts(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_rank_concepts(text) TO authenticated;

-- ─── seer_rank_ladder ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_rank_ladder()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
  v_rows     jsonb;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_agg(rank_row ORDER BY (rank_row->>'display_order')::int)
    INTO v_rows
    FROM (
      SELECT jsonb_build_object(
        'slug', r.slug,
        'display_name', r.display_name,
        'display_order', r.display_order,
        'total', (SELECT COUNT(*) FROM public.learn_concepts WHERE rank_id = r.id),
        'done', (SELECT COUNT(*) FROM public.learn_concepts c
                  WHERE c.rank_id = r.id
                    AND EXISTS (SELECT 1 FROM public.seer_rings_daily rd
                                 WHERE rd.owner_id = v_owner_id AND c.slug = ANY (rd.read_concepts)))
      ) AS rank_row
      FROM public.seer_ranks r
    ) sub;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_rank_ladder() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_rank_ladder() TO authenticated;

-- ─── seer_today_summary ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_today_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_owner_id           uuid;
  v_current_rank_id    integer;
  v_current_rank       record;
  v_prev_rank          record;
  v_next_rank          record;
  v_in_rank_total      integer;
  v_in_rank_done       integer;
  v_to_next            integer;
  v_next_concepts      jsonb;
BEGIN
  v_owner_id := public.atlas_hq_resolve_owner_id(auth.uid());
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  SELECT MIN(c.rank_id) INTO v_current_rank_id
    FROM public.learn_concepts c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.seer_rings_daily r
      WHERE r.owner_id = v_owner_id AND c.slug = ANY (r.read_concepts)
   );

  IF v_current_rank_id IS NULL THEN
    SELECT MAX(id) INTO v_current_rank_id FROM public.seer_ranks;
  END IF;

  SELECT * INTO v_current_rank FROM public.seer_ranks WHERE id = v_current_rank_id;
  SELECT * INTO v_prev_rank    FROM public.seer_ranks WHERE id = v_current_rank_id - 1;
  SELECT * INTO v_next_rank    FROM public.seer_ranks WHERE id = v_current_rank_id + 1;

  SELECT COUNT(*) INTO v_in_rank_total FROM public.learn_concepts WHERE rank_id = v_current_rank_id;

  SELECT COUNT(*) INTO v_in_rank_done
    FROM public.learn_concepts c
   WHERE c.rank_id = v_current_rank_id
     AND EXISTS (
       SELECT 1 FROM public.seer_rings_daily r
        WHERE r.owner_id = v_owner_id AND c.slug = ANY (r.read_concepts)
     );

  v_to_next := GREATEST(v_in_rank_total - v_in_rank_done, 0);

  SELECT jsonb_agg(jsonb_build_object(
      'slug', c.slug,
      'title', c.title,
      'subtitle', c.subtitle,
      'display_order', c.display_order
    ) ORDER BY c.rank_id, c.display_order)
    INTO v_next_concepts
    FROM (
      SELECT slug, title, subtitle, display_order, rank_id
        FROM public.learn_concepts c
       WHERE NOT EXISTS (
         SELECT 1 FROM public.seer_rings_daily r
          WHERE r.owner_id = v_owner_id AND c.slug = ANY (r.read_concepts)
       )
       ORDER BY rank_id, display_order
       LIMIT 3
    ) c;

  RETURN jsonb_build_object(
    'current_rank', jsonb_build_object(
      'slug', v_current_rank.slug,
      'display_name', v_current_rank.display_name,
      'display_order', v_current_rank.display_order,
      'done', v_in_rank_done,
      'total', v_in_rank_total,
      'to_next', v_to_next
    ),
    'prev_rank', CASE WHEN v_prev_rank.id IS NOT NULL THEN
      jsonb_build_object('slug', v_prev_rank.slug, 'display_name', v_prev_rank.display_name)
      ELSE NULL END,
    'next_rank', CASE WHEN v_next_rank.id IS NOT NULL THEN
      jsonb_build_object('slug', v_next_rank.slug, 'display_name', v_next_rank.display_name)
      ELSE NULL END,
    'current_position', v_current_rank_id,
    'total_concepts', (SELECT COUNT(*) FROM public.learn_concepts),
    'next_concepts', COALESCE(v_next_concepts, '[]'::jsonb)
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.seer_today_summary() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.seer_today_summary() TO authenticated;

-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║ 7. Post-flight assertions                                              ║
-- ╚══════════════════════════════════════════════════════════════════════╝
DO $$
DECLARE
  v_pk_rings text;
  v_pk_radar text;
  v_pk_streak text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.seer_rings_daily WHERE owner_id IS NULL) THEN
    RAISE EXCEPTION 'post-flight abort: seer_rings_daily has NULL owner_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seer_radar_state WHERE owner_id IS NULL) THEN
    RAISE EXCEPTION 'post-flight abort: seer_radar_state has NULL owner_id';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seer_streak WHERE owner_id IS NULL) THEN
    RAISE EXCEPTION 'post-flight abort: seer_streak has NULL owner_id';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_pk_rings
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'seer_rings_daily' AND c.contype = 'p';
  SELECT pg_get_constraintdef(c.oid) INTO v_pk_radar
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'seer_radar_state' AND c.contype = 'p';
  SELECT pg_get_constraintdef(c.oid) INTO v_pk_streak
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'seer_streak' AND c.contype = 'p';
  IF v_pk_rings  NOT LIKE '%owner_id%' THEN RAISE EXCEPTION 'rings PK not on owner_id: %', v_pk_rings; END IF;
  IF v_pk_radar  NOT LIKE '%owner_id%' THEN RAISE EXCEPTION 'radar PK not on owner_id: %', v_pk_radar; END IF;
  IF v_pk_streak NOT LIKE '%owner_id%' THEN RAISE EXCEPTION 'streak PK not on owner_id: %', v_pk_streak; END IF;
END $$;

COMMIT;
