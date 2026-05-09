import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'
import { renderInvoicePDF } from '@/lib/invoices/pdf'
import type { Invoice, InvoiceLineItem, Organization } from '@/types/database'

export const runtime = 'nodejs'

const PREVIEW_ALLOWED_ROLES = new Set([
  'admin', 'super_admin', 'manager', 'finance',
])

/**
 * GET /api/invoices/[id]/preview-pdf
 *
 * Renders the invoice to a PDF and streams it back inline. NO state change —
 * status, sent_at, viewed_at all left alone. Useful when a viewer wants to
 * see the rendered PDF without triggering the actual send (which routes to
 * to_org.billing_email and flips draft → sent).
 *
 * Auth: valid Supabase session AND caller is a member of from_org OR to_org
 * (or platform) AND role ∈ {admin, super_admin, manager, finance}. Either
 * side of the chain leg should be able to preview their own incoming or
 * outgoing invoice.
 *
 * Rate limited: 60 previews/hour/user (3× the send limit since this is
 * read-only and idempotent).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: invoiceId } = await params

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { success } = await rateLimit(`invoice-preview:${user.id}`, {
    windowMs: 3_600_000,
    max: 60,
    prefix: 'invoice',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded (60 previews/hour)' }, { status: 429 })
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('id, role')
    .eq('email', user.email)
    .single()
  const role = (userRow as { id: string; role: string } | null)?.role
  if (!role || !PREVIEW_ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, project_id, from_org, to_org, status, milestone, subtotal, tax, total, due_date, sent_at, viewed_at, paid_at, paid_amount, payment_method, payment_reference, notes, generated_by, rule_id, created_by, created_by_id, created_at, updated_at')
    .eq('id', invoiceId)
    .single()
  if (invErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }
  const inv = invoice as Invoice

  const { data: memberships } = await supabase
    .from('org_memberships')
    .select('org_id, organizations!inner(id, org_type)')
    .eq('user_id', (userRow as { id: string }).id)
  const membershipRows = (memberships ?? []) as unknown as Array<{
    org_id: string
    organizations: Array<{ id: string; org_type: string }> | { id: string; org_type: string } | null
  }>
  const userOrgIds = new Set(membershipRows.map((m) => m.org_id))
  const isPlatform = membershipRows.some((m) => {
    const orgs = Array.isArray(m.organizations) ? m.organizations : m.organizations ? [m.organizations] : []
    return orgs.some((o) => o.org_type === 'platform')
  })
  if (!isPlatform && !userOrgIds.has(inv.from_org) && !userOrgIds.has(inv.to_org)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [{ data: lineItems, error: itemsErr }, { data: orgs, error: orgsErr }, { data: projectRow }] = await Promise.all([
    supabase
      .from('invoice_line_items')
      .select('id, invoice_id, description, quantity, unit_price, total, category, sort_order, created_at')
      .eq('invoice_id', invoiceId)
      .order('sort_order', { ascending: true })
      .limit(100),
    supabase
      .from('organizations')
      .select('id, name, slug, org_type, allowed_domains, logo_url, settings, active, billing_email, billing_address, created_at, updated_at')
      .in('id', [inv.from_org, inv.to_org])
      .limit(2),
    inv.project_id
      ? supabase.from('projects').select('id, name').eq('id', inv.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (itemsErr || orgsErr) {
    return NextResponse.json({ error: 'Failed to load invoice context' }, { status: 500 })
  }

  const orgRows = (orgs ?? []) as Organization[]
  const fromOrg = orgRows.find((o) => o.id === inv.from_org)
  const toOrg = orgRows.find((o) => o.id === inv.to_org)
  if (!fromOrg || !toOrg) {
    return NextResponse.json({ error: 'Invoice orgs not found' }, { status: 500 })
  }
  const project = (projectRow as { id: string; name: string } | null) ?? null

  const pdfBuffer = await renderInvoicePDF({
    invoice: inv,
    lineItems: (lineItems ?? []) as InvoiceLineItem[],
    fromOrg,
    toOrg,
    project,
  })

  // Convert Buffer to a Blob-friendly Uint8Array so NextResponse can stream it.
  const body = new Uint8Array(pdfBuffer)
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${inv.invoice_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
