-- Migration 063: Service-rep linkage, compliance tracking, rep file uploads (Zach/Marlie feedback)

-- #8: Link service tickets to sales reps
ALTER TABLE service_calls ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES sales_reps(id);
ALTER TABLE service_calls ADD COLUMN IF NOT EXISTS ticket_category TEXT DEFAULT 'service'; -- 'sales_related' or 'service'
CREATE INDEX IF NOT EXISTS idx_service_calls_rep ON service_calls(sales_rep_id);

-- #14: Compliance / licensing tracking
CREATE TABLE IF NOT EXISTS rep_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
  license_type TEXT NOT NULL, -- 'state_license', 'certification', 'insurance', 'background_check', 'drug_test'
  license_number TEXT,
  state TEXT,
  issued_date DATE,
  expiry_date DATE,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'expired', 'pending', 'revoked'
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  file_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_licenses_rep ON rep_licenses(rep_id);
CREATE INDEX IF NOT EXISTS idx_rep_licenses_expiry ON rep_licenses(expiry_date);
CREATE INDEX IF NOT EXISTS idx_rep_licenses_status ON rep_licenses(status);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER rep_licenses_updated_at
  BEFORE UPDATE ON rep_licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: all authenticated can read, admin can write
ALTER TABLE rep_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rep_licenses_select" ON rep_licenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "rep_licenses_insert" ON rep_licenses FOR INSERT TO authenticated WITH CHECK (auth_is_admin());
CREATE POLICY "rep_licenses_update" ON rep_licenses FOR UPDATE TO authenticated USING (auth_is_admin());
CREATE POLICY "rep_licenses_delete" ON rep_licenses FOR DELETE TO authenticated USING (auth_is_super_admin());

-- #10: Rep file uploads (separate from onboarding docs)
CREATE TABLE IF NOT EXISTS rep_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id UUID NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL, -- 'license_front', 'license_back', 'w9', 'ica', 'photo', 'other'
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  uploaded_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_files_rep ON rep_files(rep_id);

ALTER TABLE rep_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rep_files_select" ON rep_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "rep_files_insert" ON rep_files FOR INSERT TO authenticated WITH CHECK (auth_is_admin());
CREATE POLICY "rep_files_delete" ON rep_files FOR DELETE TO authenticated USING (auth_is_admin());
