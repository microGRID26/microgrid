-- HOTFIX for migration 223 — closes 1 Critical + 1 High found by red-team
-- audit immediately after apply.
--
-- Bug 1 (Critical) — `name` was NOT in migration 221's
-- customer_accounts_protect_columns list. Combined with the RLS
-- self-update policy, a customer could:
--   1. UPDATE customer_accounts SET name = '<housemate name>' WHERE
--      auth_user_id = auth.uid()
--   2. Trigger their own delete (in-app delete flow)
--   3. Migration 223's BEFORE DELETE trigger then scrubs the
--      housemate's customer_messages + tickets via the
--      author_name/reported_by match.
-- Fix: add `name` to the protected-columns list. Service-role + admin
-- still bypass (so support can correct typos).
--
-- Bug 2 (High) — `ticket_comments` has no `project_id` column. Migration
-- 223's legacy fallback `(author_id IS NULL AND author = OLD.name)` was
-- therefore project-unscoped: a customer named "John Smith" deleting
-- their account would scrub every legacy non-internal comment authored
-- by any "John Smith" anywhere in the database (cross-tenant wipe).
-- Fix: constrain the fallback to comments on tickets in OLD.project_id
-- via a tickets-id subquery.
--
-- Both bugs were latent in 223 — applied to prod, but no real customer
-- has hit either path yet (6 demo accounts, all internal). This hotfix
-- closes both before any customer-initiated delete is possible.

-- ── Bug 1 fix: protect customer_accounts.name from customer-driven UPDATEs ──

CREATE OR REPLACE FUNCTION public.customer_accounts_protect_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  IF coalesce(
       current_setting('request.jwt.claim.role', true),
       (current_setting('request.jwt.claims', true)::jsonb)->>'role'
     ) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'cannot change customer_accounts.id' USING ERRCODE = '42501';
  END IF;
  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION 'cannot change customer_accounts.auth_user_id' USING ERRCODE = '42501';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'cannot change customer_accounts.email' USING ERRCODE = '42501';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'cannot change customer_accounts.project_id' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'cannot change customer_accounts.status' USING ERRCODE = '42501';
  END IF;
  IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
    RAISE EXCEPTION 'cannot change customer_accounts.invited_by' USING ERRCODE = '42501';
  END IF;
  IF NEW.invited_at IS DISTINCT FROM OLD.invited_at THEN
    RAISE EXCEPTION 'cannot change customer_accounts.invited_at' USING ERRCODE = '42501';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'cannot change customer_accounts.created_at' USING ERRCODE = '42501';
  END IF;
  -- New in 224: pin name. Migration 223's PII scrub keys on
  -- customer_messages.author_name = customer_accounts.name and
  -- tickets.reported_by = customer_accounts.name; if a customer can
  -- rename themselves to a housemate's name pre-delete, the scrub
  -- attacks the wrong rows. Pin it.
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'cannot change customer_accounts.name' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Bug 2 fix: project-scope the ticket_comments legacy fallback ──

CREATE OR REPLACE FUNCTION public.customer_account_scrub_on_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  -- 1. customer_messages — already project-scoped, no change.
  UPDATE public.customer_messages
     SET author_name = 'Deleted user',
         message     = '[message removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND author_type = 'customer'
     AND author_name = OLD.name;

  -- 2. ticket_comments — project-scope the legacy fallback via tickets
  --    subquery. ticket_comments has no project_id column directly, so
  --    we constrain through ticket_comments.ticket_id → tickets.project_id.
  --    Without this scope, a customer's name match against author_id-NULL
  --    legacy rows would wipe matching-name comments across EVERY project.
  UPDATE public.ticket_comments tc
     SET author     = 'Deleted user',
         message    = '[message removed at customer request]',
         image_url  = NULL,
         image_path = NULL
   WHERE tc.is_internal = false
     AND (
       tc.author_id = OLD.auth_user_id
       OR (
         tc.author_id IS NULL
         AND tc.author = OLD.name
         AND EXISTS (
           SELECT 1 FROM public.tickets t
           WHERE t.id = tc.ticket_id
             AND t.project_id = OLD.project_id
         )
       )
     );

  -- 3. tickets — already project-scoped, no change.
  UPDATE public.tickets
     SET reported_by = 'Deleted user',
         description = '[description removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND source      = 'customer_portal'
     AND reported_by = OLD.name;

  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.customer_account_scrub_on_delete() IS
  'Scrub customer-authored PII from retained tables on customer_accounts delete. Closes #491. Migration 224 hardened against rename attack + cross-tenant ticket_comments wipe (red-team Critical + High found post-223 apply).';
