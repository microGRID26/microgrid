import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { getTemplate } from '@/lib/email-templates'

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

/** Basic email format validation */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

export async function POST(req: Request) {
  try {
    // Rate limit: 10 requests per minute per endpoint
    if (!checkRateLimit('enroll')) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    // Authentication: require CRON_SECRET or ADMIN_API_SECRET in Authorization header
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    const adminSecret = process.env.ADMIN_API_SECRET
    const token = authHeader?.replace('Bearer ', '')
    const isAuthed = (cronSecret && token === cronSecret) || (adminSecret && token === adminSecret)
    // Also allow same-origin calls from the admin UI (check Origin/Referer)
    const origin = req.headers.get('origin') || req.headers.get('referer') || ''
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://nova.gomicrogridenergy.com'
    const isSameOrigin = origin.startsWith(appUrl) || origin.startsWith('http://localhost')
    if (!isAuthed && !isSameOrigin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { user_id, user_email, user_name } = body

    if (!user_id || !user_email) {
      return NextResponse.json({ error: 'user_id and user_email are required' }, { status: 400 })
    }

    // Validate email format (#5)
    if (!EMAIL_REGEX.test(user_email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    const supabase = getAdminClient()

    // Check if already enrolled
    const { data: existing } = await supabase
      .from('email_onboarding')
      .select('id')
      .eq('user_id', user_id)
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ enrolled: false, message: 'User already enrolled' })
    }

    // Create enrollment
    const { error: insertError } = await supabase
      .from('email_onboarding')
      .insert({
        user_id,
        user_email,
        user_name: user_name || null,
        current_day: 1,
        last_sent_at: new Date().toISOString(),
      })

    if (insertError) {
      console.error('[enroll] insert error:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    // Send Day 1 email immediately
    const template = getTemplate(1, user_name || 'there')
    if (template) {
      await sendEmail(user_email, template.subject, template.html)
    }

    return NextResponse.json({ enrolled: true, day: 1 })
  } catch (err) {
    console.error('[enroll] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
