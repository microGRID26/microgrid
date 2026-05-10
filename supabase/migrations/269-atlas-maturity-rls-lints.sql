-- atlas_maturity_get_rls_lints — server-side RLS lint scanner.
--
-- Returns lint findings for the MG database (which serves the microgrid,
-- atlas-hq, and paul-hq slugs on the maturity dashboard). Five lint types
-- covering RLS posture, ported in spirit from supabase/splinter:
--
--   - rls_disabled_in_public       (error) — table in public missing RLS
--   - policy_exists_rls_disabled   (error) — policy on a table where RLS is off
--   - rls_enabled_no_policy        (warn)  — RLS on but no policies (zero access)
--   - function_search_path_mutable (warn)  — SECURITY DEFINER without locked search_path
--   - security_definer_view        (error) — VIEW without security_invoker=true
--
-- Consumer: atlas-hq POST /api/maturity/lint reads this once per cron run and
-- the collector applies the result to all 3 slugs sharing this DB. Score at
-- call site uses unique LINT NAMES per level (not raw row counts), so the
-- one-per-function fanout of function_search_path_mutable contributes 1 to
-- the warn count, not 148. See action #734 body for the formula.
--
-- service_role only. Read-only against pg_catalog. The table function returns
-- synthetic rows so RLS is not applicable to the result.

create or replace function public.atlas_maturity_get_rls_lints()
returns table(name text, level text, cnt bigint)
language sql
security definer
set search_path = public, pg_temp
as $$

  -- 1. rls_disabled_in_public: ordinary tables in public with rowsecurity off.
  --    Excludes views (relkind 'v') and partition parents which can't have RLS.
  select 'rls_disabled_in_public'::text, 'error'::text, count(*)::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity

  union all

  -- 2. policy_exists_rls_disabled: policy declared on a table whose RLS is off.
  --    The policy exists but does nothing because RLS is the gate. Subtle bug.
  select 'policy_exists_rls_disabled'::text, 'error'::text, count(*)::bigint
  from pg_policies p
  join pg_namespace n on n.nspname = p.schemaname
  join pg_class c on c.relname = p.tablename and c.relnamespace = n.oid
  where p.schemaname = 'public'
    and not c.relrowsecurity

  union all

  -- 3. rls_enabled_no_policy: RLS on but zero policies — table is fully closed
  --    (only owner/service_role can read). Often unintentional.
  select 'rls_enabled_no_policy'::text, 'warn'::text, count(*)::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = n.nspname
        and p.tablename = c.relname
    )

  union all

  -- 4. function_search_path_mutable: SECURITY DEFINER functions without an
  --    explicit search_path GUC pinned to a non-empty schema list. Hijack risk
  --    via temp-schema function shadowing under an attacker-controlled session
  --    — the classic Supabase advisor finding fanned out across every
  --    atlas_*/seer_* RPC we own. The regex requires at least one
  --    non-whitespace character after `search_path=` so values like
  --    `search_path=` (empty) and `search_path=$user` (still mutable per
  --    PG docs §5.9.6) are correctly counted as mutable.
  select 'function_search_path_mutable'::text, 'warn'::text, count(*)::bigint
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef = true
    and (
      p.proconfig is null
      or not exists (
        select 1 from unnest(p.proconfig) cfg
        where cfg ~ '^search_path=[^$\s][^=]*$'
      )
    )

  union all

  -- 5. security_definer_view: VIEW without security_invoker=true. Reads the
  --    underlying tables with the OWNER's privileges, bypassing the caller's
  --    RLS. pg15+ allows views to opt into invoker mode via reloptions.
  select 'security_definer_view'::text, 'error'::text, count(*)::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and (
      c.reloptions is null
      or not exists (
        select 1 from unnest(c.reloptions) opt
        where opt in ('security_invoker=true', 'security_invoker=on')
      )
    );

$$;

revoke execute on function public.atlas_maturity_get_rls_lints() from public;
revoke execute on function public.atlas_maturity_get_rls_lints() from anon;
revoke execute on function public.atlas_maturity_get_rls_lints() from authenticated;
grant  execute on function public.atlas_maturity_get_rls_lints() to service_role;
alter  function public.atlas_maturity_get_rls_lints() owner to postgres;

comment on function public.atlas_maturity_get_rls_lints() is
  'Server-side RLS lint scanner for the maturity dashboard. Returns 5 categories of RLS-posture findings against the public schema. service_role only. See app/api/maturity/lint/route.ts in atlas-hq for the consumer.';
