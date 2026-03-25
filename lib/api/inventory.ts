// lib/api/inventory.ts — Project materials and warehouse stock data access
import { db } from '@/lib/db'

export interface ProjectMaterial {
  id: string
  project_id: string
  equipment_id: string | null
  name: string
  category: string
  quantity: number
  unit: string
  source: string
  vendor: string | null
  status: string
  po_number: string | null
  expected_date: string | null
  delivered_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface WarehouseStock {
  id: string
  equipment_id: string | null
  name: string
  category: string
  quantity_on_hand: number
  reorder_point: number
  unit: string
  location: string | null
  last_counted_at: string | null
  updated_at: string
}

export const MATERIAL_STATUSES = ['needed', 'ordered', 'shipped', 'delivered', 'installed'] as const
export type MaterialStatus = typeof MATERIAL_STATUSES[number]

export const MATERIAL_SOURCES = ['dropship', 'warehouse', 'tbd'] as const
export type MaterialSource = typeof MATERIAL_SOURCES[number]

export const MATERIAL_CATEGORIES = ['module', 'inverter', 'battery', 'optimizer', 'racking', 'electrical', 'other'] as const
export type MaterialCategory = typeof MATERIAL_CATEGORIES[number]

/**
 * Load all materials for a project.
 */
export async function loadProjectMaterials(projectId: string): Promise<ProjectMaterial[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('project_materials')
    .select('*')
    .eq('project_id', projectId)
    .order('category')
    .order('name')
  if (error) console.error('[loadProjectMaterials]', error.message)
  return (data ?? []) as ProjectMaterial[]
}

/**
 * Add a material to a project.
 */
export async function addProjectMaterial(
  material: Omit<ProjectMaterial, 'id' | 'created_at' | 'updated_at'>
): Promise<ProjectMaterial | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('project_materials')
    .insert(material)
    .select()
    .single()
  if (error) {
    console.error('[addProjectMaterial]', error.message)
    return null
  }
  return data as ProjectMaterial
}

/**
 * Update a project material.
 */
export async function updateProjectMaterial(
  id: string,
  updates: Partial<ProjectMaterial>
): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('project_materials')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[updateProjectMaterial]', error.message)
    return false
  }
  return true
}

/**
 * Delete a project material.
 */
export async function deleteProjectMaterial(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('project_materials')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteProjectMaterial]', error.message)
    return false
  }
  return true
}

/**
 * Auto-generate materials from a project's equipment fields.
 * Only adds items not already present (dedup by equipment_id or name+category).
 */
export async function autoGenerateMaterials(
  projectId: string,
  project: {
    module: string | null
    module_qty: number | null
    inverter: string | null
    inverter_qty: number | null
    battery: string | null
    battery_qty: number | null
    optimizer: string | null
    optimizer_qty: number | null
  }
): Promise<ProjectMaterial[]> {
  const supabase = db()

  // Load existing materials for dedup
  const existing = await loadProjectMaterials(projectId)
  const existingKeys = new Set(existing.map(m => `${m.category}:${m.name}`))

  // Build list of equipment to add
  const equipmentToAdd: { name: string; category: string; qty: number; source: string }[] = []

  if (project.module && (project.module_qty ?? 0) > 0) {
    equipmentToAdd.push({ name: project.module, category: 'module', qty: project.module_qty ?? 0, source: 'dropship' })
  }
  if (project.inverter && (project.inverter_qty ?? 0) > 0) {
    equipmentToAdd.push({ name: project.inverter, category: 'inverter', qty: project.inverter_qty ?? 0, source: 'dropship' })
  }
  if (project.battery && (project.battery_qty ?? 0) > 0) {
    equipmentToAdd.push({ name: project.battery, category: 'battery', qty: project.battery_qty ?? 0, source: 'dropship' })
  }
  if (project.optimizer && (project.optimizer_qty ?? 0) > 0) {
    equipmentToAdd.push({ name: project.optimizer, category: 'optimizer', qty: project.optimizer_qty ?? 0, source: 'tbd' })
  }

  // Filter out already-existing items
  const toInsert = equipmentToAdd.filter(e => !existingKeys.has(`${e.category}:${e.name}`))

  if (toInsert.length === 0) return []

  // Look up equipment_ids from equipment table
  const names = toInsert.map(e => e.name)
  const { data: equipRows } = await supabase
    .from('equipment')
    .select('id, name')
    .in('name', names)
  const nameToId: Record<string, string> = {}
  for (const row of (equipRows ?? []) as { id: string; name: string }[]) {
    nameToId[row.name] = row.id
  }

  // Insert materials
  const rows = toInsert.map(e => ({
    project_id: projectId,
    equipment_id: nameToId[e.name] ?? null,
    name: e.name,
    category: e.category,
    quantity: e.qty,
    unit: 'each',
    source: e.source,
    status: 'needed',
  }))

  const { data, error } = await supabase
    .from('project_materials')
    .insert(rows)
    .select()
  if (error) {
    console.error('[autoGenerateMaterials]', error.message)
    return []
  }
  return (data ?? []) as ProjectMaterial[]
}

/**
 * Load warehouse stock, optionally filtered by category.
 */
export async function loadWarehouseStock(category?: string): Promise<WarehouseStock[]> {
  const supabase = db()
  let q = supabase.from('warehouse_stock').select('*').order('category').order('name')
  if (category) q = q.eq('category', category)
  const { data, error } = await q
  if (error) console.error('[loadWarehouseStock]', error.message)
  return (data ?? []) as WarehouseStock[]
}

/**
 * Load all project materials across all projects (for inventory overview).
 */
export async function loadAllProjectMaterials(filters?: {
  status?: string
  category?: string
  source?: string
}): Promise<(ProjectMaterial & { project_name?: string })[]> {
  const supabase = db()
  let q = supabase
    .from('project_materials')
    .select('*, projects!project_materials_project_id_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.category) q = q.eq('category', filters.category)
  if (filters?.source) q = q.eq('source', filters.source)
  const { data, error } = await q
  if (error) {
    // Fallback without join if FK doesn't exist
    console.error('[loadAllProjectMaterials] join failed, falling back:', error.message)
    let q2 = supabase
      .from('project_materials')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (filters?.status) q2 = q2.eq('status', filters.status)
    if (filters?.category) q2 = q2.eq('category', filters.category)
    if (filters?.source) q2 = q2.eq('source', filters.source)
    const { data: d2, error: e2 } = await q2
    if (e2) console.error('[loadAllProjectMaterials]', e2.message)
    return (d2 ?? []) as ProjectMaterial[]
  }
  return (data ?? []).map((row: any) => ({
    ...row,
    project_name: row.projects?.name ?? null,
    projects: undefined,
  })) as (ProjectMaterial & { project_name?: string })[]
}
