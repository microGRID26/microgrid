-- Migration 225 — audit_log AFTER trigger for DB-admin bypass on stage + use_sld_v2.
-- Closes greg_actions #1053 (R1 finding from migrations 223 + 224).
--
-- Context:
--   Migrations 223 + 224 give DB-admin connection roles (postgres,
--   supabase_admin, service_role) a "Bypass A" route through the
--   stage + use_sld_v2 BEFORE UPDATE triggers, so corrections and
--   migrations can land. Side effect: those bypass UPDATEs leave ZERO
--   audit trail — stage_history never gets a row, audit_log never gets
--   a row. Real-world risk: Greg corrects a project stage in MCP at
--   2am, support asks two weeks later "why did this skip survey?" and
--   no record exists.
--
-- Design:
--   New AFTER UPDATE trigger on public.projects. Discriminates on
--   session_user (NOT current_user — same rationale as 223/224, this is
--   a SECURITY DEFINER function and current_user returns owner=postgres
--   for every caller). Only logs when session_user is in the DB-admin
--   bypass allowlist AND a watched column actually changed.
--
--   Watched columns: stage, stage_date, use_sld_v2.
--
--   Double-log guard for stage / stage_date:
--     The set_project_stage RPC sets transaction-local GUC
--     'app.via_set_project_stage' = 'true' before its UPDATE, and writes
--     its OWN audit_log row at the end. When the RPC is invoked from a
--     DB-admin session (session_user='postgres'), our AFTER trigger
--     would otherwise double-log alongside the RPC's audit row. Gate
--     stage/stage_date logging on the GUC being absent.
--
--   No such RPC governs use_sld_v2 — always log when DB-admin path
--   touched it.
--
--   Attribution: changed_by='db-admin', changed_by_id=session_user,
--   reason='direct UPDATE bypass (mig 223/224 bypass A)'.
--   audit_log_resolve_actor (mig 214 BEFORE INSERT trigger) returns NEW
--   unchanged when auth.uid() IS NULL, so our attribution survives the
--   spoof-prevention layer. DB-admin connections have no JWT, so
--   auth.uid() is reliably NULL on this code path.
--
--   Acknowledged out-of-scope: this trigger records HONEST DB-admin
--   activity. A malicious DB-admin can still self-bypass (e.g.
--   `SELECT set_config('app.via_set_project_stage','true',true);
--    UPDATE projects SET stage='X' WHERE ...`). Defending the same
--   trust principal we're recording requires out-of-band logging
--   (logical replication to a separate audit DB, or REVOKE UPDATE on
--   audit_log + append-only seal). Tracked as greg_actions follow-up
--   (audit_log tamper-resistance).
--
-- Smoke tests (will be live-run post-apply via Supabase MCP):
--   T1: SET LOCAL SESSION AUTHORIZATION authenticator;
--       SET LOCAL ROLE authenticated;
--       UPDATE projects SET use_sld_v2 = NOT use_sld_v2 WHERE id = ...
--       -> 42501 from BEFORE trigger; no audit_log row from AFTER trigger.
--   T2: postgres direct UPDATE projects SET use_sld_v2 = NOT ... WHERE id = 'PROJ-32115'
--       -> succeeds; audit_log row with field='use_sld_v2',
--          changed_by='db-admin', changed_by_id='postgres'.
--   T3: postgres direct UPDATE projects SET stage = 'evaluation' WHERE id = 'PROJ-32115'
--       (with the existing stage='evaluation' so no-op) — should NOT log
--       (column didn't change).
--   T4: postgres SELECT set_project_stage(...) (RPC path)
--       -> 1 audit_log row from the RPC; AFTER trigger sees the GUC and
--          does NOT add a second row.
--   T5: postgres direct UPDATE stage from 'evaluation' to 'survey' (no GUC)
--       -> succeeds; audit_log row with field='stage',
--          changed_by='db-admin', changed_by_id='postgres'.

CREATE OR REPLACE FUNCTION public.projects_log_db_admin_bypass()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session text := session_user::text;
  v_via_rpc boolean := current_setting('app.via_set_project_stage', true) IS NOT DISTINCT FROM 'true';
BEGIN
  -- Only audit the DB-admin bypass path. JWT/auth-mediated UPDATEs are
  -- traceable via auth logs + the JWT itself; the SECURITY DEFINER bypass
  -- is the silent one.
  IF v_session NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  -- Consume the via-RPC flag so a follow-up direct UPDATE in the same
  -- transaction can't free-ride the RPC's audit row (red-teamer R1 M1
  -- 2026-05-13). set_project_stage writes its own audit row and always
  -- targets one project — after this trigger fires for that row the
  -- flag has done its job. Unconditional clear is a no-op when the
  -- flag wasn't set.
  PERFORM set_config('app.via_set_project_stage', '', true);

  -- stage (governed by set_project_stage RPC — skip if that RPC drove this UPDATE).
  IF (NEW.stage IS DISTINCT FROM OLD.stage) AND NOT v_via_rpc THEN
    INSERT INTO public.audit_log (
      project_id, field, old_value, new_value, changed_by, changed_by_id, reason
    ) VALUES (
      NEW.id,
      'stage',
      OLD.stage,
      NEW.stage,
      'db-admin',
      v_session,
      'direct UPDATE bypass (mig 223 bypass A)'
    );
  END IF;

  -- stage_date (also gated by mig 223 BEFORE trigger; mirror the RPC-path skip).
  IF (NEW.stage_date IS DISTINCT FROM OLD.stage_date) AND NOT v_via_rpc THEN
    INSERT INTO public.audit_log (
      project_id, field, old_value, new_value, changed_by, changed_by_id, reason
    ) VALUES (
      NEW.id,
      'stage_date',
      OLD.stage_date,
      NEW.stage_date,
      'db-admin',
      v_session,
      'direct UPDATE bypass (mig 223 bypass A)'
    );
  END IF;

  -- use_sld_v2 (no governing RPC; always log DB-admin path).
  IF (NEW.use_sld_v2 IS DISTINCT FROM OLD.use_sld_v2) THEN
    INSERT INTO public.audit_log (
      project_id, field, old_value, new_value, changed_by, changed_by_id, reason
    ) VALUES (
      NEW.id,
      'use_sld_v2',
      COALESCE(OLD.use_sld_v2::text, 'NULL'),
      COALESCE(NEW.use_sld_v2::text, 'NULL'),
      'db-admin',
      v_session,
      'direct UPDATE bypass (mig 224 bypass A)'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_log_db_admin_bypass_trg ON public.projects;

CREATE TRIGGER projects_log_db_admin_bypass_trg
AFTER UPDATE OF stage, stage_date, use_sld_v2 ON public.projects
FOR EACH ROW
EXECUTE FUNCTION public.projects_log_db_admin_bypass();

-- Postcondition asserts (R1 sweep pattern from mig 223/224 commit 3).
-- Fail the apply if any of the load-bearing invariants are missing.
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
  FROM pg_proc
  WHERE proname = 'projects_log_db_admin_bypass'
    AND pronamespace = 'public'::regnamespace;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'mig 225 postcondition: function projects_log_db_admin_bypass not created';
  END IF;

  IF v_body !~ 'session_user' THEN
    RAISE EXCEPTION 'mig 225 postcondition: function body missing session_user discriminator';
  END IF;

  IF v_body !~ 'app\.via_set_project_stage' THEN
    RAISE EXCEPTION 'mig 225 postcondition: function body missing app.via_set_project_stage double-log guard';
  END IF;

  IF v_body !~ 'use_sld_v2' THEN
    RAISE EXCEPTION 'mig 225 postcondition: function body missing use_sld_v2 case';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'projects_log_db_admin_bypass_trg'
      AND tgrelid = 'public.projects'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'mig 225 postcondition: trigger projects_log_db_admin_bypass_trg not attached to public.projects';
  END IF;
END;
$$;
