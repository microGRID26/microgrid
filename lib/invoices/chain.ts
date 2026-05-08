// lib/invoices/chain.ts — Multi-tenant invoicing chain orchestrator (Tier 2)
//
// This module fires the 4-link tax-substantiation chain that Mark Bench
// specified in the 2026-04-13 meeting:
//
//   Direct Supply Equity Corp → NewCo Distribution → EPC → EDGE
//                            + Rush Engineering   → EPC
//                            + MicroGRID Sales    → EPC
//
// Unlike the milestone trigger (lib/invoices/trigger.ts), this orchestrator
// is fired explicitly by /api/invoices/generate-chain with a project_id. It
// can be called retroactively on existing projects to backfill theoretical
// chain invoices for appraiser/tax-attorney review.
//
// All rules with rule_kind='chain' are loaded at once and processed in a
// single pass. The existing buildInvoiceFromRule() pure calculator handles
// the per-line-item math in flat-rate mode.
//
// Phase 1.5 — chain rules with `use_project_catalog=true` skip their
// proforma-reference line_items JSONB and rebuild line items from
// project_cost_line_items (backfilled in Session 47, migration 103). The
// (from_org_type, to_org_type) tuple picks which price column to read:
//
//   direct_supply_equity_corp → newco_distribution → raw_cost
//   newco_distribution        → epc                → distro_price
//   epc                       → platform           → epc_price
//
// is_epc_internal line items (field execution labor) flow only on EPC→EDGE;
// they are dropped on the two upstream links since they never move through
// the supplier/distributor chain. Rules that are NOT catalog-sourced (Rush
// Engineering, MicroGRID Sales commission) keep their flat JSONB line items.
//
// Sales tax is applied here as a separate step on the EPC → EDGE link only.
//
// Idempotent: relies on the same unique partial index on
// (project_id, rule_id, milestone) added in migration 098. Calling twice
// returns the existing draft IDs on the second call rather than creating
// duplicates.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { ProjectCostLineItem } from '@/lib/cost/calculator'
import { buildInvoiceFromRule, sumLineItemsToSubtotal, type CalculatorError } from '@/lib/invoices/calculate'
import type { InvoiceRule, OrgType, Project } from '@/types/database'

// ── Constants ───────────────────────────────────────────────────────────────

/** Texas sales tax rate, applied only to the EPC → EDGE chain link. */
export const TX_SALES_TAX_RATE = 0.0825

/** Magic milestone string used by every chain rule. */
export const CHAIN_MILESTONE = 'chain'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChainTriggerInput {
  projectId: string
  /** Optional: pin "now" for due-date deterministic tests. */
  now?: Date
  /** When true, do NOT persist anything — return the would-be invoices for review. */
  dryRun?: boolean
}

export interface ChainSkippedRule {
  ruleId: string
  ruleName: string
  reason:
    | CalculatorError
    | 'from_org_unresolved'
    | 'to_org_unresolved'
    | 'self_invoice_skip'
    | 'insert_failed'
    | 'catalog_empty'
    | 'catalog_load_failed'
    | 'unmapped_catalog_link'
  detail?: string
}

export interface ChainCreatedInvoice {
  invoiceId: string | null // null in dry-run mode
  invoiceNumber: string
  ruleId: string
  ruleName: string
  fromOrgId: string
  toOrgId: string
  subtotal: number
  tax: number
  total: number
  isDryRun: boolean
}

export interface ChainTriggerResult {
  projectId: string
  rulesEvaluated: number
  created: ChainCreatedInvoice[]
  skippedExisting: Array<{ ruleId: string; ruleName: string }>
  skippedError: ChainSkippedRule[]
  dryRun: boolean
}

// ── Service-role client ─────────────────────────────────────────────────────

let _admin: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[invoice-chain] Supabase service credentials not configured (SUPABASE_SECRET_KEY)')
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

