// lib/api/commissions.ts — Commission rate configuration and commission record data access layer
// Solar: system watts × per-watt rate by role
// Adder: percentage of adder revenue
// Referral: flat bonus per referral

import { db } from '@/lib/db'

// ── Types ────────────────────────────────────────────────────────────────────
export type { CommissionRate, CommissionRecord, CommissionStatus, CommissionRateType, CommissionTier, CommissionGeoModifier, CommissionHierarchy } from '@/types/database'
import type { CommissionRate, CommissionRecord, CommissionStatus, CommissionTier, CommissionGeoModifier, CommissionHierarchy } from '@/types/database'

// ── Constants ────────────────────────────────────────────────────────────────

export const COMMISSION_STATUSES: CommissionStatus[] = ['pending', 'approved', 'paid', 'cancelled']

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

export const COMMISSION_STATUS_BADGE: Record<CommissionStatus, string> = {
  pending: 'bg-amber-900 text-amber-300',
  approved: 'bg-blue-900 text-blue-300',
  paid: 'bg-green-900 text-green-300',
  cancelled: 'bg-red-900 text-red-300',
}

export const DEFAULT_ROLES = [
  { key: 'sales_rep', label: 'Sales Rep' },
  { key: 'closer', label: 'Closer' },
  { key: 'team_leader', label: 'Team Leader Override' },
  { key: 'manager', label: 'Manager Override' },
] as const

// ── Commission Calculation (pure function, no DB) ───────────────────────────

export interface CommissionBreakdown {
  solarCommission: number
  adderCommission: number
  referralCommission: number
  total: number
}

/**
 * Calculate commission amounts for a given role. Pure function — no DB access.
 * @param systemWatts - system size in watts (e.g., 10000 for 10kW)
 * @param adderRevenue - total adder revenue for the project
 * @param referralCount - number of referrals
 * @param roleKey - role key to calculate for
 * @param rates - loaded commission rates array
 */
export function calculateCommission(
  systemWatts: number,
  adderRevenue: number,
  referralCount: number,
  roleKey: string,
  rates: CommissionRate[],
): CommissionBreakdown {
  // Guard against negative inputs
  systemWatts = Math.max(0, systemWatts)
  adderRevenue = Math.max(0, adderRevenue)
  referralCount = Math.max(0, referralCount)

  const roleRate = rates.find(r => r.role_key === roleKey && r.active)
  const adderRate = rates.find(r => r.role_key === 'adder' && r.active)
  const referralRate = rates.find(r => r.role_key === 'referral' && r.active)

  let solarCommission = 0
  if (roleRate) {
    if (roleRate.rate_type === 'per_watt') {
      solarCommission = systemWatts * roleRate.rate
    } else if (roleRate.rate_type === 'percentage') {
      // percentage of system value — not typical for solar roles, but supported
      solarCommission = systemWatts * roleRate.rate / 100
    } else if (roleRate.rate_type === 'flat') {
      solarCommission = roleRate.rate
    }
  }

  let adderCommission = 0
  if (adderRate && adderRevenue > 0) {
    if (adderRate.rate_type === 'percentage') {
      adderCommission = adderRevenue * adderRate.rate / 100
    } else if (adderRate.rate_type === 'flat') {
      adderCommission = adderRate.rate
    }
  }

  let referralCommission = 0
  if (referralRate && referralCount > 0) {
    referralCommission = referralCount * referralRate.rate
  }

  const total = solarCommission + adderCommission + referralCommission

  return {
    solarCommission: Math.round(solarCommission * 100) / 100,
    adderCommission: Math.round(adderCommission * 100) / 100,
    referralCommission: Math.round(referralCommission * 100) / 100,
    total: Math.round(total * 100) / 100,
  }
}

// ── Rate Queries ────────────────────────────────────────────────────────────

/**
 * Load commission rates, optionally filtered by org.
 * @param orgId - filter to a specific org
 * @param activeOnly - when true (default), only returns active rates; pass false to include inactive (admin use)
 */
export async function loadCommissionRates(orgId?: string | null, activeOnly = true): Promise<CommissionRate[]> {
  const supabase = db()
  let q = supabase
    .from('commission_rates')
    .select('*')
    .order('sort_order', { ascending: true })
    .limit(100)
  if (activeOnly) q = q.eq('active', true)
  if (orgId) q = q.or(`org_id.eq.${orgId},org_id.is.null`)
  const { data, error } = await q
  if (error) console.error('[loadCommissionRates]', error.message)
  return (data ?? []) as CommissionRate[]
}

