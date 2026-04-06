import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { getTemplate, getMaxDay } from '@/lib/email-templates'

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

// Supabase admin client for server-side cron (no user auth)
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars')
  return createClient(url, key)
}

export async function GET(req: Request) {
  // Rate limit: 10 requests per minute per endpoint
  if (!checkRateLimit('send-daily')) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Verify cron secret — if env var is NOT set, reject all requests (#7)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const provided = authHeader?.replace('Bearer ', '') ?? ''
  let cronMatch = false
  try {
    cronMatch = provided.length === cronSecret.length &&
      require('crypto').timingSafeEqual(Buffer.from(provided), Buffer.from(cronSecret))
  } catch { cronMatch = false }
  if (!cronMatch) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = getAdminClient()
    const today = new Date().toISOString().slice(0, 10)

    // Load all active (non-paused, non-completed) enrollments
    const { data: enrollments, error } = await supabase
      .from('email_onboarding')
      .select('*')
      .eq('paused', false)
      .eq('completed', false)
      .limit(500)

    if (error) {
      console.error('[send-daily] query error:', error)
      return NextResponse.json({ error: 'Failed to load enrollments' }, { status: 500 })
    }

    if (!enrollments || enrollments.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No active enrollments' })
    }

    let sent = 0
    let skipped = 0
    let completed = 0
    let failed = 0
    const errors: string[] = []

    for (const enrollment of enrollments) {
      // Double-send prevention (#8): Compare last_sent_at date to today's date.
      // This ensures that even if the cron fires multiple times per day (manual trigger,
      // retry, duplicate Vercel cron invocation), each user only receives one email per day.
      // The date comparison uses UTC ISO date strings (YYYY-MM-DD) for consistency.
      if (enrollment.last_sent_at) {
        const lastDate = new Date(enrollment.last_sent_at).toISOString().slice(0, 10)
        if (lastDate === today) {
          skipped++
          continue
        }
      }

      const nextDay = (enrollment.current_day || 0) + 1

      // If past max day, mark completed
      if (nextDay > getMaxDay()) {
        await supabase
          .from('email_onboarding')
          .update({ completed: true })
          .eq('id', enrollment.id)
        completed++
        continue
      }

      const template = getTemplate(nextDay, enrollment.user_name || 'there')
      if (!template) {
        errors.push(`No template for day ${nextDay}`)
        continue
      }

      const ok = await sendEmail(enrollment.user_email, template.subject, template.html)

      if (ok) {
        await supabase
          .from('email_onboarding')
          .update({
            current_day: nextDay,
            last_sent_at: new Date().toISOString(),
            completed: nextDay >= getMaxDay(),
          })
          .eq('id', enrollment.id)
        sent++
        if (nextDay >= getMaxDay()) completed++
      } else {
        failed++
        console.error(`[send-daily] Failed to send day ${nextDay} email to ${enrollment.user_email}`)
        errors.push(`Failed to send to ${enrollment.user_email}`)
      }
    }

    return NextResponse.json({
      sent,
      skipped,
      completed,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      total: enrollments.length,
    })
  } catch (err) {
    console.error('[send-daily] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
