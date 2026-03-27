-- 034-warranty-tracking.sql — Equipment warranty tracking and claim management

CREATE TABLE IF NOT EXISTS public.equipment_warranties (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  equipment_type TEXT NOT NULL, -- panel, inverter, battery, optimizer
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  quantity INTEGER DEFAULT 1,
  install_date DATE,
  warranty_start_date DATE,
  warranty_end_date DATE,
  warranty_years INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warranty_claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  warranty_id UUID NOT NULL REFERENCES equipment_warranties(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  claim_number TEXT,
  status TEXT DEFAULT 'draft', -- draft, submitted, approved, denied, completed
  issue_description TEXT,
  submitted_date DATE,
  resolved_date DATE,
  resolution_notes TEXT,
  replacement_serial TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ew_project ON equipment_warranties(project_id);
CREATE INDEX idx_ew_serial ON equipment_warranties(serial_number);
CREATE INDEX idx_ew_end_date ON equipment_warranties(warranty_end_date);

CREATE INDEX idx_wc_warranty ON warranty_claims(warranty_id);
CREATE INDEX idx_wc_project ON warranty_claims(project_id);
CREATE INDEX idx_wc_status ON warranty_claims(status);

-- RLS: Permissive policies for all authenticated users.
ALTER TABLE equipment_warranties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ew_select" ON equipment_warranties FOR SELECT TO authenticated USING (true);
CREATE POLICY "ew_insert" ON equipment_warranties FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ew_update" ON equipment_warranties FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wc_select" ON warranty_claims FOR SELECT TO authenticated USING (true);
CREATE POLICY "wc_insert" ON warranty_claims FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "wc_update" ON warranty_claims FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
