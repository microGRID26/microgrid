import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { sendEmailDetailed } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'
import { parseMentions, type MentionableUser } from '@/lib/notes/mentions'

/**
 * POST /api/notifications/note-mention
 *
 * Session-cookie authenticated only. No machine/cron path — note mentions are
 * always user-initiated and there's no legitimate reason for a backend job to
 * spear-phish via this surface (R2 Critical#2).
 *
 * Hard requirements (post R1+R2):
 *  - Server re-parses mentions from `noteText`. Client-supplied user IDs are not
 *    accepted (R1 Critical#1).
 *  - Source ownership is gated:
 *      funding_note    -> actor MUST be finance+ AND project must exist
 *      ticket_comment  -> 501 (not yet wired with a proper ownership model)
 *      project_comment -> 501
 *  - CSRF custom-header check.
 *  - `noteText` capped at 4000 chars to prevent DOS via huge inputs (R2#H5).
 *  - Audit + notification table writes go through the user-scoped client so
 *    RLS fires.
 *  - Mentioned user `active=true` re-validated at insert (R2#H4 deactivation race).
 *  - Audit `notified_at` only stamped on real sends (skipped_dev does not lie).
 *  - Response body intentionally omits `ambiguous`/`total` fields to close the
 *    handle-existence side-channel oracle (R2#M4).
 */

type Body = {
  sourceType: 'funding_note' | 'ticket_comment' | 'project_comment'
  sourceId: string
  sourceMilestone?: 'm1' | 'm2' | 'm3'
  noteText: string
}

const SOURCE_TYPES = new Set(['funding_note', 'ticket_comment', 'project_comment'])
const MILESTONES = new Set(['m1', 'm2', 'm3'])
const FINANCE_ROLES = new Set(['finance', 'admin', 'super_admin'])
const NOTE_TEXT_MAX = 4000
const NOTE_EXCERPT_MAX = 400

