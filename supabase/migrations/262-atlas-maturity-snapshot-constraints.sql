-- Phase 0 R1 audit MEDIUM #4 fix: bound score + weighted_score to sane ranges.
--
-- Without these, a buggy collector or a future weight=N scaling can write
-- weighted_score = 200, the read RPC averages it without clamping, and the
-- headline can exceed 100 or go negative. Add CHECK constraints so prod
-- mirrors the normalizer contract (score 0..100; weighted_score 0..500 to
-- accommodate up to weight=5 in a future v1.1 weighting scheme).
--
-- Lock profile: ADD CONSTRAINT NOT VALID skips the table scan; subsequent
-- VALIDATE CONSTRAINT does a single-pass check. Snapshots table currently has
-- 0 rows so VALIDATE is instantaneous either way.

alter table public.atlas_codebase_maturity_snapshots
  add constraint chk_maturity_snap_score_range
    check (score is null or score between 0 and 100) not valid;

alter table public.atlas_codebase_maturity_snapshots
  validate constraint chk_maturity_snap_score_range;

alter table public.atlas_codebase_maturity_snapshots
  add constraint chk_maturity_snap_weighted_range
    check (weighted_score is null or weighted_score between 0 and 500) not valid;

alter table public.atlas_codebase_maturity_snapshots
  validate constraint chk_maturity_snap_weighted_range;
