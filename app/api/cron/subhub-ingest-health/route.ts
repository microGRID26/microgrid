/**
 * GET /api/cron/subhub-ingest-health
 *
 * Daily. Self-monitors the SubHub→MG webhook ingest pipeline.
 *
 * Greg's directive 2026-05-06: "your scripts tend to stop often. You need
 * to build some audit in place where you are constantly checking them to
 * make sure they are firing and improving where you can."
 *
 * What it checks:
 *   1. welcome_call_logs.max(received_at) is within the last 36h.
 *   2. count of new welcome_call_logs rows in the last 24h > 0.
 *
 * On stall:
 *   - Files a P0 greg_actions row.
 *   - Reports to hq-fleet so it surfaces on the fleet dashboard.
 *
 * On healthy: reports success to hq-fleet and returns the stats.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'
import { checkCronSecret } from '@/lib/auth/check-cron-secret'

export const runtime = 'nodejs'
export const maxDuration = 30

const STALL_HOURS = 36

export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Supabase service credentials not configured' }, { status: 500 })
  }

  const fleetStartedAt = new Date()
  let fleetStatus: FleetRunStatus = 'success'
  let fleetError: string | null = null

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Most recent ingest event
    const { data: latest, error: latestErr } = await admin
      .from('welcome_call_logs')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestErr) throw new Error(`latest query failed: ${latestErr.message}`)

    const lastReceivedAt = (latest as { received_at?: string } | null)?.received_at
      ? new Date((latest as { received_at: string }).received_at)
      : null
    const hoursSinceLast = lastReceivedAt
      ? (Date.now() - lastReceivedAt.getTime()) / 3_600_000
      : Number.POSITIVE_INFINITY

    // Count in last 24h
    const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { count: count24h, error: countErr } = await admin
      .from('welcome_call_logs')
      .select('id', { count: 'exact', head: true })
      .gte('received_at', since24h)
    if (countErr) throw new Error(`count query failed: ${countErr.message}`)

    const healthy = hoursSinceLast <= STALL_HOURS && (count24h ?? 0) > 0

    if (!healthy) {
      // R1 audit M1 — dedupe: if there's already an open P0 from this cron,
      // don't file another. Only file when the stall is newly detected
      // (transitions healthy→unhealthy) or after a previous one was closed.
      const { data: existingOpen } = await admin
        .from('greg_actions')
        .select('id')
        .eq('source_session', 'subhub-ingest-health-cron')
        .eq('status', 'open')
        .limit(1)
      const alreadyFiled = (existingOpen ?? []).length > 0

      const title = `SubHub ingest stalled — last event ${hoursSinceLast.toFixed(1)}h ago, 0 in last 24h`
      const body = [
        '## SubHub ingest health check failed',
        '',
        `**Last event received:** ${lastReceivedAt ? lastReceivedAt.toISOString() : 'never'}`,
        `**Hours since last event:** ${hoursSinceLast.toFixed(1)}`,
        `**Events in last 24h:** ${count24h ?? 0}`,
        `**Stall threshold:** ${STALL_HOURS}h`,
        '',
        '## What to check',
        '',
        '1. SubHub side — is their webhook firing? Check their dashboard / contact support.',
        '2. MG side — is `/api/webhooks/subhub` reachable? `curl -X POST` should return 401 (auth required), not 5xx.',
        '3. Vercel logs for `/api/webhooks/subhub` — look for recent failures.',
        '4. `partner_webhook_subscriptions` — is the SubHub subscription still active?',
        '',
        '## How to close',
        '',
        'Resolve the underlying ingest issue. Cron re-checks daily; this row will not auto-close.',
      ].join('\n')

      if (!alreadyFiled) {
        const { error: insErr } = await admin.from('greg_actions').insert({
          priority: 'P0',
          owner: 'greg',
          title,
          body_md: body,
          source_session: 'subhub-ingest-health-cron',
          effort_estimate: 'small',
          status: 'open',
        })
        if (insErr) {
          console.error(`[subhub-ingest-health] greg_actions insert failed: ${insErr.message}`)
        }
      } else {
        console.log('[subhub-ingest-health] stall persists; existing greg_action already open, not duplicating')
      }

      fleetStatus = 'error'
      fleetError = `stalled: last=${lastReceivedAt?.toISOString() ?? 'never'} hoursSince=${hoursSinceLast.toFixed(1)} count24h=${count24h ?? 0}`
    }

    await reportFleetRun({
      slug: 'subhub-ingest-health',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: count24h ?? 0,
      outputSummary: healthy
        ? `last=${lastReceivedAt?.toISOString() ?? 'never'}, count24h=${count24h ?? 0}`
        : `STALLED last=${lastReceivedAt?.toISOString() ?? 'never'} hoursSince=${hoursSinceLast.toFixed(1)} count24h=${count24h ?? 0}`,
      errorMessage: fleetError,
      metadata: {
        last_received_at: lastReceivedAt?.toISOString() ?? null,
        hours_since_last: Math.round(hoursSinceLast * 10) / 10,
        count_last_24h: count24h ?? 0,
        stall_threshold_hours: STALL_HOURS,
        healthy,
      },
    })

    return NextResponse.json({
      ok: healthy,
      last_received_at: lastReceivedAt?.toISOString() ?? null,
      hours_since_last: Math.round(hoursSinceLast * 10) / 10,
      count_last_24h: count24h ?? 0,
      stall_threshold_hours: STALL_HOURS,
    })
  } catch (err) {
    fleetStatus = 'error'
    fleetError = (err as Error).message
    await reportFleetRun({
      slug: 'subhub-ingest-health',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      errorMessage: fleetError,
    })
    return NextResponse.json({ error: fleetError }, { status: 500 })
  }
}
