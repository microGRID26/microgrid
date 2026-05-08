-- Migration 244: super_admin raw_cost editor for project_cost_line_item_templates
--
-- Background: Mark/Greg meeting 2026-05-08 — Mark wants Greg, himself, and Paul
-- to be able to override raw_cost on the 28 catalog templates directly from
-- /admin without a code deploy. Today raw_cost edits require either editing
-- Paul's model (atlas_save_edge_model_scenario) or running a manual UPDATE.
--
-- This RPC adds a manual-override path:
--   • super_admin only (mirrors atlas_set_active_pcs_scenario rule from mig 243
--     red-teamer R1 — owner-based gate is a privilege-escalation vector)
--   • writes the new raw_cost to project_cost_line_item_templates.default_raw_cost
--   • emits an audit_log row with old/new for every edit (forensic trail for
--     the Mark/Paul invoice-correctness conversation)
--   • does NOT bust the in-app 5-min template cache; overlays + edits both
--     surface within ~5 min of save (acceptable per Mark's verbal spec)
--
-- Does NOT touch project_cost_line_items snapshots — those are intentionally
-- immutable for invoicing reproducibility (handoff doc Phase E covers the
-- explicit refresh tool for projects that need to re-snapshot).

CREATE OR REPLACE FUNCTION public.atlas_set_template_raw_cost(
  p_template_id uuid,
  p_new_raw_cost numeric,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old_raw_cost numeric;
  v_item_name text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- super_admin gate — collapsed-error pattern (mig 243 anchor).
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'super_admin required to edit cost catalog raw_cost'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_raw_cost IS NULL OR p_new_raw_cost < 0 THEN
    RAISE EXCEPTION 'new_raw_cost must be non-negative numeric, got %', p_new_raw_cost
      USING ERRCODE = '22023';
  END IF;

  -- Reject NaN / Infinity (numeric_finite check) and ceiling at \$10M / unit.
  -- Highest legitimate template today is GPU at \$29,000; \$10M ceiling allows
  -- ~340x headroom for edge cases without enabling fat-finger overflow into
  -- Infinity. Money-path R1 finding 2026-05-08.
  IF NOT (p_new_raw_cost = p_new_raw_cost) OR p_new_raw_cost = 'Infinity'::numeric THEN
    RAISE EXCEPTION 'new_raw_cost must be finite, got %', p_new_raw_cost
      USING ERRCODE = '22023';
  END IF;
  IF p_new_raw_cost > 10000000 THEN
    RAISE EXCEPTION 'new_raw_cost exceeds catalog ceiling \$10,000,000 — split into multiple templates if intentional'
      USING ERRCODE = '22023';
  END IF;

  SELECT default_raw_cost, item_name
    INTO v_old_raw_cost, v_item_name
  FROM public.project_cost_line_item_templates
  WHERE id = p_template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template not found: %', p_template_id
      USING ERRCODE = 'P0002';
  END IF;

  -- No-op if value unchanged. NULL-safe via IS NOT DISTINCT FROM
  -- (handles legacy NULL default_raw_cost rows correctly).
  IF v_old_raw_cost IS NOT DISTINCT FROM p_new_raw_cost THEN
    RETURN;
  END IF;

  UPDATE public.project_cost_line_item_templates
  SET default_raw_cost = p_new_raw_cost
  WHERE id = p_template_id;

  -- audit_log.project_id is text NOT NULL (verified live). Use 'CATALOG'
  -- sentinel for non-project-scoped catalog edits. R1 red-teamer 2026-05-08
  -- caught this — mig 243's atlas_set_active_pcs_scenario has the same
  -- latent bug (NULL on the same column) and is patched in mig 245.
  INSERT INTO public.audit_log (project_id, field, old_value, new_value, changed_by, changed_by_id, reason)
  VALUES (
    'CATALOG',
    'cost_template_raw_cost:' || v_item_name,
    v_old_raw_cost::text,
    p_new_raw_cost::text,
    auth.email(),
    v_caller::text,
    COALESCE(p_reason, 'atlas_set_template_raw_cost RPC')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atlas_set_template_raw_cost(uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_set_template_raw_cost(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.atlas_set_template_raw_cost(uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.atlas_set_template_raw_cost(uuid, numeric, text) IS
  'super_admin-only edit of project_cost_line_item_templates.default_raw_cost. '
  'Writes audit_log row per edit. Does not bust the in-app 5-min cache; '
  'overlays + edits both surface within ~5 min. Mark/Greg 2026-05-08 meeting.';
