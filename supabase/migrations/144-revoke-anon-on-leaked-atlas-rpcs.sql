-- Migration 144: revoke anon EXECUTE on 16 atlas_* RPCs that leaked back in after #94.
--
-- Action #94 (shipped 2026-04-17 via migrations 113+114) revoked anon on the 55 atlas_*
-- functions that existed then. Since then, 42 new atlas_* functions shipped — 16 of them
-- were granted EXECUTE to anon (likely by omission of explicit REVOKE in the creating
-- migrations). Red-team audit 2026-04-23 verified every non-public caller is already on
-- the MICROGRID_SUPABASE_SERVICE_KEY (sb_secret_*), so revocation is a no-op for legit
-- callers and closes a broad surface for attackers with the publishable key.
--
-- Not revoked (intentionally public):
--   - atlas_report_agent_run          — has p_secret gate (known-good reference pattern)
--   - atlas_kb_entries_touch_updated_at — trigger function, not PostgREST-invocable
--
-- Blast radius before this migration (per red-team):
--   6 High  (harness snapshot leak, pipeline counts leak, session hijack via heartbeat,
--            feedback action tampering x2, hook-event poisoning)
--   5 Medium
--   1 Low
--   4 "KEEP" (JWT-gated or uninvocable — revoked here anyway for defense-in-depth)
--
-- Reversible: each REVOKE can be undone with an equivalent GRANT statement.

begin;

revoke execute on function public.atlas_add_assumption(p_session_id text, p_project text, p_text text, p_context text, p_tags text[]) from anon;
revoke execute on function public.atlas_count_recent_feedback_dispatches(p_source text, p_days integer) from anon;
revoke execute on function public.atlas_hook_event_summary(p_since_hours integer) from anon;
revoke execute on function public.atlas_inbox_answers(p_limit integer) from anon;
revoke execute on function public.atlas_latest_eval_runs(p_limit integer) from anon;
revoke execute on function public.atlas_latest_harness_snapshot() from anon;
revoke execute on function public.atlas_list_pending_feedback_fixes(p_limit integer) from anon;
revoke execute on function public.atlas_list_sessions(p_limit integer) from anon;
revoke execute on function public.atlas_mark_inbox_seen(p_question_id bigint) from anon;
revoke execute on function public.atlas_pipeline_counts() from anon;
revoke execute on function public.atlas_record_feedback(p_question_id bigint, p_feedback text, p_note text) from anon;
revoke execute on function public.atlas_record_hook_event(p_hook_name text, p_hook_event text, p_decision text, p_duration_ms integer, p_block_reason text, p_metadata jsonb, p_host text) from anon;
revoke execute on function public.atlas_rule_violation_leaderboard(p_since_hours integer) from anon;
revoke execute on function public.atlas_session_heartbeat(p_session_id text, p_project text, p_cwd text, p_branch text, p_current_task text, p_last_action text, p_claimed_action_id bigint) from anon;
revoke execute on function public.atlas_set_feedback_fix_dispatched(p_id bigint, p_run_id text) from anon;
revoke execute on function public.atlas_set_feedback_pr_url(p_id bigint, p_pr_url text, p_status text) from anon;

commit;
