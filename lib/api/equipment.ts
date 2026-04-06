// lib/api/equipment.ts — Equipment catalog data access
import { db } from '@/lib/db'
import { escapeFilterValue } from '@/lib/utils'

export interface Equipment {
  id: string
  name: string
  manufacturer: string | null
  model: string | null
  category: string
  watts: number | null
  description: string | null
  active: boolean
  sort_order: number
  sourcing: string | null
  raw_price: number | null
  sell_price: number | null
  created_at?: string
}

/**
 * Strip raw_price from equipment items unless the requesting user's org is 'supply' type.
 * raw_price is confidential to NewCo Supply — not even EDGE/platform can see it.
 */
export function stripRawPrice<T extends { raw_price?: number | null }>(items: T[], orgType?: string | null): T[] {
  if (orgType === 'supply') return items
  return items.map(item => ({ ...item, raw_price: null }))
}

export type EquipmentCategory = 'module' | 'inverter' | 'battery' | 'optimizer' | 'racking' | 'electrical' | 'adder' | 'other'

export const EQUIPMENT_CATEGORIES: { value: EquipmentCategory; label: string }[] = [
  { value: 'module', label: 'Module' },
  { value: 'inverter', label: 'Inverter' },
  { value: 'battery', label: 'Battery' },
  { value: 'optimizer', label: 'Optimizer' },
  { value: 'racking', label: 'Racking' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'adder', label: 'Adder' },
  { value: 'other', label: 'Other' },
]

/**
 * Load all equipment items, optionally filtered by category.
 * Pass orgType to control raw_price visibility (only 'supply' sees it).
 */
export async function loadEquipment(category?: string, orgType?: string | null, orgId?: string): Promise<Equipment[]> {
  const supabase = db()
  let q = supabase.from('equipment').select('id, name, manufacturer, model, category, watts, description, active, sort_order, sourcing, raw_price, sell_price, created_at').eq('active', true).order('sort_order').order('name').limit(5000)
  if (orgId) q = q.eq('org_id', orgId)
  if (category) q = q.eq('category', category)
  const { data, error } = await q
  if (error) console.error('[loadEquipment]', error.message)
  return stripRawPrice((data ?? []) as Equipment[], orgType)
}

/**
 * Search equipment by name, optionally filtered by category.
 * Uses ilike for partial matching.
 * Pass orgType to control raw_price visibility (only 'supply' sees it).
 */
export async function searchEquipment(query: string, category?: string, orgType?: string | null, orgId?: string): Promise<Equipment[]> {
  const supabase = db()
  const escaped = escapeFilterValue(query)
  let q = supabase
    .from('equipment')
    .select('id, name, manufacturer, model, category, watts, description, active, sort_order, sourcing, raw_price, sell_price, created_at')
    .eq('active', true)
    .or(`name.ilike.%${escaped}%,manufacturer.ilike.%${escaped}%,description.ilike.%${escaped}%`)
    .order('sort_order')
    .order('name')
    .limit(20)
  if (orgId) q = q.eq('org_id', orgId)
  if (category) q = q.eq('category', category)
  const { data, error } = await q
  if (error) console.error('[searchEquipment]', error.message)
  return stripRawPrice((data ?? []) as Equipment[], orgType)
}

/**
 * Load all equipment (including inactive) for admin management.
 * Pass orgType to control raw_price visibility (only 'supply' sees it).
 */
export async function loadAllEquipment(orgType?: string | null, orgId?: string): Promise<Equipment[]> {
  const supabase = db()
  let q = supabase
    .from('equipment')
    .select('id, name, manufacturer, model, category, watts, description, active, sort_order, sourcing, raw_price, sell_price, created_at')
    .order('category')
    .order('sort_order')
    .order('name')
    .limit(5000)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q
  if (error) console.error('[loadAllEquipment]', error.message)
  return stripRawPrice((data ?? []) as Equipment[], orgType)
}
