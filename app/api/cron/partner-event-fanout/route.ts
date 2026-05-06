// GET /api/cron/partner-event-fanout — Drains partner_event_outbox and POSTs
// to env-configured partners (see lib/partner-api/events/partner-registry.ts).
//
// Vercel cron. Secret gate on CRON_SECRET. Reports to ATLAS HQ /intel.

import { NextRequest, NextResponse } from 'next/server'
import { runFanout } from '@/lib/partner-api/events/fanout'
import { reportFleetRun } from '@/lib/hq-fleet'
import { checkCronSecret } from '@/lib/auth/check-cron-secret'

export const runtime = 'nodejs'
// Vercel default is 10s. Partner fanout posts to N partners with 10s
// timeout each — easily blows the default. 60s gives headroom and stops
// mid-fanout kills that double-send on Vercel retry. Audit 2026-05 H2.
export const maxDuration = 60

const FLEET_SLUG = 'mg-partner-event-fanout'

export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
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
