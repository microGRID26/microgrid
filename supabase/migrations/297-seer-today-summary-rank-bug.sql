-- ============================================================================
-- Seer — seer_today_summary current-rank lookup bug + next-concepts ordering
-- ============================================================================
-- Prior version (migration 295) used `display_order = v_current_pos` to look
-- up the current rank's rank_id. But learn_concepts.display_order is per-
-- category (each category starts at 1), so the lookup matched multiple rows
-- with display_order=1 across different ranks. Postgres's LIMIT 1 nondeterm-
-- inistically picked one — Greg's relay account landed on rank_id=8 (s4)
-- despite having only 3 reads.
--
-- Fix:
--   1. current_rank_id = MIN(rank_id) of unread concepts (or MAX(id) if all
--      read — graduated). Deterministic. Tracks actual rank progression.
--   2. next_concepts ordered by (rank_id, display_order) — actual progression
--      order, not arbitrary global display_order.
--   3. v_current_pos variable removed; current_position field now holds
--      current_rank_id (more useful for clients reasoning about progress).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seer_today_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid                uuid;
  v_current_rank_id    integer;
  v_current_rank       record;
  v_prev_rank          record;
  v_next_rank          record;
  v_in_rank_total      integer;
  v_in_rank_done       integer;
  v_to_next            integer;
  v_next_concepts      jsonb;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  v_uid := auth.uid();

  -- Current rank = lowest rank_id that still has at least one unread concept.
  -- If everything is read, fall through to MAX(id) (graduated).
  SELECT MIN(c.rank_id) INTO v_current_rank_id
    FROM public.learn_concepts c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.seer_rings_daily r
      WHERE r.user_id = v_uid AND c.slug = ANY (r.read_concepts)
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
        WHERE r.user_id = v_uid AND c.slug = ANY (r.read_concepts)
     );

  v_to_next := GREATEST(v_in_rank_total - v_in_rank_done, 0);

  -- Next 3 unread concepts in actual progression order: (rank_id, display_order).
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
          WHERE r.user_id = v_uid AND c.slug = ANY (r.read_concepts)
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
$$;

GRANT EXECUTE ON FUNCTION public.seer_today_summary() TO authenticated;
