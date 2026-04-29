import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { rateLimit } from '@/lib/rate-limit'
import { sendCustomerMilestoneNotification, sendCustomerTicketNotification } from '@/lib/api/customer-notifications'

/**
 * POST /api/notifications/customer
 *
 * Sends push notifications to customers for milestone or ticket events.
 *
 * Body:
 *   { project_id: string, type: 'milestone' | 'ticket', stage?: string, ticket_id?: string, message?: string }
 *
 * Auth: CRON_SECRET, ADMIN_API_SECRET, or valid Supabase session.
 * Rate limited: 30 requests per minute per project.
 */
export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const cronSecret = process.env.CRON_SECRET?.trim()
  const adminSecret = process.env.ADMIN_API_SECRET?.trim()
  let hasSecretAuth = false
  try {
    if (cronSecret && token && token.length === cronSecret.length) {
      hasSecretAuth = timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))
    }
    if (!hasSecretAuth && adminSecret && token && token.length === adminSecret.length) {
      hasSecretAuth = timingSafeEqual(Buffer.from(token), Buffer.from(adminSecret))
    }
  } catch { hasSecretAuth = false }

  if (!hasSecretAuth) {
    // Fall back to Supabase session validation
    const { createServerClient } = await import('@supabase/ssr')
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: {
    project_id: string
    type: 'milestone' | 'ticket'
    stage?: string
    ticket_id?: string
    message?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { project_id, type, stage, ticket_id, message } = body

  if (!project_id || !type) {
    return NextResponse.json({ error: 'project_id and type are required' }, { status: 400 })
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  const { success: withinLimit } = await rateLimit(`customer-push:${project_id}`, {
    windowMs: 60_000,
    max: 30,
    prefix: 'customer-push',
  })
  if (!withinLimit) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ── Dispatch ───────────────────────────────────────────────────────────
  try {
    if (type === 'milestone') {
      if (!stage) {
        return NextResponse.json({ error: 'stage is required for milestone notifications' }, { status: 400 })
      }
      const sent = await sendCustomerMilestoneNotification(project_id, stage)
      return NextResponse.json({ sent, type: 'milestone', stage })
    }

    if (type === 'ticket') {
      if (!ticket_id || !message) {
        return NextResponse.json({ error: 'ticket_id and message are required for ticket notifications' }, { status: 400 })
      }
      const sent = await sendCustomerTicketNotification(project_id, ticket_id, message)
      return NextResponse.json({ sent, type: 'ticket', ticket_id })
    }

    return NextResponse.json({ error: `Unknown notification type: ${type}` }, { status: 400 })
  } catch (err: unknown) {
    console.error('[customer-notification-route] error:', err)
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
