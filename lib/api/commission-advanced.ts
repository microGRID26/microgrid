// lib/api/commission-advanced.ts — EC/Non-EC commission calculation, M1 advances, clawback, adder deductions
// Based on the MicroGRID Commission Structure CSV:
//   EC template: $0.50/W gross, $0.10/W ops deduction, $0.40/W effective stack
//   Non-EC template: $0.35/W gross, $0.10/W ops deduction, $0.25/W effective stack

import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'

// ── Type Re-exports ─────────────────────────────────────────────────────────

export type { CommissionConfig, CommissionAdvance, AdvanceStatus } from '@/types/database'
import type { CommissionAdvance, AdvanceStatus } from '@/types/database'

// ── Constants ───────────────────────────────────────────────────────────────

export const ADVANCE_STATUSES: AdvanceStatus[] = ['pending', 'approved', 'paid', 'clawed_back', 'cancelled']

export const ADVANCE_STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  paid: 'Paid',
  clawed_back: 'Clawed Back',
  cancelled: 'Cancelled',
}

export const ADVANCE_STATUS_BADGE: Record<AdvanceStatus, string> = {
  pending: 'bg-amber-900 text-amber-300',
  approved: 'bg-blue-900 text-blue-300',
  paid: 'bg-green-900 text-green-300',
  clawed_back: 'bg-red-900 text-red-300',
  cancelled: 'bg-gray-700 text-gray-300',
}

/** Default config values for quick reference without DB query */
export const EC_DEFAULTS = {
  ec_gross_per_watt: 0.50,
  non_ec_gross_per_watt: 0.35,
  ec_bonus_per_watt: 0.15,
  operations_deduction_pct: 20,
  operations_per_watt: 0.10,
  ec_effective_per_watt: 0.40,
  non_ec_effective_per_watt: 0.25,
  m1_advance_amount: 1000,
  m1_self_gen_ec_split: 100,
  m1_ec_ea_split: 50,
  clawback_days: 90,
  adder_deduction_from_stack: true,
} as const

// ── Commission Config ───────────────────────────────────────────────────────

/** Load all commission config as a key-value record */
export async function loadCommissionConfig(orgId?: string): Promise<Record<string, string>> {
  const supabase = db()
  let query = supabase.from('commission_config').select('config_key, value')
  if (orgId) {
    query = query.or(`org_id.eq.${orgId},org_id.is.null`)
  }
  const { data, error } = await query
  if (error) {
    console.error('loadCommissionConfig error:', error)
    return {}
  }
  const config: Record<string, string> = {}
  for (const row of data ?? []) {
    config[row.config_key] = row.value
  }
  return config
}

/** Admin: update a single config value */
export async function updateCommissionConfig(key: string, value: string): Promise<boolean> {
  const { error } = await db()
    .from('commission_config')
    .update({ value })
    .eq('config_key', key)
  if (error) {
    console.error('updateCommissionConfig error:', error)
    return false
  }
  return true
}

// ── Commission Calculation (Pure Functions) ─────────────────────────────────

export interface ProjectCommissionInput {
  system_kw: number          // system size in kW
  energy_community: boolean  // EC flag
  adder_total: number        // sum of project adders (price * quantity)
  self_generated: boolean    // did the EC self-generate the deal (vs EA split)?
}

export interface RoleDistribution {
  role_key: string
  label: string
  percentage: number
}

export interface CommissionLineItem {
  role_key: string
  label: string
  percentage: number
  gross_per_watt: number
  ops_deduction_per_watt: number
  effective_per_watt: number
  system_watts: number
  gross_amount: number
  ops_deduction: number
  adder_deduction: number
  net_commission: number
}

export interface ProjectCommissionBreakdown {
  is_ec: boolean
  system_watts: number
  gross_per_watt: number
  ops_deduction_per_watt: number
  effective_per_watt: number
  total_gross: number
  total_ops_deduction: number
  total_adder_deduction: number
  total_net: number
  lines: CommissionLineItem[]
  m1_advance: number
  m1_ec_amount: number
  m1_ea_amount: number
}

