-- 298: reclassify SubHub eval-pile rows that match NetSuite-truth on name+address
--
-- Action #902 (P0) — root-cause cleanup of the 1,759 SubHub Sale-evaluation pile
-- created by the 2026-05-06 whole-year backfill (commit 8a1590a).
--
-- Why this exists:
--   processSubhubProject (lib/subhub/ingest.ts:227) hardcodes stage='evaluation'
--   for every new project, ignoring SubHub's payload stage. The 5/6 backfill
--   shoved 1,754 historical SubHub deals (Jan 2025 – May 2026 contract dates)
--   into eval. Of these, 699 match a legacy_projects (NetSuite-import) row by
--   name + normalized-address. legacy_projects is the NetSuite-truth source
--   inside MG; it carries install_date / pto_date / in_service_date for the
--   real-world install state.
--
-- Scope of THIS migration (Phase 1A — "same-deal" bucket only):
--   We reclassify ONLY the 547 rows where pile.sale_date - legacy.install_date
--   is between -90 and +180 days (the gap window that indicates "two records
--   of the same install" rather than a later add-on or change order).
--
--   148 rows where the install gap is >180 days are NOT touched — those are
--   probable battery add-ons / change orders (signature: pile contract ~$250K
--   + 8x EcoFlow OCEAN Pro batteries, legacy has none). They keep stage=
--   evaluation and get filed as a triage backlog (greg_action P1, separate).
--
--   4 'neg_legacy_after_pile' rows + 33 'legacy_no_install_date' rows are
--   also not touched (manual review).
--
-- Target stage rule (within the same-deal bucket):
--   - legacy.in_service_date  IS NOT NULL  → stage = 'complete'   (510 rows)
--   - legacy.pto_date         IS NOT NULL  → stage = 'inspection' ( 37 rows)
--   - legacy.install_date     IS NOT NULL  → stage = 'install'    (  0 rows;
--                                            anything with install_date but
--                                            no pto/in_service didn't make
--                                            the bucket-0 cutoff)
--
-- Bypass note on trigger:
--   public.projects_block_direct_stage_update (mig 215b) short-circuits when
--   auth.role() <> 'authenticated'. Migrations run as postgres, so this UPDATE
--   passes the guard cleanly. We still write a manual stage_history row + an
--   audit_log row per affected project so the reclass is fully traceable.
--
-- Diagnosis source:
--   ~/.claude/plans/mg-evaluation-pile-root-cause-2026-05-12.md
--   Session 2026-05-12 — Greg validated each premise + approved bucket rule.
--
-- Pattern references:
--   mig 213  (set_project_stage)         — UPDATE projects + INSERT stage_history + audit_log
--   mig 215b (projects_block_direct_stage_update) — the guard this UPDATE bypasses
--   mig 290  (dup_review_merge)          — multi-step data migration shape


-- ── 1. Address-normalization helper (local to this migration) ─────────────
-- Mirrors the pg_temp.norm_addr function used in the diagnosis queries:
-- lowercase, collapse whitespace, normalize street-suffix variants, strip
-- non-alphanumerics. Used to match SubHub addresses ('Drive') to NetSuite
-- legacy addresses ('Dr').

CREATE OR REPLACE FUNCTION pg_temp.mig298_norm_addr(s text) RETURNS text
  LANGUAGE sql IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(lower(coalesce(s,'')), '\s+', ' ', 'g'),
                ' drive($|[, ])', ' dr\1', 'g'),
              ' avenue($|[, ])', ' ave\1', 'g'),
            ' street($|[, ])', ' st\1', 'g'),
          ' road($|[, ])', ' rd\1', 'g'),
        ' lane($|[, ])', ' ln\1', 'g'),
      ' boulevard($|[, ])', ' blvd\1', 'g'),
    ' court($|[, ])', ' ct\1', 'g'),
  '[^a-z0-9]', '', 'g');
$$;


-- ── 2. Build the reclass target set (bucket 0 only) ───────────────────────

