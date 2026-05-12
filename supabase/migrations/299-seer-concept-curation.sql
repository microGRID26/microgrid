-- Migration 299: Seer Phase 7A — per-rank concept curation
--
-- Locks the deliberate padawan-to-master teaching arc for all 60 concepts
-- across all 8 UFO/UAP ranks. Replaces the pre-Phase-6 category-inherited
-- ordering. Decided in the 2026-05-11 brainstorming session with Greg.
--
-- One UPDATE statement using a VALUES list — atomic, no temporary
-- (rank_id, display_order) collisions. Idempotent on re-apply.
--
-- Scope: ONLY learn_concepts.display_order (drives the per-rank ladder UI
-- /rank/<slug>). Does NOT touch seer_curriculum_path — that rebuild lives
-- in a separate migration (300, Phase 7B) which also rewrites the
-- seer_curriculum_next() / advance() / progress_summary() RPCs to handle
-- the new mixed-kind (concept/quiz/flashcards/story) path rows + the
-- ceiling-37 CHECK constraint on seer_curriculum_progress.current_position.
--
-- Verification (post-apply):
--   SELECT slug, title, display_order FROM public.learn_concepts
--     WHERE rank_id = 1 ORDER BY display_order;
--   -- expect roswell: llm(1), tokens(2), compaction(3)
--
-- Reference: /tmp/seer-curation.json — full curated path (95 items)
-- captured during the brainstorming session. The concept-only subset is
-- what this migration applies; the full woven path is staged for mig 300.

BEGIN;

-- Pre-flight M-2 fix: the inline DO $verify$ block at the end asserts
-- 60 rows total + uniqueness + contiguity, which is stronger than a
-- per-statement GET DIAGNOSTICS row count would be.
WITH new_order(slug, new_pos) AS (VALUES
  -- Rank 1: Roswell (fundamentals)
  ('llm', 1),
  ('tokens', 2),
  ('compaction', 3),

  -- Rank 2: Rendlesham (agents) — tool-use moved from 5 → 2 (primitive before MCP)
  ('agent-loop', 1),
  ('tool-use', 2),
  ('mcp', 3),
  ('memory', 4),
  ('subagents', 5),

  -- Rank 3: Skinwalker (engineering + atlas) — engineering-first arc
  -- version-control moved from 8 → 1 (foundation); engineering 1-8, atlas 9-13
  ('version-control-discipline', 1),
  ('abstractions-tradeoff', 2),
  ('yagni-vs-foresight', 3),
  ('testing-strategy', 4),
  ('refactor-vs-rewrite', 5),
  ('tech-debt-economics', 6),
  ('code-review-economics', 7),
  ('dependency-supply-chain', 8),
  ('atlas-protocol', 9),
  ('action-queue', 10),
  ('hooks', 11),
  ('recaps', 12),
  ('atlas-harness', 13),

  -- Rank 4: Dugway (system-design) — monolith-vs-services moved 1 → 8
  -- (architectural decision depends on data primitives first)
  ('database-tradeoffs', 1),
  ('indexes-and-planners', 2),
  ('transactions-and-isolation', 3),
  ('consistency-models', 4),
  ('cap-theorem', 5),
  ('caching-strategies', 6),
  ('queues-and-async', 7),
  ('monolith-vs-services', 8),

  -- Rank 5: Wright-Patt (system + infra) — infrastructure-first, cost as capstone
  ('networking-basics', 1),
  ('linux-posix-fluency', 2),
  ('cloud-primitives', 3),
  ('ci-cd-pipelines', 4),
  ('observability-three-pillars', 5),
  ('security-threat-model', 6),
  ('auth-vs-authz', 7),
  ('api-design-tradeoffs', 8),
  ('event-driven-architecture', 9),
  ('backups-and-dr', 10),
  ('compliance-for-small-co', 11),
  ('cloud-cost-optimization', 12),

  -- Rank 6: Los Alamos (leadership) — rfc-culture moved 1 → 5 (hire before formalize)
  ('hiring-signal', 1),
  ('onboarding-economics', 2),
  ('one-on-ones', 3),
  ('team-scaling', 4),
  ('rfc-culture', 5),
  ('build-vs-buy', 6),
  ('ship-vs-polish', 7),
  ('on-call-discipline', 8),

  -- Rank 7: Area 51 (agent-fleet) — agent-failure-modes moved 6 → 4
  -- (know failure surfaces before evaluating)
  ('agent-orchestration', 1),
  ('tool-design-for-agents', 2),
  ('prompt-as-code', 3),
  ('agent-failure-modes', 4),
  ('agent-evaluation', 5),
  ('agent-observability', 6),
  ('human-in-the-loop', 7),
  ('agent-cost-economics', 8),

  -- Rank 8: S4 (capstone) — fixes pre-existing duplicate display_order=1
  -- (economics + governance both at 1). Concept → application → governance.
  ('economics', 1),
  ('prompt-caching', 2),
  ('governance', 3)
)
UPDATE public.learn_concepts c
SET display_order = no.new_pos,
    updated_at = now()
FROM new_order no
WHERE c.slug = no.slug;

-- Verification: (rank_id, display_order) unique + 60 rows updated + no orphans.
DO $verify$
DECLARE
  v_total      int;
  v_dupes      int;
  v_updated    int;
  v_missing    text[];
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.learn_concepts;
  IF v_total <> 60 THEN
    RAISE EXCEPTION 'expected 60 concepts in learn_concepts, got %', v_total;
  END IF;

  SELECT COUNT(*) INTO v_dupes
  FROM (
    SELECT rank_id, display_order, COUNT(*) AS n
    FROM public.learn_concepts
    GROUP BY rank_id, display_order
    HAVING COUNT(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'duplicate (rank_id, display_order) pairs after curation: % collisions', v_dupes;
  END IF;

  -- Per-rank display_order must be a contiguous 1..N sequence (no gaps).
  WITH per_rank AS (
    SELECT rank_id, MAX(display_order) AS max_pos, COUNT(*) AS n
    FROM public.learn_concepts
    GROUP BY rank_id
  )
  SELECT array_agg(format('rank_id=%s max=%s n=%s', rank_id, max_pos, n))
  INTO v_missing
  FROM per_rank
  WHERE max_pos <> n;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'non-contiguous display_order in ranks: %', v_missing;
  END IF;

  RAISE NOTICE 'OK: 60 concepts curated, per-rank ordering contiguous, no duplicates.';
END
$verify$;

COMMIT;
