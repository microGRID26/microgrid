// lib/api/work-orders.ts — Work order data access layer
import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'
import { escapeIlike } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkOrder {
  id: string
  project_id: string
  wo_number: string
  type: string
  status: string
  assigned_crew: string | null
  assigned_to: string | null
  scheduled_date: string | null
  started_at: string | null
  completed_at: string | null
  priority: string
  description: string | null
  special_instructions: string | null
  customer_signature: boolean
  customer_signed_at: string | null
  materials_used: Record<string, unknown>[]
  time_on_site_minutes: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined project data (optional)
  project?: { name: string; city: string | null; address: string | null; pm: string | null } | null
}

export interface WOChecklistItem {
  id: string
  work_order_id: string
  description: string
  completed: boolean
  completed_by: string | null
  completed_at: string | null
  sort_order: number
  notes: string | null
  photo_url: string | null
}

// ── Default Checklist Templates ──────────────────────────────────────────────

export const WO_CHECKLIST_TEMPLATES: Record<string, string[]> = {
  install: [
    'Verify equipment delivery',
    'Roof preparation',
    'Panel installation',
    'Electrical wiring',
    'Inverter installation',
    'Battery installation (if applicable)',
    'System test',
    'Cleanup',
    'Customer walkthrough',
  ],
  inspection: [
    'Verify permit on site',
    'Visual inspection',
    'Electrical test',
    'Photo documentation',
    'Submit inspection results',
  ],
  service: [
    'Diagnose issue',
    'Perform repair/maintenance',
    'Test system',
    'Customer sign-off',
  ],
  survey: [
    'Roof measurement',
    'Electrical panel assessment',
    'Photos (roof, panel, meter, property)',
    'Shade analysis',
    'Customer questions',
  ],
  repair: [
    'Diagnose issue',
    'Identify parts needed',
    'Perform repair',
    'Test system',
    'Cleanup',
    'Customer sign-off',
  ],
}

// ── Valid status transitions ─────────────────────────────────────────────────

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['complete', 'cancelled'],
  complete: [],
  cancelled: [],
}

export function getValidTransitions(currentStatus: string): string[] {
  return STATUS_TRANSITIONS[currentStatus] ?? []
}

// ── WO Number Generation ─────────────────────────────────────────────────────

export async function generateWONumber(): Promise<string> {
  const supabase = createClient()
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `WO-${dateStr}-`

  // Find highest existing number for today
  const { data } = await supabase
    .from('work_orders')
    .select('wo_number')
    .like('wo_number', `${escapeIlike(prefix)}%`)
    .order('wo_number', { ascending: false })
    .limit(1)

  let nextNum = 1
  if (data && data.length > 0) {
    const lastNum = parseInt((data[0] as { wo_number: string }).wo_number.split('-').pop() ?? '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${String(nextNum).padStart(3, '0')}`
}

// ── CRUD Operations ──────────────────────────────────────────────────────────

export interface WorkOrderFilters {
  status?: string
  type?: string
  projectId?: string
  crewId?: string
  dateRange?: { start: string; end: string }
}

export async function loadWorkOrders(filters?: WorkOrderFilters): Promise<WorkOrder[]> {
  const supabase = createClient()
  let query = supabase
    .from('work_orders')
    .select('*')
    .order('scheduled_date', { ascending: false })
    .limit(500)

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.type) query = query.eq('type', filters.type)
  if (filters?.projectId) query = query.eq('project_id', filters.projectId)
  if (filters?.crewId) query = query.eq('assigned_crew', filters.crewId)
  if (filters?.dateRange) {
    query = query.gte('scheduled_date', filters.dateRange.start).lte('scheduled_date', filters.dateRange.end)
  }

  const { data, error } = await query
  if (error) { console.error('loadWorkOrders failed:', error); return [] }

  // Join project data
  const workOrders = (data ?? []) as WorkOrder[]
  const projectIds = [...new Set(workOrders.map(wo => wo.project_id).filter(Boolean))]
  if (projectIds.length > 0) {
    const { data: projData } = await supabase
      .from('projects')
      .select('id, name, city, address, pm')
      .in('id', projectIds)
    if (projData) {
      const projMap: Record<string, { name: string; city: string | null; address: string | null; pm: string | null }> = {}
      ;(projData as { id: string; name: string; city: string | null; address: string | null; pm: string | null }[]).forEach(p => {
        projMap[p.id] = { name: p.name, city: p.city, address: p.address, pm: p.pm }
      })
      workOrders.forEach(wo => { wo.project = projMap[wo.project_id] ?? null })
    }
  }

  return workOrders
}

export async function loadWorkOrder(id: string): Promise<{ wo: WorkOrder; checklist: WOChecklistItem[] } | null> {
  const supabase = createClient()
  const [woRes, checkRes] = await Promise.all([
    supabase.from('work_orders').select('*').eq('id', id).maybeSingle(),
    supabase.from('wo_checklist_items').select('*').eq('work_order_id', id).order('sort_order', { ascending: true }),
  ])

  if (woRes.error || !woRes.data) {
    console.error('loadWorkOrder failed:', woRes.error)
    return null
  }

  const wo = woRes.data as WorkOrder
  // Join project
  if (wo.project_id) {
    const { data: projData } = await supabase
      .from('projects')
      .select('id, name, city, address, pm')
      .eq('id', wo.project_id)
      .maybeSingle()
    if (projData) {
      const p = projData as { id: string; name: string; city: string | null; address: string | null; pm: string | null }
      wo.project = { name: p.name, city: p.city, address: p.address, pm: p.pm }
    }
  }

  return {
    wo,
    checklist: (checkRes.data ?? []) as WOChecklistItem[],
  }
}

export async function createWorkOrder(
  wo: Omit<WorkOrder, 'id' | 'wo_number' | 'created_at' | 'updated_at' | 'project'>,
  checklistItems?: string[]
): Promise<WorkOrder | null> {
  // Retry up to 3 times on unique constraint violation (concurrent WO number race)
  let data: unknown = null
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const woNumber = await generateWONumber()
    const result = await db()
      .from('work_orders')
      .insert({ ...wo, wo_number: woNumber })
      .select()
      .single()

    if (!result.error) {
      data = result.data
      lastError = null
      break
    }

    // PostgreSQL unique violation = code 23505
    if (result.error.code === '23505') {
      console.warn(`WO number conflict (attempt ${attempt + 1}/3), retrying...`)
      lastError = result.error
      continue
    }

    // Non-retryable error
    console.error('createWorkOrder failed:', result.error)
    return null
  }

  if (lastError || !data) {
    console.error('createWorkOrder failed after 3 retries:', lastError)
    return null
  }

  const created = data as WorkOrder

  // Insert checklist items
  const items = checklistItems ?? WO_CHECKLIST_TEMPLATES[wo.type] ?? []
  if (items.length > 0) {
    const checklistRows = items.map((desc, i) => ({
      work_order_id: created.id,
      description: desc,
      sort_order: i,
    }))
    const { error: checkErr } = await db().from('wo_checklist_items').insert(checklistRows)
    if (checkErr) console.error('checklist insert failed:', checkErr)
  }

  return created
}

