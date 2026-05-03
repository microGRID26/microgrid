-- BEFORE DELETE trigger on customer_accounts that scrubs customer-authored
-- PII from retained tables (closes #491 — Apple App Store guideline 5.1.1(v)
-- + GDPR / CCPA "right to erasure").
--
-- Why retained: customer_messages, tickets, ticket_comments are kept after
-- account deletion for legitimate operational + warranty + legal reasons
-- (per the disclosure in /privacy and the carve-out in Apple 5.1.1(v)).
-- The retention is fine; what's NOT fine is leaving the customer's name,
-- complaint text, and free-form descriptions sitting in those rows. This
-- trigger anonymizes the PII text fields in-place without dropping rows.
--
-- Multi-customer households (today: 1 project has 2 customer_accounts)
-- get correct partial-delete behavior:
--   * customer_messages — scoped by (project_id, author_name) so only
--     messages authored by THIS customer's name are scrubbed. Trigger
--     `customer_messages_pin_author_name` (migration 221) ensures the
--     name match is reliable for any post-221 message.
--   * ticket_comments — scoped by author_id (auth.uid() at insert time),
--     the most precise key. Other household members' comments are
--     untouched.
--   * tickets — scoped by (project_id, source='customer_portal',
--     reported_by) — same name-match shape as customer_messages.
--
-- Storage object cleanup (the actual image files in `ticket-attachments`
-- bucket pointed to by ticket_comments.image_path) is OUT OF SCOPE for
-- this trigger. The image_path column is nulled here so DB references
-- are gone; the orphaned bucket objects are filed as a separate cleanup
-- (greg_action #505).
--
-- Service role does NOT bypass this trigger. The scrub must run for
-- every customer-account delete — admin tooling, customer-initiated
-- in-app delete, future janitor crons, all paths.

CREATE OR REPLACE FUNCTION public.customer_account_scrub_on_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  -- 1. customer_messages authored by this customer.
  --    author_type='customer' filter is load-bearing — never touch PM
  --    or system messages.
  --    Name match relies on the post-migration-221 invariant that
  --    customer_messages.author_name = customer_accounts.name for
  --    any message inserted by a customer (the pin trigger overrides
  --    user-supplied author_name on insert).
  UPDATE public.customer_messages
     SET author_name = 'Deleted user',
         message     = '[message removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND author_type = 'customer'
     AND author_name = OLD.name;

  -- 2. ticket_comments authored by this customer.
  --    Two scoping paths:
  --      (a) author_id = OLD.auth_user_id — tightest scope, used for
  --          every comment inserted after the customer-portal addComment
  --          path was wired with an auth_user_id (post-launch path).
  --      (b) author_id IS NULL AND author = OLD.name — fallback for
  --          legacy rows (audit confirmed 53% of ticket_comments today
  --          lack author_id). Without this, those rows would silently
  --          retain the customer's name + free-form comment text after
  --          delete, which is the exact gap migration 223 closes.
  --    is_internal = false ensures we never scrub a staff comment.
  --    The fallback widens collision risk for legacy rows in same-name
  --    households; that's an accepted tradeoff because the privacy
  --    mandate is binding and household same-name collisions are rare
  --    enough (no occurrence in current 6 customer_accounts) to be a
  --    follow-up via the customer_accounts UNIQUE(project_id, name)
  --    constraint filed as #506.
  --    image_url + image_path nulled so the DB stops pointing at the
  --    customer's uploaded photos. Bucket cleanup tracked via #505.
  UPDATE public.ticket_comments
     SET author     = 'Deleted user',
         message    = '[message removed at customer request]',
         image_url  = NULL,
         image_path = NULL
   WHERE is_internal = false
     AND (
       author_id = OLD.auth_user_id
       OR (author_id IS NULL AND author = OLD.name)
     );

  -- 3. tickets reported by this customer (customer_portal source).
  --    description is nullable on this table; reported_by is not, so
  --    the scrub sets it to 'Deleted user' instead of NULL.
  UPDATE public.tickets
     SET reported_by = 'Deleted user',
         description = '[description removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND source      = 'customer_portal'
     AND reported_by = OLD.name;

  RETURN OLD;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.customer_account_scrub_on_delete() FROM PUBLIC, anon, authenticated;
-- No GRANT needed — the trigger fires under the deleter's role; the
-- function body's SECURITY DEFINER lets the scrub UPDATEs run regardless.

COMMENT ON FUNCTION public.customer_account_scrub_on_delete() IS
  'Scrub customer-authored PII from retained tables (customer_messages, tickets, ticket_comments) on customer_accounts delete. Closes #491. Storage cleanup tracked separately (#505).';

-- Drop any prior version of this trigger to make the migration idempotent.
DROP TRIGGER IF EXISTS customer_accounts_scrub_pii_on_delete ON public.customer_accounts;

CREATE TRIGGER customer_accounts_scrub_pii_on_delete
  BEFORE DELETE ON public.customer_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.customer_account_scrub_on_delete();

COMMENT ON TRIGGER customer_accounts_scrub_pii_on_delete ON public.customer_accounts IS
  'Anonymize customer-authored PII in retained tables on account delete. Required for Apple 5.1.1(v) + GDPR/CCPA compliance. Closes #491.';
