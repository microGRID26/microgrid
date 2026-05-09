// lib/cost/api.ts — Server-side helpers for project cost reconciliation
//
// Loads catalog templates and per-project line items via the service-role
// Supabase client, and instantiates missing line items on demand. Used by
// app/api/projects/[id]/cost-basis/route.ts and the backfill script.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  buildProjectLineItem,
  computeProjectCostBasis,
  resolveProjectSizing,
  scaleRawCost,
  type CostBasisSummary,
  type CostLineItemTemplate,
  type ProjectCostLineItem,
  type ProjectSizing,
} from '@/lib/cost/calculator'
import type { Project } from '@/types/database'

/** Drift between a persisted snapshot and what the live model would produce.
 *  Mark/Greg call 2026-05-08 — when is_stale=true, the Cost Basis tab shows
 *  an amber "regenerate" banner that calls atlas_create_cost_basis_snapshot. */
export interface CostBasisDrift {
  is_stale: boolean
  drifted_count: number
  max_dollar_delta: number
}

/** Threshold for flagging a line as "drifted." Dollar units. Anything below
 *  this is rounding noise from the SQL ROUND(_, 2) vs JS roundMoney(). */
const DRIFT_THRESHOLD_USD = 0.5

let _admin: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('[cost-api] Supabase service credentials not configured (SUPABASE_SECRET_KEY)')
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

// ── Catalog ─────────────────────────────────────────────────────────────────

// Catalog templates + the active EDGE-MODEL PCS scenario (Paul's source-of-
// truth) cache for 5 minutes. Scenario values overlay on top of templates at
// read time — see overlayScenarioOnTemplates() below. Mig 243 (2026-05-08).

let _templateCache: { rows: CostLineItemTemplate[]; loadedAt: number } | null = null
let _scenarioCache: { config: PcsScenarioConfig | null; loadedAt: number } | null = null
// 30s TTL: balance read latency vs. money-path correctness after a super_admin
// edits a unit rate via /admin/cost-catalog or atlas_set_active_pcs_scenario
// flips a scenario. Was 5 min; red-teamer R1 on mig 244 flagged the longer
// window as too stale for invoice generation.
const TEMPLATE_CACHE_TTL_MS = 30 * 1000

/** Bust both caches (used after admin edits to the catalog OR an active-
 *  scenario flip via atlas_set_active_pcs_scenario). */
export function clearTemplateCache(): void {
  _templateCache = null
  _scenarioCache = null
}

/** Shape of the PCS slice of edge_model_scenarios.config that MG cares
 *  about. Paul's model writes a much richer config; we only consume these
 *  4 keys. Missing keys silently fall back to template defaults. */
interface PcsScenarioConfig {
  pcsUnitRates?: Record<string, number>
  pcsSupplyMarkup?: Record<string, number>
  pcsDistroMarkup?: number
  pcsBatteryAlloc?: Record<string, number>
}

/** Load the currently-active PCS scenario from edge_model_scenarios.
 *  Returns null if no scenario is active or on read error (graceful
 *  degradation — MG falls back to template defaults). */
