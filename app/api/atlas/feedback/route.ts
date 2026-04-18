import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
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

  const { success } = await rateLimit(`atlas-fb:${authUser.id}`, {
    windowMs: 60_000,
    max: 30,
    prefix: 'atlas-fb',
  })
  if (!success) {
    return NextResponse.json({ error: 'Too many feedback submissions' }, { status: 429 })
  }

  let body: { question_id?: unknown; feedback?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const qid = Number(body.question_id)
  const feedback = body.feedback === 'up' || body.feedback === 'down' ? body.feedback : null
  const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null

  if (!Number.isFinite(qid) || qid <= 0 || !feedback) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { error } = await supabase.rpc('atlas_record_feedback', {
    p_question_id: qid,
    p_feedback: feedback,
    p_note: note,
  })
  if (error) {
    console.error('[atlas/feedback] record failed:', error.message)
    return NextResponse.json({ error: 'Failed to record feedback' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
