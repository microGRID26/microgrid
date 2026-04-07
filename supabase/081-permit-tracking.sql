-- Migration 081: Permit Submission Tracking & SolarAPP+ Foundation
-- Adds electronic filing metadata to AHJs and a permit_submissions table
-- to track the full lifecycle of permit applications per project.
--
-- SolarAPP+ (solarapp.nrel.gov) is NREL's instant permitting platform.
-- Not all AHJs support it. This migration lays the foundation so we can
-- flag eligible AHJs and track submissions whether manual or electronic.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. AHJ E-FILING COLUMNS — mark which AHJs support electronic filing
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE ahjs ADD COLUMN IF NOT EXISTS solarapp_eligible BOOLEAN DEFAULT false;
ALTER TABLE ahjs ADD COLUMN IF NOT EXISTS efiling_url TEXT;
ALTER TABLE ahjs ADD COLUMN IF NOT EXISTS efiling_type TEXT; -- 'solarapp', 'online_portal', 'email', 'manual'

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. PERMIT_SUBMISSIONS — track each permit application lifecycle
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS permit_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  ahj_id UUID REFERENCES ahjs(id),

  -- Submission classification
  submission_type TEXT NOT NULL DEFAULT 'manual',  -- solarapp, online_portal, email, manual
  status TEXT NOT NULL DEFAULT 'draft',            -- draft, submitted, under_review, approved, rejected, revision_needed

  -- Timeline
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,

  -- Permit details
  permit_number TEXT,
  rejection_reason TEXT,
  notes TEXT,

  -- People
  submitted_by TEXT,

  -- Multi-tenant
  org_id UUID REFERENCES organizations(id),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_permit_sub_project ON permit_submissions(project_id);
CREATE INDEX IF NOT EXISTS idx_permit_sub_ahj ON permit_submissions(ahj_id);
CREATE INDEX IF NOT EXISTS idx_permit_sub_status ON permit_submissions(status);
CREATE INDEX IF NOT EXISTS idx_permit_sub_type ON permit_submissions(submission_type);
CREATE INDEX IF NOT EXISTS idx_permit_sub_org ON permit_submissions(org_id);
CREATE INDEX IF NOT EXISTS idx_permit_sub_created ON permit_submissions(created_at DESC);

-- Auto-update timestamp
CREATE TRIGGER permit_submissions_updated_at
  BEFORE UPDATE ON permit_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE permit_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permit_sub_select" ON permit_submissions FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id = ANY(auth_user_org_ids()) OR auth_is_platform_user());
CREATE POLICY "permit_sub_insert" ON permit_submissions FOR INSERT TO authenticated WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "permit_sub_update" ON permit_submissions FOR UPDATE TO authenticated USING (auth.role() = 'authenticated');
CREATE POLICY "permit_sub_delete" ON permit_submissions FOR DELETE TO authenticated USING (auth_is_super_admin());

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. AHJ INDEX for efiling lookups
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_ahjs_solarapp ON ahjs(solarapp_eligible) WHERE solarapp_eligible = true;
CREATE INDEX IF NOT EXISTS idx_ahjs_efiling_type ON ahjs(efiling_type) WHERE efiling_type IS NOT NULL;
