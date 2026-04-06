// lib/api/vendors.ts — Vendor data access layer
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'

export interface Vendor {
  id: string
  name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  category: string | null
  equipment_types: string[] | null
  lead_time_days: number | null
  payment_terms: string | null
  notes: string | null
  active: boolean
  created_at: string
}

export const VENDOR_CATEGORIES = ['manufacturer', 'distributor', 'install_partner', 'electrical', 'plumbing', 'hvac', 'roofing', 'interior', 'other'] as const
export type VendorCategory = typeof VENDOR_CATEGORIES[number]

export const EQUIPMENT_TYPE_OPTIONS = ['modules', 'inverters', 'batteries', 'racking', 'electrical', 'other'] as const

/**
 * Load all vendors, optionally filtering to active only.
 */
export async function loadVendors(activeOnly?: boolean, orgId?: string | null): Promise<Vendor[]> {
  const supabase = db()
  let q = supabase.from('vendors').select('id, name, contact_name, contact_email, contact_phone, website, address, city, state, zip, category, equipment_types, lead_time_days, payment_terms, notes, active, created_at').order('name').limit(2000)
  if (activeOnly) q = q.eq('active', true)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q
  if (error) console.error('[loadVendors]', error.message)
  return (data ?? []) as Vendor[]
}

/**
 * Search vendors by name (ilike). Returns active vendors only.
 */
export async function searchVendors(query: string, orgId?: string | null): Promise<Vendor[]> {
  if (!query.trim()) return []
  const supabase = db()
  let q = supabase
    .from('vendors')
    .select('id, name, contact_name, contact_email, contact_phone, website, address, city, state, zip, category, equipment_types, lead_time_days, payment_terms, notes, active, created_at')
    .eq('active', true)
    .ilike('name', `%${escapeIlike(query)}%`)
    .order('name')
    .limit(20)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q
  if (error) {
    console.error('[searchVendors]', error.message)
    return []
  }
  return (data ?? []) as Vendor[]
}

/**
 * Load a single vendor by ID.
 */
export async function loadVendor(id: string): Promise<Vendor | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, contact_name, contact_email, contact_phone, website, address, city, state, zip, category, equipment_types, lead_time_days, payment_terms, notes, active, created_at')
    .eq('id', id)
    .single()
  if (error) {
    console.error('[loadVendor]', error.message)
    return null
  }
  return data as Vendor
}

/**
 * Create a new vendor.
 */
export async function addVendor(
  vendor: Omit<Vendor, 'id' | 'created_at'>
): Promise<Vendor | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('vendors')
    .insert(vendor)
    .select()
    .single()
  if (error) {
    console.error('[addVendor]', error.message)
    return null
  }
  return data as Vendor
}

/**
 * Update an existing vendor.
 */
export async function updateVendor(id: string, updates: Partial<Vendor>): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('vendors')
    .update(updates)
    .eq('id', id)
  if (error) {
    console.error('[updateVendor]', error.message)
    return false
  }
  return true
}

/**
 * Delete a vendor (super admin only via RLS).
 */
export async function deleteVendor(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('vendors')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteVendor]', error.message)
    return false
  }
  return true
}
