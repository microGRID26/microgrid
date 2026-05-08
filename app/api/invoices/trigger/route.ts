import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { fireMilestoneInvoices, TRIGGER_MILESTONES, type TriggerMilestone } from '@/lib/invoices/trigger'

/**
 * POST /api/invoices/trigger
 *
 * Fires all active invoice_rules matching a given (project, milestone) pair.
 * Called fire-and-forget from useProjectTasks.ts when NTP/install/PTO tasks
 * move to Complete. Idempotent via the unique index on
 * (project_id, rule_id, milestone).
 *
 * Body:
 *   { project_id: string, milestone: 'ntp' | 'installation' | 'pto' }
 *
 * Auth: valid Supabase session (must be a CRM user).
 * Rate limited: 20 requests per minute per project.
 */
export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: { project_id?: string; milestone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const projectId = body.project_id
  const milestone = body.milestone

  if (!projectId || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }
  if (!milestone || !TRIGGER_MILESTONES.includes(milestone as TriggerMilestone)) {
    return NextResponse.json(
      { error: `milestone must be one of: ${TRIGGER_MILESTONES.join(', ')}` },
      { status: 400 },
    )
  }

  // ── Project-org membership gate ────────────────────────────────────────
  // The trigger writes invoice rows + line items via the service-role client
  // (RLS-bypassing). Without this check, any authenticated CRM user could
  // fabricate draft invoices on any tenant's project by passing a foreign
  // project_id. Defense-in-depth: verify caller belongs to the project's
  // owning org, OR is a platform-org member.
  const { data: project } = await supabaseAuth
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const projOrgId = (project as { org_id: string }).org_id
  // Resolve public.users.id from email — org_memberships.user_id is keyed
  // on public.users.id, which diverges from auth.users.id for ~7 of 20
  // current memberships (pre-mig-196 backfill artifacts + active accounts
  // whose auth_user_id was never linked). Querying by `user.id` directly
  // produces false-403s for those users.
  // ilike + trim matches lib/auth/role-gate.ts checkRole — auth.users.email
  // is lowercased on signup but historical public.users.email rows can be
  // mixed-case, so an exact .eq match would re-introduce the false-403.
  const { data: callerRow } = await supabaseAuth
    .from('users')
    .select('id')
    .ilike('email', user.email.trim())
    .maybeSingle()
  const callerPublicId = (callerRow as { id: string } | null)?.id
  if (!callerPublicId) {
    return NextResponse.json({ error: 'Forbidden — no public users row' }, { status: 403 })
  }
  const { data: memberships } = await supabaseAuth
    .from('org_memberships')
    .select('org_id, organizations!inner(org_type)')
    .eq('user_id', callerPublicId)
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
  const { success } = await rateLimit(`invoice-trigger:${projectId}`, {
    windowMs: 60_000,
    max: 20,
    prefix: 'invoice',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ── Fire trigger ───────────────────────────────────────────────────────
  try {
    const result = await fireMilestoneInvoices({
      projectId,
      milestone: milestone as TriggerMilestone,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    console.error('[POST /api/invoices/trigger]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
