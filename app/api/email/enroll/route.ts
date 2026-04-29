import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'crypto'
import { sendEmail } from '@/lib/email'
import { getTemplate } from '@/lib/email-templates'
import { rateLimit } from '@/lib/rate-limit'

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
    const { success } = await rateLimit('enroll', { max: 10, prefix: 'enroll' })
    if (!success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    // Authentication: require CRON_SECRET or ADMIN_API_SECRET in Authorization header
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET?.trim()
    const adminSecret = process.env.ADMIN_API_SECRET?.trim()
    const token = authHeader?.replace('Bearer ', '')
    let isAuthed = false
    try {
      if (cronSecret && token && token.length === cronSecret.length) {
        isAuthed = timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))
      }
      if (!isAuthed && adminSecret && token && token.length === adminSecret.length) {
        isAuthed = timingSafeEqual(Buffer.from(token), Buffer.from(adminSecret))
      }
    } catch { isAuthed = false }
    if (!isAuthed) {
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
