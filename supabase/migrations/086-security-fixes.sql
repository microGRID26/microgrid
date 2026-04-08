-- 086: Security Fixes (Session 29 R1 audit)
-- Tightens RLS on customer_messages, customer_payment_methods, customer_payments.
--
-- C1: cm_update_read was USING(true) WITH CHECK(true) — any authenticated user
--     could update any message. Restrict to message owner or org member.
-- H4: customer_payment_methods CRM read had no org scope.
-- H5: customer_payments insert/update had no org scope (relied on platform check only).

-- ── C1: Tighten customer_messages UPDATE policy ────────────────────────────
DROP POLICY IF EXISTS cm_update_read ON customer_messages;

-- Customers can mark messages on their own project as read
CREATE POLICY cm_customer_update_read ON customer_messages
  FOR UPDATE TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
  );

-- CRM users can update messages within their org (mark read, etc.)
CREATE POLICY cm_org_update_read ON customer_messages
  FOR UPDATE TO authenticated
  USING (
    org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  )
  WITH CHECK (
    org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  );

-- ── H4: Org-scope customer_payment_methods ─────────────────────────────────
-- Add org_id column for proper multi-tenant scoping
ALTER TABLE customer_payment_methods
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Backfill org_id from related customer_accounts (which inherits from project)
UPDATE customer_payment_methods cpm
SET org_id = (
  SELECT p.org_id FROM customer_accounts ca
  JOIN projects p ON p.id = ca.project_id
  WHERE ca.id = cpm.customer_account_id
  LIMIT 1
)
WHERE cpm.org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cpm_org ON customer_payment_methods(org_id);

-- Replace blanket platform read with org-scoped policy
DROP POLICY IF EXISTS cpm_platform_select ON customer_payment_methods;

CREATE POLICY cpm_org_select ON customer_payment_methods
  FOR SELECT USING (
    org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  );

-- ── H5: Org-scope customer_payments ────────────────────────────────────────
ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id);

-- Backfill from statement → customer_account → project → org
UPDATE customer_payments cp
SET org_id = (
  SELECT cbs.org_id FROM customer_billing_statements cbs
  WHERE cbs.id = cp.statement_id
  LIMIT 1
)
WHERE cp.org_id IS NULL AND cp.statement_id IS NOT NULL;

UPDATE customer_payments cp
SET org_id = (
  SELECT p.org_id FROM customer_accounts ca
  JOIN projects p ON p.id = ca.project_id
  WHERE ca.id = cp.customer_account_id
  LIMIT 1
)
WHERE cp.org_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cp_org ON customer_payments(org_id);

-- Replace blanket platform policies with org-scoped versions
DROP POLICY IF EXISTS cp_platform_insert ON customer_payments;
DROP POLICY IF EXISTS cp_platform_update ON customer_payments;
DROP POLICY IF EXISTS cp_org_select ON customer_payments;

CREATE POLICY cp_org_select ON customer_payments
  FOR SELECT USING (
    customer_account_id IN (
      SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
    OR org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  );

CREATE POLICY cp_org_insert ON customer_payments
  FOR INSERT WITH CHECK (
    org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  );

CREATE POLICY cp_org_update ON customer_payments
  FOR UPDATE USING (
    org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  );

COMMENT ON COLUMN customer_payment_methods.org_id IS 'Multi-tenant scope (added in 086 security fixes)';
COMMENT ON COLUMN customer_payments.org_id IS 'Multi-tenant scope (added in 086 security fixes)';
