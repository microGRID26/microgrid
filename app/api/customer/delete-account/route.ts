import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/customer/delete-account
 *
 * Customer-initiated account deletion. Required by Apple App Store guideline 5.1.1(v):
 * any app supporting account creation must support in-app account deletion.
 *
 * Auth: Supabase session — cookie-based (web) or Bearer token (mobile).
 *
 * Behavior:
 * 1. Validates the caller is signed in
 * 2. Deletes the customer_accounts row by auth_user_id
 *    → CASCADE removes: customer_feedback, customer_feedback_attachments,
 *      customer_billing_statements, customer_payment_methods, customer_payments,
 *      customer_referrals
 * 3. Deletes the auth.users row via admin API
 * 4. Returns 200
 *
 * Does NOT touch: projects, work_orders, customer_messages, contracts, or any
 * underlying solar installation business records. These are retained for warranty,
 * service, and legal purposes (disclosed in /privacy). Apple's 5.1.1(v) explicitly
 * permits retention for legitimate operational and legal reasons.
 *
 * Rate limited: 3 attempts per hour per user (prevents loops + abuse).
 */
export async function POST(request: NextRequest) {
  // ── Auth (cookie OR Bearer token) ──────────────────────────────────────
  const bearerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  const cookieStore = await cookies()
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    },
  )

  let user = null
  if (bearerToken) {
    const { data } = await supabaseAuth.auth.getUser(bearerToken)
    user = data?.user ?? null
  } else {
    const { data } = await supabaseAuth.auth.getUser()
    user = data?.user ?? null
  }

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Rate limit ─────────────────────────────────────────────────────────
  const { success: withinLimit } = await rateLimit(`delete-account:${user.id}`, {
    windowMs: 60 * 60_000, // 1 hour
    max: 3,
    prefix: 'delete-account',
  })
  if (!withinLimit) {
    return NextResponse.json(
      { error: 'Too many delete attempts. Please contact support.' },
      { status: 429 },
    )
  }

  // ── Service role client (bypasses RLS, has auth.admin) ─────────────────
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('[delete-account] SUPABASE_SECRET_KEY not configured')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  // ── Delete customer_accounts row (FK CASCADE handles related tables) ──
  const { error: deleteAccountError } = await admin
    .from('customer_accounts')
    .delete()
    .eq('auth_user_id', user.id)

  if (deleteAccountError) {
    console.error('[delete-account] customer_accounts delete failed:', deleteAccountError.message)
    return NextResponse.json({ error: 'Failed to delete account data' }, { status: 500 })
  }

  // ── Delete auth.users row ──────────────────────────────────────────────
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteUserError) {
    console.error('[delete-account] auth.users delete failed:', deleteUserError.message)
    // Customer data is already gone — return success so the user isn't stuck.
    // Any orphaned auth.users row can be cleaned up manually.
    return NextResponse.json({
      ok: true,
      warning: 'Account data deleted; auth removal pending',
    })
  }

  return NextResponse.json({ ok: true })
}