CREATE TEMP TABLE mig298_reclass_targets ON COMMIT DROP AS
WITH pile AS (
  SELECT id AS pile_id,
         lower(trim(name)) AS lname,
         pg_temp.mig298_norm_addr(address) AS naddr,
         sale_date::date AS pile_sale_date
  FROM public.projects
  WHERE stage='evaluation' AND disposition='Sale' AND subhub_id IS NOT NULL
),
matched AS (
  SELECT DISTINCT ON (p.pile_id)
         p.pile_id,
         lp.id AS legacy_id,
         lp.install_date,
         lp.in_service_date,
         lp.pto_date,
         lp.ns_internal_id,
         (p.pile_sale_date - lp.install_date) AS gap_days
  FROM pile p
  JOIN public.legacy_projects lp
    ON lower(trim(lp.name)) = p.lname
   AND pg_temp.mig298_norm_addr(lp.address) = p.naddr
   AND p.naddr <> ''
   AND lp.install_date IS NOT NULL
  -- If 1-pile-row matches >1 legacy row, pick the most-recently-installed twin.
  -- That maximizes the chance the pile row IS the same deal (vs an older 1st install).
  ORDER BY p.pile_id, lp.install_date DESC
)
SELECT
  pile_id,
  legacy_id,
  ns_internal_id,
  gap_days,
  CASE
    WHEN in_service_date IS NOT NULL THEN 'complete'
    WHEN pto_date         IS NOT NULL THEN 'inspection'
    ELSE 'install'  -- defensive: bucket-0 implies install_date IS NOT NULL
  END AS target_stage
FROM matched
WHERE gap_days BETWEEN -90 AND 180;


-- ── 3. Sanity gate — abort if the target count is wildly off ─────────────
-- Tolerance: expected 547 per 2026-05-12 diagnosis. Allow ±15 (drift from
-- in-flight ingest). Hard-fail if outside that band so a stale migration
-- on a different snapshot can't silently affect a different row set.

DO $$
DECLARE
  v_total      int;
  v_complete   int;
  v_inspection int;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE target_stage = 'complete'),
         COUNT(*) FILTER (WHERE target_stage = 'inspection')
  INTO   v_total, v_complete, v_inspection
  FROM   mig298_reclass_targets;

  RAISE NOTICE '[mig 298] reclass_targets: total=%, complete=%, inspection=%',
    v_total, v_complete, v_inspection;

  IF v_total < 530 OR v_total > 565 THEN
    RAISE EXCEPTION '[mig 298] aborting: target count % is outside expected band 530..565', v_total;
  END IF;
END
$$;


-- ── 4. Update projects.stage + stage_date (one UPDATE for all targets) ────
-- The projects_block_direct_stage_update trigger fires under apply_migration's
-- auth context (auth.role() returns 'authenticated'). We use the same bypass
-- the set_project_stage RPC uses: set the session-local config
-- `app.via_set_project_stage='true'` so the trigger's second guard short-
-- circuits. The third arg `true` makes it transaction-local (cleared on COMMIT).

SELECT set_config('app.via_set_project_stage', 'true', true);

UPDATE public.projects p
SET    stage      = rt.target_stage,
       stage_date = to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
FROM   mig298_reclass_targets rt
WHERE  p.id = rt.pile_id;


-- ── 5. Append stage_history rows so the reclass is visible in history ────

INSERT INTO public.stage_history (project_id, stage, entered)
SELECT pile_id, target_stage, now()::text
FROM   mig298_reclass_targets;


-- ── 6. Append audit_log rows so each row's flip is traceable ──────────────
-- field='stage_manual' matches set_project_stage(p_force=true) audit shape.
-- changed_by_id='mig-298' is the sentinel for "no human actor; data migration".

INSERT INTO public.audit_log
  (project_id, field, old_value, new_value, changed_by, changed_by_id, reason)
SELECT
  pile_id,
  'stage_manual',
  'evaluation',
  target_stage,
  'Atlas (migration 298 — NetSuite reclass)',
  'mig-298',
  'NetSuite-truth reclassification (bucket 0 same-deal). '
    || 'matched legacy_projects ' || legacy_id
    || COALESCE(' (ns_internal_id=' || ns_internal_id || ')', '')
    || '. gap_days=' || gap_days::text || '.'
FROM mig298_reclass_targets;
