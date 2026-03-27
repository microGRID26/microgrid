import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

/** Escape HTML special characters to prevent XSS in email templates */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────
// Simple in-memory rate limiter (per-minute).
// On Vercel serverless, memory does not persist across cold starts — this provides
// burst protection within a warm instance without needing an external store.
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

export async function POST(req: Request) {
  try {
    // Rate limit: 10 requests per minute per endpoint
    if (!checkRateLimit('announce')) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    const body = await req.json()
    const { subject, html, targetRole, adminSecret } = body

    // Require admin secret — if env var is NOT set, reject all requests (#7)
    const secret = process.env.ADMIN_API_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'ADMIN_API_SECRET not configured' }, { status: 503 })
    }
    if (adminSecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!subject || !html) {
      return NextResponse.json({ error: 'subject and html are required' }, { status: 400 })
    }

    const supabase = getAdminClient()

    // Query active users, optionally filtered by role
    let query = supabase
      .from('users')
      .select('email, name')
      .eq('active', true)

    if (targetRole) {
      query = query.eq('role', targetRole)
    }

    const { data: users, error } = await query

    if (error) {
      console.error('[announce] query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!users || users.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No matching users' })
    }

    // Wrap the provided HTML in a simple email layout
    const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nova.gomicrogridenergy.com'
    const wrappedHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:12px;border:1px solid #1f2937;overflow:hidden;">
  <tr><td style="background:#111827;padding:24px 32px 16px;border-bottom:1px solid #1f2937;">
    <span style="color:#1D9E75;font-size:20px;font-weight:700;letter-spacing:-0.5px;">MicroGRID</span>
    <span style="color:#6b7280;font-size:12px;margin-left:8px;">What's New</span>
  </td></tr>
  <tr><td style="padding:28px 32px 32px;color:#e5e7eb;font-size:14px;line-height:1.6;">
    ${html}
  </td></tr>
  <tr><td style="padding:16px 32px;background:#0d1117;border-top:1px solid #1f2937;">
    <table width="100%"><tr>
      <td><span style="color:#4b5563;font-size:11px;">MicroGRID Energy &middot; MicroGRID</span></td>
      <td align="right"><a href="${BASE_URL}" style="color:#1D9E75;font-size:11px;text-decoration:none;">Open MicroGRID →</a></td>
    </tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

    let sent = 0
    const errors: string[] = []

    for (const user of users) {
      if (!user.email) continue
      const ok = await sendEmail(user.email, subject, wrappedHtml)
      if (ok) {
        sent++
      } else {
        errors.push(user.email)
      }
    }

    return NextResponse.json({
      sent,
      total: users.length,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err) {
    console.error('[announce] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
