-- NORAD R3 (codebase-maturity v1.47, 2026-05-15 general-purpose) closed the
-- live exposure of the atlas_shared_kb_* confused-deputy on prod (mig 329).
-- Two latent risks remained after R3:
--
--   1. Migrations 174 + 178 still ship `GRANT ... TO authenticated, service_role`
--      on disk. Mig 329's REVOKE patches the deployed DB only. Any fresh DB
--      branch / replay re-introduces the GRANT, and the confused-deputy is
--      back until somebody re-runs 329.
--   2. Mig 178's `atlas_shared_kb_revisions_for(uuid, text)` is missing from
--      mig 329's revoke list. Currently not deployed (live pg_proc shows zero
--      matches), but if 178 is ever re-applied, this function is granted to
--      `authenticated` and is NOT in 329's revoke set — silent re-exposure
--      of an 8th family member.
--
-- This migration is the idempotent backstop: a DO-block loop that revokes
-- EXECUTE from authenticated/anon/PUBLIC on every existing atlas_shared_kb_*
-- function (excluding the trigger fn touch_updated_at, which is not callable
-- as an RPC anyway). Safe to re-apply; safe to land before or after the
-- target functions exist; idempotent against future re-creates of mig 178.
--
-- Service_role + postgres retain EXECUTE — those are the legitimate callers
-- (atlas_kb.py via SUPABASE_SERVICE_ROLE_KEY).

-- Predicate is LIKE-pattern, not IN-list, so future atlas_shared_kb_* siblings
-- (e.g. _delete / _archive / _bulk_write) inherit the lockdown automatically.
-- prokind='f' excludes aggregates/procedures; pg_trigger NOT EXISTS excludes
-- trigger fns (today: atlas_shared_kb_touch_updated_at — not RPC-callable).
DO $$
DECLARE
  fn_signature text;
BEGIN
  FOR fn_signature IN
    SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'atlas_shared_kb_%'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated, anon, PUBLIC', fn_signature);
  END LOOP;
END $$;
