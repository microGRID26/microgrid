import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { clearTemplateCache } from '@/lib/cost/api'

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'manager'])

/**
 * POST /api/projects/[id]/cost-basis/regen
 *
 * Creates a new cost-basis snapshot for the project, marking the prior
 * active snapshot as inactive. Backed by mig 246's atlas_create_cost_basis_snapshot
 * SECURITY DEFINER RPC, which:
 *   - Gates on admin/super_admin/manager role + per-project org membership
 *   - Serializes concurrent callers via pg_advisory_xact_lock
 *   - Audit-logs the regen with old + new totals
 *
 * Body: { reason?: string }   (max 1000 chars; cap enforced server-side)
 * Response: { snapshot_id: string }
 *
 * Triggered by the "Generate new report" button on the Cost Basis tab when
 * the drift banner says Paul's model has been updated since the snapshot
 * was generated. Mark/Greg call 2026-05-08 — Phase F.
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

  // Mirror the resolved-public-id pattern from /generate-chain — public.users.id
  // ≠ auth.users.id for ~7 of 20 memberships per session57 anchor.
  const { data: userRow } = await supabase
    .from('users')
    .select('id, role')
    .ilike('email', user.email.trim())
    .maybeSingle()
  const role = (userRow as { id: string; role: string } | null)?.role
  if (!role || !ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  // Snapshot creation is destructive of state (flips active flag) — keep
  // tight to prevent rep-side fat-finger storms.
  const { success } = await rateLimit(`cost-basis-regen:${projectId}`, {
    windowMs: 60_000,
    max: 5,
    prefix: 'cost-basis',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
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

  // ── Fire RPC (RPC enforces tenant gate + advisory lock + audit) ────────
  const { data, error } = await supabase.rpc('atlas_create_cost_basis_snapshot', {
    p_project_id: projectId,
    p_reason: reason ?? null,
  })

  if (error) {
    console.error('[POST /cost-basis/regen]', error.message)
    // Surface the RPC's RAISE EXCEPTION text so the UI can show a
    // useful error (e.g. "forbidden — caller is not a member of project org").
    const msg = error.message ?? 'Internal error'
    const status = msg.includes('forbidden') ? 403 :
                   msg.includes('not found') ? 404 :
                   msg.includes('admin role required') ? 403 :
                   msg.includes('unauthenticated') ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }

  // Fresh snapshot — bust template cache so subsequent /cost-basis reads
  // see today's templates if the active scenario flipped at the same time.
  clearTemplateCache()

  return NextResponse.json({ snapshot_id: data as string }, { status: 200 })
}
