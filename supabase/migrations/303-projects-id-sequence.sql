-- Audit follow-up #906 (R1 red-teamer on commit 74c12f7, Phase 3 of #902).
--
-- ## What this fixes
--
-- ### Issue 1 — race-loser path on simultaneous webhooks (action body Issue 1)
--
-- Two webhook deliveries with the SAME (name, address) but DIFFERENT
-- subhub_ids both pass the subhub_id dedup (each is fresh) AND both pass the
-- (name, address) dedup (no row exists yet). Both then call getNextProjectId,
-- both compute the same `max(id_suffix) + 1` from a table SELECT, and both
-- attempt INSERT with the same `id`. The PK conflict raises 23505 — but the
-- existing 23505 recovery path re-queries by subhub_id and finds nothing
-- (different subhub_ids), so the loser returns 500. SubHub then retries and
-- succeeds with a fresh max+1, leaving the two legitimate-but-distinct
-- contracts (e.g. ADU + main install signed minutes apart) as two MG rows —
-- which is the right outcome, but with a 500-then-retry detour.
--
-- ### Issue 2 — full-table scan with implicit PostgREST cap (action body Issue 2)
--
-- getNextProjectId does `from('projects').select('id')` with no .limit().
-- PostgREST applies a max-rows cap (default 1000); on a 3,296-row table the
-- SELECT returns only the first 1000 ids. Today the max-id row happens to
-- fall in that window so the function still works, but the next time the
-- table grows or row ordering shifts, the function silently returns a
-- max-suffix from a truncated sample and generates a duplicate PROJ-ID.
-- Once that ships even once, two rows share an `id` value via a race
-- collision the existing 23505 path can't recover from cleanly.
--
-- ## Fix
--
-- Move ID generation to a Postgres sequence + a SECURITY DEFINER RPC the
-- ingest app calls. Atomic by construction — no scan, no race. Sequence is
-- seeded to the current max suffix so it doesn't collide with any legacy
-- PROJ-XXXXX value.
--
-- The app-side call site (lib/subhub/ingest.ts) swaps its getNextProjectId
-- helper to call this RPC in the same commit. scripts/subhub-backfill.ts
-- only links to existing rows and never allocates new ids.

BEGIN;

-- Seed value derived from current state at write-time: max suffix among
-- PROJ-XXXXX rows = 32117 (2026-05-12). Sequence MUST start above that so
-- the next nextval() doesn't collide with a real existing row. setval at the
-- end uses GREATEST() to be safe even if a row landed between this read and
-- the migration apply.

CREATE SEQUENCE IF NOT EXISTS public.projects_next_id_seq
  AS bigint
  START 32118
  NO MAXVALUE
  CACHE 1;
-- (No MINVALUE — defaults to 1. The DO block below calls setval(seq, v_max)
-- where v_max is the current max PROJ suffix, so next nextval returns v_max+1.
-- Setting MINVALUE 32118 would reject setval(32117) and break the seed.)

COMMENT ON SEQUENCE public.projects_next_id_seq IS
  'PROJ-XXXXX suffix generator. Replaces app-side max+1 (#906). Service-role write via gen_next_project_id() only.';

-- #906 R1 red-teamer Critical (2026-05-12): public sequences in this DB
-- inherit a default ACL that grants anon + authenticated USAGE/UPDATE
-- (verified live — every existing public sequence shows anon=rwU). Without
-- this lockdown, anon could call `nextval('public.projects_next_id_seq')`
-- through any SECURITY INVOKER surface, burning PROJ-IDs and creating audit
-- gaps. Lock the sequence down to service_role in the same transaction so
-- post-commit state is never anon-writable.
REVOKE ALL ON SEQUENCE public.projects_next_id_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.projects_next_id_seq FROM anon;
REVOKE ALL ON SEQUENCE public.projects_next_id_seq FROM authenticated;
GRANT USAGE ON SEQUENCE public.projects_next_id_seq TO service_role;

-- Re-seed defensively: if a row was inserted between the snapshot read and
-- this migration applying, GREATEST() guarantees the sequence is still above
-- the current max. setval(seq, n, true) means the NEXT nextval() returns n+1.
DO $$
DECLARE
  v_max int;
BEGIN
  SELECT COALESCE(
    MAX(NULLIF(SUBSTRING(id FROM '^PROJ-(\d+)$'), '')::int),
    32117
  )
  INTO v_max
  FROM public.projects
  WHERE id ~ '^PROJ-\d+$';
  -- One ahead of v_max — first call to gen_next_project_id() returns PROJ-(v_max+1).
  PERFORM setval('public.projects_next_id_seq', v_max);
END
$$;

-- ---------------------------------------------------------------------------
-- gen_next_project_id() — atomic SECURITY DEFINER allocator.
--
-- Returns 'PROJ-<next_int>' where next_int comes from nextval on the
-- sequence above. Service-role only — partner-api / webhook / backfill
-- contexts. NEVER call from a user-facing path (an unauth'd caller burning
-- the sequence wastes IDs and pollutes the audit).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gen_next_project_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next bigint;
BEGIN
  v_next := nextval('public.projects_next_id_seq');
  RETURN 'PROJ-' || v_next::text;
END;
$$;

COMMENT ON FUNCTION public.gen_next_project_id() IS
  'Allocates the next PROJ-XXXXX id from projects_next_id_seq atomically. Replaces the in-app full-table-scan max+1 (#906). Service-role only.';

REVOKE ALL ON FUNCTION public.gen_next_project_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gen_next_project_id() FROM anon;
REVOKE ALL ON FUNCTION public.gen_next_project_id() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.gen_next_project_id() TO service_role;

COMMIT;
