import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { clearTemplateCache } from '@/lib/cost/api'
import { generateProjectChain } from '@/lib/invoices/chain'

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'manager'])

/**
 * POST /api/projects/[id]/regen-chain
 *
 * Two-step regen for the M5 invoice-open drift popup (Mark/Greg call
 * 2026-05-08, action #670):
 *   1. atlas_create_cost_basis_snapshot — creates a fresh snapshot, flips
 *      it active, deactivates the prior one. Materializes
 *      project_cost_line_items at current PCS rates.
 *   2. generateProjectChain — builds new chain invoices stamped with the
 *      fresh snapshot_id (mig 251 unique idx is keyed on snapshot_id, so
 *      the new set coexists with the old without colliding).
 *
 * Mark explicit: never overwrite history. Old chain invoices are
 * preserved; user picks which to use downstream.
 *
 * Body: { reason?: string } (max 1000 chars)
 * Response: { snapshot_id, created: ChainCreatedInvoice[], skippedExisting, skippedError }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params

  // ── Auth + role gate ───────────────────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // public.users.id != auth.users.id for ~7 of 20 memberships per session57.
  // Normalize email lower-trim to match the RPC's lower(email) check (mig
  // 246) — finance-auditor R1 M3 caught the ilike vs lower() drift.
  const normalizedEmail = user.email.trim().toLowerCase()
  const { data: userRow } = await supabase
    .from('users')
    .select('id, role')
    .ilike('email', normalizedEmail)
    .maybeSingle()
  const role = (userRow as { id: string; role: string } | null)?.role
  const userId = (userRow as { id: string; role: string } | null)?.id
  if (!role || !ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  // finance-auditor R1 H1: dropped from 5/min to 2/min and per-user keying
  // so two admins on the same project don't collide their buckets. Combined
  // with the cooldown query below (defense-in-depth against in-memory
  // rate-limiter losing state on serverless cold starts).
  const { success } = await rateLimit(`regen-chain:${projectId}:${userId ?? 'unknown'}`, {
    windowMs: 60_000,
    max: 2,
    prefix: 'regen-chain',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ── Cooldown ───────────────────────────────────────────────────────────
  // Refuse if the project already had a snapshot created in the last 30s,
  // regardless of who initiated. Hard guard against snapshot stacking
  // (finance-auditor R1 H1).
  const { data: recentSnap } = await supabase
    .from('cost_basis_snapshots')
    .select('id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recentSnap) {
    const ageMs = Date.now() - new Date((recentSnap as { created_at: string }).created_at).getTime()
    if (ageMs < 30_000) {
      return NextResponse.json(
        { error: `Snapshot for this project was created ${Math.ceil(ageMs / 1000)}s ago. Wait at least 30s before regenerating.` },
        { status: 429 },
      )
    }
  }

  // ── Body ───────────────────────────────────────────────────────────────
  let reason: string | undefined
  try {
    const body = (await request.json().catch(() => ({}))) as { reason?: string }
    if (typeof body.reason === 'string') {
      reason = body.reason.slice(0, 1000)
    }
  } catch {
    // No body / bad JSON — proceed with default reason on the RPC side.
  }

  // ── Step 1: fresh snapshot + line items ────────────────────────────────
  const { data: snapshotData, error: snapshotErr } = await supabase.rpc(
    'atlas_create_cost_basis_snapshot',
    { p_project_id: projectId, p_reason: reason ?? 'M5 invoice-open regen' },
  )
  if (snapshotErr) {
    console.error('[POST /regen-chain snapshot]', snapshotErr.message)
    const msg = snapshotErr.message ?? 'Internal error'
    const status = msg.includes('forbidden') ? 403 :
                   msg.includes('not found') ? 404 :
                   msg.includes('admin role required') ? 403 :
                   msg.includes('unauthenticated') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
  // finance-auditor R1 L1: defensive null guard. RPC returns uuid; if it
  // ever returns null on an unhandled path, stamping "null" on invoices
  // would corrupt the chain.
  if (!snapshotData || typeof snapshotData !== 'string') {
    console.error('[POST /regen-chain snapshot] RPC returned non-uuid:', snapshotData)
    return NextResponse.json({ error: 'snapshot RPC returned no id' }, { status: 500 })
  }
  const newSnapshotId = snapshotData

  // Bust template cache before chain runs — chain.ts reads via
  // getActiveSnapshotId then fetches per-project line items, but PCS
  // overlay path reads template cache that we want fresh.
  clearTemplateCache()

  // ── Step 2: regen chain invoices stamped with new snapshot_id ──────────
  let chainResult
  try {
    chainResult = await generateProjectChain({ projectId, dryRun: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chain regen failed'
    console.error('[POST /regen-chain chain]', msg)
    // finance-auditor R1 H2: roll back the orphan snapshot. Without this,
    // the new active snapshot has zero invoices stamped to it and becomes
    // the new "current truth" for every invoice read.
    const { error: rollbackErr } = await supabase.rpc(
      'atlas_rollback_cost_basis_snapshot',
      { p_snapshot_id: newSnapshotId },
    )
    if (rollbackErr) {
      console.error('[POST /regen-chain rollback]', rollbackErr.message)
      // Surface partial state — Greg may need to manually intervene.
      return NextResponse.json(
        { error: `chain failed AND rollback failed: ${msg} | rollback: ${rollbackErr.message}`, snapshot_id: newSnapshotId, partial: true },
        { status: 500 },
      )
    }
    return NextResponse.json(
      { error: `chain regen failed (snapshot rolled back cleanly): ${msg}` },
      { status: 500 },
    )
  }

  return NextResponse.json(
    {
      snapshot_id: newSnapshotId,
      created: chainResult.created,
      skippedExisting: chainResult.skippedExisting,
      skippedError: chainResult.skippedError,
    },
    { status: 200 },
  )
}
