-- Phase 1 of MicroGRID multi-tenant RLS hardening (greg_action #350).
-- Backfills 79 NULL org_id rows across 9 tables to MicroGRID Energy
-- (a0000000-0000-0000-0000-000000000001). All 79 rows belong to MG by
-- construction: ticket categories / commission config / pay scales /
-- onboarding requirements were seeded for MG before the multi-tenant
-- org_id column was backfilled. PROJ-30331 is Greg's own house — also MG.
--
-- Lock profile: row-level UPDATE on small tables (≤27 rows each). Row
-- locks only. Safe under prod write load.
--
-- Rollback (if needed): leave the 8 reference tables backfilled (no harm
-- — they belonged to MG anyway); revert PROJ-30331 only:
--   UPDATE public.projects SET org_id = NULL WHERE id = 'PROJ-30331';
--
-- See docs/plans/2026-04-28-multi-tenant-rls-hardening-plan.md for the
-- full 7-phase plan. Phases 2-7 require branch dry-run before applying.
--
-- APPLIED TO PROD 2026-04-28 via Supabase MCP apply_migration. This local
-- file is the source-control mirror.

begin;

UPDATE public.projects                  SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.queue_sections            SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.ticket_categories         SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.ticket_resolution_codes   SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.commission_config         SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.onboarding_requirements   SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.pay_distribution          SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.commission_rates          SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE public.pay_scales                SET org_id = 'a0000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

commit;
