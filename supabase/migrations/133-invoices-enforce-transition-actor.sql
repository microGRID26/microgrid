-- 133-invoices-enforce-transition-actor.sql
-- ============================================================================
-- Invoice status-transition actor enforcement (closes greg_actions #153).
--
-- Context (2026-04-21 red-team on cd81b9d):
--   invoices_update RLS policy (supabase/047-invoices.sql) permits UPDATE from
--   either from_org OR to_org OR platform. Too permissive: a receiver could
--   flip someone else's draft to 'sent' via /api/invoices/[id]/send, cancel a
--   sender's sent invoice via updateInvoiceStatus, or rewrite content fields.
--
-- R1 (2026-04-21) caught three additional issues vs the first draft of this
-- migration:
--   Critical: the original matrix only enumerated a subset of
--             VALID_INVOICE_TRANSITIONS in lib/api/invoices.ts — the
--             overdue/* and disputed/* legs would have been bricked.
--   High:     sender could mutate content fields (total, invoice_number,
--             to_org) on already-paid invoices.
--   High:     viewed_at was in no gate — either side could forge it.
--
-- Fix: keep the RLS policy symmetric so either side can attempt UPDATE
-- (needed for receiver-owned writes), but gate via BEFORE UPDATE trigger.
-- Platform (EDGE) bypasses. Service_role bypasses by default.
--
-- Transition ownership matrix (mirrors VALID_INVOICE_TRANSITIONS):
--   draft     → sent, cancelled                     SENDER
--   sent      → cancelled, overdue                  SENDER
--   sent      → paid, disputed                      RECEIVER
--   sent      → viewed                              EITHER (pixel = service_role)
--   viewed    → cancelled, overdue                  SENDER
--   viewed    → paid, disputed                      RECEIVER
--   overdue   → cancelled                           SENDER
--   overdue   → paid, disputed                      RECEIVER
--   disputed  → sent, cancelled                     SENDER
--   anything else                                   reject
--
-- Content-field freeze:
--   sender-owned content fields (invoice_number, project_id, from_org,
--   to_org, milestone, subtotal, tax, total, due_date, notes, sent_at,
--   viewed_at) are only mutable by the sender while status='draft'. Once
--   the invoice has left draft, they are frozen (platform + service_role
--   may still override for corrections). Prevents post-send AR forgery.
--
-- Receiver-owned payment fields (paid_at, paid_amount, payment_method,
--   payment_reference) may only be set by the receiver (or platform).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.invoices_enforce_transition_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_orgs uuid[];
  v_is_sender boolean;
  v_is_receiver boolean;
BEGIN
  -- Platform users (EDGE) bypass.
  IF public.auth_is_platform_user() THEN
    RETURN NEW;
  END IF;

  v_user_orgs := public.auth_user_org_ids();
  v_is_sender := OLD.from_org = ANY(v_user_orgs);
  v_is_receiver := OLD.to_org = ANY(v_user_orgs);

  -- ── Status transition gating ────────────────────────────────────────────
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Sender-owned transitions
    IF (OLD.status = 'draft'    AND NEW.status IN ('sent', 'cancelled'))
       OR (OLD.status = 'sent'     AND NEW.status IN ('cancelled', 'overdue'))
       OR (OLD.status = 'viewed'   AND NEW.status IN ('cancelled', 'overdue'))
       OR (OLD.status = 'overdue'  AND NEW.status = 'cancelled')
       OR (OLD.status = 'disputed' AND NEW.status IN ('sent', 'cancelled'))
    THEN
      IF NOT v_is_sender THEN
        RAISE EXCEPTION 'Only the sender org may transition this invoice from % to %',
          OLD.status, NEW.status
          USING ERRCODE = '42501'; -- insufficient_privilege
      END IF;

    -- Receiver-owned transitions
    ELSIF (OLD.status = 'sent'    AND NEW.status IN ('paid', 'disputed'))
       OR (OLD.status = 'viewed'  AND NEW.status IN ('paid', 'disputed'))
       OR (OLD.status = 'overdue' AND NEW.status IN ('paid', 'disputed'))
    THEN
      IF NOT v_is_receiver THEN
        RAISE EXCEPTION 'Only the receiver org may transition this invoice from % to %',
          OLD.status, NEW.status
          USING ERRCODE = '42501';
      END IF;

    -- Either side: view-tracking (in practice done by pixel.gif via service_role)
    ELSIF OLD.status = 'sent' AND NEW.status = 'viewed' THEN
      NULL;

    ELSE
      RAISE EXCEPTION 'Disallowed invoice status transition: % → %',
        OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── Column-level gating: sender-owned content fields ────────────────────
  -- When NOT sender: block all content writes.
  -- When sender BUT status != draft: block all content writes. This freezes
  -- the invoice body after it has been sent so a compromised sender admin
  -- can't rewrite total/to_org/etc. on an already-paid invoice to corrupt
  -- the audit trail.
  IF NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
     OR NEW.project_id     IS DISTINCT FROM OLD.project_id
     OR NEW.from_org       IS DISTINCT FROM OLD.from_org
     OR NEW.to_org         IS DISTINCT FROM OLD.to_org
     OR NEW.milestone      IS DISTINCT FROM OLD.milestone
     OR NEW.subtotal       IS DISTINCT FROM OLD.subtotal
     OR NEW.tax            IS DISTINCT FROM OLD.tax
     OR NEW.total          IS DISTINCT FROM OLD.total
     OR NEW.due_date       IS DISTINCT FROM OLD.due_date
     OR NEW.notes          IS DISTINCT FROM OLD.notes
  THEN
    IF NOT v_is_sender THEN
      RAISE EXCEPTION 'Only the sender org may modify invoice content fields on invoice %',
        OLD.id
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoice % is already in status % and its content fields are frozen',
        OLD.id, OLD.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- sent_at and viewed_at are timestamp fields sender can only flip as part
  -- of a specific transition. Block direct forgery.
  IF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    -- sent_at is only set as part of draft → sent. Allow when status is
    -- concurrently flipping draft → sent AND caller is sender.
    IF NOT (v_is_sender AND OLD.status = 'draft' AND NEW.status = 'sent') THEN
      RAISE EXCEPTION 'sent_at may only be set by the sender during draft → sent'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.viewed_at IS DISTINCT FROM OLD.viewed_at THEN
    -- viewed_at is only set by the tracking pixel (service_role bypasses
    -- this trigger). Session-scoped callers — sender or receiver — may not
    -- forge it.
    RAISE EXCEPTION 'viewed_at is managed by the tracking pixel and may not be set directly'
      USING ERRCODE = '42501';
  END IF;

  -- ── Column-level gating: receiver-owned payment fields ──────────────────
  -- Sender cannot self-mark paid. Receiver (or platform) owns these.
  IF NEW.paid_at          IS DISTINCT FROM OLD.paid_at
     OR NEW.paid_amount        IS DISTINCT FROM OLD.paid_amount
     OR NEW.payment_method     IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_reference  IS DISTINCT FROM OLD.payment_reference
  THEN
    IF NOT v_is_receiver THEN
      RAISE EXCEPTION 'Only the receiver org may set payment fields on invoice %',
        OLD.id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Pin trigger name with 'a_' prefix so it fires BEFORE the existing
-- 'invoices_updated_at_trigger' (Postgres executes same-timing triggers
-- alphabetically). Guard should run before the mtime stamp.
DROP TRIGGER IF EXISTS a_invoices_enforce_actor_trigger ON public.invoices;
CREATE TRIGGER a_invoices_enforce_actor_trigger
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.invoices_enforce_transition_actor();

COMMENT ON FUNCTION public.invoices_enforce_transition_actor IS
  'Guards invoices UPDATE so sender-only transitions/fields and receiver-only transitions/fields cannot be cross-written by the wrong org. Platform and service_role bypass. Mirrors VALID_INVOICE_TRANSITIONS in lib/api/invoices.ts. See migration 133 + greg_actions #153 + R1 2026-04-21.';
