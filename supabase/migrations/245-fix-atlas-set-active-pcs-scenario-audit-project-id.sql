-- Migration 245: retro-fix latent NULL-on-NOT-NULL bug in mig 243
--
-- Background: red-teamer R1 on mig 244 (2026-05-08) discovered that
-- public.audit_log.project_id is text NOT NULL. Mig 243's atlas_set_active_pcs_scenario
-- inserts NULL into that column — the bug never fired because the RPC was
-- never invoked in production (zero rows in audit_log with field='pcs_active_scenario').
--
-- This migration republishes the function. Body is byte-identical to mig 243
-- except for the audit_log insert: project_id 'NULL' → 'CATALOG' sentinel,
-- matching mig 244's pattern.

CREATE OR REPLACE FUNCTION public.atlas_set_active_pcs_scenario(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_old_active uuid;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- super_admin gate — collapsed-error pattern (mig 243 anchor).
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'super_admin required to set active PCS scenario'
      USING ERRCODE = '42501';
  END IF;

  -- Advisory lock so concurrent activations serialize cleanly without
  -- bubbling up a 23505 unique-constraint error to the caller.
  PERFORM pg_advisory_xact_lock(hashtext('atlas-pcs-active-scenario'));

  SELECT owner_id INTO v_owner
  FROM public.edge_model_scenarios
  WHERE id = p_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'scenario not found: %', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Capture the prior active id for the audit row.
  SELECT id INTO v_old_active
  FROM public.edge_model_scenarios
  WHERE is_active_for_pull = true
  LIMIT 1;

  -- Atomic flip
  UPDATE public.edge_model_scenarios SET is_active_for_pull = false WHERE is_active_for_pull = true AND id <> p_id;
  UPDATE public.edge_model_scenarios SET is_active_for_pull = true  WHERE id = p_id;

  -- Audit row. Mig 245 fix: project_id NULL → 'CATALOG' sentinel because
  -- audit_log.project_id is text NOT NULL (red-teamer R1 on mig 244).
  INSERT INTO public.audit_log (project_id, field, old_value, new_value, changed_by, changed_by_id, reason)
  VALUES (
    'CATALOG',
    'pcs_active_scenario',
    COALESCE(v_old_active::text, 'none'),
    p_id::text,
    auth.email(),
    v_caller::text,
    'atlas_set_active_pcs_scenario RPC'
  );
END;
$$;

COMMENT ON FUNCTION public.atlas_set_active_pcs_scenario(uuid) IS
  'Atomically promote one edge_model_scenarios row to is_active_for_pull = true '
  'and demote all others. SUPER_ADMIN ONLY. Writes audit_log row with '
  'project_id=CATALOG sentinel (mig 245 retro-fixed the NULL bug from mig 243).';