export async function POST(req: Request) {
  if (!(req.headers.get('x-mg-csrf') ?? '').trim()) {
    return NextResponse.json({ error: 'Missing CSRF header' }, { status: 403 })
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const serviceKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  // SSR client parses Supabase's chunked auth cookies correctly.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const actorEmail = user.email.toLowerCase()

  let body: Body
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { sourceType, sourceId, sourceMilestone, noteText } = body
  if (!SOURCE_TYPES.has(sourceType)) {
    return NextResponse.json({ error: 'Invalid sourceType' }, { status: 400 })
  }
  if (!sourceId || typeof sourceId !== 'string') {
    return NextResponse.json({ error: 'Missing sourceId' }, { status: 400 })
  }
  if (sourceMilestone && !MILESTONES.has(sourceMilestone)) {
    return NextResponse.json({ error: 'Invalid sourceMilestone' }, { status: 400 })
  }
  if (typeof noteText !== 'string' || noteText.length === 0) {
    return NextResponse.json({ sent: 0 })
  }
  if (noteText.length > NOTE_TEXT_MAX) {
    return NextResponse.json({ error: 'Note too long' }, { status: 400 })
  }

  const svc = createClient(supabaseUrl, serviceKey)

  // Resolve actor — exact lowercase match (no ILIKE — R2#H1).
  const { data: actorRow } = await svc
    .from('users')
    .select('id, name, role')
    .eq('email', actorEmail)
    .eq('active', true)
    .maybeSingle()
  const actorId = (actorRow as { id: string; name: string | null; role: string | null } | null)?.id ?? null
  const actorName = (actorRow as { id: string; name: string | null; role: string | null } | null)?.name ?? null
  const actorRole = (actorRow as { id: string; name: string | null; role: string | null } | null)?.role ?? null
  if (!actorId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let projectName: string | null = null
  if (sourceType === 'funding_note') {
    if (!actorRole || !FINANCE_ROLES.has(actorRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { data: project } = await svc
      .from('projects')
      .select('id, name')
      .eq('id', sourceId)
      .maybeSingle()
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    projectName = (project as { name?: string } | null)?.name ?? null
  } else {
    return NextResponse.json({ error: 'Source type not yet supported' }, { status: 501 })
  }

  for (const { key, max } of [
    { key: `mention:user:${actorId}`, max: 200 },
    { key: `mention:user-source:${actorId}:${sourceType}:${sourceId}`, max: 30 },
  ]) {
    const { success: ok } = await rateLimit(key, { windowMs: 60_000, max, prefix: 'mention' })
    if (!ok) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Authoritative server-side parse. Drops ambiguous + unknown handles.
  const { data: usersData } = await svc
    .from('users')
    .select('id, email, name')
    .eq('active', true)
    .limit(2000)
  const allUsers = ((usersData ?? []) as { id: string; email: string; name: string | null }[])
    .filter(u => !!u.email) as MentionableUser[]
  const resolutions = parseMentions(noteText, allUsers)
  let resolved = resolutions.filter((r): r is { handle: string; userId: string; user: MentionableUser } => r.userId !== null)
  if (resolved.length === 0) {
    return NextResponse.json({ sent: 0 })
  }
  if (resolved.length > 20) resolved = resolved.slice(0, 20)

  // Re-validate target users active=true at insert time to close the deactivation
  // race window (R2#H4).
  const { data: stillActive } = await svc
    .from('users')
    .select('id')
    .in('id', resolved.map(r => r.userId))
    .eq('active', true)
  const activeIds = new Set(((stillActive ?? []) as { id: string }[]).map(r => r.id))
  resolved = resolved.filter(r => activeIds.has(r.userId))
  if (resolved.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  // Cast to any: `Database` type not regenerated since migration 186 added note_mentions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writer = supabaseAuth as any
  const excerpt = noteText.slice(0, NOTE_EXCERPT_MAX)
  const inserts = resolved.map(r => ({
    source_type: sourceType,
    source_id: sourceId,
    source_milestone: sourceMilestone ?? null,
    mentioned_user_id: r.userId,
    mentioned_by: actorId,
    note_excerpt: excerpt,
  }))
  const { data: rows, error: insertErr } = await writer
    .from('note_mentions')
    .insert(inserts)
    .select('id, mentioned_user_id')
  if (insertErr || !rows) {
    console.error('[note-mention] insert failed code=', insertErr?.code)
    return NextResponse.json({ error: 'Failed to record mentions' }, { status: 500 })
  }
  const idByUser = new Map<string, string>(
    (rows as { id: string; mentioned_user_id: string }[]).map(r => [r.mentioned_user_id, r.id]),
  )

  // Also write to mention_notifications — that's the table the bell hook consumes.
  // note_mentions is our audit/email-routing log; mention_notifications is the
  // in-app inbox with read state. Both have to be written or the bell stays empty.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inboxInserts = resolved.map(r => ({
    project_id: sourceId,
    note_id: idByUser.get(r.userId) ?? null,
    mentioned_user_id: r.userId,
    mentioned_by: actorName ?? 'A teammate',
    message: excerpt,
    read: false,
  }))
  const { error: bellErr } = await (writer as any).from('mention_notifications').insert(inboxInserts)
  if (bellErr) {
    // Don't fail the request — the email + audit row already landed. Surface in logs.
    console.error('[note-mention] mention_notifications insert failed code=', bellErr.code)
  }

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm.gomicrogridenergy.com').trim()
  const sourceLabel = 'Funding note'
  const deepLink = `${appUrl}/funding?search=${encodeURIComponent(sourceId)}`

  let sentCount = 0
  await Promise.all(resolved.map(async r => {
    const u = r.user
    const firstName = (u.name ?? u.email).split(' ')[0]
    const subject = `${actorName ?? 'A teammate'} mentioned you${projectName ? ` on ${projectName}` : ''}`
    const html = `
      <div style="font-family: Inter, Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #111827; color: #e5e7eb; padding: 32px; border-radius: 12px; border: 1px solid #1f2937;">
        <div style="margin-bottom: 16px;">
          <span style="color: #1D9E75; font-size: 20px; font-weight: 700;">MicroGRID</span>
          <span style="float: right; font-size: 11px; color: #6b7280;">@-mention</span>
        </div>
        <div style="border-top: 1px solid #1f2937; padding-top: 20px;">
          <p style="margin: 0 0 12px; font-size: 14px;">Hi ${esc(firstName)},</p>
          <p style="margin: 0 0 16px; font-size: 14px;">
            ${esc(actorName ?? 'A teammate')} tagged you in a ${esc(sourceLabel)}${projectName ? ` on <strong style="color: white;">${esc(projectName)}</strong>` : ''}.
          </p>
          <div style="background: #1f2937; border-radius: 8px; padding: 16px; margin: 16px 0; border-left: 4px solid #1D9E75;">
            <div style="font-size: 13px; color: #d1d5db; white-space: pre-wrap;">${esc(excerpt)}</div>
          </div>
          <div style="margin-top: 20px;">
            <a href="${deepLink}" style="background: #1D9E75; color: white; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">Open</a>
          </div>
        </div>
        <div style="border-top: 1px solid #1f2937; margin-top: 24px; padding-top: 12px;">
          <span style="font-size: 11px; color: #4b5563;">MicroGRID Energy &mdash; You were tagged</span>
        </div>
      </div>
    `
    const result = await sendEmailDetailed(u.email, subject, html)
    const id = idByUser.get(u.id)
    if (id) {
      await svc.from('note_mentions').update({
        notified_at: result === 'sent' ? new Date().toISOString() : null,
        notification_error: result === 'failed' ? 'sendEmail failed' : (result === 'skipped_dev' ? 'skipped (dev)' : null),
      }).eq('id', id)
    }
    if (result === 'sent') sentCount++
  }))

  // Response intentionally omits `ambiguous` + `total` to avoid leaking which handles
  // exist or are shared (R2#M4 oracle).
  return NextResponse.json({ sent: sentCount })
}
