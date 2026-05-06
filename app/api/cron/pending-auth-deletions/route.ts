/**
 * GET /api/cron/pending-auth-deletions
 *
 * Every 30 minutes. Drains pending_auth_deletions — the partial-success
 * table where /api/customer/delete-account stashes auth_user_ids when
 * `auth.admin.deleteUser` fails after the customer's data was erased. The
 * customer's data is gone; the auth row leaked.
 *
 * Closes greg_actions #549 (audit #544 R1 M4 follow-up).
 *
 * Logic:
 *   1. Read up to 50 rows where attempts < 5 ORDER BY last_attempt_at ASC.
 *   2. For each, call admin.auth.admin.deleteUser(auth_user_id).
 *   3. On success → DELETE FROM pending_auth_deletions WHERE auth_user_id.
 *   4. On failure → UPDATE attempts = attempts + 1, last_attempt_at = now().
 *   5. Rows that hit attempts >= 5 stop retrying — surfaced in fleet-run
 *      errorMessage so an operator can intervene manually.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'

export const runtime = 'nodejs'
export const maxDuration = 60

const FLEET_SLUG = 'mg-pending-auth-deletions'
const BATCH_SIZE = 50
const MAX_ATTEMPTS = 5

/** Constant-time bearer compare. sha256 both sides before timingSafeEqual
 *  so byte buffers are always 32 bytes — removes the length-branch timing
 *  channel and utf-8 encoding quirks. */
function constantTimeBearerOk(token: string, secret: string): boolean {
  const a = createHash('sha256').update(token).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!constantTimeBearerOk(token, cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'Supabase service credentials not configured' },
      { status: 500 }
    )
  }

  const fleetStartedAt = new Date()
  let fleetStatus: FleetRunStatus = 'success'
  let deletedCount = 0
  let retriedCount = 0
  let stuckCount = 0
  let fleetError: string | null = null

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Atomic claim — bumps attempts + last_attempt_at inside a CTE with
    // FOR UPDATE SKIP LOCKED. Closes the read-modify-write race where two
    // concurrent runs could both read attempts=N and both write N+1
    // (R1 audit High 1 / migration 229).
    const { data: due, error: listErr } = await admin.rpc('pending_auth_deletions_claim_batch', {
      p_limit: BATCH_SIZE,
      p_max_attempts: MAX_ATTEMPTS,
      p_now: new Date().toISOString(),
    })

    if (listErr) {
      throw new Error(`pending_auth_deletions claim failed: ${listErr.message}`)
    }

    const rows = (due ?? []) as Array<{
      auth_user_id: string
      attempts: number
      last_attempt_at: string
      reason: string | null
    }>

    for (const row of rows) {
      const { error: delErr } = await admin.auth.admin.deleteUser(row.auth_user_id)

      // Treat status 404 as success — user already gone, just clean up the
      // pending row. Status only — substring match on `.message` is too
      // permissive (e.g., 'refresh token not found', 'endpoint not found'
      // during a Supabase incident would silently drop real failures). R1 H2.
      const status = (delErr as { status?: number } | null)?.status
      const isAlreadyGone = status === 404

      if (!delErr || isAlreadyGone) {
        const { error: cleanupErr } = await admin
          .from('pending_auth_deletions')
          .delete()
          .eq('auth_user_id', row.auth_user_id)
        if (cleanupErr) {
          console.error('[pending-auth-deletions] cleanup row failed', row.auth_user_id, cleanupErr.message)
        }
        deletedCount += 1
        if (isAlreadyGone) {
          console.warn('[pending-auth-deletions] 404 — already gone', row.auth_user_id)
        }
        continue
      }

      // attempts already incremented inside the claim RPC; we just record
      // the failure for observability. The row stays in the table with
      // bumped attempts, eligible for re-claim on the next run (or hits
      // the MAX_ATTEMPTS cap and stops being claimed).
      retriedCount += 1
      console.warn(
        '[pending-auth-deletions] deleteUser retry',
        row.auth_user_id,
        `attempts=${row.attempts}/${MAX_ATTEMPTS}`,
        delErr.message,
      )
    }

    // Surface stuck rows separately — they're past the retry cap and need
    // manual attention. Don't include in the busy-loop, just count + alert.
    const { count: stuckTotal } = await admin
      .from('pending_auth_deletions')
      .select('auth_user_id', { count: 'exact', head: true })
      .gte('attempts', MAX_ATTEMPTS)
    stuckCount = stuckTotal ?? 0

    if (stuckCount > 0) {
      fleetStatus = 'partial'
      fleetError = `${stuckCount} pending_auth_deletions rows past retry cap (attempts>=${MAX_ATTEMPTS}) — manual cleanup required`
    } else if (retriedCount > 0) {
      // R1 M2: 'partial' for "retries pending, no permanent failures";
      // reserve 'error' for the catch block (real crashes).
      fleetStatus = 'partial'
      fleetError = `${retriedCount} retries deferred to next run`
    }

    return NextResponse.json({
      success: stuckCount === 0,
      processed: rows.length,
      deleted: deletedCount,
      retried: retriedCount,
      stuck_past_cap: stuckCount,
    })
  } catch (err) {
    console.error('[pending-auth-deletions] cron error', err)
    fleetStatus = 'error'
    fleetError = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'cron error' }, { status: 500 })
  } finally {
    await reportFleetRun({
      slug: FLEET_SLUG,
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: deletedCount,
      outputSummary:
        stuckCount > 0
          ? `Drained ${deletedCount}; ${stuckCount} stuck at retry cap`
          : `Drained ${deletedCount}; ${retriedCount} retrying`,
      errorMessage: fleetError,
    }).catch(() => { /* swallow */ })
  }
}
