import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { generateProjectChain } from '@/lib/invoices/chain'

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'manager'])

/**
 * POST /api/invoices/generate-chain
 *
 * Fires the multi-tenant invoicing chain (DSE → NewCo → EPC → EDGE + supporting
 * Rush Engineering and MicroGRID Sales invoices) for a given project. Unlike
 * /api/invoices/trigger which is fired automatically from milestone task events,
 * this endpoint is called explicitly by an authenticated CRM user to (a) preview
 * what the chain would look like for a project (dry_run) or (b) persist the
 * draft chain invoices so they can be reviewed by Mark/Paul before sending to
 * appraisers and tax attorneys.
 *
 * Body:
 *   { project_id: string, dry_run?: boolean }
 *
 * Response:
 *   { rulesEvaluated, created[], skippedExisting[], skippedError[], dryRun }
 *
 * Auth: valid Supabase session (must be a CRM user — admin-only at the moment
 *       since chain regeneration is a privileged operation).
 * Rate limited: 10 requests per minute per project (lower than the milestone
 *               trigger because each call inserts up to 5 invoices + ~30 line
 *               items).
 */
export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Admin gate ─────────────────────────────────────────────────────────
  // Chain generation creates up to 5 draft invoices per call and bypasses the
  // milestone trigger gating. Restrict to admin-tier roles only — regular CRM
  // users shouldn't be able to retroactively generate or regenerate the chain.
  if (!user.email) {
    return NextResponse.json({ error: 'Forbidden — no email on session' }, { status: 403 })
  }
  const { data: userRow } = await supabaseAuth
    .from('users')
    .select('role')
    .eq('email', user.email)
    .single()
  const role = (userRow as { role: string } | null)?.role
  if (!role || !ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: { project_id?: string; dry_run?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const projectId = body.project_id
  const dryRun = body.dry_run === true

  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  // ── Project-org membership gate ────────────────────────────────────────
  // Admin role is global; without a per-project org check, a tenant admin
  // could fire the chain against any other tenant's project (cross-tenant
  // invoice fabrication + margin disclosure via dry_run). Verify caller
  // belongs to the project's owning org, OR is a platform-org member.
  const { data: project } = await supabaseAuth
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const projOrgId = (project as { org_id: string }).org_id
  const { data: memberships } = await supabaseAuth
    .from('org_memberships')
    .select('org_id, organizations!inner(org_type)')
    .eq('user_id', user.id)
  const memberRows = (memberships ?? []) as unknown as Array<{
    org_id: string
    organizations: Array<{ org_type: string }> | { org_type: string } | null
  }>
  const userOrgIds = new Set(memberRows.map((m) => m.org_id))
  const isPlatform = memberRows.some((m) => {
    const orgs = Array.isArray(m.organizations) ? m.organizations : m.organizations ? [m.organizations] : []
    return orgs.some((o) => o.org_type === 'platform')
  })
  if (!isPlatform && !userOrgIds.has(projOrgId)) {
    return NextResponse.json({ error: 'Forbidden — not a member of project org' }, { status: 403 })
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  const { success } = await rateLimit(`invoice-chain:${projectId}`, {
    windowMs: 60_000,
    max: 10,
    prefix: 'invoice',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ── Fire chain ─────────────────────────────────────────────────────────
  try {
    const result = await generateProjectChain({
      projectId,
      dryRun,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    console.error('[POST /api/invoices/generate-chain]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
