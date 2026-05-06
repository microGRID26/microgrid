/**
 * GET /api/cron/anon-user-cleanup
 *
 * Monthly. Deletes anonymous auth.users rows that:
 *   - last_sign_in_at is NULL or > 90 days old
 *   - have NO row in spoke_feedback or bread_of_life_feedback (submitter_uid)
 *
 * Each SPOKE / bread-of-life install creates one anon user on first feedback
 * submit; Supabase bills those as MAU post-Apr-2024. Closes greg_actions #275.
 *
 * Eligible user IDs come from atlas_list_stale_anon_users() (migration 162,
 * SECURITY DEFINER, service-role-only). Deletion itself goes through
 * supabase.auth.admin.deleteUser() — the blessed path — so raw DELETE on
 * auth.users never appears in SQL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'

export const runtime = 'nodejs'

/**
 * Constant-time bearer compare. sha256 both sides before timingSafeEqual so
 * the byte buffers are always 32 bytes — removes the length-branch timing
 * channel and the utf-8 encoding quirk that would otherwise make
 * `Buffer.from(multibyte)` vary in length from the raw char count. R1 M2.
 */
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
  let errorCount = 0
  let fleetError: string | null = null

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: stale, error: listErr } = await admin.rpc(
      'atlas_list_stale_anon_users',
      { p_min_idle_days: 90 }
    )
    if (listErr) {
      throw new Error(`list rpc failed: ${listErr.message}`)
    }
    const eligible = (stale ?? []) as Array<{ id: string; last_sign_in_at: string | null }>

    // Delete sequentially. Batch size is capped at 500 by the RPC's LIMIT;
    // a monthly cron is not time-sensitive, and parallelism risks auth-admin
    // rate limits without meaningful win.
    //
    // Per-id recheck (R1 M1) closes the read-then-delete race: if a feedback
    // insert lands between the list call and the delete call, the user now
    // has attribution data — skip the delete so we don't orphan submitter_uid.
    let skippedReraced = 0
    for (const user of eligible) {
      const { data: stillStale, error: checkErr } = await admin.rpc(
        'atlas_anon_user_still_stale',
        { p_id: user.id, p_min_idle_days: 90 }
      )
      if (checkErr) {
        console.error('[anon-cleanup] recheck failed', user.id, checkErr.message)
        errorCount += 1
        continue
      }
      if (!stillStale) {
        skippedReraced += 1
        continue
      }
      const { error } = await admin.auth.admin.deleteUser(user.id)
      if (error) {
        console.error('[anon-cleanup] deleteUser failed', user.id, error.message)
        errorCount += 1
        continue
      }
      deletedCount += 1
    }

    if (errorCount > 0) {
      fleetStatus = deletedCount > 0 ? 'partial' : 'error'
      fleetError = `${errorCount} of ${eligible.length} deletions failed`
    }

    return NextResponse.json({
      success: errorCount === 0,
      eligible: eligible.length,
      deleted: deletedCount,
      failed: errorCount,
      skipped_reraced: skippedReraced,
    })
  } catch (err) {
    console.error('[anon-cleanup] cron error', err)
    fleetStatus = 'error'
    fleetError = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'cron error' }, { status: 500 })
  } finally {
    // best-effort fleet ping — must not convert a successful response into a
    // post-response crash (R1 L2).
    await reportFleetRun({
      slug: 'mg-anon-user-cleanup',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: deletedCount,
      outputSummary:
        errorCount === 0
          ? `Deleted ${deletedCount} stale anonymous users`
          : `Deleted ${deletedCount}, failed ${errorCount}`,
      errorMessage: fleetError,
    }).catch(() => { /* swallow */ })
  }
}