/**
 * Calculate the full commission breakdown for a project.
 * Pure function -- no DB access. Pass config and distribution from DB or defaults.
 *
 * @param project - project data (system_kw, energy_community, adder_total, self_generated)
 * @param config - commission config as Record<string, string> (from loadCommissionConfig)
 * @param distribution - role distribution array (from pay_distribution table)
 */
export function calculateProjectCommission(
  project: ProjectCommissionInput,
  config: Record<string, string>,
  distribution: RoleDistribution[],
): ProjectCommissionBreakdown {
  const isEC = project.energy_community
  const systemWatts = project.system_kw * 1000

  // Per-watt rates from config
  const grossPerWatt = parseFloat(
    config[isEC ? 'ec_gross_per_watt' : 'non_ec_gross_per_watt'] ??
    String(isEC ? EC_DEFAULTS.ec_gross_per_watt : EC_DEFAULTS.non_ec_gross_per_watt)
  )
  const opsPerWatt = parseFloat(
    config['operations_per_watt'] ?? String(EC_DEFAULTS.operations_per_watt)
  )
  const effectivePerWatt = parseFloat(
    config[isEC ? 'ec_effective_per_watt' : 'non_ec_effective_per_watt'] ??
    String(isEC ? EC_DEFAULTS.ec_effective_per_watt : EC_DEFAULTS.non_ec_effective_per_watt)
  )

  // Totals before distribution
  const totalGross = systemWatts * grossPerWatt
  const totalOpsDeduction = systemWatts * opsPerWatt
  const adderDeductFromStack = (config['adder_deduction_from_stack'] ?? 'true') === 'true'
  const totalAdderDeduction = adderDeductFromStack ? project.adder_total : 0
  const distributablePool = Math.max(0, totalGross - totalOpsDeduction - totalAdderDeduction)

  // M1 advance calculation
  const m1Amount = parseFloat(config['m1_advance_amount'] ?? String(EC_DEFAULTS.m1_advance_amount))
  const selfGenSplit = parseFloat(config['m1_self_gen_ec_split'] ?? String(EC_DEFAULTS.m1_self_gen_ec_split))
  const ecEaSplit = parseFloat(config['m1_ec_ea_split'] ?? String(EC_DEFAULTS.m1_ec_ea_split))

  let m1EcAmount: number
  let m1EaAmount: number
  if (project.self_generated) {
    m1EcAmount = m1Amount * (selfGenSplit / 100)
    m1EaAmount = m1Amount - m1EcAmount
  } else {
    m1EcAmount = m1Amount * (ecEaSplit / 100)
    m1EaAmount = m1Amount - m1EcAmount
  }

  // Per-role distribution
  const lines: CommissionLineItem[] = distribution.map((d) => {
    const pct = d.percentage / 100
    const roleGross = totalGross * pct
    const roleOps = totalOpsDeduction * pct
    const roleAdder = totalAdderDeduction * pct
    const roleNet = Math.max(0, distributablePool * pct)

    return {
      role_key: d.role_key,
      label: d.label,
      percentage: d.percentage,
      gross_per_watt: grossPerWatt,
      ops_deduction_per_watt: opsPerWatt,
      effective_per_watt: effectivePerWatt,
      system_watts: systemWatts,
      gross_amount: Math.round(roleGross * 100) / 100,
      ops_deduction: Math.round(roleOps * 100) / 100,
      adder_deduction: Math.round(roleAdder * 100) / 100,
      net_commission: Math.round(roleNet * 100) / 100,
    }
  })

  const totalNet = lines.reduce((sum, l) => sum + l.net_commission, 0)

  return {
    is_ec: isEC,
    system_watts: systemWatts,
    gross_per_watt: grossPerWatt,
    ops_deduction_per_watt: opsPerWatt,
    effective_per_watt: effectivePerWatt,
    total_gross: Math.round(totalGross * 100) / 100,
    total_ops_deduction: Math.round(totalOpsDeduction * 100) / 100,
    total_adder_deduction: Math.round(totalAdderDeduction * 100) / 100,
    total_net: Math.round(totalNet * 100) / 100,
    lines,
    m1_advance: m1Amount,
    m1_ec_amount: Math.round(m1EcAmount * 100) / 100,
    m1_ea_amount: Math.round(m1EaAmount * 100) / 100,
  }
}

