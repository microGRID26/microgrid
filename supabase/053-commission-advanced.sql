-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 053: Commission Advanced Features
-- EC/Non-EC support, M1 milestone advances with clawback, adder deductions,
-- pay visibility, payroll admin notes.
-- Based on the MicroGRID Commission Structure CSV.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- EC/NON-EC PROJECT FLAG
-- ═══════════════════════════════════════════════════════════

-- Add energy_community flag to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS energy_community BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════
-- COMMISSION CONFIGURATION
-- ═══════════════════════════════════════════════════════════

-- Commission config (admin-managed settings)
CREATE TABLE IF NOT EXISTS public.commission_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  org_id UUID REFERENCES public.organizations(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default config values from the CSV
INSERT INTO commission_config (config_key, value, description) VALUES
  ('ec_gross_per_watt', '0.50', 'Gross commission per watt for Energy Community projects'),
  ('non_ec_gross_per_watt', '0.35', 'Gross commission per watt for Non-EC projects'),
  ('ec_bonus_per_watt', '0.15', 'Energy Community bonus per watt (30% of gross)'),
  ('operations_deduction_pct', '20', 'Company operations deduction percentage'),
  ('operations_per_watt', '0.10', 'Company operations deduction per watt'),
  ('ec_effective_per_watt', '0.40', 'Effective commission per watt after ops deduction (EC)'),
  ('non_ec_effective_per_watt', '0.25', 'Effective commission per watt after ops deduction (Non-EC)'),
  ('m1_advance_amount', '1000', 'M1 milestone advance payment amount ($)'),
  ('m1_self_gen_ec_split', '100', 'Percentage of M1 going to EC if self-generated (vs split with EA)'),
  ('m1_ec_ea_split', '50', 'Percentage of M1 going to EC when split with EA (EA gets remainder)'),
  ('clawback_days', '90', 'Days after sale before M1 advance is clawed back if not installed'),
  ('adder_deduction_from_stack', 'true', 'When true, adder revenue is deducted from commission stack before distribution')
ON CONFLICT (config_key) DO NOTHING;

-- RLS
ALTER TABLE commission_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_select ON commission_config FOR SELECT TO authenticated USING (true);
CREATE POLICY cc_insert ON commission_config FOR INSERT TO authenticated WITH CHECK (auth_is_admin());
CREATE POLICY cc_update ON commission_config FOR UPDATE TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());
CREATE POLICY cc_delete ON commission_config FOR DELETE TO authenticated USING (auth_is_admin());

CREATE INDEX IF NOT EXISTS idx_comm_config_key ON commission_config(config_key);

-- ═══════════════════════════════════════════════════════════
-- M1 MILESTONE ADVANCES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.commission_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  rep_id UUID REFERENCES public.sales_reps(id),
  rep_name TEXT,
  role_key TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  milestone TEXT NOT NULL DEFAULT 'M1',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'clawed_back', 'cancelled')),
  self_generated BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,
  clawback_date DATE,
  clawback_reason TEXT,
  clawed_back_at TIMESTAMPTZ,
  notes TEXT,
  admin_notes TEXT,
  org_id UUID REFERENCES public.organizations(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comm_advances_project ON commission_advances(project_id);
CREATE INDEX IF NOT EXISTS idx_comm_advances_rep ON commission_advances(rep_id);
CREATE INDEX IF NOT EXISTS idx_comm_advances_status ON commission_advances(status);
CREATE INDEX IF NOT EXISTS idx_comm_advances_org ON commission_advances(org_id);
CREATE INDEX IF NOT EXISTS idx_comm_advances_clawback ON commission_advances(clawback_date);

ALTER TABLE commission_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY ca_select ON commission_advances FOR SELECT TO authenticated
  USING (org_id = ANY(auth_user_org_ids()) OR org_id IS NULL OR auth_is_platform_user());
CREATE POLICY ca_insert ON commission_advances FOR INSERT TO authenticated
  WITH CHECK (org_id = ANY(auth_user_org_ids()) OR org_id IS NULL OR auth_is_platform_user());
CREATE POLICY ca_update ON commission_advances FOR UPDATE TO authenticated
  USING (auth_is_admin()) WITH CHECK (auth_is_admin());
CREATE POLICY ca_delete ON commission_advances FOR DELETE TO authenticated
  USING (auth_is_admin());

-- ═══════════════════════════════════════════════════════════
-- PAYROLL ADMIN NOTES ON COMMISSION RECORDS
-- ═══════════════════════════════════════════════════════════

ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS days_since_sale INTEGER;
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS is_energy_community BOOLEAN DEFAULT false;
ALTER TABLE commission_records ADD COLUMN IF NOT EXISTS adder_deduction NUMERIC(12,2) DEFAULT 0;

-- Updated_at trigger for commission_advances
CREATE OR REPLACE FUNCTION public.comm_advances_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS comm_advances_updated_at_trigger ON commission_advances;
CREATE TRIGGER comm_advances_updated_at_trigger BEFORE UPDATE ON commission_advances FOR EACH ROW EXECUTE FUNCTION public.comm_advances_updated_at();

-- Updated_at trigger for commission_config
CREATE OR REPLACE FUNCTION public.comm_config_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS comm_config_updated_at_trigger ON commission_config;
CREATE TRIGGER comm_config_updated_at_trigger BEFORE UPDATE ON commission_config FOR EACH ROW EXECUTE FUNCTION public.comm_config_updated_at();
