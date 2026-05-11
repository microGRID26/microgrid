import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { Resend } from 'resend'
import crypto from 'crypto'
import { rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/customer/delete-account
 *
 * 2-phase email-token-confirmation flow. Closes #548 (P1, #544 R1 H2).
 *
 *   Phase 1 (issue + email): body = {} (or body absent).
 *     → 200 { status: 'pending_confirmation', expires_in: 300 }
 *     → Server emails a 32-char URL-safe token to the customer's
 *       customer_accounts.email. Token plaintext is shown copy-pasteable
 *       in the email; SHA-256 hash is stored in customer_delete_tokens.
 *
 *   Phase 2 (confirm + delete): body = { confirmation_token: '...' }.
 *     → 200 { ok: true }  — account deleted.
 *     → 403 invalid_or_expired_token  — token miss / used / expired.
 *
 * Why: today the route accepts a Bearer JWT (mobile) or cookie session
 * (web) and immediately CASCADE-deletes customer_accounts + 6 child
 * tables + auth.users + Stripe customer (#544). A leaked mobile JWT
 * (crash report, analytics breadcrumb, error tracker) is sufficient
 * alone to destroy the victim's account. The 2-phase email-token gate
 * forces the attacker to also have mailbox access.
 *
 * Apple App Store 5.1.1(v) permits a confirmation flow before
 * irreversible deletion — this is defense-in-depth, not Apple-required.
 *
 * R1 red-teamer audit (atlas_audit_log id 899848a1-…):
 *   - H-1 TOCTOU: addressed via atomic UPDATE-WHERE-RETURNING + rowCount=1.
 *   - H-2 rate-limit pinning: addressed via DB count of issued tokens in
 *     last hour (no Upstash counter on the issue phase). Phase 2 keeps
 *     Upstash for sub-minute brute-force guess limits.
 */

const TOKEN_TTL_MIN = 5
const ISSUE_MAX_PER_HOUR = 3

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

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

  // ── Service role client (bypasses RLS, has auth.admin) ─────────────────
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('[delete-account] SUPABASE_SECRET_KEY not configured')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  // ── Body discriminator ─────────────────────────────────────────────────
  let body: { confirmation_token?: string } = {}
  try {
    body = (await request.json()) as { confirmation_token?: string }
  } catch {
    // Empty body is valid for Phase 1.
  }
  const confirmationToken = typeof body.confirmation_token === 'string'
    ? body.confirmation_token.trim()
    : undefined

  if (confirmationToken) {
    return phase2Confirm({ admin, userId: user.id, plaintext: confirmationToken })
  }
  return phase1Issue({ admin, userId: user.id })
}

// ── Phase 1: issue + email a token ──────────────────────────────────────
async function phase1Issue(args: {
  admin: SupabaseClient
  userId: string
}): Promise<NextResponse> {
  const { admin, userId } = args

  // Rate-limit source of truth: COUNT customer_delete_tokens.created_at in the
  // last hour for this user. R1 H-2 fix — using Upstash here would pre-increment
  // even on email/insert failure, pinning legit users out of the deletion flow.
  // DB count rolls back naturally when failed-path rows are not inserted.
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString()
  const { count: recentTokens, error: countErr } = await admin
    .from('customer_delete_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('auth_user_id', userId)
    .gte('created_at', oneHourAgo)
  if (countErr) {
    console.error('[delete-account.phase1] token count failed:', countErr.message)
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  if ((recentTokens ?? 0) >= ISSUE_MAX_PER_HOUR) {
    return NextResponse.json(
      { error: 'Too many delete attempts in the last hour. Please contact support.' },
      { status: 429 },
    )
  }

  // Resolve customer email for the send target.
  const { data: account } = await admin
    .from('customer_accounts')
    .select('email')
    .eq('auth_user_id', userId)
    .maybeSingle()
  const email = (account as { email?: string } | null)?.email
  if (!email) {
    // No customer_accounts row OR no email on record — we can't deliver the
    // confirmation token. Return 400 (not 404 to avoid enumeration delta).
    return NextResponse.json(
      { error: 'No email on record. Please contact support to delete your account.' },
      { status: 400 },
    )
  }

  // Generate plaintext token + hash. 24 bytes random → 32-char URL-safe.
  const plaintext = crypto.randomBytes(24).toString('base64url')
  const tokenHash = sha256(plaintext)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000).toISOString()

  // Email FIRST. If Resend fails, no DB row inserted — no orphan to clean up
  // and no spurious counter increment for the user.
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[delete-account.phase1] RESEND_API_KEY not set')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  const resend = new Resend(apiKey)
  try {
    await resend.emails.send({
      from: process.env.RESEND_ACCOUNT_FROM_EMAIL
        ?? 'MicroGRID Account <billing@gomicrogridenergy.com>',
      to: email,
      subject: 'Confirm your MicroGRID account deletion',
      text: [
        'You requested to delete your MicroGRID account.',
        '',
        `Confirmation code (valid for ${TOKEN_TTL_MIN} minutes):`,
        '',
        plaintext,
        '',
        'Paste this into the app to confirm deletion.',
        'If you did not request this, ignore this email — no action will be taken.',
        '',
        '— MicroGRID',
      ].join('\n'),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Resend error'
    console.error('[delete-account.phase1] resend failed:', message)
    return NextResponse.json({ error: `Email send failed: ${message}` }, { status: 502 })
  }

  // Email accepted by Resend — now insert the DB row. If this fails, the user
  // has a plaintext token but it won't match any row → next attempt regenerates.
  // No worse than the email-fail path, and rate-limit count is intact.
  const { error: insErr } = await admin
    .from('customer_delete_tokens')
    .insert({ auth_user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
  if (insErr) {
    console.error('[delete-account.phase1] token insert failed (email already sent):', insErr.message)
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }

  return NextResponse.json({
    status: 'pending_confirmation',
    expires_in: TOKEN_TTL_MIN * 60,
  })
}

// ── Phase 2: confirm + delete ────────────────────────────────────────────
async function phase2Confirm(args: {
  admin: SupabaseClient
  userId: string
  plaintext: string
}): Promise<NextResponse> {
  const { admin, userId, plaintext } = args

  // Brute-force ceiling — 5 guesses/minute per user. Upstash sliding-window is
  // fine here because Phase 2 is short-lived (5min token TTL) and the limit
  // protects guessing not issuance.
  const { success: withinLimit } = await rateLimit(`delete-account-confirm:${userId}`, {
    windowMs: 60_000,
    max: 5,
    prefix: 'delete-account-confirm',
  })
  if (!withinLimit) {
    return NextResponse.json(
      { error: 'Too many confirmation attempts. Please wait a minute.' },
      { status: 429 },
    )
  }

  const tokenHash = sha256(plaintext)

  // R1 H-1 fix: atomic single-statement UPDATE-WHERE-RETURNING. No SELECT
  // followed by UPDATE — that would TOCTOU-race two concurrent confirms.
  // The WHERE clause encodes all three checks (auth_user_id match, hash
  // match, not-yet-used, not expired). RETURNING id makes rowCount the
  // gate: 1 = consumed this call, 0 = no live token matched.
  const { data: claimed, error: updateErr } = await admin
    .from('customer_delete_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('auth_user_id', userId)
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
  if (updateErr) {
    console.error('[delete-account.phase2] token claim failed:', updateErr.message)
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  const claimedRow = (claimed as { id?: string }[] | null) ?? []
  if (claimedRow.length === 0) {
    return NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 403 })
  }

  // Token consumed atomically. Proceed with the existing cascade delete.
  const { error: deleteAccountError } = await admin
    .from('customer_accounts')
    .delete()
    .eq('auth_user_id', userId)

  if (deleteAccountError) {
    console.error('[delete-account.phase2] customer_accounts delete failed:', deleteAccountError.message)
    return NextResponse.json({ error: 'Failed to delete account data' }, { status: 500 })
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId)
  if (deleteUserError) {
    console.error('[delete-account.phase2] auth.users delete failed:', deleteUserError.message)
    // Customer data is already gone — return success so the user isn't stuck.
    return NextResponse.json({
      ok: true,
      warning: 'Account data deleted; auth removal pending',
    })
  }

  return NextResponse.json({ ok: true })
}
