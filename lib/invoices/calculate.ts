// lib/invoices/calculate.ts — Pure rule → invoice draft calculator
//
// Given a project, an invoice_rules row, and the resolved from/to orgs, produce
// a fully-computed InvoiceDraft ready to persist. No DB access, no side effects.
// Tested via __tests__/lib/invoice-calculate.test.ts.
//
// Supported rule shapes:
//   1. FLAT RATE     — line item already has `unit_price` and optional `quantity`.
//                      Example: Rush Engineering ($1,200 flat at installation).
//   2. PERCENTAGE    — rule.name contains `(NN%)`, computes unit_price as
//                      project.contract * (NN / 100), quantity = 1.
//                      Example: "EPC Services — NTP (30%)".
//   3. PER-UNIT      — not yet wired; the monthly VPP rules are deferred to a
//                      cron-based pass. Calculator returns an error for now.

import type { Invoice, InvoiceRule, Organization, Project } from '@/types/database'

// ── Constants ───────────────────────────────────────────────────────────────

// Sanity ceiling: refuse to auto-generate any invoice whose total exceeds this.
// Set high enough to cover a real EPC→EDGE 50% install milestone on a large
// commercial project, low enough to block an obvious data corruption bug.
// Override per call with ctx.maxTotal.
export const DEFAULT_INVOICE_CEILING_USD = 500_000

export const DEFAULT_DUE_DAYS = 30

// ── Types ───────────────────────────────────────────────────────────────────

export interface InvoiceDraftLineItem {
  description: string
  quantity: number
  unit_price: number
  category: string | null
  sort_order: number
}

export interface InvoiceDraft {
  invoice_number: string
  project_id: string
  from_org: string
  to_org: string
  rule_id: string
  milestone: string
  generated_by: 'rule'
  due_date: string // YYYY-MM-DD
  subtotal: number
  total: number
  line_items: InvoiceDraftLineItem[]
}

export interface CalculatorContext {
  project: Project
  rule: InvoiceRule
  fromOrg: Pick<Organization, 'id'>
  toOrg: Pick<Organization, 'id'>
  invoiceNumber: string
  now?: Date
  dueInDays?: number
  maxTotal?: number
}

export type CalculatorResult =
  | { ok: true; draft: InvoiceDraft }
  | { ok: false; reason: CalculatorError }

export type CalculatorError =
  | 'missing_project_id'
  | 'inactive_rule'
  | 'contract_value_missing'
  | 'percentage_parse_failed'
  | 'per_unit_not_supported'
  | 'line_item_missing_price'
  | 'total_exceeds_ceiling'
  | 'empty_line_items'

// ── Helpers ─────────────────────────────────────────────────────────────────

const PERCENTAGE_RE = /\((\d+(?:\.\d+)?)%\)/

/** Extract the NN from "EPC Services — NTP (30%)" → 0.30. Returns null if absent. */
export function parsePercentageFromRuleName(name: string): number | null {
  const match = name.match(PERCENTAGE_RE)
  if (!match) return null
  const pct = Number(match[1])
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null
  return pct / 100
}

