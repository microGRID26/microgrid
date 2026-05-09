import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Same role surface as /send — only finance-tier roles can flip an invoice
// to paid (which atomically claims funding_deductions).
const MARK_PAID_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'finance'])

const VALID_PRIOR_STATUSES = new Set(['sent', 'viewed', 'overdue', 'disputed'])

/**
 * POST /api/invoices/[id]/mark-paid
 *
 * Server-side wrapper around the SECURITY DEFINER apply_paid_invoice RPC
 * (migration 240). Browser anon-key callers can't invoke that RPC because
 * EXECUTE was REVOKEd from authenticated — this route runs the call under
 * the service_role client after enforcing org-membership + role gates that
 * the function body itself does NOT enforce.
 *
 * Without this route the "Mark Paid" UI silently 42501s and the modal
 * refuses to close (red-team C-1, audit 2026-05-08).
 *
 * Body:
 *   { paid_amount?: number, payment_method?: string, payment_reference?: string }
 *
 * Auth: valid Supabase session AND caller is a member of from_org or to_org
 * (or platform) AND role ∈ {admin, super_admin, manager, finance}.
 *
 * Rate limited: 30 per hour per user.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: invoiceId } = await params

  // ── Auth ────────────────────────────────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Rate limit per user ────────────────────────────────────────────────
  const { success } = await rateLimit(`invoice-mark-paid:${user.id}`, {
    windowMs: 3_600_000,
    max: 30,
    prefix: 'invoice',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ── Role gate ──────────────────────────────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('id, role')
    .eq('email', user.email)
    .single()
  const role = (userRow as { id: string; role: string } | null)?.role
  if (!role || !MARK_PAID_ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Load invoice ───────────────────────────────────────────────────────
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, status, from_org, to_org')
    .eq('id', invoiceId)
    .single()
  if (invErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  const inv = invoice as { id: string; status: string; from_org: string; to_org: string }

  if (!VALID_PRIOR_STATUSES.has(inv.status)) {
    return NextResponse.json(
      { error: `Cannot mark paid from status "${inv.status}"` },
      { status: 409 },
    )
  }

  // ── Org membership gate ────────────────────────────────────────────────
  const { data: memberships } = await supabase
    .from('org_memberships')
    .select('org_id, organizations!inner(org_type)')
    .eq('user_id', (userRow as { id: string }).id)
  const memberRows = (memberships ?? []) as unknown as Array<{
    org_id: string
    organizations: Array<{ org_type: string }> | { org_type: string } | null
  }>
  const userOrgIds = new Set(memberRows.map((m) => m.org_id))
  const isPlatform = memberRows.some((m) => {
    const orgs = Array.isArray(m.organizations) ? m.organizations : m.organizations ? [m.organizations] : []
    return orgs.some((o) => o.org_type === 'platform')
  })
  if (!isPlatform && !userOrgIds.has(inv.from_org) && !userOrgIds.has(inv.to_org)) {
    return NextResponse.json({ error: 'Forbidden — not a member of invoice org' }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: { paid_amount?: number; payment_method?: string; payment_reference?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // ── Service-role RPC call ─────────────────────────────────────────────
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const now = new Date().toISOString()
  const { data: rpc, error: rpcErr } = await admin
    .rpc('apply_paid_invoice', {
      p_invoice_id: invoiceId,
      p_current_status: inv.status,
      p_paid_at: now,
      p_payment_method: body.payment_method ?? null,
      p_payment_reference: body.payment_reference ?? null,
      p_explicit_paid_amount: typeof body.paid_amount === 'number' ? body.paid_amount : null,
    })
    .single()

  if (rpcErr) {
    const code = (rpcErr as { code?: string }).code
    if (code === '40001') {
      return NextResponse.json({ error: 'Invoice status changed mid-flight; reload and retry' }, { status: 409 })
    }
    if (code === 'P0002') {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    // mig 252 sibling-paid guard. Surface RPC's exception message so the
    // user sees which sibling invoice number is blocking + how to unblock.
    if (code === 'P0003') {
      return NextResponse.json({ error: rpcErr.message }, { status: 409 })
    }
    console.error('[mark-paid] apply_paid_invoice failed:', rpcErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  // Fire-and-forget profit-transfer hook (matches lib/api/invoices.ts behavior).
  void import('@/lib/invoices/profit-transfer').then(({ recordProfitTransferIfApplicable }) =>
    recordProfitTransferIfApplicable(invoiceId).then((result) => {
      if (result.inserted) {
        console.log('[profit-transfer] recorded', result.transferId)
      } else if (result.reason && result.reason !== 'not_chain_invoice' && result.reason !== 'not_dse_origin') {
        console.warn('[profit-transfer] skipped:', result.reason, result.detail)
      }
    }),
  ).catch((err) => {
    console.error('[profit-transfer] fire-and-forget failed:', err instanceof Error ? err.message : err)
  })

  return NextResponse.json(rpc, { status: 200 })
}
