// lib/invoices/profit-transfer.ts — DSE → SPE2 profit auto-transfer (Tier 2 Phase 3.2)
//
// When a chain invoice from DSE Corp → NewCo Distribution transitions to
// 'paid', this module computes the profit (revenue − raw cost) and inserts
// a row into entity_profit_transfers targeting SPE2. Per Mark Bench in the
// 2026-04-13 meeting, "Direct Supply Equity Corporation must automatically
// invest the profit it generates into an SPE entity."
//
// The hook is called from lib/api/invoices.ts updateInvoiceStatus() after a
// successful 'paid' transition. It's a fire-and-forget side effect — the
// status update succeeds even if the profit transfer fails to record (logged
// loudly, can be backfilled).
//
// Phase 3.2a (this file) = RECORD ONLY. The profit transfer row gets
// status='pending'. No real ACH movement.
//
// Phase 3.2b (banking integration, blocked on greg_actions queue) = a
// separate cron / webhook handler will transition pending → paid as ACH
// transfers settle.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Invoice, InvoiceLineItem, OrgType } from '@/types/database'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ProfitCalculation {
  raw_cost: number
  revenue: number
  profit_amount: number
}

export interface ProfitTransferResult {
  inserted: boolean
  reason?: 'not_chain_invoice' | 'not_dse_origin' | 'invoice_not_found' | 'duplicate' | 'insert_failed' | 'no_line_items'
  detail?: string
  transferId?: string
  calculation?: ProfitCalculation
}

// ── Constants ───────────────────────────────────────────────────────────────

/** The org_type that originates profit transfers (currently only DSE Corp). */
export const PROFIT_ORIGIN_ORG_TYPE: OrgType = 'direct_supply_equity_corp'

/** The target SPE entity for tax equity reinvestment per Mark Bench 2026-04-13. */
export const PROFIT_TARGET_ENTITY = 'SPE2'

// ── Pure profit calculator ──────────────────────────────────────────────────

/**
 * Compute the profit for a chain invoice from a set of line items.
 * Pure function — no DB access. The line items must come from the invoice's
 * `invoice_line_items` rows (which carry the EPC price as `total`) and are
 * cross-referenced against the chain rule's embedded `raw_cost` field for
 * the cost side.
 *
 * If a line item has no embedded raw_cost (e.g. a pure markup or fee row),
 * its raw cost is treated as 0 — which means 100% of its revenue counts as
 * profit. This is intentional: pure markup rows ARE profit by definition.
 *
 * Inputs:
 *   - lineItems: invoice_line_items rows (description, quantity, unit_price, total)
 *   - rawCostByDescription: optional lookup of raw_cost per item description
 *     pulled from the originating invoice_rules.line_items JSONB. If absent,
 *     all raw costs default to 0 (so revenue == profit).
 */
export function computeProfit(
  lineItems: Pick<InvoiceLineItem, 'description' | 'quantity' | 'unit_price' | 'total'>[],
  rawCostByDescription: Record<string, number> = {},
): ProfitCalculation {
  let revenue = 0
  let raw_cost = 0
  for (const li of lineItems) {
    // li.total is non-nullable in the type, but PostgREST can return null
    // for unset NUMERIC columns. Defensive nullish chain.
    const total = (li as { total: number | null }).total
    const lineRevenue = total !== null && total !== undefined
      ? Number(total)
      : Number(li.quantity ?? 0) * Number(li.unit_price ?? 0)
    revenue += lineRevenue
    const rawForItem = rawCostByDescription[li.description] ?? 0
    raw_cost += Number(rawForItem)
  }
  revenue = Math.round(revenue * 100) / 100
  raw_cost = Math.round(raw_cost * 100) / 100
  const profit_amount = Math.round((revenue - raw_cost) * 100) / 100
  return { raw_cost, revenue, profit_amount }
}

/**
 * Pure predicate: should this invoice trigger a profit transfer?
 *
 * Yes iff:
 *   - generated_by === 'rule'
 *   - has a rule_id
 *   - the rule's from_org_type is the PROFIT_ORIGIN_ORG_TYPE (DSE Corp)
 *   - the rule's rule_kind is 'chain' (not milestone or monthly)
 *
 * Caller passes the invoice + the resolved rule. Both must be loaded ahead
 * of time — this function does NO I/O.
 */
