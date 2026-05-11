-- Migration 279: fill seer_curriculum_path positions 21-28 with Leadership slugs
--
-- Phase 4 Sprint 1D — Leadership category authored in
-- ~/repos/ATLAS-HQ/lib/explainer/concepts/<slug>/content.ts and synced into
-- public.learn_concepts via npm run sync-content. This migration wires the
-- 8 new slugs into the curated curriculum at the positions reserved by
-- migration 277.
--
-- Idempotent: UPDATE with explicit position match. Re-applying produces
-- identical state. Safe to re-run if a position got out of sync.

UPDATE seer_curriculum_path SET slug = 'rfc-culture'         WHERE position = 21 AND (slug IS NULL OR slug = 'rfc-culture');
UPDATE seer_curriculum_path SET slug = 'hiring-signal'        WHERE position = 22 AND (slug IS NULL OR slug = 'hiring-signal');
UPDATE seer_curriculum_path SET slug = 'onboarding-economics' WHERE position = 23 AND (slug IS NULL OR slug = 'onboarding-economics');
UPDATE seer_curriculum_path SET slug = 'one-on-ones'          WHERE position = 24 AND (slug IS NULL OR slug = 'one-on-ones');
UPDATE seer_curriculum_path SET slug = 'team-scaling'         WHERE position = 25 AND (slug IS NULL OR slug = 'team-scaling');
UPDATE seer_curriculum_path SET slug = 'build-vs-buy'         WHERE position = 26 AND (slug IS NULL OR slug = 'build-vs-buy');
UPDATE seer_curriculum_path SET slug = 'ship-vs-polish'       WHERE position = 27 AND (slug IS NULL OR slug = 'ship-vs-polish');
UPDATE seer_curriculum_path SET slug = 'on-call-discipline'   WHERE position = 28 AND (slug IS NULL OR slug = 'on-call-discipline');

-- Sanity check (returns 8 rows on a fresh apply):
-- SELECT position, slug, category
-- FROM seer_curriculum_path
-- WHERE category = 'leadership'
-- ORDER BY position;
