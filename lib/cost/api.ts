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

export async function loadActiveTemplates(): Promise<CostLineItemTemplate[]> {
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
  return (data ?? []) as CostLineItemTemplate[]
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
