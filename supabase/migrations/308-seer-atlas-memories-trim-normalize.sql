-- Migration 308: Fix C2 bypass — content_hash normalization missing trim()
--
-- Mig 303 introduced content_hash as
--   md5(lower(regexp_replace(coalesce(content,''), '\s+', ' ', 'g')))
-- which collapses multiple internal whitespaces but does NOT strip leading /
-- trailing whitespace. Smoke test 2026-05-13 confirmed: 'foo' and ' foo '
-- hash differently — defeating the spec's whitespace-bypass guard (C2).
--
-- A model retry that adds trailing newlines or leading spaces would bypass the
-- unique-index dedup and write duplicate-looking memories. Cap=30/day still
-- bounds the damage, but it pollutes the memory store with near-duplicates.
--
-- Fix: wrap the regex collapse in trim() so leading/trailing whitespace is
-- stripped before hashing. Because content_hash is GENERATED ALWAYS AS STORED,
-- Postgres requires DROP + ADD (not ALTER) to change the expression. The
-- unique index on (user_id, content_hash) is dropped by CASCADE and recreated.
--
-- Table seer_atlas_memories has 2 smoke-test rows at the time of this fix;
-- they're cleaned up below before the column rebuild so no row conflicts.

BEGIN;

-- 1. Clean up smoke-test rows (preserves real memories if any exist; matches
--    on the smoke-specific tag for safety).
DELETE FROM public.seer_atlas_memories
 WHERE 'smoke' = ANY(tags) OR 'test' = ANY(tags);

-- 2. Drop the unique index (CASCADE not needed; it references content_hash
--    directly so it'll fail if we drop column without dropping it first).
DROP INDEX IF EXISTS public.seer_atlas_memories_user_content_hash_uniq;

-- 3. Drop the generated column.
ALTER TABLE public.seer_atlas_memories DROP COLUMN content_hash;

-- 4. Re-add with the trim() wrapper.
ALTER TABLE public.seer_atlas_memories
  ADD COLUMN content_hash text GENERATED ALWAYS AS (
    md5(lower(trim(regexp_replace(coalesce(content,''), '\s+', ' ', 'g'))))
  ) STORED;

-- 5. Recreate the unique index.
CREATE UNIQUE INDEX seer_atlas_memories_user_content_hash_uniq
  ON public.seer_atlas_memories (user_id, content_hash);

-- 6. Verify the fix collapses whitespace + casing correctly.
DO $verify$
DECLARE
  h1 text;
  h2 text;
  h3 text;
BEGIN
  h1 := md5(lower(trim(regexp_replace('foo bar baz', '\s+', ' ', 'g'))));
  h2 := md5(lower(trim(regexp_replace('  FOO   bar  BAZ   ', '\s+', ' ', 'g'))));
  h3 := md5(lower(trim(regexp_replace(E'foo bar baz\n\n', '\s+', ' ', 'g'))));

  IF h1 <> h2 THEN
    RAISE EXCEPTION 'mig 308: normalization should collapse whitespace+case (h1=% h2=%)', h1, h2;
  END IF;
  IF h1 <> h3 THEN
    RAISE EXCEPTION 'mig 308: normalization should strip trailing newlines (h1=% h3=%)', h1, h3;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='seer_atlas_memories' AND column_name='content_hash'
  ) THEN
    RAISE EXCEPTION 'mig 308: content_hash column missing after rebuild';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='seer_atlas_memories_user_content_hash_uniq'
  ) THEN
    RAISE EXCEPTION 'mig 308: unique index missing after rebuild';
  END IF;
END $verify$;

COMMIT;