export function shouldTriggerProfitTransfer(
  invoice: Pick<Invoice, 'generated_by' | 'rule_id'>,
  rule: { from_org_type: string; rule_kind: string } | null,
): boolean {
  if (invoice.generated_by !== 'rule' || !invoice.rule_id) return false
  if (!rule) return false
  if (rule.rule_kind !== 'chain') return false
  if (rule.from_org_type !== PROFIT_ORIGIN_ORG_TYPE) return false
  return true
}

// ── Service-role client (for write path) ────────────────────────────────────

let _admin: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[profit-transfer] Supabase service credentials not configured')
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

// ── Main hook entry point ───────────────────────────────────────────────────

/**
 * Fire-and-forget profit transfer recording. Called from updateInvoiceStatus
 * AFTER an invoice transitions to 'paid'. Loads the invoice + rule + line
 * items, checks if the predicate matches, computes profit, inserts a row.
 *
 * Idempotent: the entity_profit_transfers table has a unique partial index
 * on triggered_by_invoice_id WHERE transfer_type = 'auto', so a duplicate
 * call is a no-op (returns reason='duplicate').
 */
export async function recordProfitTransferIfApplicable(
  invoiceId: string,
): Promise<ProfitTransferResult> {
  const admin = getAdminClient()

  // 1. Load invoice
  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .select('id, generated_by, rule_id, from_org, project_id')
    .eq('id', invoiceId)
    .single()
  if (invErr || !invoice) {
    return { inserted: false, reason: 'invoice_not_found', detail: invErr?.message }
  }
  const inv = invoice as Pick<Invoice, 'id' | 'generated_by' | 'rule_id' | 'from_org' | 'project_id'>

  // 2. Load rule
  if (!inv.rule_id) {
    return { inserted: false, reason: 'not_chain_invoice', detail: 'invoice has no rule_id' }
  }
  const { data: rule } = await admin
    .from('invoice_rules')
    .select('id, from_org_type, rule_kind, line_items')
    .eq('id', inv.rule_id)
    .single()
  const ruleRow = rule as { id: string; from_org_type: string; rule_kind: string; line_items: Array<Record<string, unknown>> } | null

  // 3. Predicate check
  if (!shouldTriggerProfitTransfer(inv, ruleRow)) {
    return {
      inserted: false,
      reason: ruleRow?.from_org_type !== PROFIT_ORIGIN_ORG_TYPE ? 'not_dse_origin' : 'not_chain_invoice',
    }
  }

  // 4. Load invoice line items + build raw_cost lookup from rule's line_items JSONB
  const { data: lineItems } = await admin
    .from('invoice_line_items')
    .select('description, quantity, unit_price, total')
    .eq('invoice_id', invoiceId)
    .limit(100)
  const items = (lineItems ?? []) as Pick<InvoiceLineItem, 'description' | 'quantity' | 'unit_price' | 'total'>[]
  if (items.length === 0) {
    return { inserted: false, reason: 'no_line_items' }
  }

  const rawCostByDescription: Record<string, number> = {}
  for (const ruleItem of ruleRow!.line_items) {
    const desc = typeof ruleItem.description === 'string' ? ruleItem.description : null
    const rawCost = typeof ruleItem.raw_cost === 'number' ? ruleItem.raw_cost : null
    if (desc && rawCost !== null) {
      rawCostByDescription[desc] = rawCost
    }
  }

  // 5. Compute profit
  const calculation = computeProfit(items, rawCostByDescription)

  // 6. Insert profit transfer row (idempotent via unique partial index)
  const { data: inserted, error: insertErr } = await admin
    .from('entity_profit_transfers')
    .insert({
      source_org_id: inv.from_org,
      target_entity: PROFIT_TARGET_ENTITY,
      project_id: inv.project_id,
      triggered_by_invoice_id: invoiceId,
      raw_cost: calculation.raw_cost,
      revenue: calculation.revenue,
      profit_amount: calculation.profit_amount,
      transfer_type: 'auto',
      status: 'pending',
      notes: `Auto-recorded on invoice paid transition (Phase 3.2a). Banking integration is Phase 3.2b — money has not actually moved yet.`,
    })
    .select('id')
    .single()

  if (insertErr) {
    if (insertErr.code === '23505') {
      return { inserted: false, reason: 'duplicate', calculation }
    }
    return { inserted: false, reason: 'insert_failed', detail: insertErr.message, calculation }
  }

  return {
    inserted: true,
    transferId: (inserted as { id: string }).id,
    calculation,
  }
}
