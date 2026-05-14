-- Migration 227 — REVOKE EXECUTE backport on mig 222b/223/224/225 SECDEF trigger functions.
-- Closes greg_actions #1069 (sister R1 finding from mig 226 red-teamer, 2026-05-14).
--
-- Context:
--   Mig 226 (audit_log_block_admin_tamper) shipped earlier this session
--   with a name-bound REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated
--   so the function couldn't be called directly via SELECT
--   public.audit_log_block_admin_tamper(). The R1 red-teamer flagged
--   that the four sister SECURITY DEFINER trigger functions from the
--   prior week's migrations have the same gap.
--
-- Functions getting REVOKEd (all SECDEF, all trigger functions, all
-- in public schema):
--   - mig 222b: projects_block_direct_use_sld_v2_update (initial fix)
--   - mig 223:  projects_block_direct_stage_update (current)
--   - mig 224:  projects_block_direct_use_sld_v2_update (current)
--   - mig 225:  projects_log_db_admin_bypass
--
-- Why backport these.
--   Postgres' default `CREATE FUNCTION` grants EXECUTE to PUBLIC. With
--   SECURITY DEFINER that means any logged-in user can call the function
--   with the function-owner's privileges. For these four functions the
--   actual exploit is small — they're trigger functions, invoked by
--   Postgres with NULL OLD/NEW when called directly, raising or no-op'ing
--   without persistent effect. But the discoverable surface is real, the
--   fix is one line per function, and consistency with mig 226's pattern
--   matters for the rest of the chain's hardening posture.
--
-- Trigger invocation impact: ZERO. Postgres invokes trigger functions
-- with the table owner's privileges, ignoring EXECUTE grants on the
-- function itself. The BEFORE/AFTER triggers on projects + audit_log
-- continue to fire on every UPDATE / INSERT / DELETE as before.
--
-- Idempotency: REVOKE on a role that doesn't have the grant is a no-op
-- (no error). Safe to re-apply.

REVOKE EXECUTE ON FUNCTION public.projects_block_direct_use_sld_v2_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projects_block_direct_stage_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projects_log_db_admin_bypass() FROM PUBLIC, anon, authenticated;

-- Postcondition: assert each ACL no longer contains PUBLIC / anon /
-- authenticated. proacl is NULL when the function has the default ACL
-- (which IS the bug we're fixing), so we expect non-NULL post-REVOKE.
-- Match on the raw ACL text — looking for the absence of a literal
-- 'anon=', 'authenticated=', or starting '=' (PUBLIC grants render
-- without a role name before the '=').
DO $$
DECLARE
  v_acl text;
  v_fn  text;
  v_offenders text[] := ARRAY[]::text[];
BEGIN
  FOR v_fn IN
    SELECT unnest(ARRAY[
      'projects_block_direct_use_sld_v2_update',
      'projects_block_direct_stage_update',
      'projects_log_db_admin_bypass'
    ])
  LOOP
    SELECT proacl::text INTO v_acl
    FROM pg_proc
    WHERE proname = v_fn
      AND pronamespace = 'public'::regnamespace;

    IF v_acl IS NULL THEN
      -- Default ACL = PUBLIC has EXECUTE. REVOKE didn't take effect.
      v_offenders := array_append(v_offenders, v_fn || ' (NULL acl — default PUBLIC grant intact)');
    ELSIF v_acl ~ '\banon=' OR v_acl ~ '\bauthenticated=' OR v_acl ~ '\{=' OR v_acl ~ ',=' THEN
      v_offenders := array_append(v_offenders, v_fn || ' (acl=' || v_acl || ')');
    END IF;
  END LOOP;

  IF array_length(v_offenders, 1) > 0 THEN
    RAISE EXCEPTION 'mig 227 postcondition: % function(s) still have PUBLIC/anon/authenticated EXECUTE: %',
      array_length(v_offenders, 1), array_to_string(v_offenders, '; ');
  END IF;
END;
$$;