/**
 * Add a new commission rate (admin only).
 */
export async function addCommissionRate(
  rate: Omit<CommissionRate, 'id' | 'created_at' | 'updated_at'>,
): Promise<CommissionRate | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_rates')
    .insert(rate)
    .select()
    .single()
  if (error) {
    console.error('[addCommissionRate]', error.message)
    return null
  }
  return data as CommissionRate
}

/**
 * Update a commission rate (admin only).
 */
export async function updateCommissionRate(
  id: string,
  updates: Partial<CommissionRate>,
): Promise<CommissionRate | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_rates')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    console.error('[updateCommissionRate]', error.message)
    return null
  }
  return data as CommissionRate
}

/**
 * Delete a commission rate (admin only).
 */
export async function deleteCommissionRate(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('commission_rates')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteCommissionRate]', error.message)
    return false
  }
  return true
}

// ── Record Queries ──────────────────────────────────────────────────────────

export interface CommissionRecordFilters {
  userId?: string
  projectId?: string
  status?: CommissionStatus
  dateFrom?: string
  dateTo?: string
  orgId?: string | null
}

/**
 * Load commission records with optional filters, limit 500.
 */
export async function loadCommissionRecords(
  filters?: CommissionRecordFilters,
): Promise<CommissionRecord[]> {
  const supabase = db()
  let q = supabase
    .from('commission_records')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (filters?.userId) q = q.eq('user_id', filters.userId)
  if (filters?.projectId) q = q.eq('project_id', filters.projectId)
  if (filters?.status) q = q.eq('status', filters.status)
  if (filters?.dateFrom) q = q.gte('created_at', filters.dateFrom)
  if (filters?.dateTo) q = q.lte('created_at', filters.dateTo)
  if (filters?.orgId) q = q.eq('org_id', filters.orgId)
  const { data, error } = await q
  if (error) console.error('[loadCommissionRecords]', error.message)
  return (data ?? []) as CommissionRecord[]
}

/**
 * Create a commission record.
 */
export async function createCommissionRecord(
  record: Omit<CommissionRecord, 'id' | 'created_at' | 'updated_at'>,
): Promise<CommissionRecord | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_records')
    .insert(record)
    .select()
    .single()
  if (error) {
    console.error('[createCommissionRecord]', error.message)
    return null
  }
  return data as CommissionRecord
}

/**
 * Update a commission record (status, paid_at, notes, etc.).
 */
export async function updateCommissionRecord(
  id: string,
  updates: Partial<CommissionRecord>,
): Promise<CommissionRecord | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_records')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    console.error('[updateCommissionRecord]', error.message)
    return null
  }
  return data as CommissionRecord
}

// ── Earnings Summary ────────────────────────────────────────────────────────

export interface EarningsSummary {
  totalEarned: number
  totalPending: number
  totalApproved: number
  totalPaid: number
  totalCancelled: number
  byRole: { roleKey: string; total: number; count: number }[]
}

/**
 * Aggregate earnings summary for a user and/or org, optionally within a date range.
 */
export async function loadEarningsSummary(
  userId?: string | null,
  orgId?: string | null,
  dateRange?: { from?: string; to?: string },
): Promise<EarningsSummary> {
  const supabase = db()
  let q = supabase
    .from('commission_records')
    .select('role_key, status, total_commission')
    // High limit for aggregation — should move to a Postgres view/function at scale (10K+ records)
    .limit(10000)
  if (userId) q = q.eq('user_id', userId)
  if (orgId) q = q.eq('org_id', orgId)
  if (dateRange?.from) q = q.gte('created_at', dateRange.from)
  if (dateRange?.to) q = q.lte('created_at', dateRange.to)

  const { data, error } = await q
  if (error) {
    console.error('[loadEarningsSummary]', error.message)
    return { totalEarned: 0, totalPending: 0, totalApproved: 0, totalPaid: 0, totalCancelled: 0, byRole: [] }
  }

  const records = (data ?? []) as { role_key: string; status: string; total_commission: number }[]

  let totalPending = 0
  let totalApproved = 0
  let totalPaid = 0
  let totalCancelled = 0
  const roleMap = new Map<string, { total: number; count: number }>()

  for (const r of records) {
    const amt = r.total_commission ?? 0
    if (r.status === 'pending') totalPending += amt
    else if (r.status === 'approved') totalApproved += amt
    else if (r.status === 'paid') totalPaid += amt
    else if (r.status === 'cancelled') totalCancelled += amt

    // Only count non-cancelled for role breakdown
    if (r.status !== 'cancelled') {
      const existing = roleMap.get(r.role_key) ?? { total: 0, count: 0 }
      existing.total += amt
      existing.count += 1
      roleMap.set(r.role_key, existing)
    }
  }

  const totalEarned = totalPending + totalApproved + totalPaid

  return {
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalPending: Math.round(totalPending * 100) / 100,
    totalApproved: Math.round(totalApproved * 100) / 100,
    totalPaid: Math.round(totalPaid * 100) / 100,
    totalCancelled: Math.round(totalCancelled * 100) / 100,
    byRole: Array.from(roleMap.entries()).map(([roleKey, v]) => ({
      roleKey,
      total: Math.round(v.total * 100) / 100,
      count: v.count,
    })),
  }
}

