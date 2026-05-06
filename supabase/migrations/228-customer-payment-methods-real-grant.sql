-- Action #551 / mig-230 Layer 2 follow-up.
--
-- Migration 230 added a column-level REVOKE on
-- customer_payment_methods.{stripe_customer_id, stripe_payment_method_id}
-- intending to be defense-in-depth in case Layer 1 (drop of the customer
-- INSERT policy) ever reverts. Postgres treated it as a no-op because
-- column-level REVOKE only matters if the privilege was originally granted
-- column-specifically — and the table had a table-level GRANT ALL to
-- authenticated/anon which made the column REVOKE invisible.
--
-- This migration converts Layer 2 to a real defense:
--   1. REVOKE table-level INSERT/UPDATE from authenticated, anon
--   2. GRANT INSERT only on the safe columns (no Stripe ids)
--   3. GRANT UPDATE only on the safe columns
--
-- service_role bypasses GRANTs entirely — webhook writes unaffected.
-- Today no authenticated/anon caller writes to this table (Layer 1 dropped
-- the customer INSERT policy in mig 230). This migration is forward-defense
-- only: if a future RLS policy re-grants customer writes, the GRANT layer
-- now caps the writable columns.
--
-- Trade: any future schema migration adding a customer-writable column must
-- remember to add a column-level GRANT for it. Failure mode is loud
-- ("permission denied for column X") not silent.

BEGIN;

REVOKE INSERT, UPDATE ON public.customer_payment_methods FROM authenticated;
REVOKE INSERT, UPDATE ON public.customer_payment_methods FROM anon;

-- INSERT — safe columns only (no Stripe ids).
GRANT INSERT (
  id,
  customer_account_id,
  org_id,
  card_brand,
  card_last4,
  card_exp_month,
  card_exp_year,
  is_default,
  autopay_enabled,
  created_at
) ON public.customer_payment_methods TO authenticated;

GRANT INSERT (
  id,
  customer_account_id,
  org_id,
  card_brand,
  card_last4,
  card_exp_month,
  card_exp_year,
  is_default,
  autopay_enabled,
  created_at
) ON public.customer_payment_methods TO anon;

-- UPDATE — only display + flag fields. Customer can rotate their default
-- and toggle autopay; cannot rewrite Stripe ids or org_id or
-- customer_account_id.
GRANT UPDATE (
  card_brand,
  card_last4,
  card_exp_month,
  card_exp_year,
  is_default,
  autopay_enabled
) ON public.customer_payment_methods TO authenticated;

GRANT UPDATE (
  card_brand,
  card_last4,
  card_exp_month,
  card_exp_year,
  is_default,
  autopay_enabled
) ON public.customer_payment_methods TO anon;

COMMIT;
