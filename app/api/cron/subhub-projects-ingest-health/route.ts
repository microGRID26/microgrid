/**
 * GET /api/cron/subhub-projects-ingest-health
 *
 * Daily sibling of /api/cron/subhub-ingest-health.
 *
 * The VWC cron monitors welcome_call_logs (voice welcome calls feed). This
 * cron monitors the MAIN PROJECT FEED — /api/webhooks/subhub → projects
 * rows where subhub_id IS NOT NULL. Discovered during action #800 diagnostic
 * 2026-05-11: that feed had silently stalled for 4 days with no monitoring.
 *
 * What it checks:
 *   1. max(created_at) on projects WHERE subhub_id IS NOT NULL is within
 *      the last 36h.
 *   2. count of new SubHub-originated projects in the last 24h > 0.
 *
 * On stall:
 *   - Files a P0 greg_actions row (dedup-suppressed if one already open).
 *   - Reports to hq-fleet.
 *
 * On healthy: reports success to hq-fleet.
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

    // Most recent SubHub-originated project
    const { data: latest, error: latestErr } = await admin
      .from('projects')
      .select('created_at')
      .not('subhub_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestErr) throw new Error(`latest query failed: ${latestErr.message}`)

    const lastCreatedAt = (latest as { created_at?: string } | null)?.created_at
      ? new Date((latest as { created_at: string }).created_at)
      : null
    const hoursSinceLast = lastCreatedAt
      ? (Date.now() - lastCreatedAt.getTime()) / 3_600_000
      : Number.POSITIVE_INFINITY

    // Count SubHub-originated projects in last 24h
    const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { count: count24h, error: countErr } = await admin
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .not('subhub_id', 'is', null)
      .gte('created_at', since24h)
    if (countErr) throw new Error(`count query failed: ${countErr.message}`)

    const healthy = hoursSinceLast <= STALL_HOURS && (count24h ?? 0) > 0

    if (!healthy) {
      // Dedupe (mirrors VWC cron's M1 audit fix): only file when no open
      // P0 from this cron exists. Transitions healthy→unhealthy file once.
      const { data: existingOpen } = await admin
        .from('greg_actions')
        .select('id')
        .eq('source_session', 'subhub-projects-ingest-health-cron')
        .eq('status', 'open')
        .limit(1)
      const alreadyFiled = (existingOpen ?? []).length > 0

      const title = `SubHub project feed stalled — last project ${hoursSinceLast.toFixed(1)}h ago, 0 in last 24h`
      const body = [
        '## SubHub project-feed health check failed',
        '',
        `**Last project created:** ${lastCreatedAt ? lastCreatedAt.toISOString() : 'never'}`,
        `**Hours since last project:** ${hoursSinceLast.toFixed(1)}`,
        `**Projects (subhub_id NOT NULL) in last 24h:** ${count24h ?? 0}`,
        `**Stall threshold:** ${STALL_HOURS}h`,
        '',
        '## What to check',
        '',
        '1. SubHub side — is their main project webhook subscription firing? Check their dashboard / contact support.',
        '2. MG side — is `/api/webhooks/subhub` reachable? `curl -X POST` should return 401 (auth required), not 5xx.',
        '3. Vercel logs for `/api/webhooks/subhub` — look for recent failures or absence-of-hits.',
        '4. Verify `SUBHUB_WEBHOOK_ENABLED=true` is still set in Vercel env (any recent env-var sweep could have stripped it).',
        '',
        '## Context',
        '',
        'This cron is the sibling of `/api/cron/subhub-ingest-health` (which monitors the VWC feed → `welcome_call_logs`). The two SubHub feeds can stall independently. Discovered + filed via action #898 from the #800 diagnostic 2026-05-11.',
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
          source_session: 'subhub-projects-ingest-health-cron',
          effort_estimate: 'small',
          status: 'open',
        })
        if (insErr) {
          console.error(`[subhub-projects-ingest-health] greg_actions insert failed: ${insErr.message}`)
        }
      } else {
        console.log('[subhub-projects-ingest-health] stall persists; existing greg_action already open, not duplicating')
      }

      fleetStatus = 'error'
      fleetError = `stalled: last=${lastCreatedAt?.toISOString() ?? 'never'} hoursSince=${hoursSinceLast.toFixed(1)} count24h=${count24h ?? 0}`
    }

    await reportFleetRun({
      slug: 'subhub-projects-ingest-health',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: count24h ?? 0,
      outputSummary: healthy
        ? `last=${lastCreatedAt?.toISOString() ?? 'never'}, count24h=${count24h ?? 0}`
        : `STALLED last=${lastCreatedAt?.toISOString() ?? 'never'} hoursSince=${hoursSinceLast.toFixed(1)} count24h=${count24h ?? 0}`,
      errorMessage: fleetError,
      metadata: {
        last_created_at: lastCreatedAt?.toISOString() ?? null,
        hours_since_last: Math.round(hoursSinceLast * 10) / 10,
        count_last_24h: count24h ?? 0,
        stall_threshold_hours: STALL_HOURS,
        healthy,
      },
    })

    return NextResponse.json({
      ok: healthy,
      last_created_at: lastCreatedAt?.toISOString() ?? null,
      hours_since_last: Math.round(hoursSinceLast * 10) / 10,
      count_last_24h: count24h ?? 0,
      stall_threshold_hours: STALL_HOURS,
    })
  } catch (err) {
    fleetStatus = 'error'
    fleetError = (err as Error).message
    await reportFleetRun({
      slug: 'subhub-projects-ingest-health',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      errorMessage: fleetError,
    })
    return NextResponse.json({ error: fleetError }, { status: 500 })
  }
}
