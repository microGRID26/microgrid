-- 172: REVOKE EXECUTE on atlas_* RPCs that are only ever called server-side
-- greg_actions #294 (P1, partial). Audit-rotation 2026-04-25 / security-definer-rpcs.
--
-- Scope: this revokes authenticated EXECUTE only on RPCs that are PROVABLY
-- called only via service_role contexts:
--   * Helper scripts in ~/.claude/scripts/ that read SUPABASE_SERVICE_ROLE_KEY
--   * ATLAS HQ Next routes that use MICROGRID_SUPABASE_SERVICE_KEY
--   * MG cron / hook scripts using the service-role key
--
-- Out of scope (NOT revoked here, requires server-route shim work first):
--   - atlas_inbox_answers                  (MG /api/atlas/inbox uses cookie session → authenticated)
--   - atlas_hq_link_auth_user              (must remain authenticated; #293 hardened content)
--   - atlas_hq_get_user_role               (called from browser session)
--   - atlas_hq_create_user / list_users / update_user  (verify ATLAS HQ getServerSupabase auth)
--   - atlas_save_edge_model_scenario, atlas_get_edge_model_scenario, atlas_list_edge_model_scenarios,
--     atlas_lock_edge_model_scenario, atlas_delete_edge_model_scenario, atlas_get_live_edge_model_source,
--     atlas_set_live_edge_model_source, atlas_list_edge_model_sources, atlas_upload_edge_model_source,
--     atlas_delete_edge_model_source, atlas_update_edge_model_build_status, atlas_edge_model_actuals
--     (EDGE model UI runs as authenticated; KEEP grant)
--   - atlas_record_feedback, atlas_mark_inbox_seen
--     (called from browser inbox UI as authenticated; KEEP grant)
--   - atlas_set_feedback_fix_dispatched, atlas_set_feedback_pr_url
--     (verify dispatch path before revoking)

-- Writers: hooks + helper scripts (service_role only)
REVOKE EXECUTE ON FUNCTION public.atlas_session_heartbeat(text, text, text, text, text, text, bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_record_hook_event(text, text, text, integer, text, jsonb, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_claim_action(text, bigint, integer)                          FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_release_action(text)                                         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_add_assumption(text, text, text, text, text[])               FROM authenticated;

-- Readers: ATLAS HQ pulls these via service_role (lib/sessions/fetch.ts pattern)
REVOKE EXECUTE ON FUNCTION public.atlas_list_sessions(integer)                          FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_pipeline_counts()                               FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_qa_fails_since(timestamptz, integer)            FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_qa_recent_runs(integer, integer)                FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_qa_summary(integer)                             FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_rule_violation_leaderboard(integer)             FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_hook_event_summary(integer)                     FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_latest_eval_runs(integer)                       FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_latest_harness_snapshot()                       FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_list_pending_feedback_fixes(integer)            FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_list_edge_model_access_log(integer, text, timestamptz) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.atlas_count_recent_feedback_dispatches(text, integer) FROM authenticated;
