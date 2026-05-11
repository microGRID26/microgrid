-- 286-atlas-codebase-maturity-snapshots-axis-check-v1.10.sql
-- Hot-fix: widen the axis CHECK to admit v1.10 axes
-- (prThroughput, coverage, sentryErrors).
--
-- Root cause: v1.10 (atlas-hq commit 72a9733) widened the route-side
-- `VALID_AXES` allowlist on `/api/maturity/ingest`, but the DB-level CHECK
-- constraint on `atlas_codebase_maturity_snapshots.axis` (added in mig 262)
-- was left at the original 5-axis set. The collector keeps emitting 8 axes;
-- the first new-axis row hits the constraint, the transaction aborts with
-- 23514, and exit_4 propagates up to the refresh watcher. Net: snapshots
-- table never gains the new axes; constellation renders every star as
-- low-confidence because measuredAxisCount < MIN_MEASURED_AXES_FOR_CONFIDENCE.
--
-- Non-destructive: relaxes the allowlist. No data backfill needed.

alter table public.atlas_codebase_maturity_snapshots
  drop constraint atlas_codebase_maturity_snapshots_axis_check;

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
    'sentryErrors'::text
  ]));
