-- ============================================================================
-- Seer Today Redesign — rank ladder + daily quote + 4 RPCs
-- Spec: ~/.claude/plans/seer-today-redesign-2026-05-11.md
-- Plan: ~/.claude/plans/seer-today-redesign-implementation-2026-05-11.md
-- Pre-flight review: /tmp/seer-phase-6-plan-review.md (7C + 6H caught + patched)
-- ============================================================================

-- ── 1. seer_ranks table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seer_ranks (
  id            integer PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  display_name  text NOT NULL,
  display_order integer NOT NULL UNIQUE
);

INSERT INTO public.seer_ranks (id, slug, display_name, display_order) VALUES
  (1, 'sleeper',    'sleeper',    1),
  (2, 'witness',    'witness',    2),
  (3, 'contact',    'contact',    3),
  (4, 'adept',      'adept',      4),
  (5, 'cypher',     'cypher',     5),
  (6, 'custodian',  'custodian',  6),
  (7, 'oracle',     'oracle',     7),
  (8, 'ascendant',  'ascendant',  8)
ON CONFLICT (id) DO NOTHING;

-- Owner-only: no direct SELECT grant. Reads go through SECDEF RPCs that gate
-- on atlas_hq_is_owner(auth.uid()). This matches spec L174 ("Seer's owner-only
-- model") and matches the C-4 finding from pre-flight review (2026-05-11).
REVOKE ALL ON public.seer_ranks FROM authenticated, anon;
-- R1 red-teamer fix (2026-05-11): defense-in-depth. REVOKE alone is brittle —
-- a future `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated` would
-- silently re-open this table. RLS-enabled with zero policies = deny-by-default
-- even under future grant accidents. Supabase advisor also flags rls_disabled.
ALTER TABLE public.seer_ranks ENABLE ROW LEVEL SECURITY;

-- ── 2. seer_daily_quotes table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seer_daily_quotes (
  id     integer PRIMARY KEY,
  body   text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.seer_daily_quotes (id, body) VALUES
  ( 1, 'I want to believe.'),
  ( 2, 'This is just a simulation.'),
  ( 3, 'Non-human biologics.'),
  ( 4, 'The tic-tac was real.'),
  ( 5, 'Trust no one.'),
  ( 6, 'The truth is out there.'),
  ( 7, 'We are not alone.'),
  ( 8, 'Disclosure is imminent.'),
  ( 9, 'It was a weather balloon.'),
  (10, 'Glitch detected. Reset?'),
  (11, 'Five observables. All five.'),
  (12, 'Base reality is statistically improbable.'),
  (13, 'Render distance: 60 miles.'),
  (14, 'Göbekli Tepe is older than they admit.'),
  (15, 'The Younger Dryas didn''t ask permission.'),
  (16, 'Skinwalker Ranch keeps logging.'),
  (17, 'Q2 budget: ███████.'),
  (18, 'The phenomenon is not subtle.'),
  (19, 'Pyramids predate dynastic Egypt.'),
  (20, 'MKUltra worked.'),
  (21, 'Epstein didn''t kill himself.'),
  (22, 'Operation: ████████.'),
  (23, 'Black budget is bigger than you think.'),
  (24, 'The grid is watching.'),
  (25, 'Aliens or angels — pick one.'),
  (26, 'AARO classified the parking lot.'),
  (27, 'The Sphinx is water-eroded.'),
  (28, 'I''m just asking questions.'),
  (29, 'Eight miles a second, then it stopped.'),
  (30, 'Lost cities under the ice.'),
  (31, 'Project Blue Book never closed.'),
  (32, 'Roswell was the warm-up.'),
  (33, 'Grusch testified. Nobody flinched.'),
  (34, 'Three letters. Same agency.'),
  (35, 'The deep state has an HR department.'),
  (36, 'Render budget exceeded.'),
  (37, 'Compiling reality… 87%.'),
  (38, 'It''s a coincidence. They''re all coincidences.'),
  (39, 'Lue Elizondo knew.'),
  (40, 'Bob Lazar saw the disk.'),
  (41, 'The Antikythera mechanism shouldn''t exist.'),
  (42, 'We''ve been here before.'),
  (43, 'Tic-tac, Gimbal, Go-fast — pick your evidence.'),
  (44, 'Fravor saw what he saw.'),
  (45, 'Operation Paperclip never ended.'),
  (46, 'COINTELPRO got promoted.'),
  (47, 'Iran-Contra was Tuesday.'),
  (48, 'Bohemian Grove. Just camping.'),
  (49, 'The Vatican has a telescope on Mt. Graham.'),
  (50, 'Atlantis. Bring proof.'),
  (51, 'Plato wasn''t lying.'),
  (52, 'The lab leak was always likely.'),
  (53, 'Twitter Files: just the warmup.'),
  (54, 'Wake up, sheeple. (Affectionate.)'),
  (55, 'Operation Mockingbird still sings.'),
  (56, 'We''re in the third density.'),
  (57, 'Saucer crashes don''t make the news.'),
  (58, 'The CIA owned Time magazine.'),
  (59, 'Skinwalker is a reporting site, not a verdict.'),
  (60, 'Hancock and Carlson walk into a podcast.')
ON CONFLICT (id) DO NOTHING;

-- Owner-only: no direct SELECT grant. See seer_ranks note above (C-4 fix).
REVOKE ALL ON public.seer_daily_quotes FROM authenticated, anon;
-- R1 red-teamer fix (2026-05-11): defense-in-depth — same rationale as seer_ranks.
ALTER TABLE public.seer_daily_quotes ENABLE ROW LEVEL SECURITY;

-- ── 3. learn_concepts.rank_id column + backfill ─────────────────────────────
ALTER TABLE public.learn_concepts
  ADD COLUMN IF NOT EXISTS rank_id integer REFERENCES public.seer_ranks(id);

-- C-5 fix (pre-flight 2026-05-11): per-category integrity check before backfill.
-- If categories drift from spec-time distribution, the rank buckets would be
-- wrong silently — guard with explicit RAISE EXCEPTION.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='fundamentals')  <> 3  THEN RAISE EXCEPTION 'category drift: fundamentals expected 3';   END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='agents')        <> 5  THEN RAISE EXCEPTION 'category drift: agents expected 5';         END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='atlas')         <> 5  THEN RAISE EXCEPTION 'category drift: atlas expected 5';          END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='engineering')   <> 8  THEN RAISE EXCEPTION 'category drift: engineering expected 8';    END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='system-design') <> 12 THEN RAISE EXCEPTION 'category drift: system-design expected 12'; END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='infrastructure')<> 8  THEN RAISE EXCEPTION 'category drift: infrastructure expected 8'; END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='leadership')    <> 8  THEN RAISE EXCEPTION 'category drift: leadership expected 8';     END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='agent-fleet')   <> 8  THEN RAISE EXCEPTION 'category drift: agent-fleet expected 8';    END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='economics')     <> 2  THEN RAISE EXCEPTION 'category drift: economics expected 2';      END IF;
  IF (SELECT COUNT(*) FROM public.learn_concepts WHERE category='governance')    <> 1  THEN RAISE EXCEPTION 'category drift: governance expected 1';     END IF;
