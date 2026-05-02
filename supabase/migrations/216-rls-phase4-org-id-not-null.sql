-- Phase 4 of the 7-phase multi-tenant RLS hardening plan.
-- Locks in Phase 1's NULL-backfill (migration 183) by enforcing NOT NULL on
-- org_id for the 9 tables that had nullable org_id and were backfilled.
--
-- Plan: docs/plans/2026-04-28-multi-tenant-rls-hardening-plan.md
-- Pre-flight 2026-05-02: all 9 tables show 0 NULL org_id rows in prod.
-- ALTER TABLE … SET NOT NULL takes ACCESS EXCLUSIVE briefly while it scans;
-- largest target is projects at 1,708 rows — sub-second on warm cache.

BEGIN;

-- Bound the worst case: if some long-held read txn is queued ahead of us,
-- abort instead of stalling app reads/writes behind ACCESS EXCLUSIVE.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Defensive pre-flight: clearer error than PG's native NOT NULL rejection
-- if data drifted between draft and apply.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.projects                WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.queue_sections          WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.ticket_categories       WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.ticket_resolution_codes WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.commission_config       WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.onboarding_requirements WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.pay_distribution        WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.commission_rates        WHERE org_id IS NULL
    UNION ALL SELECT 1 FROM public.pay_scales              WHERE org_id IS NULL
  ) s;
  IF n > 0 THEN
    RAISE EXCEPTION 'Phase 4 abort: % NULL org_id rows present across the 9 target tables. Re-run Phase 1 backfill (migration 183) before applying.', n;
  END IF;
END $$;

ALTER TABLE public.projects                ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.queue_sections          ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.ticket_categories       ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.ticket_resolution_codes ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.commission_config       ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.onboarding_requirements ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.pay_distribution        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.commission_rates        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.pay_scales              ALTER COLUMN org_id SET NOT NULL;

COMMIT;
