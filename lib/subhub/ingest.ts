import { SupabaseClient } from '@supabase/supabase-js'
import { TASKS } from '@/lib/tasks'

// Inlined to keep this module importable from Node.js scripts without pulling
// in React via @/lib/hooks/useOrg. Mirror of the export in useOrg.tsx.
const DEFAULT_ORG_ID = 'a0000000-0000-0000-0000-000000000001'

/**
 * Reject `javascript:`, `data:`, `file:`, `vbscript:` URLs and anything that
 * isn't an http(s) URL. SubHub document URLs render as clickable links in the
 * MG UI; failure to validate is stored XSS (R1 audit, Critical 1, 2026-04-28).
 */
export function isSafeHttpUrl(s: unknown): s is string {
  if (typeof s !== 'string') return false
  try {
    const u = new URL(s)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Validate `contract_signed_date` is an ISO date string in a sensible window
 * (2000-01-01 to today + 1 day). Returns the date string if valid, or `null`
 * if invalid (caller should fall back to today). R1 audit High 4 + R2 audit M2.
 *
 * Compare on the lexicographic date string (not ms epoch) so we don't drop
 * legitimate dates near the 2000-01-01 boundary in tz-behind-UTC sources.
 */
export function safeContractDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null
  const dateStr = raw.slice(0, 10)
  if (dateStr < '2000-01-01') return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  // Today's date in UTC, plus one day for end-of-day grace.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  if (dateStr > tomorrow) return null
  return dateStr
}

/**
 * Normalize an address string so the (name, address) dedup query tolerates
 * suffix and case variants ("123 Main Drive" vs "123 main dr").
 *
 * Mirrors `pg_temp.mig298_norm_addr` from migration 298 — keep the two in
 * sync. Anchor: 2026-05-12 SubHub-eval-pile diagnosis found 83 intra-batch
 * duplicates in the 5/6 backfill because the prior `.eq()` dedup matched
 * only on byte-identical addresses. Action #901.
 */
export function normAddr(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ drive($|[, ])/g, ' dr$1')
    .replace(/ avenue($|[, ])/g, ' ave$1')
    .replace(/ street($|[, ])/g, ' st$1')
    .replace(/ road($|[, ])/g, ' rd$1')
    .replace(/ lane($|[, ])/g, ' ln$1')
    .replace(/ boulevard($|[, ])/g, ' blvd$1')
    .replace(/ court($|[, ])/g, ' ct$1')
    .replace(/ trail($|[, ])/g, ' trl$1')
    .replace(/ parkway($|[, ])/g, ' pkwy$1')
    .replace(/ highway($|[, ])/g, ' hwy$1')
    .replace(/ place($|[, ])/g, ' pl$1')
    .replace(/ circle($|[, ])/g, ' cir$1')
    .replace(/ terrace($|[, ])/g, ' ter$1')
    .replace(/ square($|[, ])/g, ' sq$1')
    .replace(/ way($|[, ])/g, ' way$1')
    // Keep token boundaries when stripping non-alphanumerics so "12 3rd St"
    // doesn't collapse to "123rdst" and collide with "123 Rd St". R1 M-1.
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ /g, '|')
}

/**
 * Map a SubHub-side stage string to MG's stage enum. Webhook payload is
 * attacker-controllable; this uses strict equality on a whitelist (not
 * substring matching) so a `stage='install_complete_review'`-style payload
 * can't slip into MG `stage='complete'` and auto-mark all tasks done.
 * R1 H-2 fix (2026-05-12 red-teamer).
 *
 * Returns `{stage, disposition}`. Terminal SubHub stages (Cancelled,
 * Withdrawn, Lost, Refunded, Returned, Chargeback) flip disposition off
 * 'Sale' so revenue rollups don't double-count.
 *
 * Anchor: 2026-05-12 backfill ingested 1,754 historical deals as
 * stage='evaluation' because this mapper didn't exist. Action #902.
 */
