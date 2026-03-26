-- 030-work-orders.sql — Work order system for field work tracking and completion

CREATE TABLE IF NOT EXISTS public.work_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  wo_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL, -- install, service, inspection, repair, survey
  status TEXT DEFAULT 'draft', -- draft, assigned, in_progress, complete, cancelled
  assigned_crew TEXT,
  assigned_to TEXT, -- specific person
  scheduled_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  priority TEXT DEFAULT 'normal', -- low, normal, high, urgent
  description TEXT,
  special_instructions TEXT,
  customer_signature BOOLEAN DEFAULT false,
  customer_signed_at TIMESTAMPTZ,
  materials_used JSONB DEFAULT '[]',
  time_on_site_minutes INTEGER,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wo_checklist_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  completed_by TEXT,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  photo_url TEXT
);

CREATE INDEX idx_wo_project ON work_orders(project_id);
CREATE INDEX idx_wo_status ON work_orders(status);
CREATE INDEX idx_wo_date ON work_orders(scheduled_date);
CREATE INDEX idx_wo_crew ON work_orders(assigned_crew);
CREATE INDEX idx_wo_checklist ON wo_checklist_items(work_order_id);

ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wo_select" ON work_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "wo_insert" ON work_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "wo_update" ON work_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE wo_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "woci_select" ON wo_checklist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "woci_insert" ON wo_checklist_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "woci_update" ON wo_checklist_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "woci_delete" ON wo_checklist_items FOR DELETE TO authenticated USING (true);
