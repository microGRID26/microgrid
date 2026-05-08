// lib/invoices/trigger.ts — Server-side milestone → invoice generator
//
// This module is the load-bearing piece that converts a "task marked Complete"
// event into zero-or-more draft invoices based on the active invoice_rules.
// It is called from POST /api/invoices/trigger, which is itself called by
// useProjectTasks.ts when NTP / install_done / pto tasks move to Complete.
//
// Idempotency is enforced at the database level via the unique partial index
// on (project_id, rule_id, milestone) added in migration 098. Calling this
// function twice with the same (project, milestone) will produce draft invoices
// on the first call and return { skipped_existing } on subsequent calls —
// never duplicates, even under race conditions or page reloads.
//
// This module uses the service-role Supabase client because a single milestone
// event can fire invoices FROM multiple orgs (e.g. install_done fires
// Supply→EPC and Engineering→EPC and EPC→Platform simultaneously). Only a
// privileged client can write across all those org scopes in one pass.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { buildInvoiceFromRule, type CalculatorError } from '@/lib/invoices/calculate'
import type { InvoiceRule, OrgType, Project } from '@/types/database'

// ── Types ───────────────────────────────────────────────────────────────────

/** Project milestones that can trigger invoice generation. */
export type TriggerMilestone = 'ntp' | 'installation' | 'pto'

export const TRIGGER_MILESTONES: readonly TriggerMilestone[] = ['ntp', 'installation', 'pto'] as const

export interface TriggerInput {
  projectId: string
  milestone: TriggerMilestone
  /** Optional: pin the "now" timestamp for due-date calculation (tests). */
  now?: Date
}

export interface TriggerSkipped {
  ruleId: string
  ruleName: string
  reason: CalculatorError | 'from_org_unresolved' | 'to_org_unresolved' | 'insert_failed'
  detail?: string
}

export interface TriggerResult {
  projectId: string
  milestone: TriggerMilestone
  rulesEvaluated: number
  created: Array<{ invoiceId: string; invoiceNumber: string; ruleId: string; total: number }>
  skippedExisting: Array<{ ruleId: string; ruleName: string }>
  skippedError: TriggerSkipped[]
}

// ── Service-role client ─────────────────────────────────────────────────────

let _admin: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[invoice-trigger] Supabase service credentials not configured (SUPABASE_SECRET_KEY)')
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve a concrete organization id for a given org_type in the context of
 * a project.
 *
 * Rules:
 *   - `epc` and `platform` vary per project context. For `epc`, we treat the
 *     project's own `org_id` as the EPC (MicroGRID's actual architecture).
 *     For `platform` we look up the singleton active platform org.
 *   - All other types (`sales`, `engineering`, `supply`, `customer`) resolve
 *     to the SINGLE active org of that type. The production seed guarantees
 *     one active org per non-variable type; if a future project has multiple,
 *     this function picks the oldest and logs a warning.
 */
async function resolveOrgByType(
  admin: SupabaseClient,
  orgType: OrgType,
  project: Project,
): Promise<{ id: string } | null> {
  if (orgType === 'epc') {
    if (!project.org_id) return null
    return { id: project.org_id }
  }
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('org_type', orgType)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) {
    console.error('[invoice-trigger] org lookup failed:', orgType, error.message)
    return null
  }
  const row = (data as { id: string }[] | null)?.[0]
  if (!row) return null
  return { id: row.id }
}

/** Generate INV-YYYYMMDD-NNN, assuming the caller will retry on collision. */
async function generateInvoiceNumber(admin: SupabaseClient): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const prefix = `INV-${today}-`
  const { data } = await admin
    .from('invoices')
    .select('invoice_number')
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
  const last = (data as { invoice_number: string }[] | null)?.[0]?.invoice_number
  const nextNum = last ? parseInt(last.split('-').pop() ?? '0', 10) + 1 : 1
  return `${prefix}${String(nextNum).padStart(3, '0')}`
}

// ── Main trigger ────────────────────────────────────────────────────────────

/**
 * Fire all active invoice rules that match the given milestone for a project.
 * Idempotent: safe to call more than once with the same (project, milestone).
 */
