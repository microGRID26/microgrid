import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { checkRole, MANAGER_PLUS } from '@/lib/auth/role-gate'

/**
 * POST /api/notifications/stuck-task
 *
 * Sends an email to the PM when a task enters Pending Resolution or Revision Required.
 * Called fire-and-forget from useProjectTasks automation chain.
 *
 * Body: { projectId, projectName, taskName, status, reason, pmEmail, pmName }
 */
export async function POST(req: Request) {
  // Auth: require CRON_SECRET or ADMIN_API_SECRET (internal CRM calls pass this)
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const cronSecret = process.env.CRON_SECRET?.trim()
  const adminSecret = process.env.ADMIN_API_SECRET?.trim()
  let hasAuth = false
  try {
    if (cronSecret && token && token.length === cronSecret.length) {
      hasAuth = timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))
    }
    if (!hasAuth && adminSecret && token && token.length === adminSecret.length) {
      hasAuth = timingSafeEqual(Buffer.from(token), Buffer.from(adminSecret))
    }
  } catch { hasAuth = false }

  if (!hasAuth) {
    // Fall back to session cookie check via Supabase. Tightened per audit-rotation
    // greg_action #358 (P1): must be a real public.users row (excludes portal
    // customers / auth.users-only accounts) AND role >= manager. Without the
    // role check, any authenticated session could fire MicroGRID-branded
    // emails to attacker-supplied recipients.
    const cookieHeader = req.headers.get('cookie')
    if (!cookieHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { createClient: createBrowserClient } = await import('@supabase/supabase-js')
    const supabaseAuth = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { cookie: cookieHeader } } }
    )
    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Role gate — manager+ only. Email-based lookup (see lib/auth/role-gate.ts
    // for why id-based lookups silently 403 most legitimate users).
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim()
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Not configured' }, { status: 503 })
    }
    const supabaseRole = createClient(supabaseUrl, serviceKey)
    const roleCheck = await checkRole({
      db: supabaseRole,
      authUserEmail: user.email,
      allowedRoles: MANAGER_PLUS,
    })
    if (!roleCheck.ok) {
      return NextResponse.json({ error: 'Forbidden — manager+ required' }, { status: 403 })
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  let body: {
    projectId: string
    projectName?: string  // accepted for display fallback only — verified against DB
    taskName: string
    status: string
    reason?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { projectId, taskName, status, reason } = body

  if (!projectId || !taskName || !status) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Rate limit: 20 stuck-task emails per minute per project. Note: the
  // limit fires on the *requested* projectId BEFORE the DB existence check
  // below, so a noisy caller spraying fake projectIds can still create
  // bounded rate-limit buckets in Upstash (entries expire after 60s, so
  // memory cost is bounded). The phishing-relay vector is closed because
  // the DB lookup downstream returns 404 for non-existent projects and
  // never reaches sendEmail — only the rate-limit slot is consumed.
  const { success: withinLimit } = await rateLimit(`stuck-task:${projectId}`, {
    windowMs: 60_000,
    max: 20,
    prefix: 'stuck-task',
  })
  if (!withinLimit) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // ALWAYS look up the PM email from the project record — never trust the
  // body. Per audit-rotation greg_action #358 (P1), the prior body-trust
  // path let any authenticated user fire MicroGRID-branded email to any
  // address. The route is purpose-built to notify the project's PM, full
  // stop. If you need to email someone else, use a different endpoint.
  const supabase = createClient(supabaseUrl, serviceKey)
  const { data: project } = await supabase
    .from('projects')
    .select('pm, pm_id, name')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  let email: string | undefined
  let name = 'PM'

  if (project.pm_id) {
    const { data: user } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', project.pm_id)
      .single()
    email = (user as { email: string; name: string } | null)?.email
    name = (user as { email: string; name: string } | null)?.name ?? project.pm ?? 'PM'
  }

  if (!email) {
    return NextResponse.json({ sent: false, reason: 'No PM email found' })
  }

  // Use the DB project name; fall back to body.projectName only for display
  // when DB has no name (legacy rows). Either way, the email goes to the
  // DB-resolved PM, so attacker-controlled projectName can't be paired with
  // an attacker-controlled recipient.
  const projectName = (project.name as string | null) ?? body.projectName ?? projectId

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://microgrid-crm.vercel.app'
  const isRevision = status === 'Revision Required'
  const statusColor = isRevision ? '#f59e0b' : '#ef4444'
  const statusLabel = isRevision ? 'Revision Required' : 'Pending Resolution'
  const firstName = esc(name?.split(' ')[0] ?? 'PM')
  const safeProjectName = esc(projectName ?? '')
  const safeTaskName = esc(taskName ?? '')
  const safeReason = reason ? esc(reason) : ''
  const safeProjectId = encodeURIComponent(projectId)

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #111827; color: #e5e7eb; padding: 32px; border-radius: 12px; border: 1px solid #1f2937;">
      <div style="margin-bottom: 16px;">
        <span style="color: #1D9E75; font-size: 20px; font-weight: 700;">MicroGRID</span>
        <span style="float: right; font-size: 11px; color: #6b7280;">Task Alert</span>
      </div>
      <div style="border-top: 1px solid #1f2937; padding-top: 20px;">
        <p style="margin: 0 0 12px; font-size: 14px;">Hi ${firstName},</p>
        <p style="margin: 0 0 16px; font-size: 14px;">
          A task on <strong style="color: white;">${safeProjectName}</strong> needs your attention:
        </p>
        <div style="background: #1f2937; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid ${statusColor};">
          <div style="font-size: 13px; font-weight: 600; color: white; margin-bottom: 4px;">${safeTaskName}</div>
          <div style="font-size: 12px;">
            <span style="color: ${statusColor}; font-weight: 600;">${statusLabel}</span>
            ${safeReason ? `<span style="color: #9ca3af;"> — ${safeReason}</span>` : ''}
          </div>
        </div>
        <div style="margin-top: 20px;">
          <a href="${appUrl}/queue?search=${safeProjectId}" style="background: #1D9E75; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            View in Queue
          </a>
        </div>
      </div>
      <div style="border-top: 1px solid #1f2937; margin-top: 24px; padding-top: 12px;">
        <span style="font-size: 11px; color: #4b5563;">MicroGRID Energy — Automated alert</span>
      </div>
    </div>
  `

  const ok = await sendEmail(
    email,
    `${statusLabel}: ${taskName} on ${projectName}`,
    html,
  )

  return NextResponse.json({ sent: ok })
}
