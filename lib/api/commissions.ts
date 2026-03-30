// lib/api/commissions.ts — Commission rate configuration and commission record data access layer
// Solar: system watts × per-watt rate by role
// Adder: percentage of adder revenue
// Referral: flat bonus per referral

import { db } from '@/lib/db'

// ── Types ────────────────────────────────────────────────────────────────────
export type { CommissionRate, CommissionRecord, CommissionStatus, CommissionRateType } from '@/types/database'
import type { CommissionRate, CommissionRecord, CommissionStatus } from '@/types/database'

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
      org_id: effectiveOrgId ?? null,
    })
    if (record) created.push(record)
  }

  return created
}
