import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Send push notification to a customer.
 * Called internally from CRM when PM replies to a ticket or project stage changes.
 *
 * POST /api/portal/push
 * Body: { projectId: string, title: string, body: string, data?: object }
 */
export async function POST(request: NextRequest) {
  // Auth: require CRON_SECRET, ADMIN_API_SECRET, or valid Supabase session
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const cronSecret = process.env.CRON_SECRET
  const adminSecret = process.env.ADMIN_API_SECRET
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
      { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'Service key not configured' }, { status: 503 })
  }

  const { projectId, title, body, data } = await request.json()
  if (!projectId || !title || !body) {
    return NextResponse.json({ error: 'projectId, title, and body required' }, { status: 400 })
  }

  // Rate limit: 30 push notifications per minute per project
  const { success: withinLimit } = await rateLimit(`portal-push:${projectId}`, {
    windowMs: 60_000,
    max: 30,
    prefix: 'portal-push',
  })
  if (!withinLimit) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Look up customer push token
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)
  const { data: accounts } = await supabase
    .from('customer_accounts')
    .select('push_token, name')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .not('push_token', 'is', null)
    .limit(500)

  if (!accounts?.length) {
    return NextResponse.json({ sent: 0, reason: 'no push tokens' })
  }

  // Send via Expo Push API
  type AccountRow = { push_token: string | null; name?: string | null }
  const messages = (accounts as AccountRow[])
    .filter((a) => !!a.push_token)
    .map((a) => ({
      to: a.push_token as string,
      sound: 'default' as const,
      title,
      body,
      data: { ...data, projectId },
    }))

  if (messages.length === 0) {
    return NextResponse.json({ sent: 0, reason: 'no valid tokens' })
  }

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    })
    const result = await res.json()
    return NextResponse.json({ sent: messages.length, result })
  } catch (err) {
    console.error('[push] send failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'send failed' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Push notification API' })
}
