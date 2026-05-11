-- ============================================================================
-- Seer ranks — swap cyberpunk slugs for famous UFO/UAP locations
-- ============================================================================
-- learn_concepts.rank_id FK is on numeric id (1..8); slug change is safe.
-- All four SECDEF RPCs read slug for display only; the routing in expo-router
-- uses kebab-case slugs ('/rank/<slug>') and the client RankSlug union is
-- updated in tandem (commit on Seer repo).
-- ============================================================================

BEGIN;

UPDATE public.seer_ranks SET slug='roswell',     display_name='roswell'     WHERE id = 1;
UPDATE public.seer_ranks SET slug='rendlesham',  display_name='rendlesham'  WHERE id = 2;
UPDATE public.seer_ranks SET slug='skinwalker',  display_name='skinwalker'  WHERE id = 3;
UPDATE public.seer_ranks SET slug='dugway',      display_name='dugway'      WHERE id = 4;
UPDATE public.seer_ranks SET slug='wright-patt', display_name='wright-patt' WHERE id = 5;
UPDATE public.seer_ranks SET slug='los-alamos',  display_name='los alamos'  WHERE id = 6;
UPDATE public.seer_ranks SET slug='area-51',     display_name='area 51'     WHERE id = 7;
UPDATE public.seer_ranks SET slug='s4',          display_name='s4'          WHERE id = 8;

-- Sanity: all 8 ranks must still have unique slugs + non-null names.
DO $$
DECLARE v_dup_count integer; v_null_count integer;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM public.seer_ranks WHERE slug IS NULL OR display_name IS NULL;
  IF v_null_count > 0 THEN RAISE EXCEPTION 'rank metadata has NULLs after rename'; END IF;
  SELECT COUNT(*) INTO v_dup_count FROM (SELECT slug, COUNT(*) FROM public.seer_ranks GROUP BY slug HAVING COUNT(*) > 1) d;
  IF v_dup_count > 0 THEN RAISE EXCEPTION 'rank slug uniqueness broken after rename'; END IF;
END $$;

COMMIT;
