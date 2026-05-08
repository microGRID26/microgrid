// scripts/backfill-project-cost-line-items.ts — One-shot backfill (Tier 2 Phase 2.5)
//
// For every active project (disposition='Sale' OR null), instantiates the
// catalog templates from project_cost_line_item_templates as per-project rows
// in project_cost_line_items, scaling raw_cost by project.systemkw and
// project.battery_qty.
//
// Idempotent: rows where (project_id, template_id) already exist are skipped
// via the unique partial index. Re-running is safe.
//
// Usage:
//   npx tsx scripts/backfill-project-cost-line-items.ts --dry-run
//   npx tsx scripts/backfill-project-cost-line-items.ts
//   npx tsx scripts/backfill-project-cost-line-items.ts --project-id=PROJ-1716
//
// Requires SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in env.

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

import {
  buildProjectLineItem,
  resolveProjectSizing,
  type CostLineItemTemplate,
} from '@/lib/cost/calculator'
import type { Project } from '@/types/database'

// Load .env.local from repo root
config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface CliArgs {
  dryRun: boolean
  projectId: string | null
  limit: number
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  return {
    dryRun: args.includes('--dry-run'),
    projectId: args.find((a) => a.startsWith('--project-id='))?.split('=')[1] ?? null,
    limit: parseInt(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10) || 5000,
  }
}

async function loadTemplates(): Promise<CostLineItemTemplate[]> {
  const { data, error } = await admin
    .from('project_cost_line_item_templates')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(100)
  if (error) {
    throw new Error(`failed to load templates: ${error.message}`)
  }
  return (data ?? []) as CostLineItemTemplate[]
}

async function loadProjects(args: CliArgs): Promise<Project[]> {
  let query = admin
    .from('projects')
    .select('*')
    .order('id', { ascending: true })
    .limit(args.limit)

  if (args.projectId) {
    query = query.eq('id', args.projectId)
  } else {
    // Active pipeline only — match the rest of the codebase's INACTIVE_DISPOSITIONS filter
    query = query.or('disposition.is.null,disposition.eq.Sale')
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`failed to load projects: ${error.message}`)
  }
  return (data ?? []) as Project[]
}

async function getExistingTemplateIds(projectId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from('project_cost_line_items')
    .select('template_id')
    .eq('project_id', projectId)
  if (error) {
    throw new Error(`failed to load existing line items for ${projectId}: ${error.message}`)
  }
  return new Set(((data ?? []) as { template_id: string | null }[]).map((r) => r.template_id).filter(Boolean) as string[])
}

async function backfillProject(
  project: Project,
  templates: CostLineItemTemplate[],
  args: CliArgs,
): Promise<{ inserted: number; skipped: number }> {
  const sizing = resolveProjectSizing({
    systemkw: project.systemkw,
    battery_qty: project.battery_qty,
    inverter_qty: project.inverter_qty,
    module_qty: project.module_qty,
  })
  const existingTemplateIds = await getExistingTemplateIds(project.id)

  const rows = templates
    .filter((t) => !existingTemplateIds.has(t.id))
    .map((t) => {
      const { id: _id, ...rest } = buildProjectLineItem(t, sizing, project.id) as { id?: unknown } & Record<string, unknown>
      return rest
    })

  if (rows.length === 0) {
    return { inserted: 0, skipped: existingTemplateIds.size }
  }

  if (args.dryRun) {
    return { inserted: rows.length, skipped: existingTemplateIds.size }
  }

  const { error } = await admin.from('project_cost_line_items').insert(rows)
  if (error) {
    throw new Error(`insert failed for ${project.id}: ${error.message}`)
  }
  return { inserted: rows.length, skipped: existingTemplateIds.size }
}

async function main() {
  const args = parseArgs()
  console.log(`[backfill] mode: ${args.dryRun ? 'DRY-RUN' : 'EXECUTE'}`)
  console.log(`[backfill] scope: ${args.projectId ? `project=${args.projectId}` : 'all active projects'}`)

  const templates = await loadTemplates()
  console.log(`[backfill] loaded ${templates.length} active catalog templates`)

  const projects = await loadProjects(args)
  console.log(`[backfill] loaded ${projects.length} projects`)

  let totalInserted = 0
  let totalSkipped = 0
  let totalProjects = 0
  let errors = 0

  for (const project of projects) {
    try {
      const result = await backfillProject(project, templates, args)
      totalInserted += result.inserted
      totalSkipped += result.skipped
      totalProjects += 1
      if (totalProjects % 50 === 0) {
        console.log(`[backfill] processed ${totalProjects}/${projects.length} projects, inserted ${totalInserted} rows`)
      }
    } catch (err) {
      errors += 1
      console.error(`[backfill] FAILED on ${project.id}:`, err instanceof Error ? err.message : err)
      if (errors > 10) {
        console.error('[backfill] too many errors, aborting')
        process.exit(1)
      }
    }
  }

  console.log(`[backfill] DONE`)
  console.log(`  projects processed: ${totalProjects}`)
  console.log(`  rows inserted:      ${totalInserted}${args.dryRun ? ' (dry-run)' : ''}`)
  console.log(`  rows already existed: ${totalSkipped}`)
  console.log(`  errors:             ${errors}`)
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
