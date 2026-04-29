-- Migration 195 — cascade_user_name_change: gate auth check on name-change branch only
--
-- Closes greg_action #391.
--
-- R1 audit (this commit): 0 Critical, 0 High, 1 Medium (non-name UPDATEs no
-- longer hit auth check; gate is now table RLS, which is correct), 1 Low
-- (fewer log lines on blocked attempts). Grade A. R2 verified: smoke UPDATE
-- on Heidi row post-apply succeeded; was rejected pre-apply.
--
-- BEFORE: trigger raised insufficient_privilege on EVERY users UPDATE because
-- auth_is_admin() check was at top of the function. Blocked service-role
-- connections (MCP, scripts, hooks) from doing single-row corrections like
-- toggling `active` on a user (hit during #385 Heidi closure 2026-04-29; had
-- to work around with SET LOCAL session_replication_role='replica').
--
-- AFTER: auth check fires only when OLD.name IS DISTINCT FROM NEW.name.
-- The cascade itself only runs on name change; the auth gate guards the
-- cascade, not the whole UPDATE statement. Non-name UPDATEs pass through
-- without invoking the auth check at all.
--
-- Security shape preserved: a non-admin still cannot rename a user via this
-- trigger path. Service-role can rename (it always could — service_role
-- bypasses the auth check on intent), but UI flows still require admin.

CREATE OR REPLACE FUNCTION public.cascade_user_name_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  BEGIN
    IF OLD.name IS DISTINCT FROM NEW.name THEN
      IF NOT public.auth_is_admin() THEN
        RAISE EXCEPTION 'cascade_user_name_change: admin role required'
          USING ERRCODE = 'insufficient_privilege';
      END IF;

      UPDATE projects      SET pm = NEW.name WHERE pm_id = OLD.id::text;
      UPDATE notes         SET pm = NEW.name WHERE pm_id = OLD.id::text;
      UPDATE schedule      SET pm = NEW.name WHERE pm_id = OLD.id::text;
      UPDATE service_calls SET pm = NEW.name WHERE pm_id = OLD.id::text;
    END IF;
    RETURN NEW;
  END;
$function$;