// ── Org resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a concrete organization id for a given org_type in the context of
 * a project. Mirrors lib/invoices/trigger.ts resolveOrgByType but with the
 * two new chain org types (direct_supply_equity_corp, newco_distribution)
 * added to the singleton-lookup path.
 *
 * For 'sales': looks up the singleton org with settings.is_sales_originator=true.
 * Falls back to the oldest active 'sales' org if no flag is set.
 */
async function resolveChainOrgByType(
  admin: SupabaseClient,
  orgType: OrgType,
  project: Project,
): Promise<{ id: string } | null> {
  // EPC is per-project (project.org_id)
  if (orgType === 'epc') {
    if (!project.org_id) return null
    return { id: project.org_id }
  }

  // Sales originator: try the flagged MicroGRID Energy org first
  if (orgType === 'sales') {
    const { data: flagged } = await admin
      .from('organizations')
      .select('id, settings')
      .eq('active', true)
      .or('org_type.eq.sales,org_type.eq.epc')
      .order('created_at', { ascending: true })
      .limit(20)
    const flaggedRow = ((flagged as Array<{ id: string; settings: Record<string, unknown> | null }> | null) ?? [])
      .find((r) => r.settings && (r.settings as Record<string, unknown>).is_sales_originator === true)
    if (flaggedRow) return { id: flaggedRow.id }
    // fall through to type-based singleton lookup
  }

  // All other types resolve to the oldest active org of that type
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('org_type', orgType)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    console.error('[invoice-chain] org lookup failed:', orgType, error.message)
    return null
  }
  const row = (data as { id: string }[] | null)?.[0]
  if (!row) return null
  return { id: row.id }
}

// ── Invoice number generation (chain-prefixed) ──────────────────────────────

