/**
 * SubHub Targeted Backfill — replays from welcome_call_logs
 *
 * Greg's ask 2026-05-06: Regan reported 240+ SubHub deals since Sept 1, 2025.
 * MG `projects` only had 130 of his SubHub-linked rows — sync started 2026-03-14
 * so pre-March data wasn't ingested. welcome_call_logs has the full event log
 * for him AND Jeremy Carter; this script replays those events through the
 * canonical ingest path so the projects table catches up.
 *
 * Source: welcome_call_logs (raw SubHub project_export events already in MG).
 * No external API calls — replay is deterministic from data we already have.
 *
 * Usage:
 *   tsx scripts/subhub-backfill-from-event-log.ts --reps "Regan Spencer,Jeremy Carter" --dry-run
 *   tsx scripts/subhub-backfill-from-event-log.ts --reps "Regan Spencer,Jeremy Carter"
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (read from MG/.env.local).
 */
import { createClient } from '@supabase/supabase-js'
import { processSubhubProject, type SubHubPayload } from '../lib/subhub/ingest'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const repsArg = args.find((a) => a.startsWith('--reps='))?.slice('--reps='.length)
  ?? args[args.indexOf('--reps') + 1]
  ?? 'Regan Spencer,Jeremy Carter'
const REPS = repsArg.split(',').map((r) => r.trim()).filter(Boolean)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.MICROGRID_SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SECRET) {
  console.error('Supabase env not set (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY)')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SECRET)

interface EventLogRow {
  id: string
  payload: SubHubPayload & {
    sales_representative_name?: string
    subhub_id?: string | number
    iso_format_contract_signed_date?: string
    customer_name?: string
    name?: string
    first_name?: string
    last_name?: string
    street?: string
    city?: string
    state?: string
    postal_code?: string
  }
  received_at: string
}

async function main() {
  console.log(`[backfill] reps: ${REPS.join(', ')}`)
  console.log(`[backfill] mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (writes enabled)'}`)

  // Fetch events for the named reps via server-side jsonb filter so we don't
  // pull all 3000+ rows into memory.
  // R1 fix: the unfiltered fetch hit Postgres statement_timeout — the table
  // has multi-KB jsonb payloads × 3107 rows. Server-side filter cuts that to
  // a few hundred rows for these two reps.
  const orFilter = REPS.map((r) => `payload->>sales_representative_name.eq.${r}`).join(',')
  const { data: rawEvents, error } = await db
    .from('welcome_call_logs')
    .select('id, payload, received_at')
    .or(orFilter)
    .order('received_at', { ascending: false })

  if (error) {
    console.error('[backfill] fetch failed:', error.message)
    process.exit(1)
  }

  const events = ((rawEvents ?? []) as EventLogRow[]).filter((e) => {
    const rep = e.payload?.sales_representative_name
    return typeof rep === 'string' && REPS.some((r) => r.toLowerCase() === rep.toLowerCase())
  })

  console.log(`[backfill] total events for these reps: ${events.length}`)

  // Distinct on subhub_id, keeping the latest (we sorted DESC).
  const seen = new Set<string>()
  const latest: EventLogRow[] = []
  for (const e of events) {
    const sid = e.payload?.subhub_id != null ? String(e.payload.subhub_id) : null
    if (!sid) continue
    if (seen.has(sid)) continue
    seen.add(sid)
    latest.push(e)
  }
  console.log(`[backfill] distinct SubHub deals: ${latest.length}`)

  // Find which already exist in projects
  const subhubIds = latest.map((e) => String(e.payload.subhub_id))
  const { data: existing } = await db
    .from('projects')
    .select('id, subhub_id, name')
    .in('subhub_id', subhubIds)

  const existingIds = new Set((existing ?? []).map((r: { subhub_id: string | number | null }) => String(r.subhub_id)))
  const missing = latest.filter((e) => !existingIds.has(String(e.payload.subhub_id)))

  console.log(`[backfill] already in MG projects: ${latest.length - missing.length}`)
  console.log(`[backfill] missing from MG projects: ${missing.length}`)

  if (DRY_RUN) {
    console.log('[backfill] DRY RUN — no writes. First 5 missing:')
    for (const e of missing.slice(0, 5)) {
      console.log(`  subhub_id=${e.payload.subhub_id}  rep=${e.payload.sales_representative_name}  customer=${e.payload.customer_name ?? e.payload.name ?? '?'}  signed=${e.payload.iso_format_contract_signed_date ?? '?'}`)
    }
    return
  }

  let success = 0
  let dup = 0
  let fail = 0
  const failures: { subhub_id: string; error: string }[] = []

  for (let i = 0; i < missing.length; i++) {
    const e = missing[i]
    // Map welcome_call_logs payload → SubHubPayload shape expected by ingest.
    // The payload IS the SubHub project_export (matching shape) so most fields
    // pass through. We just normalize name → customer_name fallback.
    const payload: SubHubPayload = {
      ...e.payload,
      // Use ISO contract date if the bare contract_signed_date isn't present.
      contract_signed_date:
        (e.payload as { contract_signed_date?: string }).contract_signed_date
        ?? (typeof e.payload.iso_format_contract_signed_date === 'string'
              ? e.payload.iso_format_contract_signed_date.slice(0, 10) : undefined),
    }

    try {
      const result = await processSubhubProject(db, payload, {
        createDriveFolder: false,
        ingestDocuments: false,
        syncToEdge: false,
      })
      if (result.success) {
        if (result.duplicate) dup++
        else success++
        if ((i + 1) % 10 === 0 || i === missing.length - 1) {
          console.log(`[backfill] progress ${i + 1}/${missing.length}  new=${success}  dup=${dup}  fail=${fail}`)
        }
      } else {
        fail++
        failures.push({ subhub_id: String(e.payload.subhub_id), error: result.error ?? 'unknown' })
      }
    } catch (err) {
      fail++
      failures.push({ subhub_id: String(e.payload.subhub_id), error: (err as Error).message })
    }
  }

  console.log(`\n[backfill] DONE`)
  console.log(`  new projects: ${success}`)
  console.log(`  duplicates:   ${dup}`)
  console.log(`  failures:     ${fail}`)
  if (failures.length > 0) {
    console.log('\nFirst 10 failures:')
    for (const f of failures.slice(0, 10)) {
      console.log(`  subhub_id=${f.subhub_id}  error=${f.error}`)
    }
  }
}

main().catch((err) => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