// ── Days Since Sale (Pure Function) ─────────────────────────────────────────

/** Returns the number of days since the sale date, or 0 if no sale date */
export function calculateDaysSinceSale(saleDate: string | null | undefined): number {
  if (!saleDate) return 0
  const sale = new Date(saleDate)
  if (isNaN(sale.getTime())) return 0
  const now = new Date()
  const diffMs = now.getTime() - sale.getTime()
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
}

/** Check if an advance is eligible for clawback (past clawback window and still paid) */
export function isClawbackEligible(
  advance: Pick<CommissionAdvance, 'status' | 'clawback_date'>,
  clawbackDays?: number,
): boolean {
  if (advance.status !== 'paid') return false
  if (!advance.clawback_date) return false
  const clawbackDate = new Date(advance.clawback_date)
  if (isNaN(clawbackDate.getTime())) return false
  return new Date() >= clawbackDate
}

// ── M1 Advances CRUD ────────────────────────────────────────────────────────

export interface AdvanceFilters {
  projectId?: string
  repId?: string
  status?: AdvanceStatus
  orgId?: string
}

/** Load M1 advances with optional filters */
export async function loadAdvances(filters?: AdvanceFilters): Promise<CommissionAdvance[]> {
  const supabase = db()
  let query = supabase
    .from('commission_advances')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters?.projectId) query = query.eq('project_id', filters.projectId)
  if (filters?.repId) query = query.eq('rep_id', filters.repId)
  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.orgId) query = query.eq('org_id', filters.orgId)

  const { data, error } = await query
  if (error) {
    console.error('loadAdvances error:', error)
    return []
  }
  return (data ?? []) as CommissionAdvance[]
}

/** Create an M1 advance record */
export async function createAdvance(
  advance: Omit<CommissionAdvance, 'id' | 'status' | 'created_at' | 'updated_at'> & {
    status?: AdvanceStatus
  },
): Promise<CommissionAdvance | null> {
  const { data, error } = await db()
    .from('commission_advances')
    .insert(advance)
    .select()
    .single()
  if (error) {
    console.error('createAdvance error:', error)
    return null
  }
  return data as CommissionAdvance
}

/** Update an advance record (approve, pay, cancel, add admin notes) */
export async function updateAdvance(
  id: string,
  updates: Partial<CommissionAdvance>,
): Promise<boolean> {
  const { error } = await db()
    .from('commission_advances')
    .update(updates)
    .eq('id', id)
  if (error) {
    console.error('updateAdvance error:', error)
    return false
  }
  return true
}

/** Mark an advance as clawed back with reason and timestamp */
export async function clawbackAdvance(id: string, reason: string): Promise<boolean> {
  const { error } = await db()
    .from('commission_advances')
    .update({
      status: 'clawed_back',
      clawback_reason: reason,
      clawed_back_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) {
    console.error('clawbackAdvance error:', error)
    return false
  }
  return true
}

/** Load advances where the clawback date has passed and status is still 'paid' */
export async function loadPendingClawbacks(orgId?: string): Promise<CommissionAdvance[]> {
  const supabase = db()
  const today = new Date().toISOString().split('T')[0]
  let query = supabase
    .from('commission_advances')
    .select('*')
    .eq('status', 'paid')
    .lte('clawback_date', today)
    .order('clawback_date', { ascending: true })
    .limit(200)

  if (orgId) query = query.eq('org_id', orgId)

  const { data, error } = await query
  if (error) {
    console.error('loadPendingClawbacks error:', error)
    return []
  }
  return (data ?? []) as CommissionAdvance[]
}