// ── Generate Project Commissions ────────────────────────────────────────────

/**
 * Calculate and create commission records for a project based on current rates.
 * Reads project data (system_kw, consultant, advisor) and adders.
 * Creates records for each applicable role.
 * Returns created records.
 */
export async function generateProjectCommissions(
  projectId: string,
  orgId?: string | null,
): Promise<CommissionRecord[]> {
  const supabase = db()

  // Load project
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, systemkw, consultant, advisor, pm, pm_id, org_id')
    .eq('id', projectId)
    .single()
  if (projErr || !project) {
    console.error('[generateProjectCommissions] project load failed', projErr?.message)
    return []
  }

  // Load adders to sum revenue
  const { data: adders } = await supabase
    .from('project_adders')
    .select('price, quantity')
    .eq('project_id', projectId)
    .limit(200)
  const adderRevenue = (adders ?? []).reduce(
    (sum: number, a: { price: number; quantity: number }) => sum + (a.price ?? 0) * (a.quantity ?? 1),
    0,
  )

  // Load rates
  const effectiveOrgId = orgId ?? project.org_id
  const rates = await loadCommissionRates(effectiveOrgId)
  if (rates.length === 0) {
    console.error('[generateProjectCommissions] no active rates found')
    return []
  }

  const systemWatts = (project.systemkw ?? 0) * 1000 // kW to watts
  const created: CommissionRecord[] = []

  // Define role assignments: which project field maps to which role
  const roleAssignments: { roleKey: string; userId: string | null; userName: string | null }[] = [
    { roleKey: 'sales_rep', userId: null, userName: project.consultant },
    { roleKey: 'closer', userId: null, userName: project.advisor },
    { roleKey: 'team_leader', userId: project.pm_id, userName: project.pm },
    { roleKey: 'manager', userId: null, userName: null },
  ]

  for (const assignment of roleAssignments) {
    // Skip roles with no assigned person (except manager which may be set later)
    if (!assignment.userName && assignment.roleKey !== 'manager') continue

    const roleRate = rates.find(r => r.role_key === assignment.roleKey && r.active)
    if (!roleRate) continue

    const breakdown = calculateCommission(systemWatts, adderRevenue, 0, assignment.roleKey, rates)
    if (breakdown.total <= 0) continue

    const record = await createCommissionRecord({
      project_id: projectId,
      user_id: assignment.userId,
      user_name: assignment.userName,
      role_key: assignment.roleKey,
      system_watts: systemWatts,
      rate: roleRate.rate,
      adder_revenue: adderRevenue,
      referral_count: 0,
      solar_commission: breakdown.solarCommission,
      adder_commission: breakdown.adderCommission,
      referral_commission: breakdown.referralCommission,
      total_commission: breakdown.total,
      status: 'pending',
      milestone: null,
      paid_at: null,
      notes: null,
      admin_notes: null,
      days_since_sale: null,
      is_energy_community: false,
      adder_deduction: 0,
      org_id: effectiveOrgId ?? null,
    })
    if (record) created.push(record)
  }

  return created
}

// ── Tier Queries ───────────────────────────────────────────────────────────

/**
 * Load commission tiers for a specific rate, ordered by sort_order.
 */
export async function loadCommissionTiers(rateId: string): Promise<CommissionTier[]> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_tiers')
    .select('*')
    .eq('rate_id', rateId)
    .order('sort_order', { ascending: true })
    .limit(50)
  if (error) console.error('[loadCommissionTiers]', error.message)
  return (data ?? []) as CommissionTier[]
}

/**
 * Add a commission tier (admin only).
 */
export async function addCommissionTier(
  tier: Omit<CommissionTier, 'id' | 'created_at'>,
): Promise<CommissionTier | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_tiers')
    .insert(tier)
    .select()
    .single()
  if (error) {
    console.error('[addCommissionTier]', error.message)
    return null
  }
  return data as CommissionTier
}

