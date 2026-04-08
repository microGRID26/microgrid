-- 087: Customer in-app feedback system
-- Floating feedback button on every screen of the customer mobile app.
-- Captures category, rating, message, screenshots, device context.
-- CRM admins reply at /feedback; reply triggers a push notification back to customer.

-- ── Main feedback table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_account_id UUID NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug', 'idea', 'praise', 'question', 'confusing')),
  rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  message TEXT NOT NULL,
  screen_path TEXT,
  app_version TEXT,
  device_info TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'responded', 'closed')),
  admin_response TEXT,
  admin_responded_by TEXT,
  admin_responded_at TIMESTAMPTZ,
  org_id UUID REFERENCES organizations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_customer ON customer_feedback(customer_account_id);
CREATE INDEX IF NOT EXISTS idx_feedback_project ON customer_feedback(project_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON customer_feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON customer_feedback(category);
CREATE INDEX IF NOT EXISTS idx_feedback_org ON customer_feedback(org_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON customer_feedback(created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_feedback_updated_at ON customer_feedback;
CREATE TRIGGER trg_feedback_updated_at
  BEFORE UPDATE ON customer_feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_updated_at();

-- ── Attachments (screenshots) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_feedback_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id UUID NOT NULL REFERENCES customer_feedback(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_attachments_feedback ON customer_feedback_attachments(feedback_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE customer_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_feedback_attachments ENABLE ROW LEVEL SECURITY;

-- Customers: read + insert their own feedback
CREATE POLICY cf_customer_select ON customer_feedback
  FOR SELECT USING (
    customer_account_id IN (
      SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY cf_customer_insert ON customer_feedback
  FOR INSERT WITH CHECK (
    customer_account_id IN (
      SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
    )
  );

-- CRM users (org-scoped): read + update (to respond)
CREATE POLICY cf_org_select ON customer_feedback
  FOR SELECT USING (
    org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  );

CREATE POLICY cf_org_update ON customer_feedback
  FOR UPDATE USING (
    org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
  );

-- Attachments: customer reads their own, CRM reads via org
CREATE POLICY cfa_customer_select ON customer_feedback_attachments
  FOR SELECT USING (
    feedback_id IN (
      SELECT id FROM customer_feedback WHERE customer_account_id IN (
        SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY cfa_customer_insert ON customer_feedback_attachments
  FOR INSERT WITH CHECK (
    feedback_id IN (
      SELECT id FROM customer_feedback WHERE customer_account_id IN (
        SELECT id FROM customer_accounts WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY cfa_org_select ON customer_feedback_attachments
  FOR SELECT USING (
    feedback_id IN (
      SELECT id FROM customer_feedback WHERE org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user()
    )
  );

COMMENT ON TABLE customer_feedback IS 'In-app feedback from customers — captured via floating button on every screen';
COMMENT ON TABLE customer_feedback_attachments IS 'Screenshots and other files attached to customer feedback submissions';