const SUBHUB_STAGE_MAP: Record<string, { stage: string; disposition?: string }> = {
  // Terminal — keep at evaluation per MG convention but flip disposition.
  cancelled: { stage: 'evaluation', disposition: 'Cancelled' },
  canceled:  { stage: 'evaluation', disposition: 'Cancelled' },
  withdrawn: { stage: 'evaluation', disposition: 'Cancelled' },
  lost:      { stage: 'evaluation', disposition: 'Cancelled' },
  refunded:  { stage: 'evaluation', disposition: 'Cancelled' },
  returned:  { stage: 'evaluation', disposition: 'Cancelled' },
  chargeback:{ stage: 'evaluation', disposition: 'Cancelled' },
  // Workflow stages (strict — no substring matching).
  completed:  { stage: 'complete' },
  complete:   { stage: 'complete' },
  closed:     { stage: 'complete' },
  inspection: { stage: 'inspection' },
  pto:        { stage: 'inspection' },
  install:    { stage: 'install' },
  installing: { stage: 'install' },
  permit:     { stage: 'permit' },
  permitting: { stage: 'permit' },
  design:     { stage: 'design' },
  cad:        { stage: 'design' },
  engineering:{ stage: 'design' },
  survey:     { stage: 'survey' },
  'site visit': { stage: 'survey' },
  'site':       { stage: 'survey' },
  // Lead / proposal → evaluation. Explicit so we know they aren't ignored.
  lead:       { stage: 'evaluation' },
  proposal:   { stage: 'evaluation' },
  evaluation: { stage: 'evaluation' },
}
export function mapSubhubStage(s: unknown): { stage: string; disposition?: string } {
  if (typeof s !== 'string') return { stage: 'evaluation' }
  const t = s.trim().toLowerCase()
  if (!t) return { stage: 'evaluation' }
  return SUBHUB_STAGE_MAP[t] ?? { stage: 'evaluation' }
}

/**
 * Escape Postgres LIKE/ILIKE wildcards in a user-controlled string. Supabase
 * JS's `.ilike()` does not escape the pattern; an attacker passing `%` as
 * a `name` payload would otherwise match arbitrary rows. R1 H-1 fix
 * (2026-05-12 red-teamer).
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

export interface SubHubPayload {
  subhub_id?: string | number
  subhub_uuid?: string
  stage?: string
  name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  street?: string
  city?: string
  state?: string
  postal_code?: string
  contract_signed_date?: string
  contract_amount?: number
  system_size_kw?: number
  finance_partner?: string
  finance_type?: string
  finance_product_name?: string
  finance_escalator_rate?: number
  module_name?: string
  module_total_panels?: number
  inverter_name?: string
  inverter_quantity?: number
  battery_name?: string
  battery_quantity?: number
  utility_company?: string
  hoa_name?: string
  sales_representative_name?: string
  sales_representative_email?: string
  sales_rep_first_name?: string
  sales_rep_last_name?: string
  owner_email?: string
  downpayment?: number
  organization_name?: string
  adders?: { name?: string; unit_price?: number; cost_total?: number; qty?: number }[]
  documents?: { url?: string; label?: string }[]
}

export interface IngestOptions {
  driveWebhookUrl?: string
  /** When true, the helper attempts to call the Drive folder Apps Script. Set false for backfill if creating folders is too slow. */
  createDriveFolder?: boolean
  /** When true, downloads and stores SubHub document URLs into project_files. */
  ingestDocuments?: boolean
  /** When true, fire-and-forget syncs the new project to EDGE. Defaults true for webhook context, false for backfill. */
  syncToEdge?: boolean
}

export interface IngestResult {
  success: boolean
  project_id?: string
  duplicate?: boolean
  matched_by?: 'subhub_id' | 'name_address'
  error?: string
  documents_inserted?: number
}