async function loadActiveScenarioConfig(): Promise<PcsScenarioConfig | null> {
  const now = Date.now()
  if (_scenarioCache && now - _scenarioCache.loadedAt < TEMPLATE_CACHE_TTL_MS) {
    return _scenarioCache.config
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('edge_model_scenarios')
    .select('config')
    .eq('is_active_for_pull', true)
    .limit(1)
    .maybeSingle()

  if (error) {
    // Don't throw — cost-basis should still render with defaults if the
    // scenario read fails. Log loudly so Sentry/PostHog catches it.
    console.error('[cost-api] failed to load active PCS scenario, falling back to template defaults:', error.message)
    _scenarioCache = { config: null, loadedAt: now }
    return null
  }

  const cfg = (data?.config as PcsScenarioConfig | undefined) ?? null
  _scenarioCache = { config: cfg, loadedAt: now }
  return cfg
}

/** Apply scenario overlay to a template list. Each template with a non-null
 *  `pcs_key` gets its raw_cost / supply markup / distro markup / battery_pct
 *  overridden by the scenario's matching value. Templates with null pcs_key
 *  pass through unchanged.
 *
 *  Notes:
 *  • pv_pct is NOT overlaid (Paul's model derives it; we keep template's
 *    seeded value to avoid the recompute logic for is_itc_excluded items).
 *  • pcsDistroMarkup is a single global number in Paul's model; applied to
 *    every overlaid row.
 *  • Missing keys in the scenario fall back to template defaults silently.
 */
function overlayScenarioOnTemplates(
  templates: CostLineItemTemplate[],
  scenario: PcsScenarioConfig | null,
): CostLineItemTemplate[] {
  if (!scenario) return templates
  const rates = scenario.pcsUnitRates ?? {}
  const supplyMk = scenario.pcsSupplyMarkup ?? {}
  const distroMk = scenario.pcsDistroMarkup
  const battAlloc = scenario.pcsBatteryAlloc ?? {}
  return templates.map((t) => {
    if (!t.pcs_key) return t
    const overlaid: CostLineItemTemplate = { ...t }
    if (typeof rates[t.pcs_key] === 'number') overlaid.default_raw_cost = rates[t.pcs_key]
    if (typeof supplyMk[t.pcs_key] === 'number') overlaid.default_markup_to_distro = supplyMk[t.pcs_key]
    if (typeof distroMk === 'number') overlaid.default_markup_distro_to_epc = distroMk
    if (typeof battAlloc[t.pcs_key] === 'number') overlaid.default_battery_pct = battAlloc[t.pcs_key]
    return overlaid
  })
}

export async function loadActiveTemplates(): Promise<CostLineItemTemplate[]> {
  const now = Date.now()
  if (_templateCache && now - _templateCache.loadedAt < TEMPLATE_CACHE_TTL_MS) {
    // Re-overlay every read because the scenario cache may have been busted
    // independently. Cheap O(n) on 28 rows.
    const scenario = await loadActiveScenarioConfig()
    return overlayScenarioOnTemplates(_templateCache.rows, scenario)
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('project_cost_line_item_templates')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(100)
  if (error) {
    throw new Error(`[cost-api] failed to load templates: ${error.message}`)
  }
  const rows = (data ?? []) as CostLineItemTemplate[]
  _templateCache = { rows, loadedAt: now }
  const scenario = await loadActiveScenarioConfig()
  return overlayScenarioOnTemplates(rows, scenario)
}

// ── Per-project line items ──────────────────────────────────────────────────

/** Resolve the active snapshot_id for a project. Returns null if none.
 *  Mig 246 added cost_basis_snapshots; partial unique idx ensures at most
 *  one is_active=true row per project. */
export async function getActiveSnapshotId(projectId: string): Promise<string | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('cost_basis_snapshots')
    .select('id')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) {
    console.error(`[cost-api] active snapshot lookup failed for ${projectId}:`, error.message)
    return null
  }
  return (data as { id: string } | null)?.id ?? null
}

export async function loadProjectLineItems(
  projectId: string,
  opts: { snapshotId?: string } = {},
): Promise<ProjectCostLineItem[]> {
  const admin = getAdminClient()
  // Mig 246: filter to a specific snapshot. Default = active. Without this
  // filter, multi-snapshot projects double-count totals (migration-planner
  // R1 follow-up — required before any user clicks "Generate new report").
  const snapshotId = opts.snapshotId ?? (await getActiveSnapshotId(projectId))
  let q = admin
    .from('project_cost_line_items')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .limit(100)
  if (snapshotId) {
    q = q.eq('snapshot_id', snapshotId)
  }
  const { data, error } = await q
  if (error) {
    throw new Error(`[cost-api] failed to load line items for ${projectId}: ${error.message}`)
  }
  return (data ?? []) as ProjectCostLineItem[]
}

