import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { Resend } from 'resend'

import { rateLimit } from '@/lib/rate-limit'
import { renderInvoicePDF } from '@/lib/invoices/pdf'
import type { Invoice, InvoiceLineItem, Organization } from '@/types/database'

// @react-pdf/renderer uses Node built-ins (fs, stream) — must run on the node runtime.
export const runtime = 'nodejs'

// Only admin / super_admin / manager / finance can trigger a send. Receivers,
// customer-tenants, and EPC field roles have no business flipping draft→sent
// on someone else's invoice.
const SEND_ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'finance'])

/**
 * POST /api/invoices/[id]/send
 *
 * Renders the invoice to a PDF and emails it to the to_org's billing_email
 * via Resend. On success, transitions the invoice status from 'draft' to
 * 'sent' and stamps sent_at.
 *
 * Auth: valid Supabase session AND caller is a member of `from_org`
 * (or platform) AND role ∈ {admin, super_admin, manager, finance}. The DB
 * trigger in migration 133 enforces the from_org check a second time; this
 * route is defense in depth above it (rejects before PDF render + email).
 *
 * Rate limited: 20 sends per hour per user.
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

  // ── Rate limit per user (runs before role/db gates so a role-less caller
  //    can't spam free lookups) ──────────────────────────────────────────
  const { success } = await rateLimit(`invoice-send:${user.id}`, {
    windowMs: 3_600_000,
    max: 20,
    prefix: 'invoice',
  })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded (20 sends/hour)' }, { status: 429 })
  }

  // ── Role gate ──────────────────────────────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('id, role')
    .eq('email', user.email)
    .single()
  const role = (userRow as { id: string; role: string } | null)?.role
  if (!role || !SEND_ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Load invoice, line items, both orgs ────────────────────────────────
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, project_id, from_org, to_org, status, milestone, subtotal, tax, total, due_date, sent_at, viewed_at, paid_at, paid_amount, payment_method, payment_reference, notes, generated_by, rule_id, created_by, created_by_id, created_at, updated_at')
    .eq('id', invoiceId)
    .single()
  if (invErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const inv = invoice as Invoice

  // ── from_org membership gate ───────────────────────────────────────────
  // Only sender-org members (or platform) may send. Receivers who can SELECT
  // the row via RLS are nonetheless rejected here, matching the DB trigger's
  // ownership model. Platform is detected via org_memberships.org_type.
  const { data: memberships } = await supabase
    .from('org_memberships')
    .select('org_id, organizations!inner(id, org_type)')
    .eq('user_id', (userRow as { id: string }).id)
  // PostgREST returns the embedded table as an array even on !inner joins.
  const membershipRows = (memberships ?? []) as unknown as Array<{
    org_id: string
    organizations: Array<{ id: string; org_type: string }> | { id: string; org_type: string } | null
  }>
  const userOrgIds = new Set(membershipRows.map((m) => m.org_id))
  const isPlatform = membershipRows.some((m) => {
    const orgs = Array.isArray(m.organizations) ? m.organizations : m.organizations ? [m.organizations] : []
    return orgs.some((o) => o.org_type === 'platform')
  })
  if (!isPlatform && !userOrgIds.has(inv.from_org)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (inv.status !== 'draft') {
    return NextResponse.json(
      { error: `Cannot send invoice with status "${inv.status}" — only drafts can be sent` },
      { status: 409 },
    )
  }

  // ── Claim the send before rendering + emailing (TOCTOU guard) ──────────
  // Flip draft → sent with an optimistic status check; this reserves the
  // send so two concurrent callers can't both render + email. The loser
  // gets 409 here and never reaches the Resend call. Downside: a rendered
  // PDF or email failure downstream leaves the row in 'sent' state. That's
  // preferable to the double-email case — finance can manually resend.
  const now = new Date().toISOString()
  const { data: claimRows, error: claimErr } = await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: now })
    .eq('id', inv.id)
    .eq('status', 'draft')
    .select('id')
  if (claimErr) {
    console.error('[invoice send] claim update failed:', claimErr.message)
    return NextResponse.json({ error: 'Failed to claim send' }, { status: 500 })
  }
  if (!claimRows || claimRows.length === 0) {
    return NextResponse.json(
      { error: 'Invoice already sent by another request' },
      { status: 409 },
    )
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
    console.error('[invoice send]', itemsErr?.message, orgsErr?.message)
    return NextResponse.json({ error: 'Failed to load invoice context' }, { status: 500 })
  }
  const project = (projectRow as { id: string; name: string } | null) ?? null

  const orgRows = (orgs ?? []) as Organization[]
  const fromOrg = orgRows.find((o) => o.id === inv.from_org)
  const toOrg = orgRows.find((o) => o.id === inv.to_org)
  if (!fromOrg || !toOrg) {
    return NextResponse.json({ error: 'Invoice orgs not found' }, { status: 500 })
  }
  if (!toOrg.billing_email) {
    return NextResponse.json(
      { error: `Recipient org "${toOrg.name}" has no billing_email set — cannot send` },
      { status: 422 },
    )
  }

  // ── Render PDF ─────────────────────────────────────────────────────────
  const pdfBuffer = await renderInvoicePDF({
    invoice: inv,
    lineItems: (lineItems ?? []) as InvoiceLineItem[],
    fromOrg,
    toOrg,
    project,
  })

  // ── Send via Resend with attachment + tracking pixel ───────────────────
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[invoice send] RESEND_API_KEY not set — skipping actual send')
  } else {
    const resend = new Resend(apiKey)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.gomicrogridenergy.com'
    const pixelUrl = `${baseUrl}/api/invoices/${inv.id}/pixel.gif`

    const html = renderInvoiceEmailHTML({
      invoice: inv,
      fromOrgName: fromOrg.name,
      toOrgName: toOrg.name,
      pixelUrl,
    })

    try {
      await resend.emails.send({
        from: process.env.RESEND_BILLING_FROM_EMAIL ?? 'MicroGRID Billing <billing@gomicrogridenergy.com>',
        to: toOrg.billing_email,
        subject: `Invoice ${inv.invoice_number} from ${fromOrg.name}`,
        html,
        attachments: [
          {
            filename: `${inv.invoice_number}.pdf`,
            content: pdfBuffer,
          },
        ],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Resend error'
      console.error('[invoice send] resend failed:', message)
      return NextResponse.json({ error: `Email send failed: ${message}` }, { status: 502 })
    }
  }

  return NextResponse.json({
    ok: true,
    invoiceId: inv.id,
    sentAt: now,
    recipient: toOrg.billing_email,
  })
}

// ── Email HTML template ─────────────────────────────────────────────────────

interface EmailTemplateContext {
  invoice: Invoice
  fromOrgName: string
  toOrgName: string
  pixelUrl: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInvoiceEmailHTML(ctx: EmailTemplateContext): string {
  const { invoice, fromOrgName, toOrgName, pixelUrl } = ctx
  const totalFmt = `$${invoice.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const dueFmt = invoice.due_date
    ? new Date(invoice.due_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'upon receipt'

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f5f5f5;color:#111827;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;padding:32px;">
    <div style="border-bottom:2px solid #1D9E75;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:bold;color:#1D9E75;">${escapeHtml(fromOrgName)}</div>
    </div>
    <h1 style="font-size:22px;margin:0 0 16px;">New invoice from ${escapeHtml(fromOrgName)}</h1>
    <p style="font-size:14px;line-height:1.6;color:#374151;">
      Hello ${escapeHtml(toOrgName)},
    </p>
    <p style="font-size:14px;line-height:1.6;color:#374151;">
      A new invoice has been issued to your organization. Details and the full PDF are attached.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:24px 0;background:#f9fafb;border-radius:8px;">
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Invoice #</td>
        <td style="padding:12px 16px;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(invoice.invoice_number)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #e5e7eb;">Amount Due</td>
        <td style="padding:12px 16px;font-size:20px;font-weight:bold;color:#1D9E75;text-align:right;border-top:1px solid #e5e7eb;">${totalFmt}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;border-top:1px solid #e5e7eb;">Due Date</td>
        <td style="padding:12px 16px;font-size:14px;text-align:right;border-top:1px solid #e5e7eb;">${escapeHtml(dueFmt)}</td>
      </tr>
    </table>
    <p style="font-size:13px;line-height:1.6;color:#6b7280;margin-top:24px;">
      The full invoice is attached as a PDF. Please reply to this email with any questions
      or concerns — all replies go directly to our billing team.
    </p>
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">
      ${escapeHtml(fromOrgName)} · billing@gomicrogridenergy.com
    </div>
  </div>
  <img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;" />
</body></html>`
}
