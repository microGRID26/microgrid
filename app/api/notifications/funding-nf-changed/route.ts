import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { sendEmailDetailed } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/notifications/funding-nf-changed
 *
 * Session-cookie authenticated only — there is no cron/machine path. The route is
 * called exclusively from the /funding page UI (finance-only, server-gated upstream)
 * and so receives a JWT cookie on every request.
 *
 * Hard requirements (post R1+R2):
 *  - Actor MUST be finance+ (matches the /funding page server-side gate).
 *  - Project MUST exist (404, never an existence-oracle 500).
 *  - State verification: project_funding.nonfunded_code_<slot> MUST equal `newCode`.
 *  - For `clear` action: a prior audit row matching `oldCode` MUST exist for this
 *    (project, slot) — prevents an attacker from triggering arbitrary cleanup
 *    notifications for codes that were never set.
 *  - Idempotency: app-level dedupe via SELECT and DB-level via unique index with
 *    `nulls not distinct` (migration 186). 23505 conflicts are caught and returned
 *    as a 200 deduped success.
 *  - Rate limits: per-actor (200/min) AND per-actor-per-project (60/min).
 *  - All audit writes go through the user-scoped client so RLS fires.
 *  - PG error messages are NEVER echoed in the response body.
 */

type Body = {
  projectId: string
  slot: 1 | 2 | 3
  action: 'add' | 'update' | 'clear'
  oldCode?: string | null
  newCode?: string | null
}

const FINANCE_ROLES = new Set(['finance', 'admin', 'super_admin'])

