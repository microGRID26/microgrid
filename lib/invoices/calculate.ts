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
  /** Project-scaled raw cost basis for this line (chain rules from catalog).
   *  null when the rule doesn't carry a cost side (Rush flat-rate, MG Sales
   *  commission, percentage milestones — these are pure revenue from the
   *  recorder's perspective). #527. */
  raw_cost: number | null
  category: string | null
  sort_order: number
  /** TX sales-tax classification: true (default) = taxable TPP, false = non-TPP service.
   *  Carried from project_cost_line_items via buildChainLineItemsFromCatalog.
   *  Hand-authored rule.line_items (Rush, MG Sales) without this field default
   *  to true — those rules don't get taxed anyway (shouldApplySalesTax is
   *  EPC→EDGE only), so the default is safe. #526. */
  is_taxable_tpp: boolean
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

/** Extract the NN from "EPC Services — NTP (30%)" → 0.30. Returns null if absent.
 *  Legacy fallback path — #532 added rule.percentage column as source-of-truth.
 *  This regex only fires when percentage column is NULL (e.g. rule created via
 *  direct DB insert that skipped the new column). */
export function parsePercentageFromRuleName(name: string): number | null {
  const match = name.match(PERCENTAGE_RE)
  if (!match) return null
  const pct = Number(match[1])
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null
  return pct / 100
}

/** Resolve a rule's percentage. Prefers the rule.percentage column (#532
 *  source-of-truth), falls back to parsing the rule name for legacy rules
 *  that haven't been migrated yet. Returns null when neither yields a valid
 *  percentage in (0, 1]. */
export function resolveRulePercentage(rule: Pick<InvoiceRule, 'name' | 'percentage'>): number | null {
  if (typeof rule.percentage === 'number' && Number.isFinite(rule.percentage)) {
    if (rule.percentage > 0 && rule.percentage <= 1) return rule.percentage
  }
  return parsePercentageFromRuleName(rule.name)
}

/** ISO date string (YYYY-MM-DD) for today + N days. */
export function addDays(base: Date, days: number): string {
  const d = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)
  return d.toISOString().split('T')[0]
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Canonical line-item subtotal. Sums qty*unit_price with running-sum
 * round-to-cent at every accumulation step so floating-point error can't
 * compound across many lines. Optional predicate narrows the sum to a
 * subset (e.g., taxable-TPP lines for TX sales tax).
 *
 * Single source of truth for invoice rounding — both buildInvoiceFromRule
 * (full subtotal) and chain.ts computeChainTax (taxable subtotal) call
 * this so a future change to the policy can't drift between them. #583.
 */
export function sumLineItemsToSubtotal<T extends { quantity: number; unit_price: number }>(
  lineItems: ReadonlyArray<T>,
  predicate?: (li: T) => boolean,
): number {
  const rows = predicate ? lineItems.filter(predicate) : lineItems
  return rows.reduce(
    (sum, li) => Math.round((sum + li.quantity * li.unit_price) * 100) / 100,
    0,
  )
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
  // #533: ceiling scales with project.contract so a contract-sized milestone
  // (e.g., 50% of a $1.1M project = $550k) doesn't trip the 500k default.
  // Caller-supplied ctx.maxTotal still wins (chain.ts overrides for the
  // chain-aggregate ceiling). Number() handles the text-vs-number drift on
  // projects.contract — DB stores text, TS types it as number. ?? 0 covers
  // null. Negative contracts are nonsensical; Math.max with the default
  // floors them at the standard 500k.
  const maxTotal = ctx.maxTotal ?? Math.max(
    DEFAULT_INVOICE_CEILING_USD,
    Number(project.contract ?? 0),
  )

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

  // Detect pricing mode. Prefer rule.percentage (#532 source-of-truth column);
  // fall back to parsing the rule name for legacy rules. Percentage mode applies
  // to every line item (the 30/50/20 rules have exactly one line item anyway).
  const pct = resolveRulePercentage(rule)
  const isPercentage = pct !== null

  if (isPercentage && (project.contract === null || project.contract <= 0)) {
    return { ok: false, reason: 'contract_value_missing' }
  }

  const lineItems: InvoiceDraftLineItem[] = []

  for (let i = 0; i < rule.line_items.length; i++) {
    const raw = rule.line_items[i] as Record<string, unknown>
    const description = typeof raw.description === 'string' ? raw.description : `Line ${i + 1}`
    const category = typeof raw.category === 'string' ? raw.category : null
    const ruleQty = typeof raw.quantity === 'number' ? raw.quantity : 1
    const ruleUnitPrice = typeof raw.unit_price === 'number' ? raw.unit_price : null
    // #527: chain rules synthesized from the project catalog carry raw_cost
    // per line. Flat-rate rules (Rush, MG Sales) and percentage milestones
    // don't — read as null and recorder treats as 0.
    const ruleRawCost = typeof raw.raw_cost === 'number' ? raw.raw_cost : null
    // #526: TX-tax classification. Default true (taxable) when missing —
    // hand-authored Rush / MG Sales rules don't carry this and don't get
    // taxed anyway (shouldApplySalesTax is EPC→EDGE only).
    const ruleIsTaxableTpp = typeof raw.is_taxable_tpp === 'boolean' ? raw.is_taxable_tpp : true

    let quantity: number
    let unit_price: number

    if (isPercentage) {
      // Percentage mode: ignore the rule's unit_price (null anyway), compute from contract.
      quantity = 1
      unit_price = roundMoney((project.contract as number) * (pct as number))
    } else if (ruleUnitPrice !== null) {
      // Flat-rate mode: rule carries a concrete price.
      quantity = ruleQty
      unit_price = ruleUnitPrice
    } else {
      // No percentage in name, no unit_price in rule → we don't know what to bill.
      // Rules with variable pricing must be priced by a dedicated calculator; not Tier 1.
      return { ok: false, reason: 'line_item_missing_price' }
    }

    lineItems.push({
      description,
      quantity,
      unit_price,
      raw_cost: ruleRawCost,
      category,
      sort_order: i,
      is_taxable_tpp: ruleIsTaxableTpp,
    })
  }

  const subtotal = sumLineItemsToSubtotal(lineItems)
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
