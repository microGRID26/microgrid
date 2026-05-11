-- v1.16 / closes greg_actions #801 (v1.15 R1 red-teamer M1).
-- Move atlas_maturity_get_rls_lints into dedicated schema atlas_maturity
-- and drop USAGE on schema public from atlas_maturity_lint_reader so the
-- scoped role no longer has the implicit ability to enumerate / inspect /
-- reference objects in the public namespace.
--
-- Applied to all 7 tenants (microgrid, spark, edge, quest, sentinel, spoke,
-- collector) per lib/maturity/db-registry.json.
--
-- ROLLOUT ORDER (R1 v1.16 M1) — operational, not in this SQL:
--   1. PATCH /v1/projects/<ref>/postgrest db_schema += 'atlas_maturity' on
--      ALL 7 tenants. Verify each via `Accept-Profile: atlas_maturity` ping.
--   2. apply_migration of this file to ALL 7 tenants.
--   3. Ship atlas-hq TS change (`db: { schema: 'atlas_maturity' }`) + new tests.
-- If 1 fails partially, retry 1 — do NOT proceed to 2. If 2 succeeds but
-- 3 lags, the live route still 404s until 3 deploys (acceptable transient).
--
-- ROLLBACK (R1 v1.16 M2):
--   alter function atlas_maturity.atlas_maturity_get_rls_lints() set schema public;
--   grant usage on schema public to atlas_maturity_lint_reader;
--   alter function public.atlas_maturity_get_rls_lints() set search_path = 'public','pg_temp';
--   notify pgrst, 'reload schema';
--   -- Then PATCH db_schema to remove 'atlas_maturity' from the exposed list.
--
-- ROUTE-OMISSION DEFENSE (R1 v1.16 L3 explicit note): after this migration,
-- a client calling POST /rest/v1/rpc/atlas_maturity_get_rls_lints WITHOUT
-- the Accept-Profile header hits the project's default schema (public);
-- the function no longer exists there → PostgREST returns 404. The schema
-- lock cannot be bypassed by omitting the header.

-- R1 v1.16 M4: fail loudly if atlas_maturity is pre-existing — refuse to
-- move into a squatted schema. Pin authorization to postgres on create.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'atlas_maturity') then
    raise exception 'atlas_maturity schema already exists — investigate before moving function (mig 289 expects a clean create)';
  end if;
  execute 'create schema atlas_maturity authorization postgres';
end
$$;

-- R1 v1.16 H1: pre-empt the next maintainer's footgun. Strip PUBLIC's
-- implicit USAGE + the default-on-creation EXECUTE on future functions.
revoke all on schema atlas_maturity from public;
alter default privileges in schema atlas_maturity revoke execute on functions from public;

-- Function move. ALTER FUNCTION ... SET SCHEMA preserves SECURITY DEFINER
-- bit, body, and existing GRANTs (atlas_maturity_lint_reader retains
-- EXECUTE; service_role retains EXECUTE; postgres remains owner).
alter function public.atlas_maturity_get_rls_lints() set schema atlas_maturity;

-- R1 v1.16 M3: tighten search_path. Function body references only pg_*
-- catalog objects (always implicitly first via pg_catalog) and filters by
-- the literal string 'public' — no unqualified public-schema dependency.
-- Dropping 'public' from search_path eliminates a theoretical schema-hijack
-- pivot on the SECURITY DEFINER function.
alter function atlas_maturity.atlas_maturity_get_rls_lints() set search_path = 'pg_catalog', 'pg_temp';

-- Grant USAGE on the new schema to the scoped role only. R1 v1.16 H2:
-- authenticator does NOT need schema USAGE for SET LOCAL ROLE to work —
-- the role-membership grant from mig 288 is sufficient. Keeping the M1
-- narrative tight: only atlas_maturity_lint_reader has visibility into
-- atlas_maturity.
grant usage on schema atlas_maturity to atlas_maturity_lint_reader;

-- Revoke USAGE on public — the actual M1 fix. The scoped role can no
-- longer list / inspect / reference any object in the public namespace.
revoke usage on schema public from atlas_maturity_lint_reader;

-- R1 v1.16 L1: refresh function comment to reflect new location.
comment on function atlas_maturity.atlas_maturity_get_rls_lints() is
  'Synthetic RLS-lint counts for /api/maturity/lint. Moved from public to atlas_maturity in mig 289 (chain v1.16, closes #801). SECURITY DEFINER; grants: EXECUTE to atlas_maturity_lint_reader + service_role.';

-- Reload PostgREST schema cache so the next request sees the moved
-- function under the new schema. R1 v1.16 L2: reload is async (1-5s) —
-- the rollout script retries once on 404 to absorb the gap.
notify pgrst, 'reload schema';