END $$;

-- All UPDATEs include `AND rank_id IS NULL` for idempotency (H-1 fix).
UPDATE public.learn_concepts SET rank_id = 1 WHERE category = 'fundamentals'              AND rank_id IS NULL;  -- 3 → sleeper
UPDATE public.learn_concepts SET rank_id = 2 WHERE category = 'agents'                    AND rank_id IS NULL;  -- 5 → witness
UPDATE public.learn_concepts SET rank_id = 3 WHERE category IN ('atlas','engineering')    AND rank_id IS NULL;  -- 5+8=13 → contact

-- C-5 fix: prior version had a fatal `UPDATE ... ORDER BY ... LIMIT 8` that
-- Postgres rejects. The CTE-based replacement below is the correct shape.
WITH first_eight AS (
  SELECT slug FROM public.learn_concepts
  WHERE category = 'system-design' AND rank_id IS NULL
  ORDER BY display_order LIMIT 8
)
UPDATE public.learn_concepts c SET rank_id = 4 -- adept
  FROM first_eight WHERE c.slug = first_eight.slug;

WITH next_four AS (
  SELECT slug FROM public.learn_concepts
  WHERE category = 'system-design' AND rank_id IS NULL
  ORDER BY display_order
)
UPDATE public.learn_concepts c SET rank_id = 5 -- cypher (first 4 of 12)
  FROM next_four WHERE c.slug = next_four.slug;

