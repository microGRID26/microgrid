// GET /api/cron/partner-event-fanout — Drains partner_event_outbox and POSTs
// to env-configured partners (see lib/partner-api/events/partner-registry.ts).
//
// Vercel cron. Secret gate on CRON_SECRET. Reports to ATLAS HQ /intel.

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { runFanout } from '@/lib/partner-api/events/fanout'
import { reportFleetRun } from '@/lib/hq-fleet'

export const runtime = 'nodejs'

const FLEET_SLUG = 'mg-partner-event-fanout'

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
  try {
    const result = await runFanout()
    const status = result.errors.length === 0
      ? 'success'
      : (result.deliveries_succeeded > 0 ? 'partial' : 'error')
    const outputSummary = `${result.events_processed} events, ${result.deliveries_succeeded}/${result.deliveries_attempted} delivered`
      + (result.errors.length > 0 ? `, ${result.errors.length} errors` : '')

    void reportFleetRun({
      slug: FLEET_SLUG,
      status,
      startedAt,
      finishedAt: new Date(),
      itemsProcessed: result.events_processed,
      outputSummary,
      errorMessage: result.errors.slice(0, 5).join('; ') || null,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    void reportFleetRun({
      slug: FLEET_SLUG,
      status: 'error',
      startedAt,
      finishedAt: new Date(),
      outputSummary: 'fanout threw',
      errorMessage: msg,
    })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
