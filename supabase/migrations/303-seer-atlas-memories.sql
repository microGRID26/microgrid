-- Migration 303: Seer Atlas Phase 3A — persistent memory store
--
-- Persistent cross-session memory for Atlas-in-Seer. Atlas saves facts /
-- people / preferences / in-flight context via the save_memory tool; recalls
-- relevant memories via the recall_memories tool (FTS over content).
--
-- Dedup strategy: UNIQUE(user_id, content_hash) where content_hash is a
-- generated column md5(lower(collapse_ws(content))). Re-saving identical
-- normalized content returns the existing row's id (ON CONFLICT DO UPDATE
-- returns id; app-code uses RETURNING). Prevents the whitespace/casing
-- bypass class flagged by the Phase 3 spec pre-flight reviewer (C2 fix).
--
-- Time-windowed partial unique indexes were considered but rejected:
-- Postgres requires WHERE predicates on partial indexes to be IMMUTABLE,
-- and now() is STABLE — so `WHERE created_at > now() - interval '60s'`
-- doesn't compile. The reviewer's "60s window" intent is already met by
-- the permanent dedup: rapid duplicates from model rerolls or network
-- retries all collapse to the first row.
--
-- RLS: auth.uid() = user_id for SELECT + INSERT. Service-role bypasses
-- (matches Phase 1 pattern where the edge function dispatches with the
-- service-role client after the upfront owner gate at request entry).

BEGIN;

CREATE TABLE IF NOT EXISTS public.seer_atlas_memories (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content      text        NOT NULL CHECK (length(content) BETWEEN 1 AND 8000),
  tags         text[]      NOT NULL DEFAULT '{}',
  importance   smallint    NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  source       text        NOT NULL DEFAULT 'chat'
               CHECK (source IN ('chat','manual','recall_replay')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  content_hash text        GENERATED ALWAYS AS (
                 md5(lower(regexp_replace(coalesce(content,''), '\s+', ' ', 'g')))
               ) STORED,
  fts          tsvector    GENERATED ALWAYS AS (
                 to_tsvector('english', coalesce(content,''))
               ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS seer_atlas_memories_user_content_hash_uniq
  ON public.seer_atlas_memories (user_id, content_hash);

CREATE INDEX IF NOT EXISTS seer_atlas_memories_fts_idx
  ON public.seer_atlas_memories USING gin (fts);

CREATE INDEX IF NOT EXISTS seer_atlas_memories_user_created_idx
  ON public.seer_atlas_memories (user_id, created_at DESC);

ALTER TABLE public.seer_atlas_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seer_atlas_memories_owner_select ON public.seer_atlas_memories;
CREATE POLICY seer_atlas_memories_owner_select
  ON public.seer_atlas_memories
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS seer_atlas_memories_owner_insert ON public.seer_atlas_memories;
CREATE POLICY seer_atlas_memories_owner_insert
  ON public.seer_atlas_memories
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No UPDATE/DELETE policies in v1 — memories are append-only.
-- Phase 4 will add soft-delete + owner-edit if Greg wants memory curation UX.

REVOKE ALL ON public.seer_atlas_memories FROM PUBLIC;
GRANT SELECT, INSERT ON public.seer_atlas_memories TO authenticated;
-- service_role gets full access by default (no GRANT/REVOKE needed).

DO $verify$
BEGIN
  -- Verify table exists with the 9 expected columns
  -- (id, user_id, content, tags, importance, source, created_at, content_hash, fts)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='seer_atlas_memories'
  ) THEN
    RAISE EXCEPTION 'seer_atlas_memories table did not get created';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='seer_atlas_memories'
  ) <> 9 THEN
    RAISE EXCEPTION 'seer_atlas_memories: expected 9 columns, got %',
      (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='seer_atlas_memories');
  END IF;

  -- Verify RLS is enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname='public' AND tablename='seer_atlas_memories'
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'seer_atlas_memories: RLS not enabled';
  END IF;

  -- Verify the unique index on content_hash exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='seer_atlas_memories_user_content_hash_uniq'
  ) THEN
    RAISE EXCEPTION 'seer_atlas_memories: dedup unique index missing';
  END IF;
END $verify$;

COMMIT;
