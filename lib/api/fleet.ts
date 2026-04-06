// lib/api/fleet.ts — Fleet/vehicle management data access layer
import { db } from '@/lib/db'
import { escapeIlike, escapeFilterValue } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

export interface Vehicle {
  id: string
  vehicle_number: string
  vin: string | null
  year: number | null
  make: string | null
  model: string | null
  license_plate: string | null
  color: string | null
  assigned_crew: string | null
  assigned_driver: string | null
  status: VehicleStatus
  odometer: number | null
  insurance_expiry: string | null
  registration_expiry: string | null
  last_inspection_date: string | null
  next_inspection_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MaintenanceRecord {
  id: string
  vehicle_id: string
  type: MaintenanceType
  description: string | null
  date: string | null
  odometer: number | null
  cost: number | null
  vendor: string | null
  next_due_date: string | null
  next_due_odometer: number | null
  performed_by: string | null
  notes: string | null
  created_at: string
}

export type VehicleStatus = 'active' | 'maintenance' | 'out_of_service' | 'retired'
export type MaintenanceType = 'oil_change' | 'tire_rotation' | 'brake_service' | 'inspection' | 'repair' | 'other'

export const VEHICLE_STATUSES: VehicleStatus[] = ['active', 'maintenance', 'out_of_service', 'retired']
export const MAINTENANCE_TYPES: MaintenanceType[] = ['oil_change', 'tire_rotation', 'brake_service', 'inspection', 'repair', 'other']

export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  oil_change: 'Oil Change',
  tire_rotation: 'Tire Rotation',
  brake_service: 'Brake Service',
  inspection: 'Inspection',
  repair: 'Repair',
  other: 'Other',
}

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  active: 'Active',
  maintenance: 'In Maintenance',
  out_of_service: 'Out of Service',
  retired: 'Retired',
}

// ── Vehicle CRUD ─────────────────────────────────────────────────────────────

export interface VehicleFilters {
  status?: VehicleStatus
  crew?: string
  search?: string
}

/**
 * Load all vehicles with optional filters.
 */
export async function loadVehicles(filters?: VehicleFilters, orgId?: string): Promise<Vehicle[]> {
  const supabase = db()
  let q = supabase.from('vehicles').select('id, vehicle_number, vin, year, make, model, license_plate, color, assigned_crew, assigned_driver, status, odometer, insurance_expiry, registration_expiry, last_inspection_date, next_inspection_date, notes, created_at, updated_at').order('vehicle_number').limit(500)
  if (orgId) q = q.eq('org_id', orgId)
  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.crew) q = q.eq('assigned_crew', filters.crew)
  if (filters?.search) {
    const s = escapeFilterValue(filters.search)
    q = q.or(`vehicle_number.ilike.%${s}%,make.ilike.%${s}%,model.ilike.%${s}%,license_plate.ilike.%${s}%,assigned_driver.ilike.%${s}%,vin.ilike.%${s}%`)
  }
  const { data, error } = await q
  if (error) console.error('[loadVehicles]', error.message)
  return (data ?? []) as Vehicle[]
}

/**
 * Load a single vehicle by ID.
 */
export async function loadVehicle(id: string): Promise<Vehicle | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, vehicle_number, vin, year, make, model, license_plate, color, assigned_crew, assigned_driver, status, odometer, insurance_expiry, registration_expiry, last_inspection_date, next_inspection_date, notes, created_at, updated_at')
    .eq('id', id)
    .single()
  if (error) {
    console.error('[loadVehicle]', error.message)
    return null
  }
  return data as Vehicle
}

/**
 * Create a new vehicle.
 */
export async function addVehicle(
  vehicle: Omit<Vehicle, 'id' | 'created_at' | 'updated_at'>
): Promise<Vehicle | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('vehicles')
    .insert(vehicle)
    .select()
    .single()
  if (error) {
    console.error('[addVehicle]', error.message)
    return null
  }
  return data as Vehicle
}

/**
 * Update an existing vehicle.
 */
export async function updateVehicle(id: string, updates: Partial<Vehicle>): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('vehicles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('[updateVehicle]', error.message)
    return false
  }
  return true
}

/**
 * Delete a vehicle (super admin only via RLS).
 */
export async function deleteVehicle(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('vehicles')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteVehicle]', error.message)
    return false
  }
  return true
}

// ── Maintenance CRUD ─────────────────────────────────────────────────────────

/**
 * Load maintenance history for a vehicle.
 */
export async function loadVehicleMaintenance(vehicleId: string): Promise<MaintenanceRecord[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('vehicle_maintenance')
    .select('id, vehicle_id, type, description, date, odometer, cost, vendor, next_due_date, next_due_odometer, performed_by, notes, created_at')
    .eq('vehicle_id', vehicleId)
    .order('date', { ascending: false })
    .limit(100)
  if (error) console.error('[loadVehicleMaintenance]', error.message)
  return (data ?? []) as MaintenanceRecord[]
}

/**
 * Add a maintenance record.
 */
export async function addMaintenance(
  record: Omit<MaintenanceRecord, 'id' | 'created_at'>
): Promise<MaintenanceRecord | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('vehicle_maintenance')
    .insert(record)
    .select()
    .single()
  if (error) {
    console.error('[addMaintenance]', error.message)
    return null
  }
  return data as MaintenanceRecord
}

/**
 * Update a maintenance record.
 */
export async function updateMaintenance(id: string, updates: Partial<MaintenanceRecord>): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('vehicle_maintenance')
    .update(updates)
    .eq('id', id)
  if (error) {
    console.error('[updateMaintenance]', error.message)
    return false
  }
  return true
}

/**
 * Load vehicles with upcoming maintenance (next_due_date within daysAhead).
 */
export async function loadUpcomingMaintenance(daysAhead: number = 30): Promise<MaintenanceRecord[]> {
  const supabase = db()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() + daysAhead)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('vehicle_maintenance')
    .select('id, vehicle_id, type, description, date, odometer, cost, vendor, next_due_date, next_due_odometer, performed_by, notes, created_at')
    .lte('next_due_date', cutoffStr)
    .order('next_due_date')
    .limit(100)
  if (error) console.error('[loadUpcomingMaintenance]', error.message)
  return (data ?? []) as MaintenanceRecord[]
}