/**
 * Delete a commission tier (admin only).
 */
export async function deleteCommissionTier(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('commission_tiers')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteCommissionTier]', error.message)
    return false
  }
  return true
}

// ── Geo Modifier Queries ───────────────────────────────────────────────────

/**
 * Load active geo modifiers, optionally filtered by org.
 */
export async function loadGeoModifiers(orgId?: string | null): Promise<CommissionGeoModifier[]> {
  const supabase = db()
  let q = supabase
    .from('commission_geo_modifiers')
    .select('*')
    .eq('active', true)
    .order('state', { ascending: true })
    .limit(500)
  if (orgId) q = q.or(`org_id.eq.${orgId},org_id.is.null`)
  const { data, error } = await q
  if (error) console.error('[loadGeoModifiers]', error.message)
  return (data ?? []) as CommissionGeoModifier[]
}

/**
 * Add a geo modifier (admin only).
 */
export async function addGeoModifier(
  modifier: Omit<CommissionGeoModifier, 'id' | 'created_at'>,
): Promise<CommissionGeoModifier | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_geo_modifiers')
    .insert(modifier)
    .select()
    .single()
  if (error) {
    console.error('[addGeoModifier]', error.message)
    return null
  }
  return data as CommissionGeoModifier
}

/**
 * Update a geo modifier (admin only).
 */
export async function updateGeoModifier(
  id: string,
  updates: Partial<CommissionGeoModifier>,
): Promise<CommissionGeoModifier | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_geo_modifiers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    console.error('[updateGeoModifier]', error.message)
    return null
  }
  return data as CommissionGeoModifier
}

/**
 * Delete a geo modifier (admin only).
 */
export async function deleteGeoModifier(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('commission_geo_modifiers')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[deleteGeoModifier]', error.message)
    return false
  }
  return true
}

// ── Hierarchy Queries ──────────────────────────────────────────────────────

/**
 * Load team hierarchy, optionally filtered by org.
 */
export async function loadHierarchy(orgId?: string | null): Promise<CommissionHierarchy[]> {
  const supabase = db()
  let q = supabase
    .from('commission_hierarchy')
    .select('*')
    .eq('active', true)
    .order('role_key', { ascending: true })
    .limit(500)
  if (orgId) q = q.or(`org_id.eq.${orgId},org_id.is.null`)
  const { data, error } = await q
  if (error) console.error('[loadHierarchy]', error.message)
  return (data ?? []) as CommissionHierarchy[]
}

/**
 * Add a member to the commission hierarchy (admin only).
 */
export async function addHierarchyMember(
  member: Omit<CommissionHierarchy, 'id' | 'created_at' | 'updated_at'>,
): Promise<CommissionHierarchy | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_hierarchy')
    .insert(member)
    .select()
    .single()
  if (error) {
    console.error('[addHierarchyMember]', error.message)
    return null
  }
  return data as CommissionHierarchy
}

/**
 * Update a hierarchy member (admin only).
 */
export async function updateHierarchyMember(
  id: string,
  updates: Partial<CommissionHierarchy>,
): Promise<CommissionHierarchy | null> {
  const supabase = db()
  const { data, error } = await supabase
    .from('commission_hierarchy')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    console.error('[updateHierarchyMember]', error.message)
    return null
  }
  return data as CommissionHierarchy
}

/**
 * Remove a hierarchy member (admin only). Sets active = false (soft delete).
 */
export async function removeHierarchyMember(id: string): Promise<boolean> {
  const supabase = db()
  const { error } = await supabase
    .from('commission_hierarchy')
    .update({ active: false })
    .eq('id', id)
  if (error) {
    console.error('[removeHierarchyMember]', error.message)
    return false
  }
  return true
}

// ── Pure Calculation Functions (tiers + geo) ───────────────────────────────

/**
 * Given a base rate and tiers, return the applicable rate based on deal count or total watts.
 * Tiers are checked in sort_order — first matching tier wins.
 * Falls back to the base rate if no tier matches.
 */