export async function POST(req: Request) {
  // CSRF: any non-empty value of the custom header counts (security comes from
  // "non-CORS-safelisted header therefore preflight required," not from value match).
  if (!(req.headers.get('x-mg-csrf') ?? '').trim()) {
    return NextResponse.json({ error: 'Missing CSRF header' }, { status: 403 })
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const serviceKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  // Use the SSR client so the chunked Supabase auth cookies are parsed correctly.
  // The bare `createClient(url, anon, {headers:{cookie}})` shape does NOT parse
  // `sb-<ref>-auth-token.{0,1}` split cookies and silently 401s.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actorEmail = user.email.toLowerCase()

  let body: Body
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { projectId, slot, action } = body
  const oldCode = body.oldCode || null
  const newCode = body.newCode || null
  if (!projectId || (slot !== 1 && slot !== 2 && slot !== 3)) {
    return NextResponse.json({ error: 'Missing or invalid projectId/slot' }, { status: 400 })
  }
  if (action !== 'add' && action !== 'update' && action !== 'clear') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const svc = createClient(supabaseUrl, serviceKey)

  // Resolve actor with EXACT-match (lowercased) — never ILIKE (R2#H1: `_` is a wildcard
  // and a valid email char, leading to wrong-row matches and possible privilege
  // resolution against a different user's role).
  const { data: actorRow } = await svc
    .from('users')
    .select('id, role')
    .eq('email', actorEmail)
    .eq('active', true)
    .maybeSingle()
  const actorId = (actorRow as { id: string; role: string | null } | null)?.id ?? null
  const actorRole = (actorRow as { id: string; role: string | null } | null)?.role ?? null
  if (!actorId || !actorRole || !FINANCE_ROLES.has(actorRole)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Rate limits — per-actor + per-actor-per-project.
  for (const { key, max } of [
    { key: `nf-changed:user:${actorId}`, max: 200 },
    { key: `nf-changed:user-project:${actorId}:${projectId}`, max: 60 },
  ]) {
    const { success: ok } = await rateLimit(key, { windowMs: 60_000, max, prefix: 'nf-changed' })
    if (!ok) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Project existence — 404 not 500 so we don't doubly-leak via FK-error 500.
  const { data: project } = await svc
    .from('projects')
    .select('id, name, financier, ahj')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // State verification: confirm the requested newCode matches what's actually saved.
  const slotField = `nonfunded_code_${slot}` as const
  const { data: pf } = await svc
    .from('project_funding')
    .select(`project_id, ${slotField}`)
    .eq('project_id', projectId)
    .maybeSingle()
  const currentCode = ((pf as Record<string, unknown> | null)?.[slotField] as string | null) ?? null
  if (currentCode !== newCode) {
    return NextResponse.json({ error: 'State mismatch — stale notification skipped' }, { status: 409 })
  }

  // For `clear`: the oldCode being cleared must have been recorded as `notified_at`
  // in funding_nf_changes for this (project, slot) at some point (R2#H3). This blocks
  // an attacker from triggering arbitrary clear-emails for codes that were never set.
  if (action === 'clear') {
    if (!oldCode) {
      return NextResponse.json({ error: 'oldCode required for clear' }, { status: 400 })
    }
    const { data: priorRows } = await svc
      .from('funding_nf_changes')
      .select('id')
      .eq('project_id', projectId)
      .eq('slot', slot)
      .eq('new_code', oldCode)
      .not('notified_at', 'is', null)
      .order('changed_at', { ascending: false })
      .limit(1)
    if (!priorRows || priorRows.length === 0) {
      return NextResponse.json({ sent: 0, reason: 'No prior notification for this code on this slot — clear notification suppressed' })
    }
  }

  const routingCode = action === 'clear' ? oldCode : newCode
  if (!routingCode) {
    return NextResponse.json({ error: 'Missing routing code' }, { status: 400 })
  }

  const { data: codeRow } = await svc
    .from('nonfunded_codes')
    .select('code, master_code, description, responsible_party')
    .eq('code', routingCode)
    .maybeSingle()
  const party = (codeRow as { responsible_party: string | null } | null)?.responsible_party ?? null

  let recipients: string[] = []
  if (party) {
    const { data: emailRows } = await svc
      .from('responsible_party_emails')
      .select('email')
      .eq('responsible_party', party)
    recipients = ((emailRows ?? []) as { email: string }[]).map(r => r.email)
  }

  // App-level dedupe: same (project, slot, action, new_code, changed_by) within last 60s.
  const sinceIso = new Date(Date.now() - 60_000).toISOString()
  let dupQuery = svc
    .from('funding_nf_changes')
    .select('id')
    .eq('project_id', projectId)
    .eq('slot', slot)
    .eq('action', action)
    .eq('changed_by', actorId)
    .gte('changed_at', sinceIso)
  // supabase-js `.eq(col, null)` does NOT match SQL NULL; for a nullable column we
  // must use `.is(col, null)`. Branch explicitly. (R2 Critical#1.)
  dupQuery = newCode === null ? dupQuery.is('new_code', null) : dupQuery.eq('new_code', newCode)
  const { data: dupRows } = await dupQuery.limit(1)
  if (dupRows && dupRows.length > 0) {
    return NextResponse.json({ sent: 0, deduped: true })
  }

  // Audit insert via user-scoped (SSR) client so RLS fires. Cast to any: the
  // `Database` type hasn't been regenerated since migration 186 added this table.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writer = supabaseAuth as any
  const { data: changeRow, error: changeErr } = await writer
    .from('funding_nf_changes')
    .insert({
      project_id: projectId,
      slot,
      action,
      old_code: oldCode,
      new_code: newCode,
      changed_by: actorId,
    })
    .select('id')
    .single()
  if (changeErr || !changeRow) {
    // Catch DB-level idempotency conflict and return 200 deduped (R2#H2). Don't echo
    // the raw PG message — log the code only.
    if (changeErr && (changeErr.code === '23505' || /duplicate key/i.test(changeErr.message))) {
      return NextResponse.json({ sent: 0, deduped: true })
    }
    console.error('[nf-changed] audit insert failed code=', changeErr?.code)
    return NextResponse.json({ error: 'Failed to record change' }, { status: 500 })
  }
  const changeId = (changeRow as { id: string }).id

  if (recipients.length === 0) {
    await svc
      .from('funding_nf_changes')
      .update({ notification_error: party ? `No email mapping for "${party}"` : 'Code has no responsible_party' })
      .eq('id', changeId)
    return NextResponse.json({ sent: false, reason: party ? 'No email for party' : 'No party on code' })
  }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm.gomicrogridenergy.com').trim()
  const verb = action === 'add' ? 'added' : action === 'update' ? 'updated' : 'cleared'
  const projectName = (project as { name?: string } | null)?.name ?? projectId
  const financier = (project as { financier?: string | null } | null)?.financier ?? null
  const ahj = (project as { ahj?: string | null } | null)?.ahj ?? null
  const description = (codeRow as { description?: string | null } | null)?.description ?? ''
  const subject = `NF code ${verb}: ${routingCode} on ${projectName}`

  const codeLabel = action === 'update'
    ? `${esc(oldCode ?? '')} → ${esc(newCode ?? '')}`
    : esc(routingCode)

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #111827; color: #e5e7eb; padding: 32px; border-radius: 12px; border: 1px solid #1f2937;">
      <div style="margin-bottom: 16px;">
        <span style="color: #1D9E75; font-size: 20px; font-weight: 700;">MicroGRID</span>
        <span style="float: right; font-size: 11px; color: #6b7280;">Funding NF Code Alert</span>
      </div>
      <div style="border-top: 1px solid #1f2937; padding-top: 20px;">
        <p style="margin: 0 0 12px; font-size: 14px;">Hi ${esc(party ?? 'team')},</p>
        <p style="margin: 0 0 16px; font-size: 14px;">A non-funded code was <strong style="color: white;">${verb}</strong> on a project that needs your team's attention:</p>
        <div style="background: #1f2937; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #ef4444;">
          <div style="font-size: 13px; font-weight: 600; color: white; margin-bottom: 4px;">${esc(projectName)}</div>
          <div style="font-size: 11px; color: #9ca3af; margin-bottom: 8px;">
            ${esc(projectId)}${financier ? ` &middot; ${esc(financier)}` : ''}${ahj ? ` &middot; ${esc(ahj)}` : ''}
          </div>
          <div style="font-size: 12px;">
            <span style="color: #ef4444; font-weight: 600; font-family: monospace;">${codeLabel}</span>
            ${description ? `<div style="color: #9ca3af; margin-top: 6px;">${esc(description)}</div>` : ''}
          </div>
        </div>
        <div style="margin-top: 20px;">
          <a href="${appUrl}/funding?search=${encodeURIComponent(projectId)}" style="background: #1D9E75; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Open in Funding</a>
        </div>
      </div>
      <div style="border-top: 1px solid #1f2937; margin-top: 24px; padding-top: 12px;">
        <span style="font-size: 11px; color: #4b5563;">MicroGRID Energy &mdash; Funding NF code change</span>
      </div>
    </div>
  `

  const sendResults = await Promise.all(
    recipients.map(addr => sendEmailDetailed(addr, subject, html).then(result => ({ addr, result }))),
  )
  const sent = sendResults.filter(r => r.result === 'sent').map(r => r.addr)
  const skipped = sendResults.filter(r => r.result === 'skipped_dev').map(r => r.addr)
  const failed = sendResults.filter(r => r.result === 'failed').map(r => r.addr)

  await svc
    .from('funding_nf_changes')
    .update({
      notified_at: sent.length > 0 ? new Date().toISOString() : null,
      notified_to: sent,
      notification_error: failed.length > 0
        ? `Failed: ${failed.join(', ')}`
        : (skipped.length > 0 ? `Skipped (dev): ${skipped.join(', ')}` : null),
    })
    .eq('id', changeId)

  return NextResponse.json({ sent: sent.length, failed: failed.length })
}
