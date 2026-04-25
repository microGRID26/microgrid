-- 173: REVOKE anon EXECUTE on the 3 SECDEF write RPCs flagged in greg_actions #292
--
-- Path 1 from the audit (2026-04-25 / security-definer-rpcs surface):
--   - atlas_log_banker_login         (forensic banker-login log)
--   - atlas_log_edge_model_event     (page-view + admin-view + oauth-signin log)
--   - atlas_report_agent_run         (fleet runner cost/status report; p_secret gated)
--
-- All three callers were switched to service_role in matching code changes:
--   * EDGE-MODEL: app/api/audit-log/route.ts  → SUPABASE_SERVICE_ROLE_KEY
--   * EDGE-MODEL: lib/admin/access-log.ts (logModelPageView) → SUPABASE_SERVICE_ROLE_KEY
--   * ATLAS-HQ:   lib/hq-fleet.ts → MICROGRID_SUPABASE_SERVICE_KEY
--
-- After this migration:
--   - atlas_log_banker_login   : authenticated + service_role (UI admin pages
--     still call as authenticated). anon REVOKED.
--   - atlas_log_edge_model_event: same. authenticated retained for the
--     oauth_signin + admin_view branches; page_view branch now goes through
--     service_role.
--   - atlas_report_agent_run   : authenticated + service_role. anon REVOKED.
--     The p_secret digest gate inside the RPC body remains as defense-in-depth.
--
-- DO NOT apply until the code changes have deployed on Vercel and you've
-- verified model.energydevelopmentgroup.com banker login still writes rows
-- (otherwise the audit log will silently stop recording).

REVOKE EXECUTE ON FUNCTION public.atlas_log_banker_login(text, text, text, text)              FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_log_edge_model_event(text, text, text, text, jsonb)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_report_agent_run(text, text, text, timestamptz, timestamptz, integer, integer, integer, numeric, text, text, jsonb) FROM anon;
