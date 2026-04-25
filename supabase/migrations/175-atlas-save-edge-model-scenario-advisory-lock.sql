-- 175: close the 100-scenarios-per-user race in atlas_save_edge_model_scenario
-- greg_actions #295 follow-up. Red-team finding 2026-04-25 (HIGH).
--
-- Migration 170 added the per-user count cap but used a non-locking
-- `SELECT count(*)` followed by INSERT. A user firing concurrent POSTs all
-- read count=99, all insert -> caps blown. Fix: tx-level advisory lock keyed
-- on auth.uid() so concurrent inserts serialize.

CREATE OR REPLACE FUNCTION public.atlas_save_edge_model_scenario(
  p_id uuid,
  p_name text,
  p_config_version text,
  p_config jsonb,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_existing_locked boolean;
  v_existing_owner uuid;
  v_owner_count int;
  v_max_size_bytes int := 256 * 1024;
  v_max_scenarios_per_user int := 100;
BEGIN
  IF p_config IS NOT NULL AND pg_column_size(p_config) > v_max_size_bytes THEN
    RAISE EXCEPTION 'atlas_save_edge_model_scenario: p_config exceeds % bytes', v_max_size_bytes
      USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    -- Serialize concurrent inserts from the same user so the count + insert
    -- pair is atomic. Lock is per-user so unrelated users don't queue.
    PERFORM pg_advisory_xact_lock(hashtext('atlas_save_edge_model_scenario:' || coalesce(auth.uid()::text, 'anon')));

    SELECT count(*) INTO v_owner_count
      FROM public.edge_model_scenarios
     WHERE owner_id = auth.uid();

    IF v_owner_count >= v_max_scenarios_per_user THEN
      RAISE EXCEPTION 'atlas_save_edge_model_scenario: per-user scenario cap (%) reached', v_max_scenarios_per_user
        USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.edge_model_scenarios (
      owner_id, name, config_version, config, notes
    ) VALUES (
      auth.uid(), p_name, p_config_version, p_config, p_notes
    )
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  SELECT is_locked, owner_id
    INTO v_existing_locked, v_existing_owner
    FROM public.edge_model_scenarios
   WHERE id = p_id;

  IF v_existing_owner IS NULL THEN
    RAISE EXCEPTION 'scenario_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_existing_owner <> auth.uid() THEN
    RAISE EXCEPTION 'scenario_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_existing_locked THEN
    RAISE EXCEPTION 'scenario_locked' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.edge_model_scenarios
     SET name = p_name,
         config_version = p_config_version,
         config = p_config,
         notes = p_notes,
         updated_at = now()
   WHERE id = p_id;

  RETURN p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.atlas_save_edge_model_scenario(uuid, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.atlas_save_edge_model_scenario(uuid, text, text, jsonb, text) TO authenticated, service_role;
