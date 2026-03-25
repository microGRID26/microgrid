import { db } from '@/lib/db'

export interface ProjectFile {
  id: string
  project_id: string
  folder_name: string | null
  file_name: string
  file_id: string
  file_url: string | null
  mime_type: string | null
  file_size: number | null
  created_at: string | null
  updated_at: string | null
  synced_at: string | null
}

export interface DocumentRequirement {
  id: string
  stage: string
  task_id: string | null
  document_type: string
  folder_name: string | null
  filename_pattern: string | null
  required: boolean
  description: string | null
  sort_order: number
  active: boolean
}

export interface ProjectDocument {
  id: string
  project_id: string
  requirement_id: string
  file_id: string | null
  status: 'present' | 'missing' | 'pending' | 'verified'
  verified_by: string | null
  verified_at: string | null
  notes: string | null
}

export async function loadProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const { data, error } = await db()
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .order('folder_name')
    .order('file_name')
  if (error) { console.error('loadProjectFiles error:', error); return [] }
  return (data ?? []) as ProjectFile[]
}

export async function searchProjectFiles(projectId: string, query: string): Promise<ProjectFile[]> {
  const { data, error } = await db()
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .ilike('file_name', `%${query}%`)
    .order('file_name')
    .limit(50)
  if (error) { console.error('searchProjectFiles error:', error); return [] }
  return (data ?? []) as ProjectFile[]
}

export async function searchAllProjectFiles(
  query: string,
  page: number = 1,
  pageSize: number = 50
): Promise<{ data: ProjectFile[]; count: number }> {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await db()
    .from('project_files')
    .select('*', { count: 'exact' })
    .ilike('file_name', `%${query}%`)
    .order('project_id')
    .order('file_name')
    .range(from, to)
  if (error) { console.error('searchAllProjectFiles error:', error); return { data: [], count: 0 } }
  return { data: (data ?? []) as ProjectFile[], count: count ?? 0 }
}

export async function loadAllProjectFiles(
  page: number = 1,
  pageSize: number = 50
): Promise<{ data: ProjectFile[]; count: number }> {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, error, count } = await db()
    .from('project_files')
    .select('*', { count: 'exact' })
    .order('project_id')
    .order('file_name')
    .range(from, to)
  if (error) { console.error('loadAllProjectFiles error:', error); return { data: [], count: 0 } }
  return { data: (data ?? []) as ProjectFile[], count: count ?? 0 }
}

export async function loadDocumentRequirements(stage?: string): Promise<DocumentRequirement[]> {
  let query = db().from('document_requirements').select('*').eq('active', true).order('sort_order')
  if (stage) query = query.eq('stage', stage)
  const { data, error } = await query
  if (error) { console.error('loadDocumentRequirements error:', error); return [] }
  return (data ?? []) as DocumentRequirement[]
}

export async function loadProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  const { data, error } = await db()
    .from('project_documents')
    .select('*')
    .eq('project_id', projectId)
  if (error) { console.error('loadProjectDocuments error:', error); return [] }
  return (data ?? []) as ProjectDocument[]
}

export async function updateDocumentStatus(
  projectId: string,
  requirementId: string,
  status: 'present' | 'missing' | 'pending' | 'verified',
  verifiedBy?: string
): Promise<boolean> {
  const update: Record<string, unknown> = { status }
  if (status === 'verified' && verifiedBy) {
    update.verified_by = verifiedBy
    update.verified_at = new Date().toISOString()
  }
  const { error } = await db()
    .from('project_documents')
    .update(update)
    .eq('project_id', projectId)
    .eq('requirement_id', requirementId)
  if (error) { console.error('updateDocumentStatus error:', error); return false }
  return true
}
