-- 182-atlas-record-eval-run-lock-down-grants.sql
--
-- Follow-up to 181. Two issues caught after applying the new 14-param
-- atlas_record_eval_run signature:
--
-- 1. The atlas-fn-grant-guard hook only checks REVOKE FROM PUBLIC, but
--    Supabase's default ACL for public.* functions also grants EXECUTE
--    to `anon` and `authenticated` directly. With anon EXECUTE on a
--    SECURITY DEFINER write RPC, anyone with the MG publishable key could
--    pollute atlas_eval_runs with fake rows and corrupt regression
--    detection. Lock it down to service_role + postgres only.
--
-- 2. The pre-181 13-param version still exists alongside the new 14-param
--    version. PostgREST resolves named-param calls by matching the
--    provided keys — a caller that omits p_self_consistency_sample would
--    resolve to the orphaned 13-param function (which doesn't write the
--    new column). Drop it so all callers go through the canonical
--    14-param signature.

DROP FUNCTION IF EXISTS public.atlas_record_eval_run(
  integer, numeric, jsonb, jsonb,
  text, text, text,
  integer, numeric, text,
  numeric, text, text
);

REVOKE EXECUTE ON FUNCTION public.atlas_record_eval_run(
  integer, numeric, jsonb, jsonb,
  text, text, text,
  integer, numeric, text,
  numeric, text, text,
  jsonb
) FROM anon, authenticated, PUBLIC;
