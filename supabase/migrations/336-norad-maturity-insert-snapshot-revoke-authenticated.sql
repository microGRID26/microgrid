-- 336: NORAD wide-net R1 follow-up — close the maturity-collector write surface.
--
-- R1 (red-teamer, wide-net 2026-05-15 evening) sampled 100% (109/109) of the
-- authenticated-grantable SECDEF functions in MG public schema. Caught
-- HIGH on `atlas_maturity_insert_snapshot(p_payload jsonb)` — SECDEF,
-- granted to authenticated, NO authz body, `INSERT ... ON CONFLICT DO UPDATE`
-- on `atlas_codebase_maturity_snapshots`. Any logged-in MG user can rewrite
-- /maturity dashboard history (axis scores per project per timestamp) and
-- because of ON CONFLICT DO UPDATE, the rewrite leaves no duplicate-key trail.
--
-- Caller analysis (verified by grep across MG / ATLAS-HQ / EDGE / EDGE-MODEL):
--   ~/repos/ATLAS-HQ/lib/maturity/server.ts:13 — calls via getServiceSupabase()
--   which mints a service_role client. Zero authenticated callers anywhere.
--
-- Fix: REVOKE EXECUTE FROM PUBLIC + FROM authenticated. service_role retains.
-- Same shape as mig 334 (atlas_update_edge_model_build_status) and mig 335
-- (get_live) BUT with explicit REVOKE FROM PUBLIC added (migration-planner
-- pre-apply caught this — atlas_maturity_insert_snapshot still carries the
-- PUBLIC default grant in proacl `=X/postgres`, whereas the two prior fixes
-- had PUBLIC pre-revoked by an earlier migration. Revoking authenticated
-- alone would have been cosmetic because authenticated inherits PUBLIC).
-- Anchor: NORAD wide-net R1 + migration-planner pre-apply 2026-05-15 — High
-- finding on the original draft, caught and fixed inline before apply.

REVOKE EXECUTE ON FUNCTION public.atlas_maturity_insert_snapshot(jsonb)
  FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.atlas_maturity_insert_snapshot(jsonb)
  FROM authenticated;

GRANT EXECUTE ON FUNCTION public.atlas_maturity_insert_snapshot(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.atlas_maturity_insert_snapshot(jsonb) IS
  'Server-side only. Called by ATLAS-HQ maturity collector via service_role. authenticated revoked in mig 336 (NORAD wide-net R1 — closed dashboard-rewrite surface).';