export function getTieredRate(
  rateId: string,
  dealCount: number,
  totalWatts: number,
  rates: CommissionRate[],
  tiers: CommissionTier[],
): number {
  const baseRate = rates.find(r => r.id === rateId)
  if (!baseRate) return 0

  // Filter tiers for this rate, sorted by sort_order
  const rateTiers = tiers
    .filter(t => t.rate_id === rateId)
    .sort((a, b) => a.sort_order - b.sort_order)

  for (const tier of rateTiers) {
    const dealsMatch =
      (tier.min_deals == null || dealCount >= tier.min_deals) &&
      (tier.max_deals == null || dealCount <= tier.max_deals)
    const wattsMatch =
      (tier.min_watts == null || totalWatts >= tier.min_watts) &&
      (tier.max_watts == null || totalWatts <= tier.max_watts)

    // Tier matches if it has deal bounds and they match, OR has watt bounds and they match
    const hasDealBounds = tier.min_deals != null || tier.max_deals != null
    const hasWattBounds = tier.min_watts != null || tier.max_watts != null

    if (hasDealBounds && hasWattBounds) {
      // Both specified: both must match
      if (dealsMatch && wattsMatch) return tier.rate
    } else if (hasDealBounds) {
      if (dealsMatch) return tier.rate
    } else if (hasWattBounds) {
      if (wattsMatch) return tier.rate
    }
  }

  return baseRate.rate
}

/**
 * Find the matching geo modifier for a given state and city.
 * Priority: exact city+state match > state-only match > region match > default (1.0).
 */
export function getGeoModifier(
  state: string | null | undefined,
  city: string | null | undefined,
  modifiers: CommissionGeoModifier[],
): number {
  if (!state && !city) return 1.0

  const active = modifiers.filter(m => m.active)
  const normState = state?.trim().toLowerCase() ?? ''
  const normCity = city?.trim().toLowerCase() ?? ''

  // Priority 1: exact city + state match
  if (normCity && normState) {
    const cityMatch = active.find(
      m => m.city?.toLowerCase() === normCity && m.state?.toLowerCase() === normState,
    )
    if (cityMatch) return cityMatch.modifier
  }

  // Priority 2: state-only match (no city specified on modifier)
  if (normState) {
    const stateMatch = active.find(
      m => m.state?.toLowerCase() === normState && !m.city,
    )
    if (stateMatch) return stateMatch.modifier
  }

  // Priority 3: region match (check if state or city has a region modifier)
  // Region modifiers have region set but no state/city
  const regionMatch = active.find(m => m.region && !m.state && !m.city)
  if (regionMatch) return regionMatch.modifier

  return 1.0
}

/**
 * Enhanced commission calculation that applies volume tiers and geo modifiers.
 * Replaces the base rate with the tiered rate (if applicable) and multiplies by geo modifier.
 */
export function calculateTieredCommission(
  systemWatts: number,
  adderRevenue: number,
  referralCount: number,
  roleKey: string,
  rates: CommissionRate[],
  tiers: CommissionTier[],
  geoModifier?: number,
  dealCount?: number,
  totalWatts?: number,
): CommissionBreakdown {
  // Guard against negative inputs
  systemWatts = Math.max(0, systemWatts)
  adderRevenue = Math.max(0, adderRevenue)
  referralCount = Math.max(0, referralCount)
  const geo = geoModifier ?? 1.0

  const roleRate = rates.find(r => r.role_key === roleKey && r.active)
  const adderRate = rates.find(r => r.role_key === 'adder' && r.active)
  const referralRate = rates.find(r => r.role_key === 'referral' && r.active)

  let solarCommission = 0
  if (roleRate) {
    // Use tiered rate if tiers are provided and volume data is available
    const effectiveRate =
      tiers.length > 0 && (dealCount != null || totalWatts != null)
        ? getTieredRate(roleRate.id, dealCount ?? 0, totalWatts ?? 0, rates, tiers)
        : roleRate.rate

    if (roleRate.rate_type === 'per_watt') {
      solarCommission = systemWatts * effectiveRate * geo
    } else if (roleRate.rate_type === 'percentage') {
      solarCommission = systemWatts * effectiveRate / 100 * geo
    } else if (roleRate.rate_type === 'flat') {
      solarCommission = effectiveRate * geo
    }
  }

  let adderCommission = 0
  if (adderRate && adderRevenue > 0) {
    if (adderRate.rate_type === 'percentage') {
      adderCommission = adderRevenue * adderRate.rate / 100
    } else if (adderRate.rate_type === 'flat') {
      adderCommission = adderRate.rate
    }
  }

  let referralCommission = 0
  if (referralRate && referralCount > 0) {
    referralCommission = referralCount * referralRate.rate
  }

  const total = solarCommission + adderCommission + referralCommission

  return {
    solarCommission: Math.round(solarCommission * 100) / 100,
    adderCommission: Math.round(adderCommission * 100) / 100,
    referralCommission: Math.round(referralCommission * 100) / 100,
    total: Math.round(total * 100) / 100,
  }
}
