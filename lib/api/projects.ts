import { createClient } from '@/lib/supabase/client'
import { escapeIlike } from '@/lib/utils'
import type { Project } from '@/types/database'

// ── Centralized project data access ─────────────────────────────────────────
// All pages should use these functions instead of querying Supabase directly.
// This gives us one place to add caching, validation, and business logic.

const PROJECT_FIELDS = 'id, name, city, address, pm, pm_id, stage, stage_date, sale_date, contract, blocker, systemkw, financier, ahj, disposition, follow_up_date, email, phone'
const PROJECT_LIMIT = 2000
const TASK_STATE_LIMIT = 50000

export interface ProjectQuery {
  pmId?: string
  excludeDispositions?: string[]
  includeFields?: string
  limit?: number
}

export async function loadProjects(opts: ProjectQuery = {}) {
  const supabase = createClient()
  const fields = opts.includeFields ?? PROJECT_FIELDS
  let query = (supabase as any).from('projects').select(fields).limit(opts.limit ?? PROJECT_LIMIT)

  if (opts.pmId) {
    query = query.eq('pm_id', opts.pmId)
  }

  if (opts.excludeDispositions?.length) {
    // Sanitize disposition values to prevent injection via the raw filter string
    const safeList = opts.excludeDispositions.map(d => d.replace(/[^a-zA-Z_ ]/g, '')).join(',')
    query = query.not('disposition', 'in', `(${safeList})`)
  }

  const { data, error } = await query
  if (error) console.error('projects load failed:', error)
  return { data: data ?? [], error }
}

export async function loadTaskStates(projectIds?: string[]) {
  const supabase = createClient()

  if (projectIds && projectIds.length <= 500) {
    // Batch by project IDs for smaller sets
    const allTasks: any[] = []
    for (let i = 0; i < projectIds.length; i += 100) {
      const chunk = projectIds.slice(i, i + 100)
      const { data, error } = await supabase.from('task_state')
        .select('project_id, task_id, status, reason, follow_up_date, completed_date')
        .in('project_id', chunk)
      if (error) console.error('task_state batch failed:', error)
      if (data) allTasks.push(...data)
    }
    return { data: allTasks, error: null }
  }

  // Load all with limit
  const { data, error } = await supabase.from('task_state')
    .select('project_id, task_id, status, reason, follow_up_date, completed_date')
    .limit(TASK_STATE_LIMIT)
  if (error) console.error('task_state load failed:', error)
  return { data: data ?? [], error }
}

export async function loadProjectFunding(limit = PROJECT_LIMIT) {
  const supabase = createClient()
  const { data, error } = await (supabase as any).from('project_funding').select('*').limit(limit)
  if (error) console.error('project_funding load failed:', error)
  return { data: data ?? [], error }
}

export async function updateProject(projectId: string, updates: Record<string, any>) {
  const supabase = createClient()
  const { error } = await (supabase as any).from('projects').update(updates).eq('id', projectId)
  if (error) console.error('project update failed:', error)
  return { error }
}

/** Load a single project by ID */
export async function loadProjectById(projectId: string): Promise<Project | null> {
  const supabase = createClient()
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single()
  if (error) console.error('project load by id failed:', error)
  return (data as Project | null) ?? null
}

/** Load multiple projects by IDs (batch lookup) */
export async function loadProjectsByIds(projectIds: string[]): Promise<Project[]> {
  if (!projectIds.length) return []
  const supabase = createClient()
  const allProjects: Project[] = []
  for (let i = 0; i < projectIds.length; i += 100) {
    const chunk = projectIds.slice(i, i + 100)
    const { data, error } = await supabase.from('projects').select('id, name').in('id', chunk)
    if (error) console.error('projects batch load failed:', error)
    if (data) allProjects.push(...(data as unknown as Project[]))
  }
  return allProjects
}

/** Search projects by name or ID (for typeahead/autocomplete) */
export async function searchProjects(query: string, limit = 10): Promise<Pick<Project, 'id' | 'name' | 'city' | 'pm' | 'pm_id' | 'systemkw' | 'module' | 'module_qty' | 'financier' | 'financing_type' | 'contract' | 'tpo_escalator' | 'financier_adv_pmt' | 'down_payment'>[]> {
  const supabase = createClient()
  const escaped = escapeIlike(query)
  const { data, error } = await (supabase as any).from('projects')
    .select('id, name, city, pm, pm_id, systemkw, module, module_qty, financier, financing_type, contract, tpo_escalator, financier_adv_pmt, down_payment')
    .or(`name.ilike.%${escaped}%,id.ilike.%${escaped}%`)
    .limit(limit)
  if (error) console.error('project search failed:', error)
  return (data ?? []) as Pick<Project, 'id' | 'name' | 'city' | 'pm' | 'pm_id' | 'systemkw' | 'module' | 'module_qty' | 'financier' | 'financing_type' | 'contract' | 'tpo_escalator' | 'financier_adv_pmt' | 'down_payment'>[]
}

export async function loadUsers(domainFilter?: string) {
  const supabase = createClient()
  let query = (supabase as any).from('users').select('id, name, email, role').eq('active', true).order('name')
  if (domainFilter) {
    query = query.like('email', `%@${domainFilter}`)
  }
  const { data, error } = await query
  if (error) console.error('users load failed:', error)
  return { data: data ?? [], error }
}
