import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { sendCustomerFeedbackReplyNotification } from '@/lib/api/customer-notifications'

/**
 * POST /api/notifications/feedback-reply
 *
 * Atlas-callable. When an admin (Greg via Atlas, or future CRM UI) writes
 * a response to a customer_feedback row, call this route to fire a push
 * notification back to the customer's mobile app.
 *
 * Body: { feedback_id: string }
 *
 * The route looks up the feedback row, extracts project_id + admin_response,
 * sends the push, and updates status='responded' if not already.
 *
 * Auth: CRON_SECRET, ADMIN_API_SECRET, or valid Supabase session.
 * Rate limited: 30 requests per minute per feedback id.
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
  let body: { feedback_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const feedbackId = body.feedback_id
  if (!feedbackId) {
    return NextResponse.json({ error: 'feedback_id is required' }, { status: 400 })
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  const { success: withinLimit } = await rateLimit(`feedback-reply:${feedbackId}`, {
    windowMs: 60_000,
    max: 30,
    prefix: 'feedback-reply',
  })
  if (!withinLimit) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ── Look up the feedback row ───────────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
  if (!url || !key) {
    return NextResponse.json({ error: 'Service key not configured' }, { status: 503 })
  }

  const supabase = createClient(url, key)
  const { data: feedback, error: lookupError } = await supabase
    .from('customer_feedback')
    .select('id, project_id, admin_response, status')
    .eq('id', feedbackId)
    .single()

  if (lookupError || !feedback) {
    return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })
  }

  const row = feedback as { id: string; project_id: string; admin_response: string | null; status: string }

  if (!row.admin_response || !row.admin_response.trim()) {
    return NextResponse.json({ error: 'Feedback has no admin_response set' }, { status: 400 })
  }

  // ── Bump status FIRST so DB is consistent even if push fails ────────────
  if (row.status !== 'responded' && row.status !== 'closed') {
    const { error: updateError } = await supabase
      .from('customer_feedback')
      .update({ status: 'responded' })
      .eq('id', row.id)
    if (updateError) {
      console.error('[feedback-reply] status update failed:', updateError.message)
      return NextResponse.json({ error: 'Failed to update status' }, { status: 500 })
    }
  }

  // ── Send push ───────────────────────────────────────────────────────────
  const sent = await sendCustomerFeedbackReplyNotification(
    row.project_id,
    row.id,
    row.admin_response,
  )

  // sent=false means no customer push tokens registered (not an error,
  // but worth surfacing so the caller knows the customer won't get a notification)
  return NextResponse.json({
    sent,
    feedback_id: row.id,
    warning: sent ? undefined : 'Customer has no registered push tokens; status updated but no notification sent',
  })
}