/** ISO date string (YYYY-MM-DD) for today + N days. */
export function addDays(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
  return d.toISOString().split('T')[0]
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

// projects.contract is TEXT in Postgres. Strip currency symbols / commas before
// coercion so "9,970.00" and "$9,970" both parse correctly. Returns null when
// the value is absent or not a finite positive number.
function parseContractValue(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[$,]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── Main calculator ─────────────────────────────────────────────────────────

/**
 * Build an InvoiceDraft from a rule + project.
 * Pure function — no DB, no network, no side effects.
 * Returns { ok: false, reason } for any condition that would produce a bad invoice.
 */
export function buildInvoiceFromRule(ctx: CalculatorContext): CalculatorResult {
  const { project, rule, fromOrg, toOrg, invoiceNumber } = ctx
  const now = ctx.now ?? new Date()
  const dueInDays = ctx.dueInDays ?? DEFAULT_DUE_DAYS
  const maxTotal = ctx.maxTotal ?? DEFAULT_INVOICE_CEILING_USD

  if (!project.id) return { ok: false, reason: 'missing_project_id' }
  if (!rule.active) return { ok: false, reason: 'inactive_rule' }
  if (!Array.isArray(rule.line_items) || rule.line_items.length === 0) {
    return { ok: false, reason: 'empty_line_items' }
  }

  // Monthly rules (VPP, Light Energy) are handled by a different path (cron).
  // The calculator explicitly refuses them so a milestone trigger can't pick
  // one up by accident.
  if (rule.milestone === 'monthly') {
    return { ok: false, reason: 'per_unit_not_supported' }
  }

  // Detect pricing mode from rule name. Percentage mode applies to every line item
  // (the 30/50/20 rules have exactly one line item anyway).
  const pct = parsePercentageFromRuleName(rule.name)
  const isPercentage = pct !== null

  const contractValue = isPercentage ? parseContractValue(project.contract) : null
  if (isPercentage && contractValue === null) {
    return { ok: false, reason: 'contract_value_missing' }
  }

  const lineItems: InvoiceDraftLineItem[] = []
  let subtotal = 0

  for (let i = 0; i < rule.line_items.length; i++) {
    const raw = rule.line_items[i] as Record<string, unknown>
    const description = typeof raw.description === 'string' ? raw.description : `Line ${i + 1}`
    const category = typeof raw.category === 'string' ? raw.category : null
    const ruleQty = typeof raw.quantity === 'number' ? raw.quantity : 1
    const ruleUnitPrice = typeof raw.unit_price === 'number' ? raw.unit_price : null

    let quantity: number
    let unit_price: number

    if (isPercentage) {
      // Percentage mode: ignore the rule's unit_price (null anyway), compute from contract.
      quantity = 1
      unit_price = roundMoney(contractValue! * (pct as number))
    } else if (ruleUnitPrice !== null) {
      // Flat-rate mode: rule carries a concrete price.
      quantity = ruleQty
      unit_price = ruleUnitPrice
    } else {
      // No percentage in name, no unit_price in rule → we don't know what to bill.
      // Rules with variable pricing must be priced by a dedicated calculator; not Tier 1.
      return { ok: false, reason: 'line_item_missing_price' }
    }

    const total = roundMoney(quantity * unit_price)
    subtotal = roundMoney(subtotal + total)

    lineItems.push({
      description,
      quantity,
      unit_price,
      category,
      sort_order: i,
    })
  }

  const total = subtotal // tax = 0 in Tier 1

  if (total > maxTotal) {
    return { ok: false, reason: 'total_exceeds_ceiling' }
  }

  return {
    ok: true,
    draft: {
      invoice_number: invoiceNumber,
      project_id: project.id,
      from_org: fromOrg.id,
      to_org: toOrg.id,
      rule_id: rule.id,
      milestone: rule.milestone,
      generated_by: 'rule',
      due_date: addDays(now, dueInDays),
      subtotal,
      total,
      line_items: lineItems,
    },
  }
}

// ── Error messages (for UI / logs) ──────────────────────────────────────────

export const CALCULATOR_ERROR_MESSAGES: Record<CalculatorError, string> = {
  missing_project_id: 'Cannot generate invoice: project has no id',
  inactive_rule: 'Invoice rule is inactive',
  contract_value_missing: 'Cannot compute percentage invoice: project has no contract value',
  percentage_parse_failed: 'Could not parse percentage from rule name',
  per_unit_not_supported: 'Monthly / per-unit rules are handled by the recurring billing cron, not milestone triggers',
  line_item_missing_price: 'Rule line item has no unit_price and no percentage in rule name — cannot compute amount',
  total_exceeds_ceiling: 'Invoice total exceeds safety ceiling — refusing to auto-generate',
  empty_line_items: 'Invoice rule has no line items',
}

// Re-export for convenience when constructing an Invoice-shaped object
export type { Invoice }
