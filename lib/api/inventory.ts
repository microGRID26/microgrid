// lib/api/inventory.ts — Project materials, warehouse stock, and purchase order data access
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { stripRawPrice } from './equipment'
import type { PurchaseOrder, POLineItem, WarehouseTransaction } from '@/types/database'

export type { PurchaseOrder, POLineItem, WarehouseTransaction }

/** Extended PurchaseOrder with optional warning from material linking */
export type PurchaseOrderResult = PurchaseOrder & { _materialWarning?: string }

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
  sourcing: string | null
  raw_price: number | null
  sell_price: number | null
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
  barcode: string | null
  last_counted_at: string | null
  sourcing: string | null
  raw_price: number | null
  sell_price: number | null
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
 * Pass orgType to control raw_price visibility (only 'supply' sees it).
 */
export async function loadProjectMaterials(projectId: string, orgType?: string | null): Promise<ProjectMaterial[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('project_materials')
    .select('*')
    .eq('project_id', projectId)
    .order('category')
    .order('name')
    .limit(1000)
  if (error) console.error('[loadProjectMaterials]', error.message)
  return stripRawPrice((data ?? []) as ProjectMaterial[], orgType)
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
 * Load warehouse stock, optionally filtered by category and/or location.
 * Pass orgType to control raw_price visibility (only 'supply' sees it).
 */
export async function loadWarehouseStock(category?: string, location?: string, orgId?: string | null, orgType?: string | null): Promise<WarehouseStock[]> {
  const supabase = db()
  let q = supabase.from('warehouse_stock').select('*').order('category').order('name').limit(2000)
  if (category) q = q.eq('category', category)
  if (location) q = q.eq('location', location)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q
  if (error) console.error('[loadWarehouseStock]', error.message)
  return stripRawPrice((data ?? []) as WarehouseStock[], orgType)
}

/**
 * Look up a warehouse stock item by barcode.
 */
export async function lookupByBarcode(barcode: string): Promise<WarehouseStock | null> {
  if (!barcode || barcode.length > 255) {
    console.error('[lookupByBarcode] invalid barcode length:', barcode.length)
    return null
  }
  const supabase = db()
  const { data, error } = await supabase
    .from('warehouse_stock')
    .select('*')
    .ilike('barcode', escapeIlike(barcode))
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[lookupByBarcode]', error.message)
    return null
  }
  return (data as WarehouseStock) ?? null
}

/**
 * Load all project materials across all projects (for inventory overview).
 * Pass orgType to control raw_price visibility (only 'supply' sees it).
 */
export async function loadAllProjectMaterials(filters?: {
  status?: string
  category?: string
  source?: string
}, orgType?: string | null): Promise<(ProjectMaterial & { project_name: string | null })[]> {
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
    return stripRawPrice((d2 ?? []).map((r: unknown) => ({ ...(r as ProjectMaterial), project_name: null as string | null })), orgType)
  }
  const result = (data ?? []).map((row: Record<string, unknown>) => {
    const { projects: projectJoin, ...rest } = row
    return {
      ...rest,
      project_name: (projectJoin as { name?: string } | null)?.name ?? null,
    }
  }) as (ProjectMaterial & { project_name: string | null })[]
  return stripRawPrice(result, orgType)
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
    .limit(500)
  if (itemsErr) console.error('[loadPurchaseOrder items]', itemsErr.message)
  return { po: po as PurchaseOrder, items: (items ?? []) as POLineItem[] }
}

/**
 * Create a purchase order with line items.
 */
export async function createPurchaseOrder(
  po: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at' | 'delivery_accurate' | 'delivery_discrepancy'>,
  items: Omit<POLineItem, 'id' | 'po_id'>[]
): Promise<PurchaseOrderResult | null> {
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
  const createdPO = created as PurchaseOrderResult

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
    createdPO._materialWarning = `${materialErrors.length} material(s) failed to link to PO`
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
    .limit(500)
  if (error) console.error('[loadPOLineItems]', error.message)
  return (data ?? []) as POLineItem[]
}

// ── Warehouse Stock Management ──────────────────────────────────────────────