UPDATE public.learn_concepts SET rank_id = 5 WHERE category = 'infrastructure'              AND rank_id IS NULL;  -- cypher (remaining 8 of 12)
UPDATE public.learn_concepts SET rank_id = 6 WHERE category = 'leadership'                  AND rank_id IS NULL;  -- custodian
UPDATE public.learn_concepts SET rank_id = 7 WHERE category = 'agent-fleet'                 AND rank_id IS NULL;  -- oracle
UPDATE public.learn_concepts SET rank_id = 8 WHERE category IN ('economics','governance')   AND rank_id IS NULL;  -- ascendant

-- Verify: every concept has a rank
DO $$
DECLARE v_null_count integer;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM public.learn_concepts WHERE rank_id IS NULL;
  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'rank_id backfill incomplete: % rows still NULL', v_null_count;
  END IF;
END $$;

-- Now safe to enforce NOT NULL
ALTER TABLE public.learn_concepts ALTER COLUMN rank_id SET NOT NULL;

-- ── 4. seer_today_quote() RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_today_quote()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- C-1 fix (pre-flight 2026-05-11): shift the day-of-year by -2 hours so the
  -- quote rolls over at 02:00 America/Chicago, matching spec and client cache key.
  SELECT body FROM public.seer_daily_quotes
  WHERE active = true
  ORDER BY id
  OFFSET ((EXTRACT(doy FROM ((now() AT TIME ZONE 'America/Chicago') - interval '2 hours'))::int - 1) % 60)
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.seer_today_quote() TO authenticated;

-- ── 5. seer_today_summary() RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_today_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid                uuid;
  v_current_pos        integer;
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

  -- C-2 fix: removed dead v_today := seer_today_chicago() assignment.

  v_uid := auth.uid();

  SELECT MIN(c.display_order) INTO v_current_pos
    FROM public.learn_concepts c
   WHERE NOT EXISTS (
     SELECT 1 FROM public.seer_rings_daily r
      WHERE r.user_id = v_uid AND c.slug = ANY (r.read_concepts)
   );

  IF v_current_pos IS NULL THEN
    SELECT MAX(display_order) + 1 INTO v_current_pos FROM public.learn_concepts;
  END IF;

  SELECT rank_id INTO v_current_rank_id
    FROM public.learn_concepts WHERE display_order = v_current_pos LIMIT 1;
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

  -- H-3 fix: exclude already-read concepts from the next-3 list.
  SELECT jsonb_agg(jsonb_build_object(
      'slug', c.slug,
      'title', c.title,
      'subtitle', c.subtitle,
      'display_order', c.display_order
    ) ORDER BY c.display_order)
    INTO v_next_concepts
    FROM (
      SELECT slug, title, subtitle, display_order
        FROM public.learn_concepts c
       WHERE display_order >= v_current_pos
         AND NOT EXISTS (
           SELECT 1 FROM public.seer_rings_daily r
            WHERE r.user_id = v_uid AND c.slug = ANY (r.read_concepts)
         )
       ORDER BY display_order
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
    'current_position', v_current_pos,
    'total_concepts', (SELECT COUNT(*) FROM public.learn_concepts),
    'next_concepts', COALESCE(v_next_concepts, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seer_today_summary() TO authenticated;

-- ── 6. seer_rank_ladder() RPC ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_rank_ladder()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid;
  v_rows   jsonb;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  v_uid := auth.uid();

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
                                 WHERE rd.user_id = v_uid AND c.slug = ANY (rd.read_concepts)))
      ) AS rank_row
      FROM public.seer_ranks r
    ) sub;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seer_rank_ladder() TO authenticated;

-- ── 7. seer_rank_concepts(p_rank_slug) RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.seer_rank_concepts(p_rank_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid;
  v_rank_id integer;
  v_rows    jsonb;
BEGIN
  IF NOT public.atlas_hq_is_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = '42501';
  END IF;

  IF p_rank_slug IS NULL OR length(p_rank_slug) = 0 OR length(p_rank_slug) > 100 THEN
    RAISE EXCEPTION 'invalid_rank_slug' USING ERRCODE = '22023';
  END IF;

  v_uid := auth.uid();

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
         WHERE rd.user_id = v_uid AND c.slug = ANY (rd.read_concepts)
      )
    ) ORDER BY c.display_order)
    INTO v_rows
    FROM public.learn_concepts c
   WHERE c.rank_id = v_rank_id;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seer_rank_concepts(text) TO authenticated;
