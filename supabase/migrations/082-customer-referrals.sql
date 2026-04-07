-- 082: Customer Referrals — Refer-a-Friend program
-- Tracks referrals submitted by customers through the mobile app

CREATE TABLE IF NOT EXISTS customer_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  referrer_project_id TEXT,
  referee_name TEXT NOT NULL,
  referee_email TEXT,
  referee_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'contacted', 'signed', 'installed', 'paid')),
  bonus_amount NUMERIC(8,2) NOT NULL DEFAULT 500.00,
  notes TEXT,
  org_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_referrals_referrer ON customer_referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_customer_referrals_org ON customer_referrals(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_referrals_status ON customer_referrals(status);

-- RLS
ALTER TABLE customer_referrals ENABLE ROW LEVEL SECURITY;

-- Customers can read their own referrals
CREATE POLICY customer_referrals_select ON customer_referrals
  FOR SELECT USING (
    referrer_id IN (
      SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
  );

-- Customers can insert referrals for themselves
CREATE POLICY customer_referrals_insert ON customer_referrals
  FOR INSERT WITH CHECK (
    referrer_id IN (
      SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
  );

-- Org-scoped read for CRM users (staff can see all referrals in their org)
CREATE POLICY customer_referrals_org_select ON customer_referrals
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM users WHERE auth_id = auth.uid()
    )
  );

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_customer_referrals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_referrals_updated_at
  BEFORE UPDATE ON customer_referrals
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_referrals_updated_at();

COMMENT ON TABLE customer_referrals IS 'Customer refer-a-friend program — tracks referrals and bonus payouts';
