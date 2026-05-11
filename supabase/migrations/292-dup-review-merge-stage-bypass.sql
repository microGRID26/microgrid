-- Migration 292: Set app.via_set_project_stage='true' in atlas_dup_review_merge
-- so the projects_block_direct_stage_update trigger lets us NULL the loser stage.
--
-- Surfaced 2026-05-11 during SAFE_MERGE smoke test on PROJ-30330 → PROJ-30326.
-- The merge RPC's final UPDATE on public.projects sets stage=NULL on the loser
-- (canonical loser-archive shape). The projects trigger blocks any direct
-- stage/stage_date UPDATE unless `app.via_set_project_stage='true'` is set
-- on the session (the bypass used by set_project_stage RPC).
--
-- set_project_stage cannot be reused here because it requires p_target_stage IN
-- valid-stage enum (won't accept NULL) and runs role-check on auth_user_id()
-- which is NULL when called from a service-role RPC.
--
-- Fix: set the bypass session var transactionally before the soft-archive UPDATE.

CREATE OR REPLACE FUNCTION public.atlas_dup_review_merge(p_loser_id text, p_actor_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_winner_id    text;
  v_log_id       uuid;
  v_loser_row    public.projects;
  v_winner_row   public.projects;
  v_undo         jsonb;
  v_dropped      jsonb;
  v_unmerged_ca  jsonb;
BEGIN
  IF p_loser_id IS NULL OR p_actor_email IS NULL OR p_actor_email = '' THEN
    RAISE EXCEPTION 'merge requires loser_id and actor_email';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('atlas_dup_review_merge:' || p_loser_id, 0));

  SELECT * INTO v_loser_row FROM public.projects WHERE id = p_loser_id;
  IF v_loser_row IS NULL THEN
    RAISE EXCEPTION 'loser project % not found', p_loser_id;
  END IF;
  IF v_loser_row.dup_review_pending IS NOT TRUE THEN
    RAISE EXCEPTION 'loser project % is not flagged for review', p_loser_id;
  END IF;
  v_winner_id := v_loser_row.dup_canonical_id;
  IF v_winner_id IS NULL THEN
    RAISE EXCEPTION 'loser project % has no canonical id', p_loser_id;
  END IF;

  SELECT * INTO v_winner_row FROM public.projects WHERE id = v_winner_id;
  IF v_winner_row IS NULL THEN
    RAISE EXCEPTION 'winner project % not found', v_winner_id;
  END IF;

  IF v_loser_row.org_id IS DISTINCT FROM v_winner_row.org_id THEN
    RAISE EXCEPTION 'cross-org merge rejected: loser org_id=% winner org_id=%',
      v_loser_row.org_id, v_winner_row.org_id;
  END IF;

  v_undo := jsonb_build_object(
    'loser_id', v_loser_row.id,
    'winner_id', v_winner_row.id,
    'loser_pre_merge_summary', jsonb_build_object(
      'disposition', v_loser_row.disposition,
      'stage', v_loser_row.stage,
      'sale_date', v_loser_row.sale_date,
      'contract', v_loser_row.contract,
      'systemkw', v_loser_row.systemkw,
      'module', v_loser_row.module,
      'module_qty', v_loser_row.module_qty,
      'inverter', v_loser_row.inverter,
      'inverter_qty', v_loser_row.inverter_qty,
      'battery', v_loser_row.battery,
      'battery_qty', v_loser_row.battery_qty,
      'subhub_id', v_loser_row.subhub_id,
      'blocker', v_loser_row.blocker
    )
  );

  UPDATE public.change_orders            SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.clearing_runs            SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.commission_advances      SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.commission_records       SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.cost_basis_snapshots     SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.customer_chat_sessions   SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.engineering_assignments  SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.entity_profit_transfers  SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.funding_nf_changes       SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.funding_notes            SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.invoices                 SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.jsa                      SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.material_requests        SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.ntp_requests             SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_adders           SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.project_cost_line_items  SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.ramp_schedule            SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.tickets                  SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.time_entries             SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.workmanship_claims       SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.notes                    SET project_id = v_winner_id WHERE project_id = p_loser_id;
  UPDATE public.stage_history            SET project_id = v_winner_id WHERE project_id = p_loser_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ca)), '[]'::jsonb) INTO v_unmerged_ca
    FROM public.customer_accounts ca WHERE ca.project_id = p_loser_id;
  IF jsonb_array_length(v_unmerged_ca) > 0 THEN
    v_undo := v_undo || jsonb_build_object('unmerged_customer_accounts', v_unmerged_ca);
  END IF;

  WITH d AS (
    DELETE FROM public.project_folders
    WHERE project_id = p_loser_id
      AND EXISTS (SELECT 1 FROM public.project_folders WHERE project_id = v_winner_id)
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_project_folders', v_dropped);
  END IF;
  UPDATE public.project_folders SET project_id = v_winner_id WHERE project_id = p_loser_id;

  WITH d AS (
    DELETE FROM public.project_funding
    WHERE project_id = p_loser_id
      AND EXISTS (SELECT 1 FROM public.project_funding WHERE project_id = v_winner_id)
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_project_funding', v_dropped);
  END IF;
  UPDATE public.project_funding SET project_id = v_winner_id WHERE project_id = p_loser_id;

  WITH d AS (
    DELETE FROM public.project_readiness
    WHERE project_id = p_loser_id
      AND EXISTS (SELECT 1 FROM public.project_readiness WHERE project_id = v_winner_id)
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_project_readiness', v_dropped);
  END IF;
  UPDATE public.project_readiness SET project_id = v_winner_id WHERE project_id = p_loser_id;

  WITH d AS (
    DELETE FROM public.project_files lf
    WHERE lf.project_id = p_loser_id
      AND EXISTS (
        SELECT 1 FROM public.project_files wf
        WHERE wf.project_id = v_winner_id AND wf.file_id = lf.file_id
      )
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_project_files', v_dropped);
  END IF;
  UPDATE public.project_files SET project_id = v_winner_id WHERE project_id = p_loser_id;

  WITH d AS (
    DELETE FROM public.task_state ls
    WHERE ls.project_id = p_loser_id
      AND EXISTS (
        SELECT 1 FROM public.task_state ws
        WHERE ws.project_id = v_winner_id AND ws.task_id = ls.task_id
      )
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_task_state', v_dropped);
  END IF;
  UPDATE public.task_state SET project_id = v_winner_id WHERE project_id = p_loser_id;

  WITH d AS (
    DELETE FROM public.custom_field_values lv
    WHERE lv.project_id = p_loser_id
      AND EXISTS (
        SELECT 1 FROM public.custom_field_values wv
        WHERE wv.project_id = v_winner_id AND wv.field_id = lv.field_id
      )
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_custom_field_values', v_dropped);
  END IF;
  UPDATE public.custom_field_values SET project_id = v_winner_id WHERE project_id = p_loser_id;

  WITH d AS (
    DELETE FROM public.project_documents ld
    WHERE ld.project_id = p_loser_id
      AND EXISTS (
        SELECT 1 FROM public.project_documents wd
        WHERE wd.project_id = v_winner_id AND wd.requirement_id = ld.requirement_id
      )
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_project_documents', v_dropped);
  END IF;
  UPDATE public.project_documents SET project_id = v_winner_id WHERE project_id = p_loser_id;

  WITH d AS (
    DELETE FROM public.task_due_dates ld
    WHERE ld.project_id = p_loser_id
      AND EXISTS (
        SELECT 1 FROM public.task_due_dates wd
        WHERE wd.project_id = v_winner_id AND wd.task_id = ld.task_id
      )
    RETURNING *
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO v_dropped FROM d;
  IF jsonb_array_length(v_dropped) > 0 THEN
    v_undo := v_undo || jsonb_build_object('dropped_task_due_dates', v_dropped);
  END IF;
  UPDATE public.task_due_dates SET project_id = v_winner_id WHERE project_id = p_loser_id;

  -- Bypass projects_block_direct_stage_update trigger for this transaction.
  -- Same flag set_project_stage uses; valid because we're inside a service-role
  -- merge RPC that's the canonical loser-archive path.
  PERFORM set_config('app.via_set_project_stage', 'true', true);

  UPDATE public.projects
  SET
    disposition         = 'Merged-Duplicate',
    stage               = NULL,
    dup_review_pending  = false,
    contract            = NULL,
    systemkw            = NULL,
    module_qty          = NULL,
    inverter_qty        = NULL,
    battery_qty         = NULL,
    blocker             = COALESCE(blocker, '') || ' [merged into ' || v_winner_id || ' on ' || now()::date || ' by ' || p_actor_email || ']'
  WHERE id = p_loser_id;

  INSERT INTO public.dup_review_log (action, loser_id, winner_id, actor_email, undo_payload)
  VALUES ('merge', p_loser_id, v_winner_id, p_actor_email, v_undo)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.atlas_dup_review_merge(text, text) TO service_role;
