-- 181-atlas-eval-runs-self-consistency-sample.sql
--
-- Closes greg_action #301 (approved by #216 answer 2026-04-25).
--
-- Adds a self_consistency_sample jsonb column to atlas_eval_runs so the
-- nightly cron can persist a 10% sample re-grade comparison and detect
-- grader noise / drift between two grader calls on the same subject output.
--
-- Shape (filled by lib/eval/runner.ts):
--   {
--     "sample_rate": 0.1,
--     "samples": [
--       {
--         "entry_id": "test-1",
--         "primary_verdicts": [...],
--         "consistency_verdicts": [...],
--         "primary_overall_pass": true,
--         "consistency_overall_pass": false,
--         "agreed": false,
--         "disagreement_summary": "primary said pass, consistency said fail on rule X"
--       },
--       ...
--     ]
--   }
--
-- Older rows have null. Newer rows: empty samples array if no entries hit
-- the 10% sample on that run, populated array otherwise.
--
-- atlas_record_eval_run is recreated to accept the new optional param.
-- Default null preserves backward compatibility — any existing caller that
-- doesn't pass it gets the same behavior as before.

ALTER TABLE public.atlas_eval_runs
  ADD COLUMN IF NOT EXISTS self_consistency_sample jsonb;

-- Recreate the RPC with the new optional param appended at the end so
-- positional arg compatibility is preserved (no caller breaks).
CREATE OR REPLACE FUNCTION public.atlas_record_eval_run(
  p_total_entries integer,
  p_overall_pct numeric,
  p_per_rule_json jsonb,
  p_per_entry_json jsonb,
  p_claude_md_sha text DEFAULT NULL::text,
  p_grader_model text DEFAULT NULL::text,
  p_subject_model text DEFAULT NULL::text,
  p_duration_ms integer DEFAULT NULL::integer,
  p_cost_usd numeric DEFAULT NULL::numeric,
  p_notes text DEFAULT NULL::text,
  p_weighted_overall_pct numeric DEFAULT NULL::numeric,
  p_grader_prompt_version text DEFAULT NULL::text,
  p_variant text DEFAULT 'baseline'::text,
  p_self_consistency_sample jsonb DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  insert into atlas_eval_runs (
    total_entries, overall_pct, per_rule_json, per_entry_json,
    claude_md_sha, grader_model, subject_model,
    duration_ms, cost_usd, notes,
    weighted_overall_pct, grader_prompt_version, variant,
    self_consistency_sample
  ) values (
    p_total_entries, p_overall_pct, p_per_rule_json, p_per_entry_json,
    p_claude_md_sha, p_grader_model, p_subject_model,
    p_duration_ms, p_cost_usd, p_notes,
    p_weighted_overall_pct, p_grader_prompt_version, coalesce(p_variant, 'baseline'),
    p_self_consistency_sample
  )
  returning id;
$function$;

-- Lock down EXECUTE — Postgres grants to PUBLIC by default which inherits
-- to anon (MG publishable key). Only the service role (called via the cron
-- secret-gated route) should write eval runs.
REVOKE EXECUTE ON FUNCTION public.atlas_record_eval_run(
  integer, numeric, jsonb, jsonb,
  text, text, text,
  integer, numeric, text,
  numeric, text, text,
  jsonb
) FROM PUBLIC;
