import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { escapeFilterValue, INACTIVE_DISPOSITION_FILTER } from '@/lib/utils'
import type { Project } from '@/types/database'

// ── Centralized project data access ─────────────────────────────────────────
// All pages should use these functions instead of querying Supabase directly.
// This gives us one place to add caching, validation, and business logic.

const PROJECT_FIELDS = 'id, name, city, address, pm, pm_id, stage, stage_date, sale_date, contract, blocker, systemkw, financier, ahj, disposition, follow_up_date, email, phone, meter_number, esid'
const PROJECT_LIMIT = 2000
const TASK_STATE_LIMIT = 50000

export interface ProjectQuery {
  pmId?: string
  orgId?: string | null
  excludeDispositions?: string[]
  includeFields?: string
  limit?: number
}

export async function loadProjects(opts: ProjectQuery = {}) {
  const fields = opts.includeFields ?? PROJECT_FIELDS
  // db() needed: select uses a dynamic field string variable, typed client resolves to 'never'
  let query = db().from('projects').select(fields).limit(opts.limit ?? PROJECT_LIMIT)

  if (opts.orgId) {
    query = query.eq('org_id', opts.orgId)
  }

  if (opts.pmId) {
    query = query.eq('pm_id', opts.pmId)
  }

  if (opts.excludeDispositions?.length) {
    // Use properly escaped quoted values for the PostgREST not-in filter
    const quotedList = opts.excludeDispositions
      .map(d => `"${d.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',')
    query = query.not('disposition', 'in', `(${quotedList})`)
  }

  const { data, error } = await query
  if (error) console.error('projects load failed:', error)
  return { data: data ?? [], error }
}

export async function loadTaskStates(projectIds?: string[]) {
  const supabase = createClient()

  if (projectIds && projectIds.length <= 500) {
    // Batch by project IDs — use Promise.all for parallel fetching
    const chunks: string[][] = []
    for (let i = 0; i < projectIds.length; i += 100) {
      chunks.push(projectIds.slice(i, i + 100))
    }
    const results = await Promise.all(
      chunks.map(chunk =>
        supabase.from('task_state')
          .select('project_id, task_id, status, reason, follow_up_date, completed_date')
          .in('project_id', chunk)
      )
    )
    const allTasks: any[] = []
    for (const { data, error } of results) {
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
  const { data, error } = await supabase.from('project_funding').select('project_id, m1_amount, m1_funded_date, m1_cb, m1_cb_credit, m1_notes, m1_status, m2_amount, m2_funded_date, m2_cb, m2_cb_credit, m2_notes, m2_status, m3_amount, m3_funded_date, m3_projected, m3_notes, m3_status, nonfunded_code_1, nonfunded_code_2, nonfunded_code_3').limit(limit)
  if (error) console.error('project_funding load failed:', error)
  return { data: data ?? [], error }
}

export async function updateProject(projectId: string, updates: Record<string, any>) {
  const { error } = await db().from('projects').update(updates).eq('id', projectId)
  if (error) console.error('project update failed:', error)
  return { error }
}

/** Load a single project by ID — returns all columns for project detail panel */
export async function loadProjectById(projectId: string): Promise<Project | null> {
  const supabase = createClient()
  // select('*') intentional: single-record fetch for detail view uses all 50+ Project columns
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single()
  if (error) console.error('project load by id failed:', error)
  return (data as Project | null) ?? null
}

/** Load multiple projects by IDs (batch lookup) */
export async function loadProjectsByIds(projectIds: string[]): Promise<Project[]> {
  if (!projectIds.length) return []
  const supabase = createClient()
  // Batch by 100 IDs — use Promise.all for parallel fetching
  const chunks: string[][] = []
  for (let i = 0; i < projectIds.length; i += 100) {
    chunks.push(projectIds.slice(i, i + 100))
  }
  const results = await Promise.all(
    chunks.map(chunk =>
      supabase.from('projects').select('id, name').in('id', chunk).limit(100)
    )
  )
  const allProjects: Project[] = []
  for (const { data, error } of results) {
    if (error) console.error('projects batch load failed:', error)
    if (data) allProjects.push(...(data as unknown as Project[]))
  }
  return allProjects
}

/** Search projects by name or ID (for typeahead/autocomplete) */
export async function searchProjects(query: string, limit = 10): Promise<Pick<Project, 'id' | 'name' | 'city' | 'pm' | 'pm_id' | 'systemkw' | 'module' | 'module_qty' | 'financier' | 'financing_type' | 'contract' | 'tpo_escalator' | 'financier_adv_pmt' | 'down_payment'>[]> {
  const supabase = createClient()
  const escaped = escapeFilterValue(query)
  const { data, error } = await supabase.from('projects')
    .select('id, name, city, pm, pm_id, systemkw, module, module_qty, financier, financing_type, contract, tpo_escalator, financier_adv_pmt, down_payment')
    .or(`name.ilike.%${escaped}%,id.ilike.%${escaped}%`)
    .not('disposition', 'in', INACTIVE_DISPOSITION_FILTER)
    .limit(limit)
  if (error) console.error('project search failed:', error)
  return (data ?? []) as Pick<Project, 'id' | 'name' | 'city' | 'pm' | 'pm_id' | 'systemkw' | 'module' | 'module_qty' | 'financier' | 'financing_type' | 'contract' | 'tpo_escalator' | 'financier_adv_pmt' | 'down_payment'>[]
}

/** Load projects with map-relevant fields only (for map views). Excludes inactive dispositions. */
export async function loadProjectsForMap(orgId?: string) {
  const MAP_FIELDS = 'id, name, address, city, zip, stage, systemkw, pm, blocker'
  let query = db().from('projects')
    .select(MAP_FIELDS)
    .not('disposition', 'in', INACTIVE_DISPOSITION_FILTER)
    .not('zip', 'is', null)
    .limit(2000)
  if (orgId) query = query.eq('org_id', orgId)
  const { data, error } = await query
  if (error) console.error('projects map load failed:', error)
  return { data: data ?? [], error }
}

export async function loadUsers(domainFilter?: string | string[]) {
  const supabase = createClient()
  let query = supabase.from('users').select('id, name, email, role').eq('active', true).order('name').limit(500)
  if (domainFilter) {
    const domains = Array.isArray(domainFilter) ? domainFilter : [domainFilter]
    const safe = domains.map(d => d.replace(/[,%_\\()]/g, ''))
    if (safe.length === 1) {
      query = query.like('email', `%@${safe[0]}`)
    } else {
      query = query.or(safe.map(d => `email.like.%@${d}`).join(','))
    }
  }
  const { data, error } = await query
  if (error) console.error('users load failed:', error)
  return { data: data ?? [], error }
}
