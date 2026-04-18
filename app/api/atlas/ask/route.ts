import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { rateLimit } from '@/lib/rate-limit'

const HIGH_CONF = 0.55
const LOW_CONF = 0.25

type KbHit = {
  id: number
  title: string
  answer_md: string
  owner: string | null
  source_of_truth: string | null
  escalation_conditions: string | null
  similarity: number
}

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

  const { success } = await rateLimit(`atlas-ask:${authUser.id}`, {
    windowMs: 60_000,
    max: 20,
    prefix: 'atlas-ask',
  })
  if (!success) {
    return NextResponse.json({ error: 'Too many questions. Slow down a moment.' }, { status: 429 })
  }

  let body: { question?: unknown; page_path?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  const pagePath = typeof body.page_path === 'string' ? body.page_path.slice(0, 200) : null
  if (!question || question.length < 3) {
    return NextResponse.json({ error: 'Question too short' }, { status: 400 })
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: 'Question too long (max 2000 chars)' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('email', authUser.email)
    .single()
  const role = ((profile as { role?: string } | null)?.role ?? 'user') as string

  const { data: hitsRaw, error: searchError } = await supabase.rpc('atlas_kb_search_text', {
    p_query: question,
    p_user_role: role,
    p_limit: 5,
  })
  if (searchError) {
    console.error('[atlas/ask] kb search failed:', searchError.message)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  const hits = (hitsRaw ?? []) as KbHit[]
  const top = hits[0]
  const topSim = top?.similarity ?? 0

  const confidence: 'high' | 'medium' | 'low' =
    topSim >= HIGH_CONF ? 'high' : topSim >= LOW_CONF ? 'medium' : 'low'

  const answer =
    top && confidence !== 'low'
      ? top.answer_md
      : null

  const citations = hits.slice(0, 3).map((h) => ({
    id: h.id,
    title: h.title,
    owner: h.owner,
    source_of_truth: h.source_of_truth,
    similarity: Number(h.similarity.toFixed(3)),
  }))

  const { data: logged, error: logError } = await supabase
    .from('atlas_questions')
    .insert({
      user_id: authUser.id,
      user_email: authUser.email,
      user_role: role,
      question,
      answer,
      citations,
      confidence,
      page_path: pagePath,
      answered_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (logError) {
    console.error('[atlas/ask] log insert failed:', logError.message)
  }

  return NextResponse.json({
    id: (logged as { id?: number } | null)?.id ?? null,
    answer,
    citations,
    confidence,
    escalation_suggested: confidence === 'low',
  })
}
