// lib/invoices/funding-deductions.ts — Warranty chargeback netting (Tier 2 Phase 4.2)
//
// When an EPC → EDGE invoice transitions to 'paid', this module checks whether
// the from-org (the EPC) has any open funding_deductions (warranty chargebacks)
// and nets them from the payment before the invoice is finalized.
//
// The hook is synchronous — unlike the profit-transfer fire-and-forget, the
// deduction MUST be computed BEFORE the invoice update so that paid_amount
// reflects the net amount from the start. After the update succeeds, the
// deduction rows are marked 'applied'.
//
// Lifecycle:
//   1. EDGE ops opens a warranty_claim (pending)
//   2. Replacement EPC is deployed (deployed), cost known
//   3. funding_deduction row inserted (open)
//   4. Next EPC → EDGE invoice transitions to 'paid'
//   5. This module nets the deductions → sets paid_amount = total - deductions
//   6. funding_deduction rows → applied, applied_to_invoice_id set
//
// Idempotent: the unique partial index on funding_deductions(source_claim_id)
// WHERE status != 'cancelled' prevents double-deductions.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { OrgType } from '@/types/database'

// ── Constants ────────────────────────────────────────────────────────────────

/** Invoice must be from this org_type for deductions to apply. */
export const EPC_ORG_TYPE: OrgType = 'epc'

/** Invoice must be to this org_type for deductions to apply. */
export const PLATFORM_ORG_TYPE: OrgType = 'platform'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DeductionRow {
  id: string
  amount: number
  source_claim_id: string
}

export interface FundingDeductionResult {
  /** Gross amount on the invoice (invoice.total). */
  grossAmount: number
  /** Sum of all open deductions applied. 0 if none. */
  totalDeducted: number
  /** Net amount to record as paid_amount (floored at 0). */
  netAmount: number
  /** IDs of the funding_deduction rows that were applied. */
  appliedDeductionIds: string[]
}

export interface ApplyDeductionsResult {
  applied: boolean
  /** Reason for skip (if applied=false). */
  reason?: 'not_epc_to_platform' | 'no_open_deductions' | 'invoice_not_found' | 'apply_failed'
  detail?: string
  deductions?: FundingDeductionResult
}

// ── Admin client ─────────────────────────────────────────────────────────────

let _admin: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[funding-deductions] Supabase service credentials not configured')
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

// ── Pure calculator ──────────────────────────────────────────────────────────

/**
 * Compute the net payment after applying open deductions.
 * Pure function — no DB access.
 */
export function computeNetPayment(
  grossAmount: number,
  openDeductions: DeductionRow[],
): FundingDeductionResult {
  const totalDeducted = Math.round(
    openDeductions.reduce((sum, d) => sum + Number(d.amount), 0) * 100,
  ) / 100
  const netAmount = Math.max(0, Math.round((grossAmount - totalDeducted) * 100) / 100)
  return {
    grossAmount: Math.round(grossAmount * 100) / 100,
    totalDeducted,
    netAmount,
    appliedDeductionIds: openDeductions.map((d) => d.id),
  }
}

// ── Main hook entry point ────────────────────────────────────────────────────

/**
 * Synchronous pre-check: compute net payment for an EPC → EDGE invoice.
 *
 * Called from updateInvoiceStatus() BEFORE the Supabase update so that
 * paid_amount can be set to the net amount in the same write.
 *
 * Returns { netAmount, appliedDeductionIds } so the caller can:
 *   a) set updates.paid_amount = result.netAmount
 *   b) after the update succeeds, call markDeductionsApplied()
 *
 * Returns null if no deductions apply (caller proceeds with default logic).
 */
export async function computeInvoiceDeductions(
  invoiceId: string,
): Promise<FundingDeductionResult | null> {
  const admin = getAdminClient()

  // Load invoice + both org types in one joined query
  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .select('id, total, from_org, to_org')
    .eq('id', invoiceId)
    .single()
  if (invErr || !invoice) return null

  const inv = invoice as { id: string; total: number; from_org: string; to_org: string }

  // Check org types
  const { data: orgs } = await admin
    .from('organizations')
    .select('id, org_type')
    .in('id', [inv.from_org, inv.to_org])
  const orgMap: Record<string, string> = {}
  for (const o of (orgs ?? []) as Array<{ id: string; org_type: string }>) {
    orgMap[o.id] = o.org_type
  }

  if (orgMap[inv.from_org] !== EPC_ORG_TYPE) return null
  if (orgMap[inv.to_org] !== PLATFORM_ORG_TYPE) return null

  // Query open deductions for this EPC
  const { data: deductions } = await admin
    .from('funding_deductions')
    .select('id, amount, source_claim_id')
    .eq('target_epc_id', inv.from_org)
    .eq('status', 'open')
  const rows = (deductions ?? []) as DeductionRow[]
  if (rows.length === 0) return null

  return computeNetPayment(Number(inv.total), rows)
}

/**
 * After a successful invoice update: mark deduction rows as applied.
 * Called fire-and-await from updateInvoiceStatus() after the write succeeds.
 */
export async function markDeductionsApplied(
  deductionIds: string[],
  invoiceId: string,
): Promise<void> {
  if (deductionIds.length === 0) return
  const admin = getAdminClient()
  const { error } = await admin
    .from('funding_deductions')
    .update({
      status: 'applied',
      applied_to_invoice_id: invoiceId,
      applied_at: new Date().toISOString(),
    })
    .in('id', deductionIds)
    .eq('status', 'open') // guard: only apply rows still open
  if (error) {
    console.error('[funding-deductions] markDeductionsApplied failed:', error.message)
  }
}
