/**
 * GET /api/cron/qa-runs-cleanup
 * Daily 5 AM UTC. Marks any qa_runs row stuck in `started` for more than
 * QA_RUN_ABANDON_AFTER_HOURS as `abandoned`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getQaAdmin, QA_RUN_ABANDON_AFTER_HOURS } from '@/lib/qa/server'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'
import { checkCronSecret } from '@/lib/auth/check-cron-secret'

export const runtime = 'nodejs'
// Audit 2026-05 H2 + L2.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fleetStartedAt = new Date()
  let fleetStatus: FleetRunStatus = 'success'
  let fleetItems: number | null = 0
  let fleetSummary: string | null = null
  let fleetError: string | null = null

  try {
    const admin = getQaAdmin()
    const cutoff = new Date(Date.now() - QA_RUN_ABANDON_AFTER_HOURS * 60 * 60 * 1000).toISOString()
    const { data: stale } = await admin
      .from('qa_runs')
      .select('id')
      .eq('status', 'started')
      .lt('started_at', cutoff) as { data: { id: string }[] | null }

    const ids = (stale ?? []).map((r) => r.id)
    if (ids.length === 0) {
      fleetSummary = 'No stale QA runs found'
      return NextResponse.json({ success: true, abandoned: 0 })
    }

    const now = new Date().toISOString()
    const { error } = await admin
      .from('qa_runs')
      .update({ status: 'abandoned', completed_at: now })
      .in('id', ids)

    if (error) {
      console.error('cleanup update failed', error)
      fleetStatus = 'error'
      fleetError = `Failed to abandon stale runs: ${error.message}`
      return NextResponse.json({ error: 'Failed to abandon stale runs' }, { status: 500 })
    }

    console.log(`QA cron: abandoned ${ids.length} stale runs`)
    fleetItems = ids.length
    fleetSummary = `Abandoned ${ids.length} stale QA runs`
    return NextResponse.json({ success: true, abandoned: ids.length })
  } catch (err) {
    console.error('cron error', err)
    fleetStatus = 'error'
    fleetError = String(err)
    return NextResponse.json({ error: 'Cron error' }, { status: 500 })
  } finally {
    await reportFleetRun({
      slug: 'mg-qa-runs-cleanup',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: fleetItems,
      outputSummary: fleetSummary,
      errorMessage: fleetError,
    })
  }
}
