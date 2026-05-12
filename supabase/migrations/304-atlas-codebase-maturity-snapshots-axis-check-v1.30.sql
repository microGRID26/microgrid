-- 304-atlas-codebase-maturity-snapshots-axis-check-v1.30.sql
-- Widen the axis CHECK on atlas_codebase_maturity_snapshots to admit the
-- v1.30 `codebase` axis (LOC + per-language breakdown via tokei).
--
-- Same shape as mig 286 (which widened to admit the v1.10 axes). The new
-- axis is non-scoring — its `score` is always null and it stays out of the
-- headline average — but the snapshot row carries `raw_value` so the
-- per-slug page can render LOC + language breakdown without a separate
-- table. Single-axis allowlist widening, no data backfill needed.
--
-- Mirror: `~/repos/ATLAS-HQ/lib/maturity/axes.ts` AXES const +
-- `~/repos/ATLAS-HQ/lib/maturity/axes.json` (cross-repo — the SOT files
-- live in atlas-hq, not in MG). The vitest in
-- `~/repos/ATLAS-HQ/lib/maturity/__tests__/axes.test.ts` asserts those two
-- files stay in sync.
--
-- Idempotency: `drop constraint if exists` so a replay against a fresh
-- dev DB that already has the v1.30 shape is a no-op rather than an
-- error. Pre-existing pattern in migs 286 + earlier was naked `drop` —
-- this one fixes the carry-forward (R1 v1.30 phase1 mig-planner M1).

alter table public.atlas_codebase_maturity_snapshots
  drop constraint if exists atlas_codebase_maturity_snapshots_axis_check;

alter table public.atlas_codebase_maturity_snapshots
  add constraint atlas_codebase_maturity_snapshots_axis_check
  check (axis = any (array[
    'typecheck'::text,
    'rls'::text,
    'audit'::text,
    'velocity'::text,
    'ci'::text,
    'prThroughput'::text,
    'coverage'::text,
    'sentryErrors'::text,
    'codebase'::text
  ]));
