-- Migration 144b: revoke PUBLIC EXECUTE on atlas_* RPCs (real fix for the leak).
--
-- Migration 144 revoked `anon` EXECUTE explicitly, but PostgreSQL functions also
-- inherit EXECUTE from the PUBLIC pseudo-role (created by `GRANT EXECUTE ON
-- FUNCTION ... TO PUBLIC` or implicit default on CREATE FUNCTION). Anon can still
-- reach the function via the PUBLIC inheritance even after the explicit anon
-- revoke.  Verified empirically: `set role anon; select atlas_pipeline_counts();`
-- succeeded after 144 ran.  This migration revokes PUBLIC.
--
-- Two functions newly discovered during verify also have PUBLIC grants and get
-- added here: atlas_is_feedback_processed + atlas_record_harness_snapshot.
--
-- atlas_report_agent_run keeps its explicit anon GRANT (p_secret-gated public
-- path, known-good reference pattern) — we revoke PUBLIC on it too for
-- consistency; the explicit anon grant survives.
--
-- atlas_kb_entries_touch_updated_at is a trigger function; revoking PUBLIC on
-- it is a no-op for PostgREST invocability but tightens defense-in-depth.

begin;

revoke execute on function public.atlas_count_recent_feedback_dispatches(p_source text, p_days integer) from public;
revoke execute on function public.atlas_hook_event_summary(p_since_hours integer) from public;
revoke execute on function public.atlas_is_feedback_processed(p_source text, p_feedback_id text) from public;
revoke execute on function public.atlas_kb_entries_touch_updated_at() from public;
revoke execute on function public.atlas_latest_eval_runs(p_limit integer) from public;
revoke execute on function public.atlas_latest_harness_snapshot() from public;
revoke execute on function public.atlas_list_pending_feedback_fixes(p_limit integer) from public;
revoke execute on function public.atlas_list_sessions(p_limit integer) from public;
revoke execute on function public.atlas_pipeline_counts() from public;
revoke execute on function public.atlas_record_harness_snapshot(p_payload jsonb, p_settings_sha text, p_claude_md_sha text, p_notes text, p_host text) from public;
revoke execute on function public.atlas_record_hook_event(p_hook_name text, p_hook_event text, p_decision text, p_duration_ms integer, p_block_reason text, p_metadata jsonb, p_host text) from public;
revoke execute on function public.atlas_report_agent_run(p_secret text, p_slug text, p_status text, p_started_at timestamp with time zone, p_finished_at timestamp with time zone, p_items_processed integer, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_output_summary text, p_error_message text, p_metadata jsonb) from public;
revoke execute on function public.atlas_rule_violation_leaderboard(p_since_hours integer) from public;
revoke execute on function public.atlas_session_heartbeat(p_session_id text, p_project text, p_cwd text, p_branch text, p_current_task text, p_last_action text, p_claimed_action_id bigint) from public;
revoke execute on function public.atlas_set_feedback_fix_dispatched(p_id bigint, p_run_id text) from public;
revoke execute on function public.atlas_set_feedback_pr_url(p_id bigint, p_pr_url text, p_status text) from public;

commit;
