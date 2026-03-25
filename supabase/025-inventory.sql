-- 025-inventory.sql — Project material lists and warehouse stock
-- Phase 1 of Inventory Management System

-- Project material list — what each project needs
CREATE TABLE IF NOT EXISTS public.project_materials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  equipment_id UUID REFERENCES equipment(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL, -- module, inverter, battery, optimizer, racking, electrical, other
  quantity INTEGER NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'each', -- each, ft, box, roll
  source TEXT DEFAULT 'dropship', -- dropship, warehouse, tbd
  vendor TEXT,
  status TEXT DEFAULT 'needed', -- needed, ordered, shipped, delivered, installed
  po_number TEXT,
  expected_date DATE,
  delivered_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_project_materials_project ON project_materials(project_id);
CREATE INDEX idx_project_materials_status ON project_materials(status);
CREATE INDEX idx_project_materials_equipment ON project_materials(equipment_id);
ALTER TABLE project_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_materials_select" ON project_materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_materials_insert" ON project_materials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "project_materials_update" ON project_materials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "project_materials_delete" ON project_materials FOR DELETE TO authenticated USING (true);

-- BOS warehouse stock levels
CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  equipment_id UUID REFERENCES equipment(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER DEFAULT 0,
  unit TEXT DEFAULT 'each',
  location TEXT, -- shelf/bin location
  last_counted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_warehouse_stock_equipment ON warehouse_stock(equipment_id);
CREATE INDEX idx_warehouse_stock_category ON warehouse_stock(category);
ALTER TABLE warehouse_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "warehouse_stock_select" ON warehouse_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "warehouse_stock_insert" ON warehouse_stock FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "warehouse_stock_update" ON warehouse_stock FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
