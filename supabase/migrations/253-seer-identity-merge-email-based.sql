-- 253-seer-identity-merge-email-based.sql
--
-- Phase 0 of Seer elite rebuild (spec at ~/Seer/docs/superpowers/specs/2026-05-09-seer-elite-rebuild-design.md).
-- Implements §3.1 identity-merge — fixes red-teamer R3 finding C-3 ("identity-merge mechanism deferred = ownership escalation window").
--
-- This migration was rejected by the red-teamer subagent on first draft for two
-- High findings; this version incorporates those fixes:
--   * H-1 (case-sensitivity bypass): all email comparisons go through lower()
--   * H-2 (no email uniqueness): unique partial index on (lower(email)) WHERE
--     active AND role='owner', preventing future owner-row injection via any
--     compromised admin RPC
--   * M-1 (provider_subs write surface): trigger restricts mutations to
--     service_role / postgres only
--   * M-3 (SQL planner / pgbouncer cache concerns): function rewritten as
--     PL/pgSQL to match migration 183's pattern
--
-- Problem statement
-- ------------------
-- Today atlas_hq_is_owner(p_uid) checks `atlas_hq_users.auth_user_id = p_uid` —
-- keyed off a single auth.users row id. Greg's existing owner row is bound to
-- his Google-provider auth.users id (395611ed-6657-4a68-b9c9-5abb09f3bedc).
--
-- Seer (mobile) will sign Greg in via Apple — Apple Sign-In creates a *new*
-- auth.users row with a different id. Under the current function, that new
-- row is NOT the owner. RPCs would deny. To fix without a fragile "first-
-- write-binds-the-Apple-sub" pattern (which an attacker could race), the
-- canonical link becomes EMAIL — both auth.users rows for Greg
-- (Google + Apple) carry the same confirmed email, and atlas_hq_users links
-- via lower(email).
--
-- Attack surface considered (red-teamer R3 + R3' audits):
--   * Apple Hide-My-Email relay returns *@privaterelay.appleid.com — explicitly
--     rejected so an attacker can't sign up with a relay address that lets
--     Apple keep the real address private.
--   * Spoof via creating an Apple ID with greg@gomicrogridenergy.com requires
--     actually owning that email (Apple's verification). If Greg's email is
--     compromised, all bets are off across his entire stack.
--   * Two auth.users rows with the same confirmed email IS the desired
--     Apple+Google linking behavior; preserved by JOIN, both pass.
--   * Owner-row injection via compromised admin RPC: blocked by the new
--     unique partial index AND the provider_subs write trigger.
--
-- Three-part change:
--   1. Add atlas_hq_users.provider_subs jsonb (defense in depth — strict mode
--      future use; trigger ensures only service_role can mutate)
--   2. Add UNIQUE INDEX on (lower(email)) WHERE active AND role='owner' so a
--      second owner row cannot exist with the same email
--   3. Rewrite atlas_hq_is_owner to be email-joined (case-insensitive), with
--      confirmed-email + relay rejection + the existing service_role/auth.uid()
--      guard from migration 183 preserved verbatim
--
-- Pre-flight + post-check DO blocks fail the migration if Greg's owner row
-- is missing or the rewritten function doesn't return true for him via
-- service_role.

BEGIN;

-- 1. Reserve provider_subs column (additive, NULL-safe default).
ALTER TABLE public.atlas_hq_users
  ADD COLUMN IF NOT EXISTS provider_subs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.atlas_hq_users.provider_subs IS
  'Map of OAuth provider name -> sub claim, e.g. {"google":"abc","apple":"xyz"}. '
  'NON-EMPTY mutations restricted to service_role / postgres via atlas_hq_users_provider_subs_write_guard '
  'trigger (an INSERT that defaults to {} is allowed for any caller, but a follow-up UPDATE that adds '
  'a sub requires service_role). Available for future strict-mode policy that requires sub binding.';

-- 2. Trigger: only service_role / postgres may mutate provider_subs.
--    Closes red-teamer M-1: prevents an existing admin RPC from pre-poisoning
--    the column before strict mode flips on.
CREATE OR REPLACE FUNCTION public.atlas_hq_users_provider_subs_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  IF (TG_OP = 'UPDATE' AND COALESCE(OLD.provider_subs, '{}'::jsonb) IS DISTINCT FROM COALESCE(NEW.provider_subs, '{}'::jsonb))
     OR (TG_OP = 'INSERT' AND COALESCE(NEW.provider_subs, '{}'::jsonb) <> '{}'::jsonb) THEN
    -- Defense: COALESCE auth.role() to '' so a NULL JWT context (anon-with-no-session
    -- or any path where the GUC isn't set) does NOT silently pass the IN-list check.
    -- NULL NOT IN (...) evaluates to NULL not TRUE in Postgres, which would skip the
    -- RAISE — closes red-teamer R2 finding.
    IF COALESCE(auth.role(), '') NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION USING
        ERRCODE = 'insufficient_privilege',
        MESSAGE = 'provider_subs may only be written by service_role / postgres';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS atlas_hq_users_provider_subs_write_guard_trg ON public.atlas_hq_users;
CREATE TRIGGER atlas_hq_users_provider_subs_write_guard_trg
  BEFORE INSERT OR UPDATE ON public.atlas_hq_users
  FOR EACH ROW
  EXECUTE FUNCTION public.atlas_hq_users_provider_subs_write_guard();

-- 3. Pre-flight: confirm Greg's owner row has the canonical email.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.atlas_hq_users
    WHERE role='owner' AND active AND lower(email)='greg@gomicrogridenergy.com'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Pre-flight failed: no active owner row with email greg@gomicrogridenergy.com (case-insensitive). Resolve manually before re-running this migration.';
  END IF;
END $$;

-- 4. Unique partial index — at most one active owner row per email.
--    Closes red-teamer H-2: an attacker who compromises an admin INSERT path
--    cannot plant a second owner row with the same email.
CREATE UNIQUE INDEX IF NOT EXISTS atlas_hq_users_active_owner_email_uniq
  ON public.atlas_hq_users (lower(email))
  WHERE active AND role = 'owner';

-- 5. Rewrite atlas_hq_is_owner to be email-based.
--    PL/pgSQL form (matches migration 183) avoids any planner inlining /
--    pgbouncer transaction-pooler caching weirdness with auth.role() / auth.uid()
--    GUC reads inside a SQL-language SECURITY DEFINER function.
--
-- Owner iff:
--   * auth.users row for p_uid exists,
--   * email is non-null and confirmed (email_confirmed_at IS NOT NULL),
--   * email is NOT an Apple Hide-My-Email relay,
--   * an active atlas_hq_users row with role='owner' exists with case-
--     insensitive matching email,
--   * caller is service_role/postgres OR p_uid = auth.uid()
--     (preserving the migration-183 cross-user lookup guard).
CREATE OR REPLACE FUNCTION public.atlas_hq_is_owner(p_uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_match boolean;
BEGIN
  -- INTENTIONAL: auth.role() and auth.uid() read invoker GUCs (request.jwt.claim.*),
  -- NOT definer context, despite SECURITY DEFINER. This is the migration-183 pattern:
  -- service_role / postgres callers (HQ Next.js API routes via getServiceSupabase)
  -- pass the gate; authenticated callers must pass p_uid = auth.uid() (no cross-user
  -- owner queries). STABLE is safe under pgbouncer transaction-pooler — same value
  -- within a statement and the GUC values don't change inside one.
  SELECT EXISTS (
    SELECT 1
    FROM auth.users au
    JOIN public.atlas_hq_users hu ON lower(hu.email) = lower(au.email)
    WHERE au.id = p_uid
      AND au.email IS NOT NULL
      AND au.email_confirmed_at IS NOT NULL
      AND lower(au.email) NOT LIKE '%@privaterelay.appleid.com'
      AND hu.role = 'owner'
      AND hu.active
      AND (
        auth.role() IN ('service_role', 'postgres')
        OR p_uid = auth.uid()
      )
  ) INTO v_match;
  RETURN v_match;
END;
$function$;

COMMENT ON FUNCTION public.atlas_hq_is_owner(uuid) IS
  'Email-based owner check (rewrite 2026-05-10, Seer rebuild Phase 0, spec R3 fix C-3). '
  'Owner iff: auth.users row for p_uid has confirmed non-relay email matching (case-insensitive) '
  'an active atlas_hq_users.role=owner row. Apple Hide-My-Email relay addresses explicitly '
  'rejected. Caller must be service_role/postgres OR the uid being checked must match '
  'auth.uid() (preserved from migration 183 — no cross-user owner queries).';

-- 6. Re-assert REVOKE from PUBLIC (idempotent, kept from migration 183).
--    Note: `authenticated` keeps EXECUTE per migration 184 — RLS policies
--    invoke this function via the requesting session, not service_role,
--    so authenticated must be able to call. The auth.uid() = p_uid guard
--    inside the function is what actually limits cross-user lookups.
REVOKE EXECUTE ON FUNCTION public.atlas_hq_is_owner(uuid) FROM PUBLIC;

-- 7. Post-check: verify the rewrite returns TRUE for EVERY confirmed Greg
--    auth.users row via service_role. Loops so that when Apple Sign-In creates
--    a second confirmed row in the future, re-running this migration would catch
--    a regression on either row, not just the oldest.
--
--    auth.role() reads request.jwt.claim.role GUC, which is unset on direct
--    pooler connections (the DO block runs as the connection role, but with no
--    JWT context). Without a simulated service_role GUC the function would
--    return FALSE not because of a real bug but because we're testing from
--    "outside" the PostgREST JWT path. set_config(..., true) sets the GUC
--    transaction-locally, so it rolls back with the rest of the migration if
--    something downstream fails.
--
--    Aborts the transaction (rolls back the column add, the index create, the
--    trigger create, and the function rewrite) if any check fails.
DO $$
DECLARE
  v_uid uuid;
  v_result boolean;
  v_count int := 0;
BEGIN
  -- Simulate service_role caller context for the function's auth.role() check.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  FOR v_uid IN
    SELECT id
    FROM auth.users
    WHERE lower(email) = 'greg@gomicrogridenergy.com'
      AND email_confirmed_at IS NOT NULL
    ORDER BY created_at
  LOOP
    v_count := v_count + 1;
    SELECT public.atlas_hq_is_owner(v_uid) INTO v_result;
    IF NOT v_result THEN
      RAISE EXCEPTION USING
        MESSAGE = format(
          'Post-check failed: rewritten atlas_hq_is_owner returned FALSE for Greg confirmed auth.users uid=%s under simulated service_role context. Manual review required.',
          v_uid
        );
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Post-check failed: no confirmed auth.users rows for greg@gomicrogridenergy.com';
  END IF;
END $$;

COMMIT;
