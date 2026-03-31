import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'

/**
 * POST /api/notifications/stuck-task
 *
 * Sends an email to the PM when a task enters Pending Resolution or Revision Required.
 * Called fire-and-forget from useProjectTasks automation chain.
 *
 * Body: { projectId, projectName, taskName, status, reason, pmEmail, pmName }
 */
export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  let body: {
    projectId: string
    projectName: string
    taskName: string
    status: string
    reason?: string
    pmEmail?: string
    pmName?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { projectId, projectName, taskName, status, reason, pmEmail, pmName } = body

  if (!projectId || !taskName || !status) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // If no PM email provided, look it up
  let email = pmEmail
  let name = pmName ?? 'PM'

  if (!email) {
    const supabase = createClient(supabaseUrl, serviceKey)
    const { data: project } = await supabase
      .from('projects')
      .select('pm, pm_id')
      .eq('id', projectId)
      .single()

    if (project?.pm_id) {
      const { data: user } = await supabase
        .from('users')
        .select('email, name')
        .eq('id', project.pm_id)
        .single()

      email = (user as { email: string; name: string } | null)?.email
      name = (user as { email: string; name: string } | null)?.name ?? project?.pm ?? 'PM'
    }
  }

  if (!email) {
    return NextResponse.json({ sent: false, reason: 'No PM email found' })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://microgrid-crm.vercel.app'
  const isRevision = status === 'Revision Required'
  const statusColor = isRevision ? '#f59e0b' : '#ef4444'
  const statusLabel = isRevision ? 'Revision Required' : 'Pending Resolution'
  const firstName = name.split(' ')[0]

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #111827; color: #e5e7eb; padding: 32px; border-radius: 12px; border: 1px solid #1f2937;">
      <div style="margin-bottom: 16px;">
        <span style="color: #1D9E75; font-size: 20px; font-weight: 700;">MicroGRID</span>
        <span style="float: right; font-size: 11px; color: #6b7280;">Task Alert</span>
      </div>
      <div style="border-top: 1px solid #1f2937; padding-top: 20px;">
        <p style="margin: 0 0 12px; font-size: 14px;">Hi ${firstName},</p>
        <p style="margin: 0 0 16px; font-size: 14px;">
          A task on <strong style="color: white;">${projectName}</strong> needs your attention:
        </p>
        <div style="background: #1f2937; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid ${statusColor};">
          <div style="font-size: 13px; font-weight: 600; color: white; margin-bottom: 4px;">${taskName}</div>
          <div style="font-size: 12px;">
            <span style="color: ${statusColor}; font-weight: 600;">${statusLabel}</span>
            ${reason ? `<span style="color: #9ca3af;"> — ${reason}</span>` : ''}
          </div>
        </div>
        <div style="margin-top: 20px;">
          <a href="${appUrl}/queue?search=${projectId}" style="background: #1D9E75; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
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
