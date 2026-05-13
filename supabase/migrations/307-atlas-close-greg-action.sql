-- Migration 307: Seer Atlas Phase 3 — close_action RPC
--
-- The close_action write tool calls this RPC to mark a greg_actions row
-- closed. Tightened per H2 fix from the Phase 3 spec pre-flight reviewer:
-- the RPC filters BOTH on atlas_hq_is_owner(auth.uid()) AND on the row's
-- owner matching the caller's resolved email. This means in a multi-owner
-- future, owner A cannot close owner B's actions — only their own.
--
-- Semantics:
--   - Success → returns {closed: true, id, title, owner, closed_at}
--   - Already closed → returns {already_closed: true, id, closed_at}
--   - Owner mismatch / no owner resolvable → RAISES 42501 insufficient_privilege
--   - Row not found → RAISES P0002 no_data_found
--
-- The atlas_close_greg_action call is idempotent on already-closed rows
-- (matches the close_action tool's idempotency contract in spec §7).

BEGIN;

CREATE OR REPLACE FUNCTION public.atlas_close_greg_action(
  p_id   bigint,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_owner_email   text;
  v_row           public.greg_actions%ROWTYPE;
  v_already_closed boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth.uid() is null - close_action requires authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- Outer owner gate — must be an owner at all.
  IF NOT public.atlas_hq_is_owner(v_uid) THEN
    RAISE EXCEPTION 'caller is not an owner' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's email from atlas_hq_users. Used to scope the row filter
  -- so that owner A can never close owner B's actions in a multi-owner future.
  SELECT lower(hu.email) INTO v_owner_email
    FROM public.atlas_hq_users hu
   WHERE hu.auth_user_id = v_uid
     AND hu.role = 'owner'
     AND hu.active
   LIMIT 1;

  IF v_owner_email IS NULL THEN
    -- Could happen if owner is bound via Apple-relay provider_subs path
    -- (auth_user_id is NULL on the hq_users row). Fallback: resolve via
    -- auth.users email match.
    SELECT lower(au.email) INTO v_owner_email
      FROM auth.users au
     WHERE au.id = v_uid
       AND au.email_confirmed_at IS NOT NULL
     LIMIT 1;
  END IF;

  IF v_owner_email IS NULL THEN
    RAISE EXCEPTION 'cannot resolve caller owner email' USING ERRCODE = '42501';
  END IF;

  -- Fetch the row to determine whether already closed (for idempotency)
  SELECT * INTO v_row
    FROM public.greg_actions
   WHERE id = p_id
     AND lower(owner) = v_owner_email
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'greg_actions row % not found for owner %', p_id, v_owner_email
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status = 'done' THEN
    RETURN jsonb_build_object(
      'already_closed', true,
      'id',             v_row.id,
      'closed_at',      v_row.done_at,
      'title',          v_row.title
    );
  END IF;

  -- Mark done (the DB-enum value for "closed" per live greg_actions_status_check
  -- CHECK constraint: allowed = open|in_progress|done|skipped). The returned
  -- JSONB key `closed: true` is the tool/UI contract and stays unchanged —
  -- migration-planner R1 confirmed this is a UI-vs-DB-enum split, not a bug.
  -- Append the note to body_md if provided (preserves the original body so
  -- the row stays auditable).
  UPDATE public.greg_actions
     SET status   = 'done',
         done_at  = now(),
         body_md  = CASE
                      WHEN p_note IS NOT NULL AND length(p_note) > 0
                        THEN body_md || E'\n\n---\n**Closed by Atlas:** ' || p_note
                      ELSE body_md
                    END
   WHERE id = p_id
     AND lower(owner) = v_owner_email
     AND status = 'open'                       -- only 'open' rows are closable
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Race: row transitioned to a terminal status (done/skipped) between SELECT
    -- and UPDATE. Re-read and return already_closed (idempotent contract).
    SELECT * INTO v_row
      FROM public.greg_actions
     WHERE id = p_id AND lower(owner) = v_owner_email;
    RETURN jsonb_build_object(
      'already_closed', true,
      'id',             v_row.id,
      'closed_at',      v_row.done_at,
      'title',          v_row.title,
      'race_detected',  true
    );
  END IF;

  RETURN jsonb_build_object(
    'closed',    true,
    'id',        v_row.id,
    'title',     v_row.title,
    'owner',     v_row.owner,
    'closed_at', v_row.done_at
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.atlas_close_greg_action(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atlas_close_greg_action(bigint, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.atlas_close_greg_action(bigint, text) TO authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname='atlas_close_greg_action'
      AND pronamespace='public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'atlas_close_greg_action RPC did not get created';
  END IF;

  -- Verify SECURITY DEFINER + search_path are set
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname='atlas_close_greg_action'
      AND pronamespace='public'::regnamespace
      AND prosecdef = true
  ) THEN
    RAISE EXCEPTION 'atlas_close_greg_action: SECURITY DEFINER not set';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE specific_schema='public'
      AND routine_name='atlas_close_greg_action'
      AND grantee='authenticated'
      AND privilege_type='EXECUTE'
  ) THEN
    RAISE EXCEPTION 'atlas_close_greg_action: authenticated EXECUTE grant missing';
  END IF;

  -- anon must NOT have EXECUTE
  IF EXISTS (
    SELECT 1 FROM information_schema.role_routine_grants
    WHERE specific_schema='public'
      AND routine_name='atlas_close_greg_action'
      AND grantee IN ('anon','PUBLIC')
  ) THEN
    RAISE EXCEPTION 'atlas_close_greg_action: anon/PUBLIC must NOT have EXECUTE';
  END IF;
END $verify$;

COMMIT;