// Generate next PROJ-ID. See webhook route for the rationale on why this is
// in app code instead of a sequence.
async function getNextProjectId(db: SupabaseClient): Promise<string> {
  const { data } = await db.from('projects').select('id')
  if (!data || data.length === 0) return 'PROJ-30001'
  const max = data
    .map((row: { id: string | null }) => parseInt((row.id ?? '').replace('PROJ-', ''), 10))
    .filter((n: number) => Number.isFinite(n) && n > 0)
    .reduce((a: number, b: number) => Math.max(a, b), 30000)
  return `PROJ-${max + 1}`
}

/**
 * Idempotent SubHub project ingest. Checks (subhub_id) then (name, address)
 * for an existing match; creates project + task_state + stage_history +
 * project_funding + Drive folder + adders + initial note + EDGE sync if new.
 *
 * Used by both `/api/webhooks/subhub` (live signing) and
 * `scripts/subhub-backfill.ts` (catch-up).
 *
 * On duplicate match by (name, address) when subhub_id was previously null,
 * the existing project's subhub_id is updated so future calls match the
 * preferred (subhub_id) path. Documents are still ingested for duplicates.
 */
export async function processSubhubProject(
  payload: SubHubPayload,
  db: SupabaseClient,
  options: IngestOptions = {},
): Promise<IngestResult> {
  // DIAG-2026-05-09 (action #667): real SubHub deliveries 400 with "Missing
  // required fields: name and address" but docs/subhub-webhook-sample.json
  // contains all required keys correctly named. Vercel MCP can't show request
  // bodies, so log the payload key shape ONCE per request to identify the
  // missing/renamed field. STRIP after first real fire is captured.
  // Hardened per red-teamer R1: guards null/array payloads (would 500 on
  // Object.keys(null)), caps key count (anti log-volume abuse), caps PII
  // values to first 80 chars.
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keys = Object.keys(payload as Record<string, unknown>).slice(0, 80).sort()
    const derived = (payload.name ?? `${payload.first_name ?? ''} ${payload.last_name ?? ''}`.trim()) || '<EMPTY>'
    const street = payload.street ?? '<MISSING>'
    console.log('[subhub] DIAG payload shape:', JSON.stringify({
      topLevelKeys: keys,
      keyCount: Object.keys(payload as Record<string, unknown>).length,
      hasName: !!payload.name,
      hasFirstLast: !!(payload.first_name || payload.last_name),
      hasStreet: !!payload.street,
      hasSubhubId: payload.subhub_id != null,
      hasSubhubUuid: !!payload.subhub_uuid,
      derivedName: derived.slice(0, 80),
      streetValue: String(street).slice(0, 80),
    }))
  }
  const customerName = payload.name ?? `${payload.first_name ?? ''} ${payload.last_name ?? ''}`.trim()
  const customerAddress = payload.street
  if (!customerName || !customerAddress) {
    return { success: false, error: 'Missing required fields: name and address' }
  }

  // R1 audit High 3 (2026-04-28): require AT LEAST one stable SubHub identifier so
  // the synthetic file_id can never collide on `subhub-unknown-N`. Webhook callers
  // must include subhub_id; backfill always has it from the API.
  if (payload.subhub_id == null && !payload.subhub_uuid) {
    return { success: false, error: 'Missing subhub_id and subhub_uuid (cannot dedupe documents)' }
  }

  // Idempotency
  let projectId: string | undefined
  let duplicate = false
  let matchedBy: IngestResult['matched_by'] | undefined

  // R1 C-1 fix (2026-05-12 red-teamer): every dedup query is org-scoped.
  // `db` is a service-role client (RLS bypassed) so org_id filtering MUST
  // be explicit in the query — otherwise a cross-tenant webhook payload
  // could merge into another org's project. Today MG runs single-org, but
  // mig 294 prepares for multi-tenant; closing this before that lands.
  if (payload.subhub_id != null) {
    const { data: existing } = await db.from('projects').select('id')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('subhub_id', payload.subhub_id).limit(1)
    if (existing && existing.length > 0) {
      projectId = existing[0].id as string
      duplicate = true
      matchedBy = 'subhub_id'
    }
  }
  if (!projectId && customerName && customerAddress) {
    // R2 audit M1 (2026-04-28): trim before .eq() so stray whitespace doesn't
    // bypass conflict detection.
    // 2026-05-12 (#901): exact-match leaked 83 intra-batch duplicates in the
    // 5/6 backfill ("HECTOR GARCIA"/"Hector Garcia" same address; "Drive"
    // vs "Dr" suffix variants). Two-step dedup:
    //   1. Fast-path .eq() for byte-identical hits.
    //   2. Fallback: case-insensitive name match (with LIKE wildcards in
    //      input escaped — R1 H-1), then filter rows by normalized address.
    const nameQ = customerName.trim()
    const addrQ = customerAddress.trim()
    const naddrQ = normAddr(addrQ)

    type ExistRow = { id: string; subhub_id: string | number | null; name?: string; address?: string }
    let existing: ExistRow[] | null = null

    const { data: exact } = await db
      .from('projects')
      .select('id, subhub_id, name, address')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('name', nameQ).eq('address', addrQ).limit(1)
    if (exact && exact.length > 0) {
      existing = exact as ExistRow[]
    } else if (naddrQ) {
      // Escape LIKE wildcards (% and _) so an attacker passing name='%' can't
      // pull arbitrary rows. R1 H-1.
      const escapedName = escapeLikePattern(nameQ)
      const { data: nameHits } = await db
        .from('projects')
        .select('id, subhub_id, name, address')
        .eq('org_id', DEFAULT_ORG_ID)
        .ilike('name', escapedName).limit(20)
      const matched = (nameHits ?? []).filter(
        (r) => normAddr((r as ExistRow).address ?? '') === naddrQ,
      )
      // R1 L-2: ambiguous match — when >1 row normalized-matches, refuse to
      // merge silently. Caller (webhook) returns 409 so SubHub retry path
      // doesn't quietly corrupt a record.
      if (matched.length > 1) {
        return {
          success: false,
          error: `ambiguous_match: ${matched.length} MG rows share normalized (name,address) for "${nameQ}"; cannot safely merge`,
        }
      }
      if (matched.length === 1) existing = matched as ExistRow[]
    }

    if (existing && existing.length > 0) {
      const existingSubhubId = existing[0].subhub_id
      // R1 audit Critical 2 (2026-04-28): hard-error when (name, address) matches
      // an MG row that already has a DIFFERENT subhub_id (ADU + main; same
      // homeowner, two phases — silent merge corrupts both records).
      if (
        payload.subhub_id != null &&
        existingSubhubId != null &&
        String(existingSubhubId) !== String(payload.subhub_id)
      ) {
        return {
          success: false,
          error: `subhub_id_conflict: existing MG ${existing[0].id} (subhub_id=${existingSubhubId}) shares (name,address) with payload subhub_id=${payload.subhub_id}`,
        }
      }
      projectId = existing[0].id
      duplicate = true
      matchedBy = 'name_address'
      // Backfill subhub_id on the existing row so subsequent calls hit the
      // fast path. org-scoped to avoid cross-tenant write.
      if (payload.subhub_id != null && existingSubhubId == null) {
        await db.from('projects').update({ subhub_id: payload.subhub_id })
          .eq('org_id', DEFAULT_ORG_ID).eq('id', projectId)
      }
    }
  }

  if (!projectId) {
    projectId = await getNextProjectId(db)
    // 2026-05-12 (#902): respect SubHub's stage when present. Prior to this,
    // every new SubHub project landed at stage='evaluation' regardless of
    // SubHub-side state — caused the 1,754-row eval pile (migration 298
    // reclassified 547 of them after the fact). Cancellation on SubHub side
    // also flips disposition off 'Sale'.
    const mapped = mapSubhubStage(payload.stage)
    const project: Record<string, unknown> = {
      id: projectId,
      org_id: DEFAULT_ORG_ID,
      subhub_id: payload.subhub_id ?? null,
      name: customerName || 'Unknown',
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      address: payload.street ?? null,
      city: payload.city ?? null,
      state: payload.state ?? 'TX',
      zip: payload.postal_code ?? null,
      stage: mapped.stage,
      stage_date: new Date().toISOString().slice(0, 10),
      sale_date: safeContractDate(payload.contract_signed_date) ?? new Date().toISOString().slice(0, 10),
      contract: payload.contract_amount ?? null,
      systemkw: payload.system_size_kw ?? null,
      financier: payload.finance_partner ?? null,
      financing_type: payload.finance_type ?? null,
      financier_adv_pmt: payload.finance_product_name ?? null,
      module: payload.module_name ?? null,
      module_qty: payload.module_total_panels ?? null,
      inverter: payload.inverter_name ?? null,
      inverter_qty: payload.inverter_quantity ?? null,
      battery: payload.battery_name ?? null,
      battery_qty: payload.battery_quantity ?? null,
      utility: payload.utility_company ?? null,
      hoa: payload.hoa_name ?? null,
      advisor: payload.sales_representative_name ?? payload.sales_rep_first_name ?? null,
      consultant: payload.sales_representative_name ?? (`${payload.sales_rep_first_name ?? ''} ${payload.sales_rep_last_name ?? ''}`.trim() || null),
      consultant_email: payload.sales_representative_email ?? payload.owner_email ?? null,
      disposition: mapped.disposition ?? 'Sale',
      down_payment: payload.downpayment ?? null,
      tpo_escalator: payload.finance_escalator_rate ?? null,
      dealer: payload.organization_name ?? null,
    }

    const { error: projErr } = await db.from('projects').insert(project)
    if (projErr) {
      // R464: race-loser path. Two webhook deliveries with the same subhub_id
      // can both pass the SELECT above; only one wins the INSERT — the other
      // hits the unique partial index on projects.subhub_id (migration 119)
      // and returns error.code = 23505. Re-query and return the winner's row
      // as a clean duplicate so SubHub's retry doesn't see a 500. Side
      // effects (task_state, stage_history, Drive folder, edge sync) come
      // AFTER this point, so they never amplified on the loser path.
      if ((projErr as { code?: string }).code === '23505' && payload.subhub_id != null) {
        const { data: winner } = await db
          .from('projects')
          .select('id')
          .eq('subhub_id', payload.subhub_id)
          .limit(1)
        if (winner && winner.length > 0) {
          return {
            success: true,
            project_id: winner[0].id as string,
            duplicate: true,
            matched_by: 'subhub_id',
          }
        }
      }
      return { success: false, error: `project insert failed: ${projErr.message}` }
    }

    // Initial task states. When SubHub stage is past evaluation (mapped to e.g.
    // 'complete', 'install'), mark tasks in earlier stages as Complete so the
    // auto-advance hook (useProjectTasks.ts) doesn't mis-render the pipeline.
    const STAGE_ORDER = ['evaluation','survey','design','permit','install','inspection','complete'] as const
    const newStageIdx = STAGE_ORDER.indexOf(mapped.stage as (typeof STAGE_ORDER)[number])
    const taskRecords: { project_id: string; task_id: string; status: string }[] = []
    for (const [stage, tasks] of Object.entries(TASKS)) {
      const stageIdx = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number])
      for (const task of tasks) {
        let status: string
        if (stageIdx >= 0 && newStageIdx >= 0 && stageIdx < newStageIdx) {
          status = 'Complete'
        } else if (stageIdx === newStageIdx && task.pre.length === 0) {
          status = 'Ready To Start'
        } else {
          status = 'Not Ready'
        }
        taskRecords.push({ project_id: projectId, task_id: task.id, status })
      }
    }
    await db.from('task_state').insert(taskRecords)

    await db.from('stage_history').insert({
      project_id: projectId,
      stage: mapped.stage,
      entered: new Date().toISOString(),
    })

    await db.from('project_funding').insert({ project_id: projectId })

    if (options.createDriveFolder !== false && options.driveWebhookUrl) {
      try {
        const driveRes = await fetch(options.driveWebhookUrl, {
          method: 'POST',
          body: JSON.stringify({ project_id: projectId, customer_name: project.name }),
          redirect: 'follow',
        })
        const driveText = await driveRes.text()
        try {
          const driveData = JSON.parse(driveText)
          if (driveData.folder_url) {
            await db
              .from('project_folders')
              .upsert({ project_id: projectId, folder_url: driveData.folder_url }, { onConflict: 'project_id' })
          }
        } catch {
          /* drive response not JSON */
        }
      } catch (driveErr) {
        console.error('[subhub-ingest] drive folder error:', driveErr)
      }
    }

    if (payload.adders && Array.isArray(payload.adders) && payload.adders.length > 0) {
      const adderRecords = payload.adders.map((a) => ({
        project_id: projectId,
        adder_name: a.name ?? 'Unknown',
        price: a.unit_price ?? a.cost_total ?? null,
        total_amount: a.cost_total ?? null,
        quantity: a.qty ?? 1,
      }))
      await db.from('project_adders').insert(adderRecords)
    }

    await db.from('notes').insert({
      project_id: projectId,
      text: `[System] Project created from SubHub (ID: ${payload.subhub_id ?? 'unknown'}). Contract signed ${payload.contract_signed_date ?? 'unknown'}.`,
      time: new Date().toISOString(),
      pm: 'System',
    })

    if (options.syncToEdge !== false) {
      // Lazy-load to avoid pulling 'server-only' modules into Node.js script imports.
      try {
        const { syncProjectToEdge } = await import('@/lib/api/edge-sync')
        void syncProjectToEdge(projectId)
      } catch (e) {
        console.error('[subhub-ingest] edge sync skipped:', (e as Error).message)
      }
    }
  }

  // Document ingest — applies to BOTH new and duplicate matches.
  // R1 audit Critical 1 (2026-04-28): only http(s) URLs accepted to prevent
  // stored XSS via javascript:/data:/file: schemes when the UI renders
  // file_url as a clickable link. We've already early-returned if neither
  // subhub_id nor subhub_uuid was set, so the synthetic file_id is stable.
  let documents_inserted = 0
  if (options.ingestDocuments && payload.documents && Array.isArray(payload.documents) && projectId) {
    const stableId = payload.subhub_id ?? payload.subhub_uuid
    const fileRecords = payload.documents
      .filter((d) => isSafeHttpUrl(d.url) && typeof d.label === 'string' && d.label.length > 0)
      .map((d, idx) => ({
        project_id: projectId!,
        folder_name: 'SubHub',
        file_name: d.label!.slice(0, 200),
        file_id: `subhub-${stableId}-${idx}`,
        file_url: d.url!,
        mime_type: null,
        file_size: null,
        synced_at: new Date().toISOString(),
      }))

    if (fileRecords.length > 0) {
      // Upsert by (project_id, file_id) — unique constraint already in 023-document-management.sql
      const { data: inserted, error: fileErr } = await db
        .from('project_files')
        .upsert(fileRecords, { onConflict: 'project_id,file_id' })
        .select('id')
      if (fileErr) {
        console.error('[subhub-ingest] project_files upsert failed:', fileErr.message)
      } else {
        documents_inserted = inserted?.length ?? fileRecords.length
      }
    }
  }

  return { success: true, project_id: projectId, duplicate, matched_by: matchedBy, documents_inserted }
}
