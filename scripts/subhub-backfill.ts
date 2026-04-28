/**
 * SubHub Backfill Script
 *
 * One-time backfill: pulls all SubHub projects, filters to a date window
 * (default: 2026-01-01 → today), diffs against MG `projects` by (name,
 * address) since `subhub_id` is mostly null in MG, and inserts the missing
 * via the shared `processSubhubProject` helper from lib/subhub/ingest.ts.
 *
 * Document URLs from SubHub are stored in `project_files` with
 * folder_name='SubHub' so they show up in the existing file list UI.
 *
 * Usage:
 *   tsx scripts/subhub-backfill.ts --dry-run          # diff only, no writes
 *   tsx scripts/subhub-backfill.ts --since 2026-01-01 # explicit window
 *   tsx scripts/subhub-backfill.ts                    # default 2026-01-01, live writes
 *
 * ENV:
 *   SUBHUB_API_KEY, SUBHUB_API_BASE_URL                  (read from ~/.claude/secrets/.env)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY        (read from MicroGRID/.env*)
 */
import { createClient } from '@supabase/supabase-js'
import { processSubhubProject, type SubHubPayload } from '../lib/subhub/ingest'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const sinceArg = args.find((a) => a.startsWith('--since='))?.slice('--since='.length) ?? '2026-01-01'
const SKIP_DRIVE = args.includes('--skip-drive')
const FROM_CACHE = args.find((a) => a.startsWith('--from-cache='))?.slice('--from-cache='.length)

const SUBHUB_API_KEY = process.env.SUBHUB_API_KEY
const SUBHUB_API_BASE_URL = process.env.SUBHUB_API_BASE_URL ?? 'https://api.virtualsaleportal.com'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.MICROGRID_SUPABASE_SERVICE_KEY

if (!SUBHUB_API_KEY) {
  console.error('SUBHUB_API_KEY not set')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SECRET) {
  console.error('Supabase env not set (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY)')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SECRET)

// R1 audit High 8 (2026-04-28): validate API response shape before trusting
// `last_page` (could trigger an unbounded loop if the upstream is compromised).
const MAX_PAGES_HARD_CAP = 500

async function fetchPage(page: number, limit = 20): Promise<{ data: SubHubPayload[]; total: number; last_page: number }> {
  const url = new URL(`${SUBHUB_API_BASE_URL}/api/public/v2/get-projects`)
  url.searchParams.set('publicapikey', SUBHUB_API_KEY!)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('page', String(page))
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 60_000)
  try {
    const res = await fetch(url.toString(), { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as unknown
    if (!json || typeof json !== 'object') throw new Error('non-object response')
    const obj = json as Record<string, unknown>
    if (!Array.isArray(obj.data)) throw new Error('response.data is not an array')
    const total = typeof obj.total === 'number' && obj.total >= 0 && obj.total < 1_000_000 ? obj.total : 0
    const lastPageRaw = typeof obj.last_page === 'number' ? obj.last_page : 0
    const last_page = Math.max(1, Math.min(lastPageRaw, MAX_PAGES_HARD_CAP))
    return { data: obj.data as SubHubPayload[], total, last_page }
  } finally {
    clearTimeout(t)
  }
}

interface ExistingMg { id: string; name: string | null; address: string | null; subhub_id: string | number | null }

function normalizeKey(name: string | null | undefined, address: string | null | undefined): string {
  return `${(name ?? '').trim().toLowerCase()}|${(address ?? '').trim().toLowerCase()}`
}

async function loadExistingMg(): Promise<{ byKey: Map<string, ExistingMg>; bySubhubId: Map<string, ExistingMg> }> {
  const { data, error } = await db.from('projects').select('id, name, address, subhub_id')
  if (error) throw new Error(`projects fetch failed: ${error.message}`)
  const byKey = new Map<string, ExistingMg>()
  const bySubhubId = new Map<string, ExistingMg>()
  for (const row of (data ?? []) as ExistingMg[]) {
    byKey.set(normalizeKey(row.name, row.address), row)
    if (row.subhub_id != null) bySubhubId.set(String(row.subhub_id), row)
  }
  return { byKey, bySubhubId }
}

async function loadFromCache(dir: string): Promise<SubHubPayload[]> {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('page-') && f.endsWith('.json')).sort()
  const all: SubHubPayload[] = []
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as { data?: SubHubPayload[] }
      if (Array.isArray(j.data)) all.push(...j.data)
    } catch (e) {
      console.error(`  cache read failed: ${f}: ${(e as Error).message}`)
    }
  }
  return all
}

