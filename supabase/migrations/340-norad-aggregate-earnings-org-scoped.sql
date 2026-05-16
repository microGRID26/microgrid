-- NORAD R1 finance-auditor 2026-05-16 caught Critical (#1148, P1):
-- `public.aggregate_earnings(p_user_id text, p_org_id uuid, ...)` SECDEF +
-- granted to authenticated, with caller-supplied parameters intersected
-- against ZERO auth context. Any authenticated rep could
-- `supabase.rpc('aggregate_earnings', { p_user_id: '<peer>' })` and read a
-- peer's commission totals. Symmetric leak via p_org_id for cross-tenant
-- totals. NULL params returned global $108,780 sum.
--
-- Greg picked option (c) org-scoped (2026-05-16):
--   * Admins: pass through unchanged (manager-tier handled elsewhere).
--   * Non-admins:
--       - p_user_id IS NULL AND p_org_id IS NULL → scope to caller (self).
--       - p_user_id != auth_user_id() → REJECT (42501).
--       - p_org_id not in auth_user_org_ids() → REJECT (42501).
--       - Otherwise allow: self by NULL, or org-wide via member-org.
--
-- Also closes the M1 NULL-param fallthrough: after the auth bind, NULL on
-- both params is rewritten to the caller's id, so no global-sum branch
-- survives for non-admins.
--
-- Fallback path in lib/api/commissions.ts:328 (direct table SELECT) is
-- RLS-protected (commission_records: rls=on, force=on, 4 policies);
-- closing the SECDEF here closes the actual exploit.

CREATE OR REPLACE FUNCTION public.aggregate_earnings(
  p_user_id text DEFAULT NULL::text,
  p_org_id uuid DEFAULT NULL::uuid,
  p_from text DEFAULT NULL::text,
  p_to text DEFAULT NULL::text
)
RETURNS TABLE(role_key text, status text, total numeric, cnt bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $$
DECLARE
  v_user text;
  v_is_admin boolean;
BEGIN
  v_user := public.auth_user_id();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'aggregate_earnings: not authenticated'
      USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.auth_is_admin();

  IF NOT v_is_admin THEN
    -- (1) peer-by-user_id query blocked
    IF p_user_id IS NOT NULL AND p_user_id <> v_user THEN
      RAISE EXCEPTION 'aggregate_earnings: cross-user query denied (non-admin)'
        USING ERRCODE = '42501';
    END IF;
    -- (2) foreign-org query blocked
    IF p_org_id IS NOT NULL
       AND NOT (p_org_id = ANY (public.auth_user_org_ids())) THEN
      RAISE EXCEPTION 'aggregate_earnings: cross-tenant query denied (non-admin)'
        USING ERRCODE = '42501';
    END IF;
    -- (3) NULL/NULL → force self-scope (closes M1 global-sum fallthrough)
    IF p_user_id IS NULL AND p_org_id IS NULL THEN
      p_user_id := v_user;
    END IF;
  END IF;

  RETURN QUERY
    SELECT
      cr.role_key,
      cr.status,
      COALESCE(SUM(cr.total_commission), 0) AS total,
      COUNT(*) AS cnt
    FROM public.commission_records cr
    WHERE
      (p_user_id IS NULL OR cr.user_id = p_user_id)
      AND (p_org_id IS NULL OR cr.org_id = p_org_id)
      AND (p_from IS NULL OR cr.created_at >= p_from::timestamptz)
      AND (p_to   IS NULL OR cr.created_at <= p_to::timestamptz)
    GROUP BY cr.role_key, cr.status;
END;
$$;

-- ACL: keep authenticated grant (function now self-checks). Service_role +
-- postgres retain. Anon never had access — confirmed via routine_privileges.
GRANT EXECUTE ON FUNCTION public.aggregate_earnings(text, uuid, text, text)
  TO authenticated, service_role;
