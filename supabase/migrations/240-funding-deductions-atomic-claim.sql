-- 240: atomic apply_paid_invoice — fold the EPC→EDGE paid transition,
-- the funding-deduction FIFO claim, and the deduction status flip into
-- a single PG transaction.
--
-- Closes the Critical surfaced by R1 red-teamer on the original two-step
-- design (#613): an RPC that committed status='applied' before returning
-- left the deductions stranded if the JS process died between the RPC
-- return and the subsequent invoice UPDATE (timeouts, deploy mid-flight,
-- OOM kills). EDGE would silently under-collect until manual revert.
--
-- The fold makes the JS↔PG boundary irrelevant: either the whole TX
-- commits (invoice paid AND deductions applied) or none of it does
-- (TX rollback restores deductions to 'open', invoice stays in prior
-- status). No revert RPC needed — Postgres handles it.
--
-- Algorithm matches lib/invoices/funding-deductions.ts computeNetPayment:
--   1. Order open deductions oldest-first (NULLS LAST), id ASC tiebreaker.
--   2. Take rows in order until cumulative sum would exceed gross. Skip
--      rows that don't fit (matches TS `continue` — not `break` — so a
--      single oversized row doesn't poison later smaller rows).
--   3. Mark selected rows status='applied' with applied_to_invoice_id.
--
-- TOCTOU: the RPC SELECTs the invoice with FOR UPDATE, then re-checks the
-- expected status. If another transaction transitioned the invoice in the
-- interim, the RPC raises 'invoice_status_changed' → caller treats as
-- race-loss (return null), TX rolls back automatically.
--
-- Rounding parity (R1 HIGH): both the TS pure calc and this PL/pgSQL use
-- numeric * 100 then round() — Postgres `round(numeric)` is half-away-from-
-- zero, which matches `Math.round` for positive amounts. Banker's rounding
-- only applies to `double precision`. funding_deductions.amount is numeric.

CREATE OR REPLACE FUNCTION public.apply_paid_invoice(
  p_invoice_id            uuid,
  p_current_status        text,
  p_paid_at               timestamptz,
  p_payment_method        text,
  p_payment_reference     text,
  p_explicit_paid_amount  numeric DEFAULT NULL
)
RETURNS TABLE(
  invoice          jsonb,
  applied_ids      uuid[],
  total_deducted   numeric,
  net_amount       numeric,
  gross_amount     numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv             public.invoices%ROWTYPE;
  v_from_org_type   text;
  v_to_org_type     text;
  v_gross_cents     bigint;
  v_total_cents     bigint := 0;
  v_amt_cents       bigint;
  v_applied_ids     uuid[] := ARRAY[]::uuid[];
  v_now             timestamptz := COALESCE(p_paid_at, now());
  v_net             numeric;
  v_updated_inv     jsonb;
  r                 record;
BEGIN
  -- Lock the invoice row for the duration of this TX. Any concurrent paid
  -- transition on the same invoice waits here.
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- TOCTOU guard. If the invoice already moved to a different status (or
  -- another concurrent paid transition won), abort. The RAISE rolls back
  -- the TX, so any work below is undone — safe even if we somehow get here
  -- after partial state changes.
  IF v_inv.status IS DISTINCT FROM p_current_status THEN
    RAISE EXCEPTION 'invoice_status_changed: expected % got %',
      p_current_status, v_inv.status
      USING ERRCODE = '40001'; -- serialization_failure → caller maps to race-loss
  END IF;

  -- Decide the paid_amount.
  -- Caller-provided explicit amount short-circuits the deduction path
  -- entirely (matches the prior TS contract: details.paid_amount overrides).
  IF p_explicit_paid_amount IS NOT NULL THEN
    v_net := round(p_explicit_paid_amount, 2);
  ELSE
    -- Look up org types for both ends of the invoice. If this isn't an
    -- EPC → platform chain invoice, no deductions apply; net = gross.
    SELECT org_type INTO v_from_org_type
    FROM public.organizations WHERE id = v_inv.from_org;
    SELECT org_type INTO v_to_org_type
    FROM public.organizations WHERE id = v_inv.to_org;

    v_gross_cents := round(COALESCE(v_inv.total, 0) * 100);
    IF v_gross_cents < 0 THEN v_gross_cents := 0; END IF;

    IF v_from_org_type = 'epc' AND v_to_org_type = 'platform' THEN
      -- Atomic FIFO claim. SKIP LOCKED ensures concurrent calls hit
      -- different rows; ORDER BY mirrors the TS pure calculator.
      FOR r IN
        SELECT id, amount, source_claim_id, created_at
        FROM public.funding_deductions
        WHERE target_epc_id = v_inv.from_org
          AND status = 'open'
        ORDER BY created_at ASC NULLS LAST, id ASC
        FOR UPDATE SKIP LOCKED
      LOOP
        v_amt_cents := round(COALESCE(r.amount, 0) * 100);
        IF v_total_cents + v_amt_cents > v_gross_cents THEN
          -- Row doesn't fit — leave it locked for this TX, status stays
          -- 'open', available for the next invoice. Continue (not break)
          -- so a single oversized row doesn't poison later smaller ones.
          CONTINUE;
        END IF;
        v_total_cents := v_total_cents + v_amt_cents;
        v_applied_ids := v_applied_ids || r.id;
      END LOOP;

      v_net := (greatest(0, v_gross_cents - v_total_cents)::numeric) / 100;
    ELSE
      v_net := (v_gross_cents::numeric) / 100;
    END IF;

    -- Apply deductions inside the same TX as the invoice update. If the
    -- UPDATE below somehow fails, both this UPDATE and the deductions roll
    -- back together.
    IF cardinality(v_applied_ids) > 0 THEN
      UPDATE public.funding_deductions
      SET status                = 'applied',
          applied_to_invoice_id = p_invoice_id,
          applied_at            = v_now
      WHERE id = ANY(v_applied_ids);
    END IF;
  END IF;

  -- Apply the paid transition.
  UPDATE public.invoices
  SET status            = 'paid',
      paid_at           = v_now,
      paid_amount       = v_net,
      payment_method    = COALESCE(p_payment_method, payment_method),
      payment_reference = COALESCE(p_payment_reference, payment_reference)
  WHERE id = p_invoice_id
    AND status = p_current_status -- defense in depth; we already locked + checked
  RETURNING to_jsonb(public.invoices.*) INTO v_updated_inv;

  IF v_updated_inv IS NULL THEN
    -- Should be unreachable given the FOR UPDATE + status check above, but
    -- if somehow the guard slipped, abort the whole TX.
    RAISE EXCEPTION 'invoice_update_failed' USING ERRCODE = '40001';
  END IF;

  invoice        := v_updated_inv;
  applied_ids    := v_applied_ids;
  total_deducted := (v_total_cents::numeric) / 100;
  net_amount     := v_net;
  gross_amount   := COALESCE((v_gross_cents::numeric) / 100, COALESCE(v_inv.total, 0));
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) IS
'Atomic EPC→EDGE invoice paid transition with funding-deduction FIFO claim. '
'Single PG TX commits invoice + deductions or rolls both back. '
'Closes #613 — replaces the prior two-step design that orphaned deductions on caller process death.';

-- service_role only — invoked from lib/api/invoices.ts on the server.
REVOKE ALL ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paid_invoice(uuid, text, timestamptz, text, text, numeric) TO service_role;
