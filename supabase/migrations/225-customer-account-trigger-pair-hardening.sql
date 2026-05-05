-- Hardening pass on the 221+223+224 customer_accounts trigger pair.
-- Closes #506 (UNIQUE(project_id, name)) + #509 (idempotency predicate,
-- schema-qualify auth_is_admin).
--
-- These are minor follow-ups from the 491 audit cycle. None are
-- exploitable today; this migration ships them before context cools and
-- before any production-customer delete path goes live.

-- ── #506 — UNIQUE(project_id, name) on customer_accounts ──────────────
--
-- The 224 hotfix added a `name` pin to customer_accounts_protect_columns
-- so a customer can't rename themselves to a housemate's name pre-delete
-- (Critical from the 223 red-team). That closes the rename attack.
--
-- The other half of the same risk surface — two customer_accounts in the
-- same project that ALREADY share `name` (legitimate same-name household:
-- "Jordan Smith Sr." + "Jordan Smith Jr." abbreviated to "Jordan Smith"
-- on both, or two roommates named "Jordan") — is best closed by a UNIQUE
-- constraint at insert time. The next account in the household is forced
-- to disambiguate.
--
-- Pre-flight: zero duplicates and zero NULL names in current 6 rows
-- (verified via SELECT GROUP BY HAVING + NULL count). Safe to apply.

ALTER TABLE public.customer_accounts
  ADD CONSTRAINT customer_accounts_uniq_project_name
  UNIQUE (project_id, name);

COMMENT ON CONSTRAINT customer_accounts_uniq_project_name ON public.customer_accounts IS
  'Prevents same-name household collision on the customer_messages / tickets PII scrub by name match (closes #506; pairs with the name pin added in migration 224 closing the rename attack).';

-- ── #509a — Idempotency predicate on the scrub trigger ────────────────
--
-- Concurrent same-project deletes (rare) or trigger re-fires would
-- re-scrub already-scrubbed rows. UPDATEs are idempotent (re-setting
-- the same literal) but each re-fire still does proportional row-lock
-- + write work. Add predicates so already-scrubbed rows are skipped.
--
-- Read-team flagged this as Medium #2 in the post-224 audit (Grade A).
-- Cheap fix; no behavior change beyond skipping no-op writes.
--
-- ── #509b — Schema-qualify auth_is_admin() inside SECURITY DEFINER ────
--
-- search_path is pinned to `public, pg_temp` so today the unqualified
-- `auth_is_admin()` resolves correctly. Schema-qualifying as
-- `public.auth_is_admin()` is belt-and-suspenders against a future
-- migration creating a same-name function in pg_catalog or another
-- schema and the search_path order ever changing.

CREATE OR REPLACE FUNCTION public.customer_account_scrub_on_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  -- 1. customer_messages — skip rows already scrubbed (idempotency).
  UPDATE public.customer_messages
     SET author_name = 'Deleted user',
         message     = '[message removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND author_type = 'customer'
     AND author_name = OLD.name
     AND author_name <> 'Deleted user';

  -- 2. ticket_comments — skip rows already scrubbed.
  --    Project-scoped legacy fallback (224) preserved.
  UPDATE public.ticket_comments tc
     SET author     = 'Deleted user',
         message    = '[message removed at customer request]',
         image_url  = NULL,
         image_path = NULL
   WHERE tc.is_internal = false
     AND tc.author <> 'Deleted user'
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

  -- 3. tickets — skip rows already scrubbed.
  UPDATE public.tickets
     SET reported_by = 'Deleted user',
         description = '[description removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND source      = 'customer_portal'
     AND reported_by = OLD.name
     AND reported_by <> 'Deleted user';

  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.customer_account_scrub_on_delete() IS
  'Scrub customer-authored PII from retained tables on customer_accounts delete. Closes #491. 225: idempotency predicates skip already-scrubbed rows.';

-- ── #509b — Schema-qualify auth_is_admin() ────────────────────────────

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

  -- 225: schema-qualify against future shadowing of auth_is_admin.
  IF public.auth_is_admin() THEN
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
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'cannot change customer_accounts.name' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;