/** Compare each persisted line item's raw_cost against what the live overlay'd
 *  template would produce TODAY at the project's current sizing. If any line
 *  exceeds DRIFT_THRESHOLD_USD, the snapshot is stale.
 *
 *  This is TS-side (not RPC) because it needs the edge_model_scenarios
 *  overlay logic from loadActiveTemplates. SQL-only drift would only catch
 *  template changes, missing scenario flips — the more common case per
 *  Mark's spec ("model has been updated"). */
export function computeDrift(
  persisted: ProjectCostLineItem[],
  liveTemplates: CostLineItemTemplate[],
  sizing: ProjectSizing,
): CostBasisDrift {
  const tplById = new Map(liveTemplates.map((t) => [t.id, t]))
  let drifted = 0
  let maxDelta = 0
  for (const li of persisted) {
    if (!li.template_id) continue
    const tpl = tplById.get(li.template_id)
    if (!tpl) continue
    const expected = scaleRawCost(tpl, sizing)
    const delta = Math.abs(Number(li.raw_cost) - expected)
    if (delta > DRIFT_THRESHOLD_USD) drifted++
    if (delta > maxDelta) maxDelta = delta
  }
  return {
    is_stale: drifted > 0,
    drifted_count: drifted,
    max_dollar_delta: Math.round(maxDelta * 100) / 100,
  }
}

/**
 * Return the cost-basis snapshot for a project: line items + computed summary.
 *
 * If the project has no persisted line items yet, ephemeral line items are
 * computed in-memory from the catalog at the project's sizing (NOT persisted).
 * This keeps the cost basis tab functional for projects that haven't been
 * backfilled yet — they see the proforma defaults.
 *
 * Pass `persist: true` to insert the computed line items if they don't exist
 * (used by the cost-basis API route's first-load path).
 */
export async function loadProjectCostBasis(
  project: Project,
  opts: { persist?: boolean } = {},
): Promise<{
  lineItems: ProjectCostLineItem[]
  summary: CostBasisSummary
  isEphemeral: boolean
  drift: CostBasisDrift
}> {
  const persisted = await loadProjectLineItems(project.id)
  const sizing = resolveProjectSizing({
    systemkw: project.systemkw,
    battery_qty: project.battery_qty,
    inverter_qty: project.inverter_qty,
    module_qty: project.module_qty,
  })

  if (persisted.length > 0) {
    // Drift: compare persisted snapshot against today's overlay'd templates.
    const liveTemplates = await loadActiveTemplates()
    const drift = computeDrift(persisted, liveTemplates, sizing)
    return {
      lineItems: persisted,
      summary: computeProjectCostBasis(persisted),
      isEphemeral: false,
      drift,
    }
  }

  // No persisted rows — compute from catalog defaults
  const templates = await loadActiveTemplates()
  const ephemeral: ProjectCostLineItem[] = templates.map((tpl) => ({
    ...buildProjectLineItem(tpl, sizing, project.id),
    id: undefined,
  }))

  if (opts.persist) {
    const admin = getAdminClient()
    const rows = ephemeral.map(({ id: _id, ...rest }) => rest)
    const { data: inserted, error } = await admin
      .from('project_cost_line_items')
      .insert(rows)
      .select('*')
    if (error) {
      throw new Error(`[cost-api] failed to persist line items for ${project.id}: ${error.message}`)
    }
    const persistedRows = (inserted ?? []) as ProjectCostLineItem[]
    return {
      lineItems: persistedRows,
      summary: computeProjectCostBasis(persistedRows),
      isEphemeral: false,
      // Just-persisted rows are by definition not drifted.
      drift: { is_stale: false, drifted_count: 0, max_dollar_delta: 0 },
    }
  }

  return {
    lineItems: ephemeral,
    summary: computeProjectCostBasis(ephemeral),
    isEphemeral: true,
    // Ephemeral = computed from live templates already, no drift possible.
    drift: { is_stale: false, drifted_count: 0, max_dollar_delta: 0 },
  }
}
