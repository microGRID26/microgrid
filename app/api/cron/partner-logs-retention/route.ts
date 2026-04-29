// GET /api/cron/partner-logs-retention — Daily partition maintenance.
//
// Runs daily at 05:00 UTC (vercel.json). Calls:
//   1. ensure_partner_partitions(2)  — pre-create next 2 months of partitions
//   2. drop_old_partner_partitions(90) — drop partitions older than 90 days
//   3. sweep_partner_idempotency_keys(24) — delete idempotency rows > 24h old

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { partnerApiAdmin } from '@/lib/partner-api/supabase-admin'
import { reportFleetRun } from '@/lib/hq-fleet'

export const runtime = 'nodejs'

const FLEET_SLUG = 'mg-partner-logs-retention'

function checkSecret(request: NextRequest): boolean {
  const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const expected = (process.env.CRON_SECRET ?? '').trim()
  if (!expected || !header) return false
  if (header.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(header, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date()
  const errors: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = partnerApiAdmin() as any

  let created = 0
  let dropped: string[] = []
  let sweptIdemp = 0

  try {
    const { data: c, error: ce } = await sb.rpc('ensure_partner_partitions', { p_months_ahead: 2 })
    if (ce) errors.push(`ensure_partner_partitions: ${ce.message}`)
    else created = typeof c === 'number' ? c : 0

    const { data: d, error: de } = await sb.rpc('drop_old_partner_partitions', { p_retention_days: 90 })
    if (de) errors.push(`drop_old_partner_partitions: ${de.message}`)
    else dropped = Array.isArray(d) ? d : []

    const { data: s, error: se } = await sb.rpc('sweep_partner_idempotency_keys', { p_retention_hours: 24 })
    if (se) errors.push(`sweep_partner_idempotency_keys: ${se.message}`)
    else sweptIdemp = typeof s === 'number' ? s : 0

    const status = errors.length === 0 ? 'success' : 'partial'
    const summary = `ensured ${created} partitions, dropped ${dropped.length}, swept ${sweptIdemp} idempotency rows`

    void reportFleetRun({
      slug: FLEET_SLUG,
      status,
      startedAt,
      finishedAt: new Date(),
      itemsProcessed: created + dropped.length + sweptIdemp,
      outputSummary: summary,
      errorMessage: errors.join('; ') || null,
    })
    return NextResponse.json({
      ok: true,
      partitions_created: created,
      partitions_dropped: dropped,
      idempotency_rows_swept: sweptIdemp,
      errors,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    void reportFleetRun({
      slug: FLEET_SLUG,
      status: 'error',
      startedAt,
      finishedAt: new Date(),
      outputSummary: 'retention cron threw',
      errorMessage: msg,
    })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