/**
 * Add a new warehouse stock item.
 */
export async function addWarehouseStock(
  item: Omit<WarehouseStock, 'id' | 'updated_at'>
): Promise<WarehouseStock | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('warehouse_stock')
    .insert(item)
    .select()
    .single()
  if (error) {
    console.error('[addWarehouseStock]', error.message)
    return null
  }
  return data as WarehouseStock
}

/**
 * Update a warehouse stock item.
 */
export async function updateWarehouseStock(
  id: string,
  updates: Partial<WarehouseStock>
): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('warehouse_stock')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[updateWarehouseStock]', error.message)
    return false
  }
  return true
}

/**
 * Delete a warehouse stock item.
 */
export async function deleteWarehouseStock(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('warehouse_stock')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteWarehouseStock]', error.message)
    return false
  }
  return true
}

/**
 * Check out stock from warehouse for a project.
 * Creates a transaction, decrements quantity_on_hand, optionally creates a project_material entry.
 */
export async function checkoutFromWarehouse(
  stockId: string,
  quantity: number,
  projectId: string,
  performedBy: string,
  notes?: string
): Promise<boolean> {
  const supabase = db()

  // Get current stock
  const { data: stock, error: stockErr } = await supabase
    .from('warehouse_stock')
    .select('*')
    .eq('id', stockId)
    .single()
  if (stockErr || !stock) {
    console.error('[checkoutFromWarehouse] stock lookup failed:', stockErr?.message)
    return false
  }

  const s = stock as WarehouseStock
  if (quantity > s.quantity_on_hand) {
    console.error('[checkoutFromWarehouse] insufficient stock:', quantity, '>', s.quantity_on_hand)
    return false
  }

  // Create transaction
  const { error: txErr } = await supabase
    .from('warehouse_transactions')
    .insert({
      stock_id: stockId,
      project_id: projectId,
      transaction_type: 'checkout',
      quantity,
      // Notes are rendered as React text nodes in the UI (not dangerouslySetInnerHTML),
      // so they are safe from XSS by default. No sanitization needed.
      notes: notes || null,
      performed_by: performedBy,
    })
  if (txErr) {
    console.error('[checkoutFromWarehouse] transaction insert:', txErr.message)
    return false
  }

  // Decrement stock with optimistic lock — the WHERE clause checks that quantity_on_hand
  // hasn't changed since we read it, preventing race conditions in concurrent checkouts.
  const { error: updateErr, count: updateCount } = await supabase
    .from('warehouse_stock')
    .update({
      quantity_on_hand: s.quantity_on_hand - quantity,
      updated_at: new Date().toISOString(),
    })
    .eq('id', stockId)
    .eq('quantity_on_hand', s.quantity_on_hand) // optimistic lock
  if (updateErr) {
    console.error('[checkoutFromWarehouse] stock update:', updateErr.message)
    return false
  }
  if (updateCount === 0) {
    console.warn('[checkoutFromWarehouse] optimistic lock failed — stock was modified by another user')
    return false
  }

  // Add to project materials
  const { error: matErr } = await supabase
    .from('project_materials')
    .insert({
      project_id: projectId,
      equipment_id: s.equipment_id,
      name: s.name,
      category: s.category,
      quantity,
      unit: s.unit,
      source: 'warehouse',
      status: 'delivered',
      delivered_date: new Date().toISOString().split('T')[0],
    })
  if (matErr) {
    console.error('[checkoutFromWarehouse] material insert:', matErr.message)
    // Non-fatal: the checkout transaction + stock decrement already succeeded, so we
    // return true. The project_material record is a convenience link; the warehouse
    // transaction is the source of truth. The _materialWarning assignment below is
    // dead code — `s` is a local variable that is never returned to the caller.
    // Kept for documentation; has no runtime effect.
    ;(s as WarehouseStock & { _materialWarning?: string })._materialWarning = `Failed to create project material record: ${matErr.message}`
  }

  return true
}

/**
 * Check in stock to warehouse.
 * Creates a transaction and increments quantity_on_hand.
 */
