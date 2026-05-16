-- Mig 346 — atlas_create_cost_basis_snapshot service-role shim.
-- Closes greg_action #679. Picks option (b): SECDEF variant takes a trusted
-- p_caller_email param when called by service_role, looks up the user record,
-- and continues with the existing role/org checks against that resolved
-- identity. Frontend callers (auth.uid() path) unaffected — they don't pass
-- p_caller_email and fall through to v_caller := auth.uid() as before.
--
-- MCP-driven Atlas batches can now call this RPC directly instead of
-- duplicating the snapshot-insert + backfill + audit-log dance in raw SQL.

BEGIN;

CREATE OR REPLACE FUNCTION public.atlas_create_cost_basis_snapshot(
  p_project_id text,
  p_reason text DEFAULT NULL::text,
  p_caller_email text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller         uuid := auth.uid();
  v_caller_pubid   uuid;
  v_caller_role    text;
  v_new_snapshot   uuid := gen_random_uuid();
  v_old_snapshot   uuid;
  v_old_total      numeric;
  v_new_total      numeric;
  v_project_org    uuid;
  v_caller_email   text;
BEGIN
  -- Service-role path: trusted p_caller_email resolves the user record.
  -- Requires the caller to explicitly identify who the snapshot is for,
  -- so audit_log + cost_basis_snapshots.created_by_id are still populated
  -- with a real user FK. service_role JWTs never carry auth.uid().
  IF auth.role() = 'service_role' THEN
    IF p_caller_email IS NULL OR length(trim(p_caller_email)) = 0 THEN
      RAISE EXCEPTION 'service_role calls must pass p_caller_email'
        USING ERRCODE = '42501';
    END IF;
    v_caller_email := lower(trim(p_caller_email));
  ELSIF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  ELSE
    v_caller_email := lower((auth.jwt() ->> 'email'));
  END IF;

  SELECT u.id, u.role INTO v_caller_pubid, v_caller_role
    FROM public.users u
   WHERE lower(u.email) = v_caller_email
   LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('super_admin','admin','manager') THEN
    RAISE EXCEPTION 'admin role required to create cost-basis snapshot'
      USING ERRCODE = '42501';
  END IF;

  IF length(coalesce(p_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'p_reason exceeds 1000 char limit' USING ERRCODE = '22023';
  END IF;

  SELECT p.org_id INTO v_project_org
    FROM public.projects p WHERE p.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found: %', p_project_id USING ERRCODE = 'P0002';
  END IF;

  -- Org membership check: service_role bypasses (it's already trusted to
  -- specify the caller identity; org gating is a frontend concern).
  IF auth.role() <> 'service_role'
     AND NOT public.auth_is_platform_user()
     AND NOT (v_project_org = ANY(public.auth_user_org_ids())) THEN
    RAISE EXCEPTION 'forbidden — caller is not a member of project org'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cost_basis_snapshot_create:' || p_project_id));

  SELECT s.id, COALESCE(SUM(pcli.epc_price), 0)
    INTO v_old_snapshot, v_old_total
    FROM public.cost_basis_snapshots s
    LEFT JOIN public.project_cost_line_items pcli
      ON pcli.project_id = s.project_id AND pcli.snapshot_id = s.id
   WHERE s.project_id = p_project_id AND s.is_active = true
   GROUP BY s.id
   LIMIT 1;

  UPDATE public.cost_basis_snapshots
     SET is_active = false
   WHERE project_id = p_project_id AND is_active = true;

  INSERT INTO public.cost_basis_snapshots (id, project_id, created_by_id, reason, is_active)
  VALUES (v_new_snapshot, p_project_id, v_caller_pubid,
          COALESCE(p_reason, 'Cost-basis regen via Cost Basis tab banner'), true);

  PERFORM public.backfill_project_cost_line_items(p_project_id, v_new_snapshot);

  SELECT COALESCE(SUM(epc_price), 0) INTO v_new_total
    FROM public.project_cost_line_items
   WHERE project_id = p_project_id AND snapshot_id = v_new_snapshot;

  INSERT INTO public.audit_log (project_id, field, old_value, new_value, changed_by, changed_by_id, reason)
  VALUES (
    p_project_id,
    'cost_basis_snapshot',
    CASE WHEN v_old_snapshot IS NULL
         THEN NULL
         ELSE format('snapshot=%s, total=$%s', v_old_snapshot, v_old_total::text)
    END,
    format('snapshot=%s, total=$%s', v_new_snapshot, v_new_total::text),
    'atlas_create_cost_basis_snapshot',
    v_caller_pubid::text,
    COALESCE(p_reason, 'Cost-basis regen via Cost Basis tab banner')
  );

  RETURN v_new_snapshot;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_create_cost_basis_snapshot(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_create_cost_basis_snapshot(text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_create_cost_basis_snapshot(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atlas_create_cost_basis_snapshot(text, text, text) TO authenticated, service_role;

-- Post-apply verification:
-- 1. Frontend path (authenticated): existing call sites use the 2-arg signature
--    `atlas_create_cost_basis_snapshot(p_project_id, p_reason)` — Postgres
--    resolves to the 3-arg overload with p_caller_email defaulting to NULL,
--    enters the ELSIF branch, looks up email via auth.jwt(). Unchanged behavior.
-- 2. MCP path (service_role): `SELECT atlas_create_cost_basis_snapshot(
--      'PROJ-XXXXX', 'test reason', 'greg@gomicrogridenergy.com')` resolves
--    Greg's user row and proceeds.
-- 3. Negative: service_role without p_caller_email raises 42501 ('service_role
--    calls must pass p_caller_email').

COMMIT;
