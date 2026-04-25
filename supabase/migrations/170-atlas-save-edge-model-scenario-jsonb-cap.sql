-- 170: cap atlas_save_edge_model_scenario p_config size + per-user row limit
-- greg_actions #295 (P2 part 1). Audit-rotation 2026-04-25 / security-definer-rpcs.
--
-- Prior body accepted unbounded jsonb. An authenticated user could spam 9MB
-- scenarios and bloat edge_model_scenarios. This adds:
--   * 256 KB cap on p_config (pg_column_size)
--   * 100 scenarios/user soft cap on insert path (update path unaffected)

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
  v_max_size_bytes int := 256 * 1024;     -- 256 KB
  v_max_scenarios_per_user int := 100;
BEGIN
  -- size cap (applies to both insert + update paths)
  IF p_config IS NOT NULL AND pg_column_size(p_config) > v_max_size_bytes THEN
    RAISE EXCEPTION 'atlas_save_edge_model_scenario: p_config exceeds % bytes', v_max_size_bytes
      USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    -- insert: enforce per-user row cap
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

COMMENT ON FUNCTION public.atlas_save_edge_model_scenario(uuid, text, text, jsonb, text) IS
  '256KB jsonb cap + 100 scenarios/user. Hardened in migration 170 (greg_actions #295 part 1).';
