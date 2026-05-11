-- v1.15 / #759 H2 — atlas_maturity_lint_reader role for scoped lint reads.
--
-- Replaces atlas-hq's use of the per-tenant service-role key with a scoped
-- JWT minted per request. The JWT carries role = atlas_maturity_lint_reader;
-- PostgREST does SET LOCAL ROLE on that, and the role has EXECUTE on exactly
-- one function (`atlas_maturity_get_rls_lints`) and nothing else.
--
-- Blast radius before: leaked atlas-hq runtime service-role key = full RLS
-- bypass on the tenant DB (read/write any table).
-- Blast radius after:  leaked scoped JWT = call this one function and read
-- its synthetic counts. Window also bounded to 60s by the JWT's exp claim.
--
-- USAGE ON SCHEMA public is required because PostgREST needs to discover the
-- function under the public namespace; without it, calls 404. The role has
-- no SELECT/INSERT/UPDATE/DELETE on any table — only EXECUTE on this one
-- function — so USAGE-on-schema is just visibility, not data access.
--
-- Applied to all 7 tenants (microgrid, spark, edge, quest, sentinel, spoke,
-- collector) per lib/maturity/db-registry.json.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'atlas_maturity_lint_reader') then
    create role atlas_maturity_lint_reader nologin;
  end if;
end
$$;

grant usage on schema public to atlas_maturity_lint_reader;
grant execute on function public.atlas_maturity_get_rls_lints() to atlas_maturity_lint_reader;

-- Required so PostgREST (running as `authenticator`) can SET LOCAL ROLE
-- atlas_maturity_lint_reader when the JWT claim arrives. Without this grant
-- the request fails with "permission denied to set role". Mirrors the Supabase
-- pattern for anon/authenticated/service_role.
grant atlas_maturity_lint_reader to authenticator;

comment on role atlas_maturity_lint_reader is
  'Scoped reader for /api/maturity/lint (atlas-hq v1.15, #759 H2). EXECUTE on atlas_maturity_get_rls_lints only. Used via short-lived JWTs minted by atlas-hq; replaces service-role for this hot path.';

-- R1 v1.15 migration-planner M1: PostgREST caches authenticator role
-- membership for ~30-60s after grant. Without this NOTIFY, the first JWTs
-- minted with role=atlas_maturity_lint_reader will 500 with "role does not
-- exist" until pgrst auto-reloads. Force the schema reload so the role is
-- recognized immediately on this project.
notify pgrst, 'reload schema';
