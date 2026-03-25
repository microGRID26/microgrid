-- 023-document-management.sql
-- Phase 1: Document Management System foundation tables

-- ── project_files — file inventory synced from Google Drive ──────────────────
CREATE TABLE IF NOT EXISTS public.project_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  folder_name TEXT,
  file_name TEXT NOT NULL,
  file_id TEXT NOT NULL,
  file_url TEXT,
  mime_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, file_id)
);

CREATE INDEX idx_project_files_project ON project_files(project_id);
CREATE INDEX idx_project_files_name ON project_files USING GIN(file_name gin_trgm_ops);
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_files_select" ON project_files FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_files_insert" ON project_files FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "project_files_update" ON project_files FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── document_requirements — admin-configurable required docs per stage ───────
CREATE TABLE IF NOT EXISTS public.document_requirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stage TEXT NOT NULL,
  task_id TEXT,
  document_type TEXT NOT NULL,
  folder_name TEXT,
  filename_pattern TEXT,
  required BOOLEAN DEFAULT true,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_doc_requirements_stage ON document_requirements(stage);
ALTER TABLE document_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doc_requirements_select" ON document_requirements FOR SELECT TO authenticated USING (true);
CREATE POLICY "doc_requirements_admin" ON document_requirements FOR ALL TO authenticated USING (auth_is_admin()) WITH CHECK (auth_is_admin());

-- ── project_documents — tracks present/missing status per project ────────────
CREATE TABLE IF NOT EXISTS public.project_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  requirement_id UUID NOT NULL REFERENCES document_requirements(id),
  file_id UUID REFERENCES project_files(id),
  status TEXT DEFAULT 'missing' CHECK (status IN ('present', 'missing', 'pending', 'verified')),
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, requirement_id)
);

CREATE INDEX idx_project_documents_project ON project_documents(project_id);
CREATE INDEX idx_project_documents_status ON project_documents(status);
ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_documents_select" ON project_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "project_documents_write" ON project_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
