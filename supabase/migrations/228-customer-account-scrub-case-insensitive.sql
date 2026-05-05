-- Migration 228 — Case-insensitive trim on customer_account_scrub PII matchers (#523).
--
-- Audit run 2026-05-05 found drift between ticket_comments.author and
-- customer_accounts.name in legacy CRM-side rows where author_id is NULL:
--
--   Distinct legacy authors today:
--     "Greg Kelsch"     × 11  on PROJ-29857 (no customer_account)
--     "Gregory Kelsch"  ×  1  on PROJ-28692 (no customer_account) ← drift
--     "Install Crew"    ×  1  on PROJ-28692 (staff, not customer)
--     "Manny Cruz"      ×  1  on PROJ-30313 (no customer_account)
--     "Marlie White"    ×  1  on PROJ-DEMO-MARLIE (matches customer_account)
--     "Zach Hall"       ×  1  on PROJ-DEMO-ZACH (matches customer_account)
--
-- All projects with drift-style mismatches ("Gregory Kelsch") have NO
-- customer_account today, so the trigger never fires against them. Real
-- under-collection risk is zero on current data, but the trigger's
-- exact-equality posture is fragile: a case/whitespace difference in any
-- future legacy import would surface as silent under-collection.
--
-- Hardening: switch all three exact-equality clauses (customer_messages,
-- ticket_comments, tickets) to `lower(btrim(X)) = lower(btrim(Y))`. Cost
-- is one function call per candidate row; rows are bounded by the
-- project_id / author_type filters and are tiny (< 100 per delete in
-- foreseeable future).
--
-- Function body is a republish of 224's customer_account_scrub_on_delete
-- with the equality clauses widened. No other behavior changes.

CREATE OR REPLACE FUNCTION public.customer_account_scrub_on_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  -- 1. customer_messages — case-insensitive trim on author_name = OLD.name
  UPDATE public.customer_messages
     SET author_name = 'Deleted user',
         message     = '[message removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND author_type = 'customer'
     AND lower(btrim(author_name)) = lower(btrim(OLD.name));

  -- 2. ticket_comments — primary branch (author_id) unchanged; legacy
  --    fallback (author_id IS NULL) widened to lower(btrim()) and still
  --    project-scoped via tickets subquery (224's bug 2 fix preserved).
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
         AND lower(btrim(tc.author)) = lower(btrim(OLD.name))
         AND EXISTS (
           SELECT 1 FROM public.tickets t
           WHERE t.id = tc.ticket_id
             AND t.project_id = OLD.project_id
         )
       )
     );

  -- 3. tickets — case-insensitive trim on reported_by = OLD.name
  UPDATE public.tickets
     SET reported_by = 'Deleted user',
         description = '[description removed at customer request]'
   WHERE project_id  = OLD.project_id
     AND source      = 'customer_portal'
     AND lower(btrim(reported_by)) = lower(btrim(OLD.name));

  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.customer_account_scrub_on_delete() IS
  'Scrub customer-authored PII from retained tables on customer_accounts delete. Closes #491. Migration 224 hardened against rename attack + cross-tenant ticket_comments wipe. Migration 228 widened all three exact-equality matchers to lower(btrim()) so legacy author/name drift cannot under-collect (#523).';

-- ── Lock the matcher's domain: prevent case-folded namesake collisions ────
--
-- Widening the trigger's equality from `=` to `lower(btrim()) = lower(btrim())`
-- introduces a new over-collection vector (R1 M1): if two customer_accounts on
-- the same project end up with names that case-fold to the same key (e.g.
-- "John Smith" + "JOHN SMITH "), deleting one wipes the other's authored
-- rows. Migration 225's UNIQUE(project_id, name) is case-sensitive and
-- doesn't prevent that collision.
--
-- Add a stricter partial unique index on (project_id, lower(btrim(name)))
-- so the case-folded namespace is also unique. Existing 225 index stays for
-- exact-name display uniqueness; this one closes the matcher-domain gap.
--
-- Pre-apply check: today's 6 customer_accounts have zero collisions on this
-- key (verified live 2026-05-05).
CREATE UNIQUE INDEX IF NOT EXISTS customer_accounts_uniq_project_name_ci
  ON public.customer_accounts (project_id, lower(btrim(name)));
