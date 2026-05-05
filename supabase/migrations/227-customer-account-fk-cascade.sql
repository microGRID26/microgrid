-- Migration 227 — Make 3 child-table FKs CASCADE on customer_accounts delete (#507).
--
-- The /api/customer/delete-account route's docstring claims the following
-- tables CASCADE-clean on customer_accounts row delete. Reality (pre-227)
-- showed three of them at NO ACTION, which means a customer with rows in
-- ANY of these tables would 500 with FK violation when trying to delete
-- their account:
--
--   - customer_billing_statements.customer_account_id_fkey  (NO ACTION → CASCADE)
--   - customer_payment_methods.customer_account_id_fkey     (NO ACTION → CASCADE)
--   - customer_payments.customer_account_id_fkey            (NO ACTION → CASCADE)
--
-- ALSO fixed in this migration (caught by R1 migration-planner audit):
--   - customer_payments.statement_id_fkey                   (NO ACTION → CASCADE)
--     Hidden FK chain: 10/10 payments today have non-null statement_id.
--     Without this fix, the customer_billing_statements cascade-delete would
--     itself FK-violate against payments → entire delete-account flow 500s.
--
-- Already CASCADE (no change needed):
--   - customer_feedback.customer_account_id_fkey
--   - customer_chat_sessions.account_id_fkey
--   - customer_referrals.referrer_id_fkey
--
-- Pre-launch state (2026-05-05): 15 billing rows + 5 payment-method rows +
-- 10 payment rows across 6 demo customer_accounts. No real customer
-- financial trail to preserve. Apple 5.1.1(v) carve-out for retaining
-- warranty/legal/financial records during right-to-erasure is a real
-- concern post-launch — when the first paying customer hits the delete
-- flow with billing rows, we will likely want to revisit this and switch
-- to "anonymize + SET NULL + retain" instead of CASCADE. That's tracked
-- as a follow-up action.
--
-- Apply-time risk: zero. ALTER CONSTRAINT just rewrites the trigger
-- behavior on the parent table; no data movement, sub-millisecond on
-- tables with < 100 rows. Wrapped in BEGIN/COMMIT for atomicity (R1 L1)
-- so a partial failure doesn't leave the cascade chain half-fixed.
-- (apply_migration via Supabase MCP already wraps in a transaction; the
-- explicit BEGIN/COMMIT is for archaeology / re-running the .sql file
-- via psql later.)

BEGIN;

ALTER TABLE public.customer_billing_statements
  DROP CONSTRAINT customer_billing_statements_customer_account_id_fkey,
  ADD  CONSTRAINT customer_billing_statements_customer_account_id_fkey
       FOREIGN KEY (customer_account_id)
       REFERENCES public.customer_accounts(id)
       ON DELETE CASCADE;

ALTER TABLE public.customer_payment_methods
  DROP CONSTRAINT customer_payment_methods_customer_account_id_fkey,
  ADD  CONSTRAINT customer_payment_methods_customer_account_id_fkey
       FOREIGN KEY (customer_account_id)
       REFERENCES public.customer_accounts(id)
       ON DELETE CASCADE;

ALTER TABLE public.customer_payments
  DROP CONSTRAINT customer_payments_customer_account_id_fkey,
  ADD  CONSTRAINT customer_payments_customer_account_id_fkey
       FOREIGN KEY (customer_account_id)
       REFERENCES public.customer_accounts(id)
       ON DELETE CASCADE;

-- Hidden FK chain (R1 H1): customer_payments.statement_id → customer_billing_statements(id).
-- Was NO ACTION; without this fix, cascade-delete of billing statements
-- (above) would FK-violate against payments pointing at them. 10/10
-- payments today carry a non-null statement_id, so this would break the
-- chain on every real customer-delete attempt.
ALTER TABLE public.customer_payments
  DROP CONSTRAINT customer_payments_statement_id_fkey,
  ADD  CONSTRAINT customer_payments_statement_id_fkey
       FOREIGN KEY (statement_id)
       REFERENCES public.customer_billing_statements(id)
       ON DELETE CASCADE;

COMMIT;

-- Verification: all six FKs that point at customer_accounts.id should
-- now report CASCADE on delete_rule. Run post-apply:
--   SELECT tc.table_name, kcu.column_name, rc.delete_rule
--     FROM information_schema.table_constraints tc
--     JOIN information_schema.key_column_usage kcu USING (constraint_name)
--     JOIN information_schema.referential_constraints rc USING (constraint_name)
--    WHERE tc.constraint_type='FOREIGN KEY'
--      AND tc.table_schema='public'
--      AND kcu.referenced_table_name = 'customer_accounts'  -- (psql syntax)
--   ORDER BY tc.table_name;