export async function fireMilestoneInvoices(input: TriggerInput): Promise<TriggerResult> {
  const admin = getAdminClient()
  const result: TriggerResult = {
    projectId: input.projectId,
    milestone: input.milestone,
    rulesEvaluated: 0,
    created: [],
    skippedExisting: [],
    skippedError: [],
  }

  // 1. Load project
  const { data: project, error: projectErr } = await admin
    .from('projects')
    .select('*')
    .eq('id', input.projectId)
    .single()
  if (projectErr || !project) {
    throw new Error(`[invoice-trigger] project not found: ${input.projectId}`)
  }
  const proj = project as Project

  // 2. Load all active rules matching this milestone
  // Filter rule_kind='milestone' so chain rules (Tier 2, fired by
  // /api/invoices/generate-chain) don't get accidentally fired by task events.
  const { data: rules, error: rulesErr } = await admin
    .from('invoice_rules')
    .select('*')
    .eq('milestone', input.milestone)
    .eq('rule_kind', 'milestone')
    .eq('active', true)
    .limit(50)
  if (rulesErr) {
    throw new Error(`[invoice-trigger] failed to load rules: ${rulesErr.message}`)
  }
  const activeRules = (rules ?? []) as InvoiceRule[]
  result.rulesEvaluated = activeRules.length

  // 3. For each rule: resolve orgs, build draft, insert
  for (const rule of activeRules) {
    const fromOrg = await resolveOrgByType(admin, rule.from_org_type as OrgType, proj)
    if (!fromOrg) {
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'from_org_unresolved',
        detail: `no active org of type ${rule.from_org_type}`,
      })
      continue
    }

    const toOrg = await resolveOrgByType(admin, rule.to_org_type as OrgType, proj)
    if (!toOrg) {
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'to_org_unresolved',
        detail: `no active org of type ${rule.to_org_type}`,
      })
      continue
    }

    const invoiceNumber = await generateInvoiceNumber(admin)

    const calc = buildInvoiceFromRule({
      project: proj,
      rule,
      fromOrg,
      toOrg,
      invoiceNumber,
      now: input.now ?? new Date(),
    })

    if (!calc.ok) {
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: calc.reason,
      })
      continue
    }

    const draft = calc.draft

    // Insert invoice row. Two unique indexes can trip 23505:
    //   • invoices_invoice_number_key — same-ms collision; retry with new number (#537)
    //   • idx_invoices_rule_idempotency on (project_id, rule_id, milestone) — already
    //     generated, skip cleanly. Distinguish via constraint name in error.message.
    let currentInvoiceNumber = draft.invoice_number
    let insertedInvoice: { id: string; invoice_number: string } | null = null
    let lastErr: { code?: string; message?: string } | null = null
    const MAX_INVOICE_NUM_RETRIES = 3
    for (let attempt = 0; attempt < MAX_INVOICE_NUM_RETRIES; attempt++) {
      const { data, error: invErr } = await admin
        .from('invoices')
        .insert({
          invoice_number: currentInvoiceNumber,
          project_id: draft.project_id,
          from_org: draft.from_org,
          to_org: draft.to_org,
          status: 'draft',
          milestone: draft.milestone,
          subtotal: draft.subtotal,
          tax: 0,
          total: draft.total,
          due_date: draft.due_date,
          rule_id: draft.rule_id,
          generated_by: 'rule',
          notes: `Auto-generated by rule "${rule.name}" on ${input.milestone} milestone`,
        })
        .select('id, invoice_number')
        .single()
      if (!invErr) {
        insertedInvoice = data as { id: string; invoice_number: string }
        break
      }
      lastErr = invErr
      if (invErr.code !== '23505') break
      const msg = (invErr.message ?? '').toLowerCase()
      if (msg.includes('invoice_number') && attempt < MAX_INVOICE_NUM_RETRIES - 1) {
        currentInvoiceNumber = await generateInvoiceNumber(admin)
        continue
      }
      // Milestone idempotency hit OR ran out of retries — bail.
      break
    }

    if (!insertedInvoice) {
      const errCode = lastErr?.code
      const errMsg = (lastErr?.message ?? '').toLowerCase()
      if (errCode === '23505' && !errMsg.includes('invoice_number')) {
        result.skippedExisting.push({ ruleId: rule.id, ruleName: rule.name })
        continue
      }
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'insert_failed',
        detail: lastErr?.message,
      })
      continue
    }

    const invoiceRow = insertedInvoice

    // Bulk-insert line items
    // #526/#527: persist raw_cost (so profit-transfer reads from per-invoice
    // rows, not stale rule.line_items JSONB) and is_taxable_tpp (so TX
    // auditor can reconstruct the tax basis post-fact). Mirrors chain.ts
    // persistence at lines 576-591 — without these the milestone trigger
    // silently re-introduces the #526 over-tax bug because the column
    // default is is_taxable_tpp=true.
    const items = draft.line_items.map((li) => ({
      invoice_id: invoiceRow.id,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      total: li.quantity * li.unit_price,
      raw_cost: li.raw_cost,
      category: li.category,
      sort_order: li.sort_order,
      is_taxable_tpp: li.is_taxable_tpp,
    }))
    const { error: itemsErr } = await admin.from('invoice_line_items').insert(items)
    if (itemsErr) {
      // Invoice row exists but line items failed — leave it as an orphan draft,
      // log loudly. Next call will hit idempotency and skip, so we can't retry
      // inline without deleting + reinserting, which we don't do silently.
      console.error('[invoice-trigger] line item insert failed:', itemsErr.message)
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'insert_failed',
        detail: `line items: ${itemsErr.message}`,
      })
      continue
    }

    result.created.push({
      invoiceId: invoiceRow.id,
      invoiceNumber: invoiceRow.invoice_number,
      ruleId: rule.id,
      total: draft.total,
    })
  }

  return result
}
