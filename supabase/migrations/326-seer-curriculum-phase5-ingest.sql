-- 326: Seer curriculum Phase 5 — ingest agent.
--
-- See plan: ~/.claude/plans/mellow-napping-wind.md
-- Pre-flight reviews (Step 2.5 of chain skill): R0a, R0b, R0c — final GO.
--
-- Adds:
--   1. Provenance columns on seer_curriculum_path (classified_by, agent_confidence, classified_at).
--   2. UNIQUE (slug, kind) constraint — fixes C-1 (slug alone is not unique today).
--   3. Deferrable PK — fixes C-2 (RPC needs deferred PK to do global position shift).
--   4. seer_curriculum_path_insert RPC — shift + provenance + p_anchor_slug for quiz inheritance.
--   5. atlas_list_low_confidence_curriculum_inserts digest RPC (service_role only).
--   6. atlas_agents row 'seer_curriculum_ingest_agent' with kill-switch + budgets.

-- ============================================================
-- 1. Provenance columns on the path
-- ============================================================
ALTER TABLE seer_curriculum_path
  ADD COLUMN IF NOT EXISTS classified_by text
    DEFAULT 'human'
    CHECK (classified_by IN ('human', 'agent')),
  ADD COLUMN IF NOT EXISTS agent_confidence numeric(4, 3)
    CHECK (agent_confidence IS NULL OR (agent_confidence >= 0 AND agent_confidence <= 1)),
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

-- ============================================================
-- 2. UNIQUE (slug, kind)
--    Live verified clean before this migration:
--      SELECT slug, kind, count(*) FROM seer_curriculum_path
--       GROUP BY 1,2 HAVING count(*)>1; -- expect 0 rows
-- ============================================================
ALTER TABLE seer_curriculum_path
  DROP CONSTRAINT IF EXISTS seer_curriculum_path_slug_kind_unique;
ALTER TABLE seer_curriculum_path
  ADD CONSTRAINT seer_curriculum_path_slug_kind_unique UNIQUE (slug, kind);

-- ============================================================
-- 3. Deferrable PK — required for in-statement global position shift
-- ============================================================
ALTER TABLE seer_curriculum_path
  DROP CONSTRAINT IF EXISTS seer_curriculum_path_pkey;
ALTER TABLE seer_curriculum_path
  ADD CONSTRAINT seer_curriculum_path_pkey
  PRIMARY KEY (position) DEFERRABLE INITIALLY IMMEDIATE;

-- ============================================================
-- 4. seer_curriculum_path_insert RPC
--    Callers MUST NOT batch multiple RPC calls in one outer transaction —
--    the deferred PK applies tx-wide. One supabase.rpc() call = one auto-tx.
-- ============================================================
CREATE OR REPLACE FUNCTION public.seer_curriculum_path_insert(
  p_slug text,
  p_kind text,
  p_category text,
  p_rank_id integer,
  p_position integer,
  p_gating boolean,
  p_classified_by text DEFAULT 'agent',
  p_agent_confidence numeric DEFAULT NULL,
  p_anchor_slug text DEFAULT NULL
) RETURNS seer_curriculum_path
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row seer_curriculum_path;
  v_rank_max_pos integer;
  v_rank_min_pos integer;
  v_effective_pos integer;
  v_anchor_pos integer;
