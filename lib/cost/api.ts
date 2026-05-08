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
  type CostBasisSummary,
  type CostLineItemTemplate,
  type ProjectCostLineItem,
} from '@/lib/cost/calculator'
import type { Project } from '@/types/database'

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
const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000

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

export async function loadProjectLineItems(projectId: string): Promise<ProjectCostLineItem[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('project_cost_line_items')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .limit(100)
  if (error) {
    throw new Error(`[cost-api] failed to load line items for ${projectId}: ${error.message}`)
  }
  return (data ?? []) as ProjectCostLineItem[]
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
): Promise<{ lineItems: ProjectCostLineItem[]; summary: CostBasisSummary; isEphemeral: boolean }> {
  const persisted = await loadProjectLineItems(project.id)
  if (persisted.length > 0) {
    return {
      lineItems: persisted,
      summary: computeProjectCostBasis(persisted),
      isEphemeral: false,
    }
  }

  // No persisted rows — compute from catalog defaults
  const templates = await loadActiveTemplates()
  const sizing = resolveProjectSizing({
    systemkw: project.systemkw,
    battery_qty: project.battery_qty,
  })
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
      // Throw rather than silently degrading — the caller asked to persist,
      // so a failure is signal not noise. The /api/projects/[id]/cost-basis
      // route catches and returns 500. Fall back to ephemeral by NOT passing
      // persist:true if you want the silent degradation.
      throw new Error(`[cost-api] failed to persist line items for ${project.id}: ${error.message}`)
    }
    const persistedRows = (inserted ?? []) as ProjectCostLineItem[]
    return {
      lineItems: persistedRows,
      summary: computeProjectCostBasis(persistedRows),
      isEphemeral: false,
    }
  }

  return {
    lineItems: ephemeral,
    summary: computeProjectCostBasis(ephemeral),
    isEphemeral: true,
  }
}