export async function checkinToWarehouse(
  stockId: string,
  quantity: number,
  performedBy: string,
  notes?: string
): Promise<boolean> {
  const supabase = db()

  // Get current stock
  const { data: stock, error: stockErr } = await supabase
    .from('warehouse_stock')
    .select('quantity_on_hand')
    .eq('id', stockId)
    .single()
  if (stockErr || !stock) {
    console.error('[checkinToWarehouse] stock lookup failed:', stockErr?.message)
    return false
  }

  const currentQty = (stock as { quantity_on_hand: number }).quantity_on_hand

  // Create transaction
  const { error: txErr } = await supabase
    .from('warehouse_transactions')
    .insert({
      stock_id: stockId,
      project_id: null,
      transaction_type: 'checkin',
      quantity,
      notes: notes || null,
      performed_by: performedBy,
    })
  if (txErr) {
    console.error('[checkinToWarehouse] transaction insert:', txErr.message)
    return false
  }

  // Increment stock
  const { error: updateErr } = await supabase
    .from('warehouse_stock')
    .update({
      quantity_on_hand: currentQty + quantity,
      updated_at: new Date().toISOString(),
    })
    .eq('id', stockId)
  if (updateErr) {
    console.error('[checkinToWarehouse] stock update:', updateErr.message)
    return false
  }

  return true
}

/**
 * Adjust warehouse stock to a new quantity (for physical count corrections).
 * Creates an adjustment transaction.
 */
export async function adjustWarehouseStock(
  stockId: string,
  newQuantity: number,
  performedBy: string,
  notes?: string
): Promise<boolean> {
  const supabase = db()

  // Get current stock
  const { data: stock, error: stockErr } = await supabase
    .from('warehouse_stock')
    .select('quantity_on_hand')
    .eq('id', stockId)
    .single()
  if (stockErr || !stock) {
    console.error('[adjustWarehouseStock] stock lookup failed:', stockErr?.message)
    return false
  }

  const currentQty = (stock as { quantity_on_hand: number }).quantity_on_hand
  const diff = newQuantity - currentQty

  // Create transaction
  const { error: txErr } = await supabase
    .from('warehouse_transactions')
    .insert({
      stock_id: stockId,
      project_id: null,
      transaction_type: 'adjustment',
      quantity: diff,
      notes: notes || `Adjusted from ${currentQty} to ${newQuantity}`,
      performed_by: performedBy,
    })
  if (txErr) {
    console.error('[adjustWarehouseStock] transaction insert:', txErr.message)
    return false
  }

  // Set new quantity
  const now = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from('warehouse_stock')
    .update({
      quantity_on_hand: newQuantity,
      last_counted_at: now,
      updated_at: now,
    })
    .eq('id', stockId)
  if (updateErr) {
    console.error('[adjustWarehouseStock] stock update:', updateErr.message)
    return false
  }

  return true
}

/**
 * Load warehouse transactions, optionally filtered by stock item or project.
 */
export async function loadWarehouseTransactions(
  stockId?: string,
  projectId?: string
): Promise<WarehouseTransaction[]> {
  const supabase = db()
  let q = supabase
    .from('warehouse_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (stockId) q = q.eq('stock_id', stockId)
  if (projectId) q = q.eq('project_id', projectId)
  const { data, error } = await q
  if (error) console.error('[loadWarehouseTransactions]', error.message)
  return (data ?? []) as WarehouseTransaction[]
}

/**
 * Get items where quantity_on_hand <= reorder_point.
 *
 * NOTE: Uses client-side filtering because Supabase JS doesn't support column-to-column
 * comparisons (e.g., quantity_on_hand <= reorder_point). At scale (1000+ stock items),
 * this should be moved to a Postgres RPC function for efficiency.
 */
export async function getLowStockItems(): Promise<WarehouseStock[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('warehouse_stock')
    .select('*')
    .order('name')
    .limit(2000)
  if (error) {
    console.error('[getLowStockItems]', error.message)
    return []
  }
  return ((data ?? []) as WarehouseStock[]).filter(
    s => s.quantity_on_hand <= s.reorder_point
  )
}
