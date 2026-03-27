// lib/api/warranties.ts — Equipment warranty and claim data access layer
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EquipmentWarranty {
  id: string
  project_id: string
  equipment_type: string
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  quantity: number
  install_date: string | null
  warranty_start_date: string | null
  warranty_end_date: string | null
  warranty_years: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface WarrantyClaim {
  id: string
  warranty_id: string
  project_id: string
  claim_number: string | null
  status: string
  issue_description: string | null
  submitted_date: string | null
  resolved_date: string | null
  resolution_notes: string | null
  replacement_serial: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const WARRANTY_EQUIPMENT_TYPES = ['panel', 'inverter', 'battery', 'optimizer'] as const
export type WarrantyEquipmentType = typeof WARRANTY_EQUIPMENT_TYPES[number]

export const CLAIM_STATUSES = ['draft', 'submitted', 'approved', 'denied', 'completed'] as const
export type ClaimStatus = typeof CLAIM_STATUSES[number]

export interface WarrantyFilters {
  search?: string
  equipmentType?: string
  warrantyStatus?: 'active' | 'expiring' | 'expired'
  manufacturer?: string
}

// ── Warranty Functions ────────────────────────────────────────────────────────

/**
 * Load all warranties for a project.
 */
export async function loadProjectWarranties(projectId: string): Promise<EquipmentWarranty[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('equipment_warranties')
    .select('*')
    .eq('project_id', projectId)
    .order('equipment_type')
  if (error) console.error('[loadProjectWarranties]', error.message)
  return (data ?? []) as EquipmentWarranty[]
}

/**
 * Create a warranty record.
 */
export async function addWarranty(
  warranty: Omit<EquipmentWarranty, 'id' | 'created_at' | 'updated_at'>
): Promise<EquipmentWarranty | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('equipment_warranties')
    .insert(warranty)
    .select()
    .single()
  if (error) {
    console.error('[addWarranty]', error.message)
    return null
  }
  return data as EquipmentWarranty
}

/**
 * Update a warranty record.
 */
export async function updateWarranty(
  id: string,
  updates: Partial<EquipmentWarranty>
): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('equipment_warranties')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[updateWarranty]', error.message)
    return false
  }
  return true
}

/**
 * Delete a warranty record (cascades to claims).
 */
export async function deleteWarranty(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('equipment_warranties')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteWarranty]', error.message)
    return false
  }
  return true
}

// ── Claim Functions ───────────────────────────────────────────────────────────

/**
 * Load all claims for a warranty.
 */
export async function loadWarrantyClaims(warrantyId: string): Promise<WarrantyClaim[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('warranty_claims')
    .select('*')
    .eq('warranty_id', warrantyId)
    .order('created_at', { ascending: false })
  if (error) console.error('[loadWarrantyClaims]', error.message)
  return (data ?? []) as WarrantyClaim[]
}

/**
 * Create a warranty claim.
 */
export async function addClaim(
  claim: Omit<WarrantyClaim, 'id' | 'created_at' | 'updated_at'>
): Promise<WarrantyClaim | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('warranty_claims')
    .insert(claim)
    .select()
    .single()
  if (error) {
    console.error('[addClaim]', error.message)
    return null
  }
  return data as WarrantyClaim
}

/**
 * Update a warranty claim.
 */
export async function updateClaim(
  id: string,
  updates: Partial<WarrantyClaim>
): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('warranty_claims')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[updateClaim]', error.message)
    return false
  }
  return true
}

// ── Cross-project Queries ─────────────────────────────────────────────────────

/**
 * Load warranties expiring within N days from today.
 */
export async function loadExpiringWarranties(daysAhead: number = 90): Promise<EquipmentWarranty[]> {
  const supabase = db()
  const today = new Date().toISOString().split('T')[0]
  const future = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('equipment_warranties')
    .select('*')
    .gte('warranty_end_date', today)
    .lte('warranty_end_date', future)
    .order('warranty_end_date')
  if (error) console.error('[loadExpiringWarranties]', error.message)
  return (data ?? []) as EquipmentWarranty[]
}

/**
 * Paginated list of all warranties with optional filters.
 */
export async function loadAllWarranties(
  page: number = 1,
  pageSize: number = 50,
  filters?: WarrantyFilters
): Promise<{ data: EquipmentWarranty[]; total: number }> {
  const supabase = db()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let q = supabase
    .from('equipment_warranties')
    .select('*', { count: 'exact' })
    .order('warranty_end_date', { ascending: true })
    .range(from, to)

  if (filters?.equipmentType) {
    q = q.eq('equipment_type', filters.equipmentType)
  }
  if (filters?.manufacturer) {
    q = q.ilike('manufacturer', `%${escapeIlike(filters.manufacturer)}%`)
  }
  if (filters?.search) {
    const s = escapeIlike(filters.search)
    q = q.or(`project_id.ilike.%${s}%,manufacturer.ilike.%${s}%,model.ilike.%${s}%,serial_number.ilike.%${s}%`)
  }

  // Status filters applied client-side since they depend on date math
  const { data, error, count } = await q

  if (error) {
    console.error('[loadAllWarranties]', error.message)
    return { data: [], total: 0 }
  }

  return { data: (data ?? []) as EquipmentWarranty[], total: count ?? 0 }
}

/**
 * Load all open claims across all projects.
 */
export async function loadOpenClaims(): Promise<WarrantyClaim[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('warranty_claims')
    .select('*')
    .in('status', ['draft', 'submitted', 'approved'])
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) console.error('[loadOpenClaims]', error.message)
  return (data ?? []) as WarrantyClaim[]
}
