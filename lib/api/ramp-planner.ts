// lib/api/ramp-planner.ts — Install Ramp-Up Planner
// Scheduling, readiness scoring, route optimization, and tier classification
//
// Architecture:
//   - Projects are classified into 4 tiers based on AHJ type + equipment
//   - Each project gets a readiness score (0-100) from its checklist
//   - Auto-suggest picks the best projects for each week using a weighted
//     composite score: readiness * 0.4 + proximity * 0.3 + cluster * 0.15 + value * 0.15
//   - Route optimization uses nearest-neighbor on Haversine distance

import { db } from '@/lib/db'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectReadiness {
  id: string
  project_id: string
  equipment_ready: boolean
  homeowner_confirmed: boolean
  permit_clear: boolean
  utility_approved: boolean
  hoa_approved: boolean
  redesign_complete: boolean
  crew_available: boolean
  blocker_notes: string | null
  readiness_score: number
  updated_at: string
  updated_by: string | null
}

export interface RampScheduleEntry {
  id: string
  project_id: string
  crew_id: string | null
  crew_name: string | null
  scheduled_week: string
  scheduled_day: string | null
  slot: number
  status: string
  priority_score: number
  drive_minutes: number | null
  distance_miles: number | null
  notes: string | null
  completed_at: string | null
  cancelled_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface RampConfig {
  warehouse_lat: number
  warehouse_lng: number
  warehouse_address: string
  crews_count: number
  installs_per_crew_per_week: number
  weight_readiness: number
  weight_proximity: number
  weight_cluster: number
  weight_value: number
  primary_market: string
  secondary_market: string
}

export type Tier = 1 | 2 | 3 | 4

export interface TierInfo {
  tier: Tier
  label: string
  description: string
  color: string
  minScore: number
}

// Tiers are now derived from readiness score, not fixed AHJ/equipment combos
export const TIER_INFO: Record<Tier, TierInfo> = {
  1: { tier: 1, label: 'Ready to Schedule', description: 'Readiness 60+', color: 'green', minScore: 60 },
  2: { tier: 2, label: 'Almost Ready', description: 'Readiness 40-59', color: 'amber', minScore: 40 },
  3: { tier: 3, label: 'Needs Work', description: 'Readiness 20-39', color: 'blue', minScore: 20 },
  4: { tier: 4, label: 'Not Ready', description: 'Readiness 0-19', color: 'red', minScore: 0 },
}

export function tierFromScore(score: number): Tier {
  if (score >= 60) return 1
  if (score >= 40) return 2
  if (score >= 20) return 3
  return 4
}

export const RAMP_STATUSES = ['planned', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled'] as const

export const RAMP_STATUS_COLORS: Record<string, string> = {
  planned: 'bg-blue-500/20 text-blue-400',
  confirmed: 'bg-indigo-500/20 text-indigo-400',
  in_progress: 'bg-amber-500/20 text-amber-400',
  completed: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-400',
  rescheduled: 'bg-purple-500/20 text-purple-400',
}

// ── Tier Classification ──────────────────────────────────────────────────────

// permitRequired: pass the AHJ's permit_required field if available.
// Falls back to pattern-matching on "county" in the AHJ name.
export function classifyTier(ahj: string | null, module: string | null, inverter: string | null, battery: string | null, permitRequired?: boolean): Tier {
  const needsPermit = permitRequired !== undefined
    ? permitRequired
    : !(ahj ?? '').toLowerCase().includes('county') // Fallback: counties don't need permits
  const isEcoflow = [module, inverter, battery].some(f => (f ?? '').toLowerCase().includes('ecoflow'))

  if (!needsPermit && !isEcoflow) return 1
  if (!needsPermit && isEcoflow) return 2
  if (needsPermit && !isEcoflow) return 3
  return 4
}

// ── Haversine Distance ───────────────────────────────────────────────────────
// Returns distance in miles between two lat/lng points

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Estimate drive minutes from distance (rough: 1.4x straight line, 30mph avg in metro)
export function estimateDriveMinutes(miles: number): number {
  const roadMiles = miles * 1.4 // Roads aren't straight
  return Math.round(roadMiles / 30 * 60) // 30mph average in Houston metro
}

// ── Readiness Score ──────────────────────────────────────────────────────────
// 0-100 based on checklist items. Each item has a weight.

export const READINESS_WEIGHTS = [
  { field: 'permit_clear', label: 'Permit Clear', weight: 25 },
  { field: 'redesign_complete', label: 'Redesign Done', weight: 25 },
  { field: 'equipment_ready', label: 'Equipment', weight: 20 },
  { field: 'utility_approved', label: 'Utility', weight: 15 },
  { field: 'hoa_approved', label: 'HOA', weight: 10 },
  { field: 'crew_available', label: 'Crew', weight: 5 },
] as const

export function computeReadinessScore(r: Partial<ProjectReadiness>): number {
  let score = 0
  for (const w of READINESS_WEIGHTS) {
    if ((r as any)[w.field] === true) score += w.weight
  }
  return score
}

// Auto-compute initial readiness from project properties
// County AHJ → permit_clear = true (no permit needed)
// Non-ecoflow → redesign_complete = true (no redesign needed)
// crew_available defaults to true
export function autoReadiness(ahj: string | null, module: string | null, inverter: string | null, battery: string | null, permitRequired?: boolean): Partial<ProjectReadiness> {
  const needsPermit = permitRequired !== undefined
    ? permitRequired
    : !(ahj ?? '').toLowerCase().includes('county')
  const isEcoflow = [module, inverter, battery].some(f => (f ?? '').toLowerCase().includes('ecoflow'))
  return {
    equipment_ready: false,
    permit_clear: !needsPermit,    // No permit needed = auto-clear
    utility_approved: false,
    hoa_approved: true,            // Default true — most projects don't have HOA issues
    redesign_complete: false,      // Nothing redesigned yet under MicroGRID transition
    crew_available: true,
  }
}

// ── Priority Score ───────────────────────────────────────────────────────────
// Composite score for auto-suggesting which projects to schedule next.
// Higher = should be scheduled sooner.

export function computePriorityScore(
  readinessScore: number,
  distanceFromWarehouseMiles: number,
  clusterCount: number,       // How many other projects in the same zip
  contractValue: number,
  maxDistance: number,         // Max distance in the pool (for normalization)
  maxContract: number,        // Max contract in the pool (for normalization)
  weights: { readiness: number; proximity: number; cluster: number; value: number }
): number {
  const readiness = readinessScore // Already 0-100
  const proximity = maxDistance > 0 ? (1 - distanceFromWarehouseMiles / maxDistance) * 100 : 50
  const cluster = Math.min(clusterCount * 10, 50) // Cap at 50
  const value = maxContract > 0 ? (contractValue / maxContract) * 50 : 0

  return (
    readiness * weights.readiness +
    proximity * weights.proximity +
    cluster * weights.cluster +
    value * weights.value
  )
}

// ── Config ───────────────────────────────────────────────────────────────────

export async function loadRampConfig(): Promise<RampConfig> {
  const { data } = await db().from('ramp_config').select('config_key, value').limit(50)
  const map = new Map<string, string>((data ?? []).map((r: any) => [r.config_key as string, r.value as string]))
  return {
    warehouse_lat: parseFloat(map.get('warehouse_lat') ?? '29.9902'),
    warehouse_lng: parseFloat(map.get('warehouse_lng') ?? '-95.4152'),
    warehouse_address: map.get('warehouse_address') ?? '600 Northpark Central Dr, Houston TX 77073',
    crews_count: parseInt(map.get('crews_count') ?? '2'),
    installs_per_crew_per_week: parseInt(map.get('installs_per_crew_per_week') ?? '2'),
    weight_readiness: parseFloat(map.get('weight_readiness') ?? '0.40'),
    weight_proximity: parseFloat(map.get('weight_proximity') ?? '0.30'),
    weight_cluster: parseFloat(map.get('weight_cluster') ?? '0.15'),
    weight_value: parseFloat(map.get('weight_value') ?? '0.15'),
    primary_market: map.get('primary_market') ?? 'Houston',
    secondary_market: map.get('secondary_market') ?? 'DFW',
  }
}

export async function updateRampConfig(key: string, value: string): Promise<void> {
  await db().from('ramp_config').update({ value }).eq('config_key', key)
}

// ── Readiness CRUD ───────────────────────────────────────────────────────────

export async function loadReadiness(projectId: string): Promise<ProjectReadiness | null> {
  const { data } = await db().from('project_readiness').select('*').eq('project_id', projectId).single()
  return data as ProjectReadiness | null
}

export async function loadAllReadiness(): Promise<Map<string, ProjectReadiness>> {
  const { data } = await db().from('project_readiness').select('*').limit(2000)
  const map = new Map<string, ProjectReadiness>()
  for (const r of (data ?? []) as ProjectReadiness[]) {
    map.set(r.project_id, r)
  }
  return map
}

export async function upsertReadiness(projectId: string, updates: Partial<ProjectReadiness>, updatedBy?: string): Promise<void> {
  const score = computeReadinessScore(updates)
  const existing = await loadReadiness(projectId)
  if (existing) {
    await db().from('project_readiness').update({ ...updates, readiness_score: score, updated_by: updatedBy }).eq('project_id', projectId)
  } else {
    await db().from('project_readiness').insert({ ...updates, project_id: projectId, readiness_score: score, updated_by: updatedBy })
  }
}

// ── Schedule CRUD ────────────────────────────────────────────────────────────

export async function loadScheduleByWeek(weekStart: string): Promise<RampScheduleEntry[]> {
  const { data } = await db().from('ramp_schedule').select('*').eq('scheduled_week', weekStart).order('crew_name').order('slot').limit(100)
  return (data ?? []) as RampScheduleEntry[]
}

export async function loadAllSchedule(): Promise<RampScheduleEntry[]> {
  const { data } = await db().from('ramp_schedule').select('*').order('scheduled_week').order('crew_name').order('slot').limit(1000)
  return (data ?? []) as RampScheduleEntry[]
}

export async function loadScheduledProjectIds(): Promise<Set<string>> {
  const { data } = await db().from('ramp_schedule').select('project_id').not('status', 'in', '("cancelled","rescheduled")').limit(2000)
  return new Set((data ?? []).map((r: any) => r.project_id))
}

export async function scheduleProject(entry: Partial<RampScheduleEntry>): Promise<RampScheduleEntry | null> {
  const { data, error } = await db().from('ramp_schedule').insert(entry).select().single()
  if (error) { console.error('[scheduleProject]', error.message); return null }
  return data as RampScheduleEntry
}

export async function updateScheduleEntry(id: string, updates: Partial<RampScheduleEntry>): Promise<boolean> {
  const { error } = await db().from('ramp_schedule').update(updates).eq('id', id)
  if (error) { console.error('[updateScheduleEntry]', error.message); return false }
  return true
}

export async function completeScheduleEntry(id: string): Promise<boolean> {
  return updateScheduleEntry(id, { status: 'completed', completed_at: new Date().toISOString() })
}

export async function cancelScheduleEntry(id: string, reason: string): Promise<boolean> {
  return updateScheduleEntry(id, { status: 'cancelled', cancelled_reason: reason })
}

// ── Route Optimization ───────────────────────────────────────────────────────
// Given a list of project locations and warehouse, find the best order
// using nearest-neighbor heuristic.

export interface RoutePoint {
  id: string
  lat: number
  lng: number
  label: string
}

export function optimizeRoute(warehouse: { lat: number; lng: number }, points: RoutePoint[]): {
  ordered: RoutePoint[]
  totalMiles: number
  totalMinutes: number
  legs: { from: string; to: string; miles: number; minutes: number }[]
} {
  if (points.length <= 1) {
    const totalMiles = points.length === 1 ? haversineDistance(warehouse.lat, warehouse.lng, points[0].lat, points[0].lng) * 2 : 0
    return {
      ordered: points,
      totalMiles,
      totalMinutes: estimateDriveMinutes(totalMiles),
      legs: points.length === 1 ? [
        { from: 'Warehouse', to: points[0].label, miles: totalMiles / 2, minutes: estimateDriveMinutes(totalMiles / 2) },
        { from: points[0].label, to: 'Warehouse', miles: totalMiles / 2, minutes: estimateDriveMinutes(totalMiles / 2) },
      ] : [],
    }
  }

  // Nearest-neighbor starting from warehouse
  const remaining = [...points]
  const ordered: RoutePoint[] = []
  const legs: { from: string; to: string; miles: number; minutes: number }[] = []
  let currentLat = warehouse.lat
  let currentLng = warehouse.lng
  let currentLabel = 'Warehouse'
  let totalMiles = 0

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const dist = haversineDistance(currentLat, currentLng, remaining[i].lat, remaining[i].lng)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    legs.push({ from: currentLabel, to: next.label, miles: Math.round(bestDist * 10) / 10, minutes: estimateDriveMinutes(bestDist) })
    totalMiles += bestDist
    ordered.push(next)
    currentLat = next.lat
    currentLng = next.lng
    currentLabel = next.label
  }

  // Return to warehouse
  const returnDist = haversineDistance(currentLat, currentLng, warehouse.lat, warehouse.lng)
  legs.push({ from: currentLabel, to: 'Warehouse', miles: Math.round(returnDist * 10) / 10, minutes: estimateDriveMinutes(returnDist) })
  totalMiles += returnDist

  return {
    ordered,
    totalMiles: Math.round(totalMiles * 10) / 10,
    totalMinutes: legs.reduce((sum, l) => sum + l.minutes, 0),
    legs,
  }
}

// ── Week Helpers ─────────────────────────────────────────────────────────────

export function getMonday(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().slice(0, 10)
}

export function getWeekLabel(mondayStr: string): string {
  const d = new Date(mondayStr + 'T00:00:00')
  const end = new Date(d)
  end.setDate(end.getDate() + 4)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export function getNextWeeks(count: number): string[] {
  const weeks: string[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i * 7)
    weeks.push(getMonday(d))
  }
  return weeks
}
