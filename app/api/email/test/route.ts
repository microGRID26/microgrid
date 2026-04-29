import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { sendEmail } from '@/lib/email'
import { getTemplate } from '@/lib/email-templates'

/**
 * POST /api/email/test
 * Send a test email for a specific day to a specific email address.
 * Body: { email: string, day: number, name?: string }
 * Auth: requires CRON_SECRET or ADMIN_API_SECRET
 */
export async function POST(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  const cronSecret = process.env.CRON_SECRET?.trim()
  const adminSecret = process.env.ADMIN_API_SECRET?.trim()

  let validSecret = false
  try {
    if (cronSecret && token && token.length === cronSecret.length) {
      validSecret = timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))
    }
    if (!validSecret && adminSecret && token && token.length === adminSecret.length) {
      validSecret = timingSafeEqual(Buffer.from(token), Buffer.from(adminSecret))
    }
  } catch { validSecret = false }
  if (!validSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { email, day, name } = body as { email?: string; day?: number; name?: string }

    if (!email || !day) {
      return NextResponse.json({ error: 'Missing email or day' }, { status: 400 })
    }

    const template = getTemplate(day, name ?? 'Test User')
    if (!template) {
      return NextResponse.json({ error: `No template for day ${day}` }, { status: 400 })
    }

    const ok = await sendEmail(email, template.subject, template.html)
    return NextResponse.json({ sent: ok, day, email: email.replace(/(.{3}).+(@.+)/, '$1***$2') })
  } catch (err) {
    console.error('[email/test]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
