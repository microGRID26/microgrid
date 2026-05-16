-- 344 — atlas_* suspicious-RPC REVOKE sweep (closes #643 — SPARK-chain v147 cross-cut)
--
-- Source: action #643 (autofix-loop-2026-05-08-636-followup). Action surface
-- spans MG/SPARK/EDGE. Pre-mig sweep:
--   - SPARK (rmeczihrzlwgcvmnlour): 0 atlas_* SECDEF fns with anon=X. Clean.
--   - EDGE  (hkeirtxuiqzxbzhugoch): 0 atlas_* SECDEF fns with anon=X. Clean.
--   - MG    (hzymsezqfxzpbcqryeim): 5 atlas_* SECDEF fns with anon=X — exactly
--     the intersection of the action's "likely should be service-role only"
--     suspicious list with what's actually extant.
--
-- The 5 closes the MG portion of the action's success criteria:
--   `select count(*) from pg_proc where prosecdef=true and proacl::text like '%anon=X%'
--    and proname like 'atlas_%' and proname not like 'auth_%'` → 0
--
-- The 5 fns:
--   1. atlas_assert_owner()                 — owner-check helper, called server-side only
--   2. atlas_get_daily_brief(date)          — admin daily-brief read, cron + HQ admin UI
--   3. atlas_list_daily_brief_dates(int)    — cron-facing list
--   4. atlas_list_daily_brief_repos()       — cron-facing list
--   5. atlas_list_weekly_recipients()       — weekly digest cron internals
--
-- All 5 are cron/orchestration RPCs — none have a user-facing call path.
-- HQ web app uses service_role for the brief/digest UI (server route reads),
-- not direct authenticated RPC calls. Verified via repo grep.
--
-- Out of scope (NOT touched in this mig):
-- - 31 other atlas_* SECDEF fns with authenticated=X (no anon). These are
--   HQ-user-facing RPCs with internal owner-check (atlas_assert_owner /
--   atlas_is_hq_owner) and need authenticated access. Hygiene revocation
--   to service_role would break the HQ web client. Filed as a separate
--   pass if Greg decides to migrate HQ to service-role-only.
-- - Trigger functions (action body notes "lower priority hygiene").

BEGIN;

REVOKE EXECUTE ON FUNCTION public.atlas_assert_owner()                FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_assert_owner()                TO service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_get_daily_brief(date)         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_get_daily_brief(date)         TO service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_list_daily_brief_dates(int)   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_daily_brief_dates(int)   TO service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_list_daily_brief_repos()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_daily_brief_repos()      TO service_role;

REVOKE EXECUTE ON FUNCTION public.atlas_list_weekly_recipients()      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_list_weekly_recipients()      TO service_role;

DO $verify$
DECLARE
  v_remaining int;
  v_offenders text;
BEGIN
  -- Success criteria from action #643: anon=0 on atlas_* SECDEF surface
  SELECT count(*), string_agg(DISTINCT proname, ', ' ORDER BY proname)
    INTO v_remaining, v_offenders
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.prosecdef = true
    AND p.proname LIKE 'atlas_%'
    AND p.proname NOT LIKE 'auth_%'
    AND p.proacl::text LIKE '%anon=X%';

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'mig 344 verify: % atlas_* SECDEF fn(s) still grant anon EXECUTE: %', v_remaining, v_offenders;
  END IF;

  -- Belt-and-suspenders: confirm the 5 we touched have service_role + no anon + no authenticated
  SELECT count(*) INTO v_remaining
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('atlas_assert_owner','atlas_get_daily_brief','atlas_list_daily_brief_dates',
                      'atlas_list_daily_brief_repos','atlas_list_weekly_recipients')
    AND (p.proacl::text LIKE '%anon=X%' OR p.proacl::text LIKE '%authenticated=X%');

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'mig 344 verify: targeted 5 fns still have anon/authenticated grants';
  END IF;

  SELECT count(*) INTO v_remaining
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('atlas_assert_owner','atlas_get_daily_brief','atlas_list_daily_brief_dates',
                      'atlas_list_daily_brief_repos','atlas_list_weekly_recipients')
    AND p.proacl::text LIKE '%service_role=X%';

  IF v_remaining <> 5 THEN
    RAISE EXCEPTION 'mig 344 verify: expected 5 fns with service_role grant, got %', v_remaining;
  END IF;

  RAISE NOTICE 'mig 344 verify ok: anon=0 on atlas_* SECDEF surface; 5 suspicious RPCs locked to service_role';
END
$verify$;

COMMIT;
