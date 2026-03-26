-- 029-vendors.sql — Vendor management table

CREATE TABLE IF NOT EXISTS public.vendors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  category TEXT, -- manufacturer, distributor, subcontractor, other
  equipment_types TEXT[], -- what they supply: modules, inverters, batteries, racking, electrical
  lead_time_days INTEGER, -- typical lead time
  payment_terms TEXT, -- Net 30, COD, etc.
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vendors_name ON vendors USING GIN(name gin_trgm_ops);
CREATE INDEX idx_vendors_category ON vendors(category);
CREATE INDEX idx_vendors_active ON vendors(active) WHERE active = true;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendors_select" ON vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "vendors_insert" ON vendors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "vendors_update" ON vendors FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "vendors_delete" ON vendors FOR DELETE TO authenticated USING (auth_is_super_admin());
