import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { SLA_THRESHOLDS, INTERNAL_DOMAINS } from '@/lib/utils'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nova.gomicrogridenergy.com'

/**
 * GET /api/email/digest
 *
 * Sends a morning digest email to each active PM with their portfolio summary:
 * - Blocked projects count + names
 * - Follow-ups due today
 * - Stuck tasks (Pending Resolution / Revision Required)
 * - SLA status (critical/at-risk/on-track counts)
 * - Today's scheduled jobs
 *
 * Auth: CRON_SECRET bearer token required.
 * Schedule: Weekdays at 7 AM CT (12:00 UTC) via Vercel cron.
 */
export async function GET(req: Request) {
  // Rate limit: 10 requests per minute per endpoint
  const { success } = await rateLimit('email-digest', { max: 10, prefix: 'email-digest' })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const provided = authHeader?.replace('Bearer ', '') ?? ''
  let cronMatch = false
  try {
    cronMatch = provided.length === cronSecret.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(cronSecret))
  } catch { cronMatch = false }
  if (!cronMatch) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const fleetStartedAt = new Date()
  let fleetStatus: FleetRunStatus = 'success'
  let fleetItems: number | null = 0
  let fleetSummary: string | null = null
  let fleetError: string | null = null

  try {

  // Load active PMs (users with role >= manager who are active)
  const { data: users, error: usersErr } = await supabase
    .from('users')
    .select('id, name, email, role')
    .eq('active', true)
    .in('role', ['super_admin', 'admin', 'finance', 'manager', 'user'])
    .limit(200)

  if (usersErr || !users) {
    console.error('[digest] users query failed:', usersErr?.message)
    fleetStatus = 'error'
    fleetError = `Users query failed: ${usersErr?.message ?? 'null result'}`
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
  }

  // Filter to users with internal company emails
  const pms = (users as { id: string; name: string; email: string; role: string }[])
    .filter(u => u.email && INTERNAL_DOMAINS.some(d => u.email.includes(`@${d}`)))

  if (pms.length === 0) {
    fleetSummary = 'No PMs to notify'
    return NextResponse.json({ sent: 0, message: 'No PMs to notify' })
  }

  // Load active projects (not In Service, Loyalty, or Cancelled)
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, stage, stage_date, pm, pm_id, blocker, disposition, follow_up_date, contract')
    .or('disposition.is.null,disposition.eq.Sale')
    .neq('stage', 'complete')
    .limit(2000)

  const allProjects = (projects ?? []) as {
    id: string; name: string; stage: string; stage_date: string | null
    pm: string | null; pm_id: string | null; blocker: string | null
    disposition: string | null; follow_up_date: string | null; contract: number | null
  }[]

  // Load stuck tasks
  const { data: stuckTasks } = await supabase
    .from('task_state')
    .select('project_id, task_id, status, reason')
    .in('status', ['Pending Resolution', 'Revision Required'])
    .limit(5000)

  const stuckByProject = new Map<string, { task_id: string; status: string; reason: string | null }[]>()
  for (const t of (stuckTasks ?? []) as { project_id: string; task_id: string; status: string; reason: string | null }[]) {
    const list = stuckByProject.get(t.project_id) ?? []
    list.push(t)
    stuckByProject.set(t.project_id, list)
  }

  // Load today's schedule
  const today = new Date().toISOString().split('T')[0]
  const { data: schedule } = await supabase
    .from('schedule')
    .select('project_id, crew, job_type, date, time, notes')
    .eq('date', today)
    .limit(500)

  const scheduleByPm = new Map<string, typeof schedule>()
  // We'll match schedule to PM via project_id → project → pm_id
  const projectPmMap = new Map<string, string>()
  for (const p of allProjects) {
    if (p.pm_id) projectPmMap.set(p.id, p.pm_id)
  }
  for (const s of (schedule ?? []) as { project_id: string; crew: string; job_type: string; date: string; time: string | null; notes: string | null }[]) {
    const pmId = projectPmMap.get(s.project_id)
    if (!pmId) continue
    const list = scheduleByPm.get(pmId) ?? []
    list.push(s)
    scheduleByPm.set(pmId, list)
  }

  // Load follow-up tasks due today
  const { data: followUps } = await supabase
    .from('task_state')
    .select('project_id, task_id, follow_up_date')
    .eq('follow_up_date', today)
    .limit(1000)

  const followUpsByProject = new Map<string, string[]>()
  for (const f of (followUps ?? []) as { project_id: string; task_id: string }[]) {
    const list = followUpsByProject.get(f.project_id) ?? []
    list.push(f.task_id)
    followUpsByProject.set(f.project_id, list)
  }

  // Send digest to each PM
  let sent = 0
  const errors: string[] = []

  for (const pm of pms) {
    const myProjects = allProjects.filter(p => p.pm_id === pm.id)
    if (myProjects.length === 0) continue // Skip PMs with no projects

    // Calculate stats
    const blocked = myProjects.filter(p => p.blocker)
    const followUpProjects = myProjects.filter(p =>
      followUpsByProject.has(p.id) || (p.follow_up_date && p.follow_up_date <= today)
    )

    let critCount = 0
    let riskCount = 0
    let onTrack = 0
    for (const p of myProjects) {
      const t = SLA_THRESHOLDS[p.stage] ?? { target: 3, risk: 5, crit: 7 }
      const days = p.stage_date
        ? Math.max(0, Math.floor((Date.now() - new Date(p.stage_date + 'T00:00:00').getTime()) / 86400000))
        : 0
      if (days >= t.crit) critCount++
      else if (days >= t.risk) riskCount++
      else onTrack++
    }

    const stuckCount = myProjects.filter(p => stuckByProject.has(p.id)).length
    const todaySchedule = scheduleByPm.get(pm.id) ?? []
    const portfolioValue = myProjects.reduce((s, p) => s + (p.contract ?? 0), 0)

    // Build email HTML
    const firstName = pm.name?.split(' ')[0] ?? 'PM'
    const html = buildDigestHtml({
      firstName,
      totalProjects: myProjects.length,
      blocked,
      followUpProjects,
      critCount,
      riskCount,
      onTrack,
      stuckCount,
      stuckByProject,
      todaySchedule,
      portfolioValue,
    })

    const ok = await sendEmail(
      pm.email,
      `Morning Briefing: ${blocked.length > 0 ? `${blocked.length} blocked` : `${myProjects.length} projects`} — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
      html,
    )

    if (ok) sent++
    else errors.push(`Failed: ${pm.email}`)
  }

  console.log(`[digest] Sent ${sent} digests, ${errors.length} errors`)
  fleetItems = sent
  fleetSummary = `Sent ${sent} PM digests (${pms.length} PMs, ${errors.length} errors)`
  if (errors.length > 0) fleetStatus = 'partial'
  return NextResponse.json({ sent, errors: errors.length, pmCount: pms.length })
  } catch (err) {
    fleetStatus = 'error'
    fleetError = err instanceof Error ? err.message : String(err)
    console.error('[digest] fatal:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  } finally {
    await reportFleetRun({
      slug: 'mg-email-digest',
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: fleetItems,
      outputSummary: fleetSummary,
      errorMessage: fleetError,
    })
  }
}

// ── Email HTML Builder ──────────────────────────────────────────────────────

interface DigestData {
  firstName: string
  totalProjects: number
  blocked: { id: string; name: string; blocker: string | null }[]
  followUpProjects: { id: string; name: string }[]
  critCount: number
  riskCount: number
  onTrack: number
  stuckCount: number
  stuckByProject: Map<string, { task_id: string; status: string; reason: string | null }[]>
  todaySchedule: { project_id: string; crew: string; job_type: string; time: string | null }[]
  portfolioValue: number
}

function buildDigestHtml(d: DigestData): string {
  const appUrl = APP_URL

  // Stat cards row
  const statCard = (label: string, value: string | number, color: string) =>
    `<td style="padding:8px 12px;background:#1f2937;border-radius:8px;text-align:center;width:25%;">
      <div style="font-size:20px;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:2px;">${label}</div>
    </td>`

  const stats = `<table width="100%" cellpadding="0" cellspacing="4" style="margin:16px 0;">
    <tr>
      ${statCard('Active', d.totalProjects, '#ffffff')}
      ${statCard('Blocked', d.blocked.length, d.blocked.length > 0 ? '#ef4444' : '#6b7280')}
      ${statCard('Critical', d.critCount, d.critCount > 0 ? '#ef4444' : '#6b7280')}
      ${statCard('At Risk', d.riskCount, d.riskCount > 0 ? '#f59e0b' : '#6b7280')}
    </tr>
  </table>`

  // Action items
  const actions: string[] = []

  if (d.blocked.length > 0) {
    const items = d.blocked.slice(0, 5).map(p =>
      `<li style="margin:4px 0;"><a href="${appUrl}/queue?search=${p.id}" style="color:#ef4444;text-decoration:none;">${p.name}</a> <span style="color:#6b7280;">— ${p.blocker}</span></li>`
    ).join('')
    actions.push(`<div style="margin:12px 0;">
      <div style="font-size:11px;font-weight:600;color:#ef4444;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Blocked (${d.blocked.length})</div>
      <ul style="margin:0;padding-left:16px;color:#e5e7eb;font-size:13px;">${items}</ul>
      ${d.blocked.length > 5 ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">+ ${d.blocked.length - 5} more</div>` : ''}
    </div>`)
  }

  if (d.followUpProjects.length > 0) {
    const items = d.followUpProjects.slice(0, 5).map(p =>
      `<li style="margin:4px 0;"><a href="${appUrl}/queue?search=${p.id}" style="color:#f59e0b;text-decoration:none;">${p.name}</a></li>`
    ).join('')
    actions.push(`<div style="margin:12px 0;">
      <div style="font-size:11px;font-weight:600;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Follow-ups Due (${d.followUpProjects.length})</div>
      <ul style="margin:0;padding-left:16px;color:#e5e7eb;font-size:13px;">${items}</ul>
    </div>`)
  }

  if (d.stuckCount > 0) {
    actions.push(`<div style="margin:12px 0;">
      <div style="font-size:11px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Stuck Tasks (${d.stuckCount} projects)</div>
      <div style="font-size:13px;color:#e5e7eb;">Projects with tasks in Pending Resolution or Revision Required status.</div>
    </div>`)
  }

  if (d.todaySchedule.length > 0) {
    const items = d.todaySchedule.slice(0, 5).map(s =>
      `<li style="margin:4px 0;color:#e5e7eb;">${s.job_type.toUpperCase()} — ${s.crew}${s.time ? ` at ${s.time}` : ''}</li>`
    ).join('')
    actions.push(`<div style="margin:12px 0;">
      <div style="font-size:11px;font-weight:600;color:#3b82f6;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Today's Schedule (${d.todaySchedule.length})</div>
      <ul style="margin:0;padding-left:16px;font-size:13px;">${items}</ul>
    </div>`)
  }

  const actionSection = actions.length > 0
    ? actions.join('')
    : `<div style="color:#6b7280;font-size:13px;margin:12px 0;">No urgent action items today. Your portfolio is clean.</div>`

  const portfolioFormatted = d.portfolioValue >= 1000000
    ? `$${(d.portfolioValue / 1000000).toFixed(1)}M`
    : `$${Math.round(d.portfolioValue / 1000)}K`

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:12px;border:1px solid #1f2937;overflow:hidden;">
  <!-- Header -->
  <tr><td style="padding:24px 32px 16px;border-bottom:1px solid #1f2937;">
    <table width="100%"><tr>
      <td><span style="color:#1D9E75;font-size:20px;font-weight:700;letter-spacing:-0.5px;">MicroGRID</span></td>
      <td align="right"><span style="color:#6b7280;font-size:11px;">Morning Briefing</span></td>
    </tr></table>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:28px 32px 32px;color:#e5e7eb;font-size:14px;line-height:1.6;">
    <div style="margin-bottom:16px;">
      <span style="font-size:16px;font-weight:600;color:white;">Good morning, ${d.firstName}</span>
      <span style="color:#6b7280;font-size:13px;"> — ${d.totalProjects} active projects, ${portfolioFormatted} portfolio</span>
    </div>

    ${stats}

    <div style="border-top:1px solid #1f2937;margin:20px 0 16px;"></div>

    <div style="font-size:13px;font-weight:600;color:white;margin-bottom:8px;">Action Items</div>
    ${actionSection}

    <div style="margin-top:24px;">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="background:#1D9E75;border-radius:8px;padding:12px 28px;">
          <a href="${appUrl}/command" style="color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Open Command Center</a>
        </td>
        <td style="padding-left:12px;">
          <a href="${appUrl}/queue" style="color:#1D9E75;font-size:13px;text-decoration:none;">View Queue →</a>
        </td>
      </tr></table>
    </div>
  </td></tr>
  <!-- Footer -->
  <tr><td style="padding:16px 32px;background:#0d1117;border-top:1px solid #1f2937;">
    <table width="100%"><tr>
      <td><span style="color:#4b5563;font-size:11px;">MicroGRID Energy</span></td>
      <td align="right"><span style="color:#4b5563;font-size:11px;">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span></td>
    </tr></table>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}
