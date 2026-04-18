import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
    },
  )

  const { data: authData } = await supabase.auth.getUser()
  const authUser = authData?.user
  if (!authUser?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { success } = await rateLimit(`atlas-esc:${authUser.id}`, {
    windowMs: 60 * 60_000,
    max: 10,
    prefix: 'atlas-esc',
  })
  if (!success) {
    return NextResponse.json({ error: 'Too many escalations this hour' }, { status: 429 })
  }

  let body: { question_id?: unknown; question?: unknown; note?: unknown; page_path?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const qid = Number(body.question_id)
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2000) : ''
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
  const pagePath = typeof body.page_path === 'string' ? body.page_path.slice(0, 200) : ''

  if (!question || question.length < 3) {
    return NextResponse.json({ error: 'Question too short' }, { status: 400 })
  }

  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.error('[atlas/escalate] service key not configured')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  const title = `Employee question from ${authUser.email}: ${question.slice(0, 80)}${question.length > 80 ? '…' : ''}`
  const bodyMd = [
    `**Asked by:** ${authUser.email}`,
    pagePath ? `**Page:** ${pagePath}` : null,
    '',
    '**Question:**',
    question,
    note ? `\n**Additional context from user:**\n${note}` : null,
    '',
    '**How to close:** answer via `atlas_answer_greg_action` — the user gets the reply in-app next time they open Ask Atlas.',
  ].filter(Boolean).join('\n')

  const { data: actionId, error: rpcError } = await admin.rpc('atlas_add_greg_action', {
    p_priority: 'question',
    p_title: title,
    p_body_md: bodyMd,
    p_source_session: 'ask-atlas-widget',
    p_effort_estimate: '5min',
    p_tags: ['ask-atlas', 'employee-question'],
  })

  if (rpcError || actionId == null) {
    console.error('[atlas/escalate] rpc failed:', rpcError?.message)
    return NextResponse.json({ error: 'Failed to escalate' }, { status: 500 })
  }

  if (Number.isFinite(qid) && qid > 0) {
    await admin
      .from('atlas_questions')
      .update({
        escalated: true,
        escalated_action_id: actionId,
      })
      .eq('id', qid)
      .eq('user_email', authUser.email)
  }

  return NextResponse.json({ ok: true, action_id: actionId })
}
