-- Migration 226 — audit_log append-only seal (BEFORE UPDATE/DELETE trigger).
-- Closes greg_actions #1059 (R1 red-teamer Low on mig 225, 2026-05-13 evening).
--
-- Context:
--   Mig 225 added an AFTER UPDATE trigger on public.projects that writes
--   an audit_log row whenever a DB-admin trust principal (postgres /
--   supabase_admin / service_role) directly UPDATEs stage / stage_date /
--   use_sld_v2. That closes the silent-paper-trail gap for honest
--   DB-admin activity.
--
--   It does NOT defend against tampering: the same DB-admin trust
--   principals can post-mutate or DELETE the rows mig 225 just wrote.
--   audit_log has rls_forced=false and owner=postgres, plus no
--   UPDATE/DELETE policies — RLS doesn't apply to the table owner here
--   and service_role bypasses RLS by design. So:
--
--     UPDATE public.audit_log SET reason = 'nothing happened'
--       WHERE id = (SELECT id FROM public.audit_log ORDER BY id DESC LIMIT 1);
--     DELETE FROM public.audit_log WHERE changed_by = 'db-admin';
--
--   both succeed today for the same operators whose actions mig 225
--   records. The protection is theoretical.
--
-- Design:
--   New BEFORE UPDATE OR DELETE trigger on public.audit_log. Function
--   checks a transaction-local GUC `app.audit_log_admin_purge`. If
--   present and set to 'true' (NULL-safe match via IS NOT DISTINCT FROM,
--   not =), the UPDATE/DELETE is allowed. Otherwise the trigger raises
--   42501 (insufficient_privilege).
--
--   Setting the GUC requires a deliberate, in-band statement:
--     SET LOCAL app.audit_log_admin_purge = 'true';
--   which is itself recorded in the txn the operator is running, and a
--   reviewer of the session history can see the intent gate fire. This
--   is the standard "explicit purge mode" pattern.
--
--   INSERT path is untouched — mig 214's BEFORE INSERT trigger
--   (audit_log_resolve_actor) continues to fire, and the AFTER trigger
--   from mig 225 continues to write its 3 audit rows per DB-admin path
--   UPDATE on projects.
--
-- GUC name:
--   `app.audit_log_admin_purge` — under the `app.*` namespace used by
--   `app.via_set_project_stage` (mig 225) / `app.user_org_ids` /
--   `app.is_platform_user`. No collision with existing GUCs.
--
-- Retention/purge compatibility:
--   No code path in the repo (route handlers, scripts, migrations) does
--   `UPDATE audit_log` or `DELETE FROM audit_log` today. If a retention
--   pruner is added later, it must `SET LOCAL app.audit_log_admin_purge
--   = 'true'` at the start of its transaction.
--
-- Smoke tests (will be live-run post-apply via Supabase MCP):
--   T1: As postgres, UPDATE audit_log SET reason='tamper' WHERE id=X
--       -> 42501 from BEFORE trigger (no row mutated). BEGIN/ROLLBACK.
--   T2: As postgres, DELETE FROM audit_log WHERE id=X
--       -> 42501 from BEFORE trigger (no row deleted). BEGIN/ROLLBACK.
--   T3: As postgres, SET LOCAL app.audit_log_admin_purge='true';
--       UPDATE audit_log SET reason='retention' WHERE id=X
--       -> succeeds. BEGIN/ROLLBACK.
--   T4: Regression — INSERT INTO audit_log (...) still works for the
--       AFTER trigger from mig 225 and any other inserter. BEFORE
--       UPDATE/DELETE doesn't fire on INSERT.

CREATE OR REPLACE FUNCTION public.audit_log_block_admin_tamper()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purge_authorized boolean := current_setting('app.audit_log_admin_purge', true) IS NOT DISTINCT FROM 'true';
BEGIN
  IF v_purge_authorized THEN
    -- Deliberate purge mode. Allow the operation. RETURN OLD for DELETE,
    -- NEW for UPDATE — the BEFORE trigger contract.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- No purge GUC set. This is tamper attempt.
  -- 42501 = insufficient_privilege. Same SQLSTATE the mig 223/224 BEFORE
  -- triggers raise on direct stage/use_sld_v2 UPDATE attempts.
  RAISE EXCEPTION
    'audit_log is append-only. Set app.audit_log_admin_purge=''true'' in this txn to authorize a deliberate purge. TG_OP=%, audit_log.id=%',
    TG_OP,
    COALESCE(OLD.id::text, 'unknown')
  USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_block_admin_tamper_trg ON public.audit_log;

CREATE TRIGGER audit_log_block_admin_tamper_trg
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.audit_log_block_admin_tamper();

-- Defense in depth (R1 red-teamer M1 fold, 2026-05-14): revoke direct
-- EXECUTE from end-user roles. Trigger invocation by the table owner
-- uses owner privileges and is unaffected; only direct SELECT-style
-- function calls are blocked. mig 223/224/225 didn't do this — flag for
-- a hygiene pass to backport.
REVOKE EXECUTE ON FUNCTION public.audit_log_block_admin_tamper() FROM PUBLIC, anon, authenticated;

-- Postcondition asserts (R1 sweep pattern from mig 223/224/225).
-- Fail the apply if any of the load-bearing invariants are missing.
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
  FROM pg_proc
  WHERE proname = 'audit_log_block_admin_tamper'
    AND pronamespace = 'public'::regnamespace;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'mig 226 postcondition: function audit_log_block_admin_tamper not created';
  END IF;

  IF v_body !~ 'app\.audit_log_admin_purge' THEN
    RAISE EXCEPTION 'mig 226 postcondition: function body missing app.audit_log_admin_purge GUC gate';
  END IF;

  IF v_body !~ 'IS NOT DISTINCT FROM' THEN
    RAISE EXCEPTION 'mig 226 postcondition: function body missing NULL-safe IS NOT DISTINCT FROM check (= would be falsy on NULL)';
  END IF;

  IF v_body !~ '42501' THEN
    RAISE EXCEPTION 'mig 226 postcondition: function body missing SQLSTATE 42501 (insufficient_privilege)';
  END IF;

  -- Pin BEFORE timing bit (tgtype & 2)<>0 AND tgenabled='O' enabled.
  -- R1 red-teamer M2 fold (2026-05-14): without this, an ad-hoc
  -- `ALTER TABLE audit_log DISABLE TRIGGER ...` by postgres would
  -- silently neuter the seal and the static test wouldn't catch it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'audit_log_block_admin_tamper_trg'
      AND tgrelid = 'public.audit_log'::regclass
      AND NOT tgisinternal
      AND (tgtype & 2) <> 0           -- BEFORE
      AND tgenabled = 'O'              -- enabled (origin + local writes)
  ) THEN
    RAISE EXCEPTION 'mig 226 postcondition: trigger audit_log_block_admin_tamper_trg not attached to public.audit_log as BEFORE+enabled';
  END IF;
END;
$$;