async function generateChainInvoiceNumber(admin: SupabaseClient): Promise<string> {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const prefix = `CHN-${today}-`
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

// ── Sales tax application ───────────────────────────────────────────────────

/**
 * Determine whether a chain rule should have TX sales tax (8.25%) applied.
 * Per Mark + Paul in the 2026-04-13 meeting: only the EPC → EDGE invoice
 * carries sales tax. Other links use resale-exempt tax IDs.
 */
export function shouldApplySalesTax(rule: InvoiceRule): boolean {
  return rule.from_org_type === 'epc' && rule.to_org_type === 'platform'
}

/**
 * Compute the TX sales-tax amount over the taxable-TPP subset of line items.
 * Returns 0 when shouldApply is false (non-EPC→EDGE links). Pure function;
 * the chain orchestrator decides whether to apply via shouldApplySalesTax.
 *
 * #526. Previously the orchestrator taxed draft.subtotal, which over-collected
 * ~$6,188/project on the typical EPC→EDGE invoice (~8.25% × ~$75k of non-TPP
 * service rows: engineering, inspection, sales commission, warranty, EPC
 * residual). Conservative default: rows without an explicit is_taxable_tpp
 * flag are treated as taxable (handles legacy hand-authored rules).
 */
export function computeChainTax(
  lineItems: ReadonlyArray<{ quantity: number; unit_price: number; is_taxable_tpp: boolean }>,
  shouldApply: boolean,
): number {
  if (!shouldApply) return 0
  // #583: canonical rounding policy lives in calculate.ts. Was inlined here.
  const taxableSubtotal = sumLineItemsToSubtotal(lineItems, (li) => li.is_taxable_tpp)
  return Math.round(taxableSubtotal * TX_SALES_TAX_RATE * 100) / 100
}

// ── Project catalog → chain line items (Phase 1.5) ──────────────────────────

/**
 * Which price column on project_cost_line_items maps to the chain link
 * (from_org_type, to_org_type). Returns null for links that aren't sourced
 * from the 28-row project catalog (Rush Engineering, MG Sales commission) —
 * those stay on flat rule.line_items JSONB.
 */
export type ChainPriceField = 'raw_cost' | 'distro_price' | 'epc_price'

export function pickChainPriceField(
  fromOrgType: string,
  toOrgType: string,
): ChainPriceField | null {
  if (fromOrgType === 'direct_supply_equity_corp' && toOrgType === 'newco_distribution') {
    return 'raw_cost'
  }
  if (fromOrgType === 'newco_distribution' && toOrgType === 'epc') {
    return 'distro_price'
  }
  if (fromOrgType === 'epc' && toOrgType === 'platform') {
    return 'epc_price'
  }
  return null
}

/**
 * Pure helper — given the per-project cost line items (already scaled by sizing
 * during Session 47 backfill) and the chain link, synthesize the line items the
 * calculator needs. Returned shape matches the {description, quantity, unit_price,
 * category} fields the flat-rate path of buildInvoiceFromRule reads.
 *
 * Filter rule: is_epc_internal=true items (field execution labor, EPC-attestation
 * proof) do NOT flow DSE→NewCo or NewCo→EPC — they are EPC's own costs, not
 * equipment moving through the distribution chain. They DO flow EPC→EDGE because
 * EPC bills EDGE for the whole delivered project including labor.
 */
export function buildChainLineItemsFromCatalog(
  catalog: ProjectCostLineItem[],
  fromOrgType: string,
  toOrgType: string,
): Array<{
  description: string
  quantity: number
  unit_price: number
  raw_cost: number
  category: string | null
  is_taxable_tpp: boolean
}> {
  const priceField = pickChainPriceField(fromOrgType, toOrgType)
  if (priceField === null) return []
  const includeEpcInternal = fromOrgType === 'epc' && toOrgType === 'platform'

  return catalog
    .filter((li) => (includeEpcInternal ? true : !li.is_epc_internal))
    .map((li) => ({
      description: li.item_name,
      quantity: 1,
      // project_cost_line_items is NUMERIC in Postgres → may arrive as string
      // through PostgREST; coerce defensively. Session 47 taught us this bites.
      unit_price: Number(li[priceField]),
      // #527: project-scaled raw cost basis (always present on catalog rows
      // since Session 47 backfill). Carried through invoice_line_items so
      // profit-transfer.ts can read project-scaled values, not the static
      // rule.line_items JSONB.
      raw_cost: Number(li.raw_cost),
      category: li.section ?? null,
      // #526: TX-tax classification. Mirrored from template at materialization;
      // the chain.ts EPC→EDGE tax filter reads this on the InvoiceDraftLineItem
      // side after buildInvoiceFromRule passes it through.
      is_taxable_tpp: li.is_taxable_tpp,
    }))
}

// ── Main orchestrator ───────────────────────────────────────────────────────

/**
 * Fire all active chain rules against a project. Idempotent: if chain
 * invoices already exist for this project, returns their existing IDs.
 *
 * In dryRun mode, computes the would-be invoices but does NOT persist —
 * useful for preview UIs and test runs.
 */
export async function generateProjectChain(input: ChainTriggerInput): Promise<ChainTriggerResult> {
  const admin = getAdminClient()
  const result: ChainTriggerResult = {
    projectId: input.projectId,
    rulesEvaluated: 0,
    created: [],
    skippedExisting: [],
    skippedError: [],
    dryRun: input.dryRun ?? false,
  }

  // 1. Load project
  const { data: project, error: projectErr } = await admin
    .from('projects')
    .select('*')
    .eq('id', input.projectId)
    .single()
  if (projectErr || !project) {
    throw new Error(`[invoice-chain] project not found: ${input.projectId}`)
  }
  const proj = project as Project

  // 2. Load all active chain rules
  const { data: rules, error: rulesErr } = await admin
    .from('invoice_rules')
    .select('*')
    .eq('rule_kind', 'chain')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(50)
  if (rulesErr) {
    throw new Error(`[invoice-chain] failed to load chain rules: ${rulesErr.message}`)
  }
  const chainRules = (rules ?? []) as InvoiceRule[]
  result.rulesEvaluated = chainRules.length

  // 3. Lazy-load the per-project cost catalog (once per run). Only needed if
  //    at least one rule has use_project_catalog=true. A single empty or
  //    failed load marks the rules skipped rather than throwing — other
  //    flat-rate rules (Rush, MG Sales) can still proceed.
  let catalogCache: ProjectCostLineItem[] | null = null
  let catalogLoadError: string | null = null
  const anyCatalogRule = chainRules.some((r) => r.use_project_catalog === true)
  if (anyCatalogRule) {
    const { data: catalogRows, error: catalogErr } = await admin
      .from('project_cost_line_items')
      .select('*')
      .eq('project_id', proj.id)
      .order('sort_order', { ascending: true })
    if (catalogErr) {
      catalogLoadError = catalogErr.message
    } else {
      catalogCache = (catalogRows ?? []) as ProjectCostLineItem[]
    }
  }

  // 4. For each rule: resolve orgs, build draft, optionally persist
  for (const rule of chainRules) {
    const fromOrg = await resolveChainOrgByType(admin, rule.from_org_type as OrgType, proj)
    if (!fromOrg) {
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'from_org_unresolved',
        detail: `no active org of type ${rule.from_org_type}`,
      })
      continue
    }

    const toOrg = await resolveChainOrgByType(admin, rule.to_org_type as OrgType, proj)
    if (!toOrg) {
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'to_org_unresolved',
        detail: `no active org of type ${rule.to_org_type}`,
      })
      continue
    }

    // Self-invoice skip: when from_org_id === to_org_id (e.g. MG Energy is
    // both the sales originator AND the EPC on a project), skip the rule
    // rather than insert a same-org invoice.
    if (fromOrg.id === toOrg.id) {
      result.skippedError.push({
        ruleId: rule.id,
        ruleName: rule.name,
        reason: 'self_invoice_skip',
        detail: `from_org === to_org === ${fromOrg.id}`,
      })
      continue
    }

    const invoiceNumber = await generateChainInvoiceNumber(admin)

    // Phase 1.5 — if this rule is catalog-sourced, rebuild line items from the
    // per-project cost catalog rather than the static proforma JSONB. The synthesized
    // rule feeds the existing flat-rate calculator unchanged; the rule's own
    // line_items are ignored for this call.
    let effectiveRule: InvoiceRule = rule
    if (rule.use_project_catalog) {
      if (catalogLoadError !== null) {
        result.skippedError.push({
          ruleId: rule.id,
          ruleName: rule.name,
          reason: 'catalog_load_failed',
          detail: catalogLoadError,
        })
        continue
      }
      if (!catalogCache || catalogCache.length === 0) {
        result.skippedError.push({
          ruleId: rule.id,
          ruleName: rule.name,
          reason: 'catalog_empty',
          detail: `project ${proj.id} has no project_cost_line_items rows`,
        })
        continue
      }
      const priceField = pickChainPriceField(rule.from_org_type, rule.to_org_type)
      if (priceField === null) {
        result.skippedError.push({
          ruleId: rule.id,
          ruleName: rule.name,
          reason: 'unmapped_catalog_link',
          detail: `no catalog mapping for ${rule.from_org_type} → ${rule.to_org_type}`,
        })
        continue
      }
      const catalogLineItems = buildChainLineItemsFromCatalog(
        catalogCache,
        rule.from_org_type,
        rule.to_org_type,
      )
      effectiveRule = {
        ...rule,
        line_items: catalogLineItems as unknown as Record<string, unknown>[],
      }
    }

    // #526 R1 M-1: detect the future-foot-gun where someone adds an EPC→platform
    // rule with hand-authored line_items (use_project_catalog=false) that
    // don't carry is_taxable_tpp. The default-true fallback would silently
    // tax the entire amount — same shape of bug as #526 was filed against.
    if (
      shouldApplySalesTax(rule) &&
      !rule.use_project_catalog &&
      Array.isArray(effectiveRule.line_items) &&
      effectiveRule.line_items.some(
        (li) => typeof (li as Record<string, unknown>).is_taxable_tpp !== 'boolean',
      )
    ) {
      console.warn(
        `[invoice-chain] #526 risk: rule "${rule.name}" (${rule.id}) is EPC→platform with hand-authored line_items missing is_taxable_tpp — will default to taxable on every line. Either set use_project_catalog=true or add is_taxable_tpp to each line_items entry.`,
      )
    }

    // Reuse the existing flat-rate calculator. Chain rules carry concrete
    // unit_price values per line — either from the proforma JSONB (Rush, MG Sales)
    // or synthesized from the project catalog above (DSE→NewCo, NewCo→EPC,
    // EPC→EDGE). Chain totals can well exceed the milestone ceiling, so we pass
    // a chain-specific cap.
    const calc = buildInvoiceFromRule({
      project: proj,
      rule: effectiveRule,
      fromOrg,
      toOrg,
      invoiceNumber,
      now: input.now ?? new Date(),
      // #533: scale the chain ceiling with project.contract so a $10M
      // commercial project doesn't trip the historical 5M floor. Number()
      // handles the text-vs-number drift on projects.contract.
      maxTotal: Math.max(5_000_000, Number(proj.contract ?? 0)),
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

    // #526: tax over taxable-TPP line items only (engineering / inspection /
    // sales commission / warranty / EPC residual are non-TPP services and are
    // excluded). Was previously taxing draft.subtotal which over-collected
    // ~$6,188/project.
    const tax = computeChainTax(draft.line_items, shouldApplySalesTax(rule))
    const total = Math.round((draft.subtotal + tax) * 100) / 100

    // Dry-run: collect the would-be invoice and continue.
    if (result.dryRun) {
      result.created.push({
        invoiceId: null,
        invoiceNumber,
        ruleId: rule.id,
        ruleName: rule.name,
        fromOrgId: fromOrg.id,
        toOrgId: toOrg.id,
        subtotal: draft.subtotal,
        tax,
        total,
        isDryRun: true,
      })
      continue
    }

    // Persist: insert invoice + line items. Two unique indexes can trip
    // 23505 — invoices_invoice_number_key (same-ms collision; retry with new
    // number per #537) and idx_invoices_rule_idempotency on
    // (project_id, rule_id, milestone) (already generated; skip cleanly).
    // Distinguish via constraint name in error.message.
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
          milestone: CHAIN_MILESTONE,
          subtotal: draft.subtotal,
          tax,
          total,
          due_date: draft.due_date,
          rule_id: draft.rule_id,
          generated_by: 'rule',
          notes: `Auto-generated chain rule "${rule.name}" — chain orchestrator${tax > 0 ? ' (incl. TX sales tax on TPP portion only)' : ''}`,
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
        currentInvoiceNumber = await generateChainInvoiceNumber(admin)
        continue
      }
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
    const items = draft.line_items.map((li) => ({
      invoice_id: invoiceRow.id,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
      total: li.quantity * li.unit_price,
      // #527: persist project-scaled raw_cost so profit-transfer reads from
      // the per-invoice line items, not the static rule.line_items JSONB.
      raw_cost: li.raw_cost,
      category: li.category,
      sort_order: li.sort_order,
      // #526: persist taxability so a TX auditor can reconstruct WHICH
      // lines made up the tax basis on a given invoice. Without this the
      // basis becomes unknowable post-fact if the catalog flag drifts.
      is_taxable_tpp: li.is_taxable_tpp,
    }))
    const { error: itemsErr } = await admin.from('invoice_line_items').insert(items)
    if (itemsErr) {
      console.error('[invoice-chain] line item insert failed:', itemsErr.message)
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
      ruleName: rule.name,
      fromOrgId: fromOrg.id,
      toOrgId: toOrg.id,
      subtotal: draft.subtotal,
      tax,
      total,
      isDryRun: false,
    })
  }

  // Phase 3.1 — write a clearing_runs audit row whenever we actually persist
  // chain invoices (skipped in dry-run mode since nothing would have moved).
  // The row captures the gross flow as documented for tax equity substantiation.
  if (!result.dryRun && result.created.length > 0) {
    const totalGross = result.created.reduce((sum, inv) => sum + inv.total, 0)
    const firedRuleIds = result.created.map((inv) => inv.ruleId)
    const payload = {
      project_id: input.projectId,
      run_at: (input.now ?? new Date()).toISOString(),
      mode: 'gross_substantiation',
      total_gross: Math.round(totalGross * 100) / 100,
      invoices_created: result.created.length,
      invoices_skipped: result.skippedExisting.length + result.skippedError.length,
      status: 'recorded',
      notes: `Chain orchestrator fired for ${input.projectId}; ${result.created.length} invoices created, ${result.skippedExisting.length} skipped (existing), ${result.skippedError.length} errored.`,
      fired_rule_ids: firedRuleIds,
    }

    // #539: previously a single best-effort insert that silently swallowed
    // failures into console.error — tax-equity substantiation could lose a
    // run with no visible signal. Now: retry once on transient failure,
    // then escalate the gap to greg_actions so the row can be backfilled
    // from invoice history before it ages out.
    let clearingErr = (await admin.from('clearing_runs').insert(payload)).error
    if (clearingErr) {
      // 250ms backoff covers transient PG contention / network blip.
      await new Promise((resolve) => setTimeout(resolve, 250))
      clearingErr = (await admin.from('clearing_runs').insert(payload)).error
    }
    if (clearingErr) {
      console.error('[invoice-chain] clearing_runs insert failed (twice):', clearingErr.message)
      const firedRuleSummary = result.created
        .map((inv) => `${inv.invoiceNumber} (${inv.ruleId}) total=$${inv.total.toFixed(2)}`)
        .join('\n  - ')
      const { error: actionErr } = await admin.from('greg_actions').insert({
        priority: 'P0',
        owner: 'greg',
        title: `clearing_runs audit gap — chain fired for ${input.projectId} but row not recorded`,
        body_md: [
          '## What\'s broken',
          '',
          `Chain orchestrator created **${result.created.length} invoices** for project \`${input.projectId}\` totalling **$${(payload.total_gross).toLocaleString()}**, but writing the corresponding \`clearing_runs\` audit row failed twice (initial + retry).`,
          '',
          `**Last error:** \`${clearingErr.message}\``,
          '',
          '## Why this matters',
          '',
          'Tax-equity substantiation requires a clearing_runs row per chain run (Mark, 2026-04-13 meeting). Without backfill, the audit trail has a gap.',
          '',
          '## Fired rules / invoices',
          '',
          `  - ${firedRuleSummary}`,
          '',
          '## How to close',
          '',
          'Backfill the missing row manually:',
          '',
          '```sql',
          `INSERT INTO public.clearing_runs (project_id, run_at, mode, total_gross, invoices_created, invoices_skipped, status, notes, fired_rule_ids) VALUES (`,
          `  '${payload.project_id}',`,
          `  '${payload.run_at}',`,
          `  '${payload.mode}',`,
          `  ${payload.total_gross},`,
          `  ${payload.invoices_created},`,
          `  ${payload.invoices_skipped},`,
          `  '${payload.status}',`,
          `  ${JSON.stringify(payload.notes)},`,
          `  ${JSON.stringify(JSON.stringify(payload.fired_rule_ids))}::jsonb`,
          `);`,
          '```',
        ].join('\n'),
        source_session: 'invoice-chain-clearing-runs-gap',
        effort_estimate: 'S',
        status: 'open',
      })
      if (actionErr) {
        console.error('[invoice-chain] greg_actions escalation also failed:', actionErr.message)
      }
    }
  }

  return result
}
