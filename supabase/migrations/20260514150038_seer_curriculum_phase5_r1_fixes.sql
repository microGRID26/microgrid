-- 327: Seer curriculum Phase 5 R1 fixes (post-audit).
--
-- R1 findings: red-teamer + general-purpose audited 326. Folding fixes here:
--   - GP-M1: empty-rank slotting → slot after max(position) of any rank < p_rank_id
--     instead of global tail. Preserves rank monotonicity when a rank is emptied.
--   - RT-M2: bump cron timeout 60000 → 180000 (worst-case 20-orphan batch
--     × p99 Anthropic latency can exceed 60s).
--
-- Other R1 findings folded edge-function-side (see git history on
-- supabase/functions/seer-curriculum-ingest/index.ts):
--   - RT-H1: atlas_mark_agent_breach call uses p_level '100pct' (whitelist
--     accepts '80pct'/'100pct'/NULL only); + throw-aware error handling.
--   - RT-M3: diff-scan ORDER BY slug for deterministic LIMIT 500.
--   - RT-L1: agent_lookup_failed logs server-side, returns generic body.
--   - RT-L2: quiz 23505 → skipped_dedupe (was mislabeled skipped_no_concept).
--   - GP-H1: classifier prompt rank→category map matches live taxonomy
--     (system-design in R4+R5, story in R3+R8).
--   - GP-M4: inPath Set delimiter \x1F (Unit Separator) instead of '::'.

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

  IF EXISTS (
    SELECT 1 FROM seer_curriculum_path WHERE slug = p_slug AND kind = p_kind
  ) THEN
    RAISE EXCEPTION 'slug_kind_already_in_path: %/%', p_slug, p_kind USING ERRCODE = '23505';
  END IF;

  SET CONSTRAINTS seer_curriculum_path_pkey DEFERRED;

  IF p_anchor_slug IS NOT NULL THEN
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
    SELECT MIN(position), MAX(position)
      INTO v_rank_min_pos, v_rank_max_pos
      FROM seer_curriculum_path
     WHERE rank_id = p_rank_id;

    IF v_rank_min_pos IS NULL THEN
      -- R1 GP-M1 fix: empty rank → slot just AFTER the highest position of any
      -- rank < p_rank_id, preserving global rank monotonicity (vs. appending
      -- to global tail which would put a rank-6 row after rank-8).
      SELECT COALESCE(MAX(position), 0) + 1
        INTO v_effective_pos
        FROM seer_curriculum_path
       WHERE rank_id < p_rank_id;
    ELSE
      v_effective_pos := GREATEST(v_rank_min_pos,
                                  LEAST(p_position, v_rank_max_pos + 1));
    END IF;
  END IF;

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

-- Cron timeout bump (already applied live; reapply idempotently). Unschedule +
-- reschedule pattern is necessary because cron.schedule errors on collision.
SELECT cron.unschedule('seer-curriculum-ingest')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='seer-curriculum-ingest');

SELECT cron.schedule(
  'seer-curriculum-ingest',
  '0 4 * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://hzymsezqfxzpbcqryeim.supabase.co/functions/v1/seer-curriculum-ingest',
      headers := jsonb_build_object(
        'apikey', 'sb_publishable_mY0uHkw46TOFM2FmX3Dczw_9xbS1sJD',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
           WHERE name = 'seer_curriculum_ingest_token'
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 180000
    );
  $cmd$
);
