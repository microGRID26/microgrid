/**
 * GET /api/cron/storage-janitor
 *
 * Daily. Sweeps orphan objects from the two customer-facing private
 * storage buckets (`ticket-attachments`, `customer-feedback`).
 *
 * An orphan is a storage.objects row whose `name` (path inside the bucket)
 * has no matching row in the canonical reference table:
 *
 *   - ticket-attachments → ticket_comments.image_path
 *   - customer-feedback  → customer_feedback_attachments.file_path
 *
 * Closes the loop on the Apple 5.1.1(v) data-deletion story:
 *
 *   1. atlas_customer_account_scrub (BEFORE DELETE trigger, migration 223+224)
 *      anonymizes PII text in retained tables.
 *   2. /api/customer/delete-account collects file paths BEFORE the delete
 *      and best-effort calls storage.remove POST-delete (#505).
 *   3. THIS cron sweeps anything #2's best-effort missed (network blips,
 *      partial failures, paths from other cascade sources).
 *
 * Listing comes from atlas_list_orphan_ticket_attachments /
 * atlas_list_orphan_customer_feedback_attachments (migration 226,
 * SECURITY DEFINER, service-role-only). Deletion goes through
 * supabase.storage.from(bucket).remove() — Supabase's blessed path,
 * matching the anon-user-cleanup pattern.
 *
 * Safety:
 *   - 24h min-age on every candidate (RPC default) — protects against
 *     in-flight upload races where the storage row lands before the DB row.
 *   - 500 path cap per bucket per run (RPC LIMIT). Cron re-fires daily.
 *   - Service-role bearer auth, constant-time compare.
 *   - Storage delete is best-effort per-bucket; one bucket failure does
 *     not abort the other.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'

export const runtime = 'nodejs'

type BucketSpec = {
  bucket: 'ticket-attachments' | 'customer-feedback'
  rpc:
    | 'atlas_list_orphan_ticket_attachments'
    | 'atlas_list_orphan_customer_feedback_attachments'
}

// Scope is intentionally limited to the two customer-uploaded private buckets
// that the customer-account scrub trigger (migration 223+224+225) and the
// delete-account route (#505) target. Other private buckets — wo-photos,
// rep-files, Project-documents, spoke-feedback — accumulate orphans from
// different sources (rep termination, work-order cancel) and are NOT swept
// here. When adding a new private bucket, decide explicitly whether it needs
// a janitor entry, OR document the exemption (red-team R1 M1).
//
// Path-write-once assumption: this design assumes app code never re-points
// an existing image_path / file_path at a previously-orphaned storage object.
// A re-point shape would silently expose a race where the cron lists a path
// at T0, the app re-points to that path at T0+ε, and `.remove()` deletes a
// now-referenced object. No code path does this today; flag here so the
// assumption stays explicit if anyone builds a "restore prior attachment"
// flow later (red-team R1 M2).
const BUCKETS: BucketSpec[] = [
  { bucket: 'ticket-attachments', rpc: 'atlas_list_orphan_ticket_attachments' },
  { bucket: 'customer-feedback', rpc: 'atlas_list_orphan_customer_feedback_attachments' },
]

// Concurrent runs (Vercel cron + manual curl) are not specifically guarded.
// Storage `.remove()` is idempotent — a second run sees the freshly-deleted
// objects gone from the next list call, so no double-delete damage. The cost
// is potential inflation of fleet metrics on a rare manual-curl + cron-fire
// overlap. Matches the anon-user-cleanup pattern. Acceptable trade-off
// (red-team R1 M3); worth revisiting if the cron's metrics get audited.

/**
 * Constant-time bearer compare. sha256 both sides before timingSafeEqual
 * so the byte buffers are always 32 bytes — removes the length-branch
 * timing channel and the utf-8 encoding quirk that would otherwise make
 * `Buffer.from(multibyte)` vary in length from the raw char count.
 * Same shape as anon-user-cleanup.
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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'Supabase service credentials not configured' },
      { status: 500 }
    )
  }

  const fleetStartedAt = new Date()
  let fleetStatus: FleetRunStatus = 'success'
  let fleetError: string | null = null

  // Per-bucket counters. Aggregate at the end for response + fleet.
  const perBucket: Record<
    string,
    { listed: number; deleted: number; failed: number; error: string | null }
  > = {}

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    for (const { bucket, rpc } of BUCKETS) {
      const counters = { listed: 0, deleted: 0, failed: 0, error: null as string | null }
      perBucket[bucket] = counters

      const { data: orphanRows, error: listErr } = await admin.rpc(rpc, {})
      if (listErr) {
        counters.error = `list rpc failed: ${listErr.message}`
        counters.failed = 1
        // Don't abort the whole run — try the next bucket.
        continue
      }
      const paths = ((orphanRows ?? []) as Array<{ name: string }>)
        .map((r) => r.name)
        .filter((p): p is string => !!p)
      counters.listed = paths.length

      if (paths.length === 0) continue

      // Single batched remove. supabase-js storage.remove accepts an
      // array of paths and returns the rows it successfully removed.
      // On failure the whole batch errors — leave the orphans for the
      // next daily run rather than retrying inline.
      const { data: removedRows, error: rmErr } = await admin.storage
        .from(bucket)
        .remove(paths)
      if (rmErr) {
        counters.error = `storage.remove failed: ${rmErr.message}`
        counters.failed = paths.length
        continue
      }
      const removedCount = (removedRows ?? []).length
      // Post-batch verify (red-team R1 M4): supabase-js's batch-remove
      // returns the rows it considers removed but does not surface per-
      // path failures separately. A path absent from `removedRows` could
      // mean (a) it was already gone (truly idempotent — common when
      // delete-account already swept it), OR (b) a future Supabase change
      // / a storage trigger silently rejected the delete. Re-query the
      // metadata table for the listed paths: anything still present is a
      // permanent failure we should surface as `failed`, not silently
      // count as deleted. The query is bounded by `p_limit` (500) so this
      // is one extra round-trip per bucket per run.
      if (removedCount < paths.length) {
        const { data: stillThere, error: verifyErr } = await admin
          .schema('storage')
          .from('objects')
          .select('name')
          .eq('bucket_id', bucket)
          .in('name', paths)
        if (verifyErr) {
          // Verification round-trip failed — we don't know the per-path
          // outcome. Treat the whole gap as failed so it stays visible.
          counters.deleted = removedCount
          counters.failed = paths.length - removedCount
          counters.error = `post-batch verify failed: ${verifyErr.message}`
        } else {
          const failedPaths = ((stillThere ?? []) as Array<{ name: string }>).map(
            (r) => r.name
          )
          counters.deleted = paths.length - failedPaths.length
          counters.failed = failedPaths.length
          if (failedPaths.length > 0) {
            counters.error = `${failedPaths.length} path(s) still present after batch remove`
            // eslint-disable-next-line no-console
            console.warn(
              `[storage-janitor] ${bucket}: ${failedPaths.length} of ${paths.length} ` +
                `paths still exist after remove (orphans persist for next run)`
            )
          }
        }
      } else {
        counters.deleted = removedCount
      }
    }

    const totalDeleted = Object.values(perBucket).reduce((n, b) => n + b.deleted, 0)
    const totalFailed = Object.values(perBucket).reduce((n, b) => n + b.failed, 0)
    const errored = Object.values(perBucket).filter((b) => b.error !== null)

    if (errored.length === BUCKETS.length) {
      fleetStatus = 'error'
      fleetError = errored.map((b) => b.error).join(' | ')
    } else if (errored.length > 0) {
      fleetStatus = 'partial'
      fleetError = errored.map((b) => b.error).join(' | ')
    }

    return NextResponse.json({
      success: errored.length === 0,
      total_deleted: totalDeleted,
      total_failed: totalFailed,
      buckets: perBucket,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[storage-janitor] cron error', err)
    fleetStatus = 'error'
    fleetError = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'cron error' }, { status: 500 })
  } finally {
    const totalDeleted = Object.values(perBucket).reduce((n, b) => n + b.deleted, 0)
    await reportFleetRun({
      slug: 'mg-storage-janitor',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: totalDeleted,
      outputSummary:
        fleetStatus === 'success'
          ? `Deleted ${totalDeleted} orphan storage objects across ${BUCKETS.length} buckets`
          : `${fleetStatus}: ${fleetError ?? 'see logs'}`,
      errorMessage: fleetError,
    }).catch(() => {
      /* swallow — never let fleet ping convert success into a 500 */
    })
  }
}