BEGIN
  -- ---- validation ----
  IF p_slug IS NULL OR p_kind IS NULL OR p_rank_id IS NULL OR p_position IS NULL THEN
    RAISE EXCEPTION 'missing_required_field' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('concept', 'story', 'quiz', 'flashcards') THEN
    RAISE EXCEPTION 'invalid_kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_rank_id < 1 OR p_rank_id > 8 THEN
    RAISE EXCEPTION 'invalid_rank: %', p_rank_id USING ERRCODE = '22023';
  END IF;
  IF p_classified_by NOT IN ('human', 'agent') THEN
    RAISE EXCEPTION 'invalid_classified_by' USING ERRCODE = '22023';
  END IF;

  -- ---- dedupe on (slug, kind) (belt; UNIQUE constraint is suspenders) ----
  IF EXISTS (
    SELECT 1 FROM seer_curriculum_path WHERE slug = p_slug AND kind = p_kind
  ) THEN
    RAISE EXCEPTION 'slug_kind_already_in_path: %/%', p_slug, p_kind USING ERRCODE = '23505';
  END IF;

  -- ---- defer PK so the row-lock + shift can collide transiently. Single
  --      auto-tx scope; caller contract is one supabase.rpc() per logical insert.
  SET CONSTRAINTS seer_curriculum_path_pkey DEFERRED;

  IF p_anchor_slug IS NOT NULL THEN
    -- Quiz/inherit branch: re-read anchor's CURRENT position INSIDE the
    -- row-lock window so same-batch shifts can't stale-read the position
    -- a prior orphan moved. Prefer the concept row when both concept+quiz
    -- of same slug exist.
    SELECT position INTO v_anchor_pos
      FROM seer_curriculum_path
     WHERE slug = p_anchor_slug
     ORDER BY (kind = 'concept') DESC, position ASC
     LIMIT 1
     FOR UPDATE;
    IF v_anchor_pos IS NULL THEN
      RAISE EXCEPTION 'anchor_not_found: %', p_anchor_slug USING ERRCODE = '22023';
    END IF;
    v_effective_pos := v_anchor_pos + 1;
  ELSE
    -- Concept/story branch: clamp suggested position into target rank's
    -- contiguous global span. Position is globally ordered across all 8 ranks.
    SELECT MIN(position), MAX(position)
      INTO v_rank_min_pos, v_rank_max_pos
      FROM seer_curriculum_path
     WHERE rank_id = p_rank_id;

    IF v_rank_min_pos IS NULL THEN
      -- rank is empty; append to end of global path
      SELECT COALESCE(MAX(position), 0) + 1 INTO v_effective_pos FROM seer_curriculum_path;
    ELSE
      v_effective_pos := GREATEST(v_rank_min_pos,
                                  LEAST(p_position, v_rank_max_pos + 1));
    END IF;
  END IF;

  -- ---- global shift: every row at or after effective position bumps +1 ----
  UPDATE seer_curriculum_path
     SET position = position + 1
   WHERE position >= v_effective_pos;

  INSERT INTO seer_curriculum_path
    (slug, kind, category, rank_id, position, gating, added_at,
     classified_by, agent_confidence, classified_at)
  VALUES
    (p_slug, p_kind, p_category, p_rank_id, v_effective_pos, p_gating, now(),
     p_classified_by,
     CASE WHEN p_classified_by = 'agent' THEN p_agent_confidence ELSE NULL END,
     CASE WHEN p_classified_by = 'agent' THEN now() ELSE NULL END)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.seer_curriculum_path_insert(text, text, text, integer, integer, boolean, text, numeric, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seer_curriculum_path_insert(text, text, text, integer, integer, boolean, text, numeric, text) TO service_role;

-- ============================================================
-- 5. Low-confidence digest RPC (service_role only — H-4 fix)
-- ============================================================
CREATE OR REPLACE FUNCTION public.atlas_list_low_confidence_curriculum_inserts(
  p_threshold numeric DEFAULT 0.70,
  p_since_days integer DEFAULT 7
) RETURNS TABLE (
  slug text, kind text, category text, rank_id integer, position integer,
  agent_confidence numeric, classified_at timestamptz
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT slug, kind, category, rank_id, position, agent_confidence, classified_at
    FROM seer_curriculum_path
   WHERE classified_by = 'agent'
     AND agent_confidence IS NOT NULL
     AND agent_confidence < p_threshold
     AND classified_at > now() - (p_since_days || ' days')::interval
   ORDER BY agent_confidence ASC, classified_at DESC;
$$;

REVOKE ALL ON FUNCTION public.atlas_list_low_confidence_curriculum_inserts(numeric, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_list_low_confidence_curriculum_inserts(numeric, integer) TO service_role;

-- ============================================================
-- 6. atlas_agents row
-- ============================================================
INSERT INTO atlas_agents (
  slug, name, type, owner_project, description, schedule, enabled,
  primary_model, daily_budget_usd, monthly_budget_usd, auto_disable_on_breach
) VALUES (
  'seer_curriculum_ingest_agent',
  'Seer Curriculum Ingest Agent',
  'cron',
  'Seer',
  'Nightly classifier: routes newly-ingested learn_* slugs into seer_curriculum_path with rank+position+category. See ~/.claude/plans/mellow-napping-wind.md.',
  '0 4 * * *',
  true,
  'claude-haiku-4-5-20251001',
  0.50,
  10.00,
  true
)
ON CONFLICT (slug) DO NOTHING;