export async function updateWorkOrder(id: string, updates: Partial<WorkOrder>): Promise<boolean> {
  const { error } = await db()
    .from('work_orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) { console.error('updateWorkOrder failed:', error); return false }
  return true
}

export async function updateWorkOrderStatus(id: string, status: string): Promise<boolean> {
  // Load current WO to validate transition
  const supabase = createClient()
  const { data: current, error: loadErr } = await supabase
    .from('work_orders')
    .select('status')
    .eq('id', id)
    .maybeSingle()

  if (loadErr || !current) {
    console.error('updateWorkOrderStatus: failed to load current WO:', loadErr)
    return false
  }

  const currentStatus = (current as { status: string }).status
  const allowed = getValidTransitions(currentStatus)
  if (!allowed.includes(status)) {
    console.warn(`updateWorkOrderStatus: invalid transition from "${currentStatus}" to "${status}" (allowed: ${allowed.join(', ')})`)
    return false
  }

  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() }

  if (status === 'in_progress') {
    updates.started_at = new Date().toISOString()
  }
  if (status === 'complete') {
    updates.completed_at = new Date().toISOString()
  }

  const { error } = await db().from('work_orders').update(updates).eq('id', id)
  if (error) { console.error('updateWorkOrderStatus failed:', error); return false }
  return true
}

// ── Checklist Operations ─────────────────────────────────────────────────────

export async function addChecklistItem(workOrderId: string, description: string): Promise<WOChecklistItem | null> {
  // Get max sort_order
  const supabase = createClient()
  const { data: existing } = await supabase
    .from('wo_checklist_items')
    .select('sort_order')
    .eq('work_order_id', workOrderId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = existing && existing.length > 0 ? (existing[0] as { sort_order: number }).sort_order + 1 : 0

  const { data, error } = await db()
    .from('wo_checklist_items')
    .insert({ work_order_id: workOrderId, description, sort_order: nextOrder })
    .select()
    .single()

  if (error) { console.error('addChecklistItem failed:', error); return null }
  return data as WOChecklistItem
}

export async function toggleChecklistItem(id: string, completed: boolean, completedBy: string): Promise<boolean> {
  const updates: Record<string, unknown> = {
    completed,
    completed_by: completed ? completedBy : null,
    completed_at: completed ? new Date().toISOString() : null,
  }

  const { error } = await db().from('wo_checklist_items').update(updates).eq('id', id)
  if (error) { console.error('toggleChecklistItem failed:', error); return false }
  return true
}

export async function deleteChecklistItem(id: string): Promise<boolean> {
  const { error } = await db().from('wo_checklist_items').delete().eq('id', id)
  if (error) { console.error('deleteChecklistItem failed:', error); return false }
  return true
}

// ── Create from Project (convenience) ────────────────────────────────────────

export async function createWorkOrderFromProject(
  projectId: string,
  type: string,
  project: { name: string; address: string | null; city: string | null },
  options?: { crew?: string; assignedTo?: string; date?: string; priority?: string; createdBy?: string }
): Promise<WorkOrder | null> {
  const description = `${type.charAt(0).toUpperCase() + type.slice(1)} work order for ${project.name}`
  const address = [project.address, project.city].filter(Boolean).join(', ')

  return createWorkOrder({
    project_id: projectId,
    type,
    status: options?.crew ? 'assigned' : 'draft',
    assigned_crew: options?.crew ?? null,
    assigned_to: options?.assignedTo ?? null,
    scheduled_date: options?.date ?? null,
    started_at: null,
    completed_at: null,
    priority: options?.priority ?? 'normal',
    description,
    special_instructions: address ? `Location: ${address}` : null,
    customer_signature: false,
    customer_signed_at: null,
    materials_used: [],
    time_on_site_minutes: null,
    notes: null,
    created_by: options?.createdBy ?? null,
  })
}

// ── Load work orders for a project ───────────────────────────────────────────

export async function loadProjectWorkOrders(projectId: string): Promise<WorkOrder[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('work_orders')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) { console.error('loadProjectWorkOrders failed:', error); return [] }
  return (data ?? []) as WorkOrder[]
}
