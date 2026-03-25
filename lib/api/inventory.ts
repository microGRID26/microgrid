// lib/api/inventory.ts — Project materials, warehouse stock, and purchase order data access
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import type { PurchaseOrder, POLineItem } from '@/types/database'

export type { PurchaseOrder, POLineItem }

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
}): Promise<(ProjectMaterial & { project_name: string | null })[]> {
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
    return (d2 ?? []).map((r: unknown) => ({ ...(r as ProjectMaterial), project_name: null as string | null }))
  }
  return (data ?? []).map((row: Record<string, unknown>) => {
    const { projects: projectJoin, ...rest } = row
    return {
      ...rest,
      project_name: (projectJoin as { name?: string } | null)?.name ?? null,
    }
  }) as (ProjectMaterial & { project_name: string | null })[]
}

// ── Purchase Order constants ──────────────────────────────────────────────────
export const PO_STATUSES = ['draft', 'submitted', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const
export type POStatus = typeof PO_STATUSES[number]

export const PO_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  submitted: 'bg-blue-500/20 text-blue-400',
  confirmed: 'bg-indigo-500/20 text-indigo-400',
  shipped: 'bg-amber-500/20 text-amber-400',
  delivered: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-400',
}

/**
 * Generate a PO number in format PO-YYYYMMDD-NNN
 */
export async function generatePONumber(): Promise<string> {
  const supabase = db()
  const today = new Date()
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '')
  const prefix = `PO-${dateStr}-`

  // Find the highest existing PO number with today's prefix
  const { data } = await supabase
    .from('purchase_orders')
    .select('po_number')
    .like('po_number', `${escapeIlike(prefix)}%`)
    .order('po_number', { ascending: false })
    .limit(1)

  let seq = 1
  if (data && data.length > 0) {
    const row = data[0] as { po_number: string }
    const lastSeq = Number(row.po_number.replace(prefix, ''))
    if (Number.isFinite(lastSeq) && lastSeq > 0) seq = lastSeq + 1
  }

  return `${prefix}${String(seq).padStart(3, '0')}`
}

/**
 * Load purchase orders with optional filters.
 */
export async function loadPurchaseOrders(filters?: {
  status?: string
  vendor?: string
  projectId?: string
}): Promise<PurchaseOrder[]> {
  const supabase = db()
  let q = supabase
    .from('purchase_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.vendor) q = q.eq('vendor', filters.vendor)
  if (filters?.projectId) q = q.eq('project_id', filters.projectId)
  const { data, error } = await q
  if (error) console.error('[loadPurchaseOrders]', error.message)
  return (data ?? []) as PurchaseOrder[]
}

/**
 * Load a single purchase order with its line items.
 */
export async function loadPurchaseOrder(id: string): Promise<{ po: PurchaseOrder; items: POLineItem[] } | null> {
  const supabase = db()
  const { data: po, error: poErr } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('id', id)
    .single()
  if (poErr || !po) {
    console.error('[loadPurchaseOrder]', poErr?.message)
    return null
  }
  const { data: items, error: itemsErr } = await supabase
    .from('po_line_items')
    .select('*')
    .eq('po_id', id)
    .order('name')
  if (itemsErr) console.error('[loadPurchaseOrder items]', itemsErr.message)
  return { po: po as PurchaseOrder, items: (items ?? []) as POLineItem[] }
}

/**
 * Create a purchase order with line items.
 */
export async function createPurchaseOrder(
  po: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>,
  items: Omit<POLineItem, 'id' | 'po_id'>[]
): Promise<PurchaseOrder | null> {
  const supabase = db()
  const { data: created, error: poErr } = await supabase
    .from('purchase_orders')
    .insert(po)
    .select()
    .single()
  if (poErr || !created) {
    console.error('[createPurchaseOrder]', poErr?.message)
    return null
  }
  const createdPO = created as PurchaseOrder

  // Insert line items
  if (items.length > 0) {
    const rows = items.map(item => ({ ...item, po_id: createdPO.id }))
    const { error: itemsErr } = await supabase.from('po_line_items').insert(rows)
    if (itemsErr) {
      console.error('[createPurchaseOrder items]', itemsErr.message)
      return null
    }
  }

  // Update linked project_materials with the PO number
  const materialErrors: string[] = []
  for (const item of items) {
    if (item.material_id) {
      const { error: matErr } = await supabase
        .from('project_materials')
        .update({ po_number: createdPO.po_number, status: 'ordered', updated_at: new Date().toISOString() })
        .eq('id', item.material_id)
      if (matErr) {
        materialErrors.push(`material ${item.material_id}: ${matErr.message}`)
      }
    }
  }
  if (materialErrors.length > 0) {
    console.error('[createPurchaseOrder] material update errors:', materialErrors.join('; '))
    // PO created but some materials failed to link — attach warning
    ;(createdPO as any)._materialWarning = `${materialErrors.length} material(s) failed to link to PO`
  }

  return createdPO
}

/**
 * Update a purchase order's status.
 * When status is 'delivered', auto-update linked project_materials.
 */
export async function updatePurchaseOrderStatus(id: string, status: string): Promise<boolean> {
  if (!(PO_STATUSES as readonly string[]).includes(status)) {
    console.error('[updatePurchaseOrderStatus] invalid status:', status)
    return false
  }

  const supabase = db()

  // Build timestamp updates based on status
  const timestamps: Record<string, string | null> = {}
  const now = new Date().toISOString()
  if (status === 'submitted') timestamps.submitted_at = now
  if (status === 'confirmed') timestamps.confirmed_at = now
  if (status === 'shipped') timestamps.shipped_at = now
  if (status === 'delivered') timestamps.delivered_at = now

  const { error } = await supabase
    .from('purchase_orders')
    .update({ status, updated_at: now, ...timestamps })
    .eq('id', id)
  if (error) {
    console.error('[updatePurchaseOrderStatus]', error.message)
    return false
  }

  // When delivered, update all linked project_materials
  if (status === 'delivered') {
    const { data: lineItems } = await supabase
      .from('po_line_items')
      .select('material_id')
      .eq('po_id', id)
    const today = new Date().toISOString().split('T')[0]
    const deliveryErrors: string[] = []
    for (const item of (lineItems ?? []) as { material_id: string | null }[]) {
      if (item.material_id) {
        const { error: matErr } = await supabase
          .from('project_materials')
          .update({ status: 'delivered', delivered_date: today, updated_at: now })
          .eq('id', item.material_id)
        if (matErr) {
          deliveryErrors.push(`material ${item.material_id}: ${matErr.message}`)
        }
      }
    }
    if (deliveryErrors.length > 0) {
      console.error('[updatePurchaseOrderStatus] delivery update errors:', deliveryErrors.join('; '))
      return false
    }
  }

  return true
}

/**
 * Update purchase order fields (notes, tracking_number, expected_delivery, etc.).
 */
export async function updatePurchaseOrder(id: string, updates: Omit<Partial<PurchaseOrder>, 'id' | 'created_at'>): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('purchase_orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[updatePurchaseOrder]', error.message)
    return false
  }
  return true
}

/**
 * Load line items for a specific PO.
 */
export async function loadPOLineItems(poId: string): Promise<POLineItem[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('po_line_items')
    .select('*')
    .eq('po_id', poId)
    .order('name')
  if (error) console.error('[loadPOLineItems]', error.message)
  return (data ?? []) as POLineItem[]
}
