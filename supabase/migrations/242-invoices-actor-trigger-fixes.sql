-- 242: invoices_enforce_transition_actor — two fixes
--
-- Surfaced 2026-05-08 invoicing walkthrough:
--   1) Pixel route silently fails: trigger rejects every viewed_at write.
--      Pixel route uses service-role + auth_user_org_ids() = empty, so
--      auth_is_platform_user() is false → falls through to the unconditional
--      "viewed_at is managed by the tracking pixel" rejection. The trigger
--      name implies a pixel carve-out exists; it does not.
--   2) Mark-Paid blocked for super_admin who isn't a platform-org member.
--      Trigger short-circuits only on auth_is_platform_user(). Super admins
--      doing ops support (refund flips, AR cleanup, demo runs) hit the
--      receiver-only rule and 42501. Production rule is correct (receiver
--      should be the one acknowledging payment); super_admin should still
--      bypass it for ops surgery, mirroring how mig 241 handles platform
--      org config.
--
-- Fixes:
--   • Allow viewed_at NULL→non-NULL during sent→viewed (the pixel pattern).
--     Other writes to viewed_at still reject (no late-open fakery, no
--     manual override).
--   • Add auth_is_super_admin() to the early-return alongside platform user.

CREATE OR REPLACE FUNCTION public.invoices_enforce_transition_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_orgs uuid[];
  v_is_sender boolean;
  v_is_receiver boolean;
BEGIN
  -- super_admin bypass (added 242) + existing platform-user bypass.
  IF public.auth_is_super_admin() OR public.auth_is_platform_user() THEN
    RETURN NEW;
  END IF;

  v_user_orgs := public.auth_user_org_ids();
  v_is_sender := OLD.from_org = ANY(v_user_orgs);
  v_is_receiver := OLD.to_org = ANY(v_user_orgs);

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status = 'draft'    AND NEW.status IN ('sent', 'cancelled'))
       OR (OLD.status = 'sent'     AND NEW.status IN ('cancelled', 'overdue'))
       OR (OLD.status = 'viewed'   AND NEW.status IN ('cancelled', 'overdue'))
       OR (OLD.status = 'overdue'  AND NEW.status = 'cancelled')
       OR (OLD.status = 'disputed' AND NEW.status IN ('sent', 'cancelled'))
    THEN
      IF NOT v_is_sender THEN
        RAISE EXCEPTION 'Only the sender org may transition this invoice from % to %',
          OLD.status, NEW.status USING ERRCODE = '42501';
      END IF;
    ELSIF (OLD.status = 'sent'    AND NEW.status IN ('paid', 'disputed'))
       OR (OLD.status = 'viewed'  AND NEW.status IN ('paid', 'disputed'))
       OR (OLD.status = 'overdue' AND NEW.status IN ('paid', 'disputed'))
    THEN
      IF NOT v_is_receiver THEN
        RAISE EXCEPTION 'Only the receiver org may transition this invoice from % to %',
          OLD.status, NEW.status USING ERRCODE = '42501';
      END IF;
    ELSIF OLD.status = 'sent' AND NEW.status = 'viewed' THEN
      NULL; -- pixel-route transition; allowed without actor
    ELSE
      RAISE EXCEPTION 'Disallowed invoice status transition: % → %',
        OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
  END IF;

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
        OLD.id USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoice % is already in status % and its content fields are frozen',
        OLD.id, OLD.status USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.sent_at IS DISTINCT FROM OLD.sent_at THEN
    IF NOT (v_is_sender AND OLD.status = 'draft' AND NEW.status = 'sent') THEN
      RAISE EXCEPTION 'sent_at may only be set by the sender during draft → sent'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- viewed_at carve-out (added 242):
  -- Pixel route writes viewed_at NULL→non-NULL during sent→viewed. Allow that
  -- exact pattern; reject every other viewed_at modification (manual override,
  -- back-dating, late-open fakery on already-paid invoices, etc.).
  IF NEW.viewed_at IS DISTINCT FROM OLD.viewed_at THEN
    IF NOT (
      OLD.viewed_at IS NULL
      AND NEW.viewed_at IS NOT NULL
      AND OLD.status = 'sent'
      AND NEW.status = 'viewed'
    ) THEN
      RAISE EXCEPTION 'viewed_at may only be set by the pixel route on the canonical sent→viewed transition'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.paid_at           IS DISTINCT FROM OLD.paid_at
     OR NEW.paid_amount        IS DISTINCT FROM OLD.paid_amount
     OR NEW.payment_method     IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_reference  IS DISTINCT FROM OLD.payment_reference
  THEN
    IF NOT v_is_receiver THEN
      RAISE EXCEPTION 'Only the receiver org may set payment fields on invoice %',
        OLD.id USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
