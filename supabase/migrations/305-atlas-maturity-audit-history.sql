-- 305-atlas-maturity-audit-history.sql
-- v1.30 Phase 3: new SECURITY DEFINER RPC to read `atlas_chain_audit_log`
-- entries that count as the audit history for a given maturity dashboard
-- project. The TS-side mapping `lib/maturity/audit-chain-map.ts` resolves
-- the project slug → chain_slugs array; this RPC just filters the log.
--
-- Caller: atlas-hq SSR using the service-role key. Same pattern as the
-- other atlas_maturity_* RPCs (mig 260: get_constellation, get_project,
-- insert_snapshot). No anon/authenticated execute grant; the service-role
-- bypass is the entry point.
--
-- Filtered to last `p_limit` rows ordered by created_at desc; default
-- 50 keeps the per-slug page payload small. Returns jsonb array.

create or replace function public.atlas_maturity_audit_history(
  p_chain_slugs text[],
  p_limit       int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  set local statement_timeout = '5s';

  -- Empty / null array returns []; saves a roundtrip on the per-slug page
  -- when audit-chain-map.ts has no entries for the project (most slugs
  -- have empty arrays today — only atlas-hq + microgrid + spark + seer
  -- have chain audit history at v1.30 launch).
  if p_chain_slugs is null or array_length(p_chain_slugs, 1) is null then
    return '[]'::jsonb;
  end if;

  with rows as (
    select
      id,
      created_at,
      chain_slug,
      version,
      gate,
      agent,
      agent_id,
      grade,
      critical,
      high,
      medium,
      low,
      findings_json,
      notes
    from public.atlas_chain_audit_log
    where chain_slug = any (p_chain_slugs)
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',            id,
        'created_at',    created_at,
        'chain_slug',    chain_slug,
        'version',       version,
        'gate',          gate,
        'agent',         agent,
        'agent_id',      agent_id,
        'grade',         grade,
        'critical',      critical,
        'high',          high,
        'medium',        medium,
        'low',           low,
        'findings_json', findings_json,
        'notes',         notes
      )
      order by created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from rows;

  return result;
end;
$$;

revoke execute on function public.atlas_maturity_audit_history(text[], int) from public;
revoke execute on function public.atlas_maturity_audit_history(text[], int) from anon;
revoke execute on function public.atlas_maturity_audit_history(text[], int) from authenticated;
grant  execute on function public.atlas_maturity_audit_history(text[], int) to service_role;
alter  function public.atlas_maturity_audit_history(text[], int) owner to postgres;

comment on function public.atlas_maturity_audit_history(text[], int) is
  'v1.30 — returns recent atlas_chain_audit_log rows for the chain_slugs that count as audit history for a project. Service-role only; called from atlas-hq SSR (lib/maturity/audit-chain-map.ts resolves project slug → chain_slugs). Filtered to last p_limit rows (default 50, max 200) ordered by created_at desc.';