async function main() {
  console.error(`SubHub backfill — dry_run=${DRY_RUN}, since=${sinceArg}, skip_drive=${SKIP_DRIVE}, from_cache=${FROM_CACHE ?? 'no'}`)

  const all: SubHubPayload[] = []
  if (FROM_CACHE) {
    const cached = await loadFromCache(FROM_CACHE)
    all.push(...cached)
    console.error(`Loaded ${all.length} projects from cache dir ${FROM_CACHE}`)
  } else {
    // 1. Fetch all SubHub pages
    const first = await fetchPage(1)
    console.error(`SubHub total: ${first.total} projects across ${first.last_page} pages`)
    for (const p of first.data) all.push(p)
    for (let pg = 2; pg <= first.last_page; pg++) {
      try {
        const { data } = await fetchPage(pg)
        for (const p of data) all.push(p)
        if (pg % 10 === 0) console.error(`  fetched page ${pg}/${first.last_page} (running: ${all.length})`)
        await new Promise((r) => setTimeout(r, 50))
      } catch (e) {
        console.warn(`  page ${pg} failed: ${(e as Error).message}; continuing`)
      }
    }
    console.error(`Total fetched: ${all.length}`)
  }

  // 2. Filter to window
  const filtered = all.filter((p) => {
    const iso = (p as { iso_format_contract_signed_date?: string }).iso_format_contract_signed_date ?? p.contract_signed_date ?? ''
    return iso >= sinceArg
  })
  console.error(`In window (signed >= ${sinceArg}): ${filtered.length}`)

  // 3. Load existing MG state
  const { byKey, bySubhubId } = await loadExistingMg()
  console.error(`MG existing projects: total=${byKey.size}, with subhub_id=${bySubhubId.size}`)

  // 4. Diff
  const newProjects: SubHubPayload[] = []
  const existingProjects: { payload: SubHubPayload; existing: ExistingMg; matchedBy: 'subhub_id' | 'name_address' }[] = []
  for (const p of filtered) {
    const subhubIdStr = p.subhub_id != null ? String(p.subhub_id) : null
    if (subhubIdStr && bySubhubId.has(subhubIdStr)) {
      existingProjects.push({ payload: p, existing: bySubhubId.get(subhubIdStr)!, matchedBy: 'subhub_id' })
      continue
    }
    const name = p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
    const key = normalizeKey(name, p.street)
    if (byKey.has(key)) {
      existingProjects.push({ payload: p, existing: byKey.get(key)!, matchedBy: 'name_address' })
      continue
    }
    newProjects.push(p)
  }
  console.error()
  console.error(`DIFF:`)
  console.error(`  new (will create): ${newProjects.length}`)
  console.error(`  existing (will set subhub_id + ingest docs): ${existingProjects.length}`)

  // Sample first / last
  if (newProjects.length > 0) {
    console.error()
    console.error(`First 5 new:`)
    for (const p of newProjects.slice(0, 5)) {
      const name = p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
      console.error(`  ${p.subhub_id} · ${name} · ${p.street} · signed=${(p as { iso_format_contract_signed_date?: string }).iso_format_contract_signed_date}`)
    }
    if (newProjects.length > 5) {
      console.error(`Last 5 new:`)
      for (const p of newProjects.slice(-5)) {
        const name = p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()
        console.error(`  ${p.subhub_id} · ${name} · ${p.street} · signed=${(p as { iso_format_contract_signed_date?: string }).iso_format_contract_signed_date}`)
      }
    }
  }

  // Document count totals
  const newDocs = newProjects.reduce((acc, p) => acc + (p.documents?.length ?? 0), 0)
  const existDocs = existingProjects.reduce((acc, e) => acc + (e.payload.documents?.length ?? 0), 0)
  console.error()
  console.error(`Documents to ingest: ${newDocs} (new projects) + ${existDocs} (existing) = ${newDocs + existDocs}`)

  if (DRY_RUN) {
    console.error()
    console.error('DRY RUN — no writes performed. Re-run without --dry-run to execute.')
    return
  }

  // 5. Execute
  console.error()
  console.error('Executing backfill...')
  const driveWebhookUrl = SKIP_DRIVE ? undefined : process.env.NEXT_PUBLIC_DRIVE_WEBHOOK_URL
  let createdCount = 0
  let updatedCount = 0
  let docInsertCount = 0
  let errorCount = 0

  for (const p of newProjects) {
    const result = await processSubhubProject(p, db, {
      driveWebhookUrl,
      createDriveFolder: !SKIP_DRIVE,
      ingestDocuments: true,
    })
    if (!result.success) {
      console.error(`  ERR ${p.subhub_id}: ${result.error}`)
      errorCount++
      continue
    }
    createdCount++
    docInsertCount += result.documents_inserted ?? 0
    if (createdCount % 10 === 0) console.log(`  created ${createdCount}/${newProjects.length}`)
  }

  for (const { payload } of existingProjects) {
    const result = await processSubhubProject(payload, db, {
      driveWebhookUrl: undefined, // existing rows already have folders if relevant
      createDriveFolder: false,
      ingestDocuments: true,
    })
    if (!result.success) {
      console.error(`  ERR existing ${payload.subhub_id}: ${result.error}`)
      errorCount++
      continue
    }
    if (result.duplicate) updatedCount++
    docInsertCount += result.documents_inserted ?? 0
    if (updatedCount % 50 === 0 && updatedCount > 0) console.log(`  existing-updated ${updatedCount}/${existingProjects.length}`)
  }

  console.error()
  console.error('DONE')
  console.error(`  projects created: ${createdCount}`)
  console.error(`  existing updated: ${updatedCount}`)
  console.error(`  documents inserted/upserted: ${docInsertCount}`)
  console.error(`  errors: ${errorCount}`)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
