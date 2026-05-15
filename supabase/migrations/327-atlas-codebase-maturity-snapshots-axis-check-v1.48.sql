-- 327-atlas-codebase-maturity-snapshots-axis-check-v1.48.sql
-- Widen the axis CHECK on atlas_codebase_maturity_snapshots to admit the
-- v1.48 axes: bundleSize, accessibility, dependencyVulns. Same shape as
-- migs 286 + 304. Idempotent via `drop constraint if exists` so a replay
-- against a fresh dev DB that already has the v1.48 shape is a no-op
-- rather than an error.
--
-- New axes are SCORING (not in NON_SCORING_AXES set in axes.ts) — they
-- emit `score` 0-100 alongside `raw_value` and contribute to the headline
-- average. Per-slug N/A reasons (`mobile_only_no_web_bundle`,
-- `not_npm_project`, `tier_dormant`, `service_kind`) skip the axis at
-- collector time for surfaces that can't measure them — the row is
-- emitted as `score=null` with a typed reason in raw_value.
--
-- Mirror requirement: `~/repos/ATLAS-HQ/lib/maturity/axes.ts` AXES const
-- + `~/repos/ATLAS-HQ/lib/maturity/axes.json` mirror. Vitest in
-- `~/repos/ATLAS-HQ/lib/maturity/__tests__/axes.test.ts` parity-asserts
-- both files AND the EXPECTED_DB_CHECK_ARRAY constant against this
-- migration's array — all four MUST stay in lockstep.

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
    'codebase'::text,
    'bundleSize'::text,
    'accessibility'::text,
    'dependencyVulns'::text
  ]));
