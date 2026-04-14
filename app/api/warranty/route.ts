import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { rateLimit } from '@/lib/rate-limit'

const ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'finance'])

async function getSessionUser(request: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return request.cookies.getAll() }, setAll() {} } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null
  const { data: userRow } = await supabase
    .from('users')
    .select('role, id')
    .eq('email', user.email)
    .single()
  const row = userRow as { role: string; id: string } | null
  if (!row || !ALLOWED_ROLES.has(row.role)) return null
  return { user, role: row.role, userId: row.id, supabase }
}

/**
 * GET /api/warranty
 *
 * List warranty claims. Optional query params:
 *   ?status=pending|deployed|invoiced|recovered|voided
 *   ?epc_id=<org_uuid>
 *   ?limit=50
 *
 * Returns claims joined with project + org names for display.
 */
export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { success } = await rateLimit(`warranty-list:${ip}`, { max: 60, windowMs: 60_000 })
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const session = await getSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const epcId = searchParams.get('epc_id')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 200)

  let query = session.supabase
    .from('workmanship_claims')
    .select(`
      id, project_id, claim_date, description, work_required,
      claim_amount, status, notes, created_at, updated_at,
      original_epc:organizations!original_epc_id(id, name, slug),
      deployed_epc:organizations!deployed_epc_id(id, name, slug),
      project:projects!project_id(id, job_number, customer_name, city, state)
    `)
    .order('claim_date', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (epcId) query = query.eq('original_epc_id', epcId)

  const { data, error } = await query
  if (error) {
    console.error('[GET /api/warranty]', error.message)
    return NextResponse.json({ error: 'Failed to load warranty claims' }, { status: 500 })
  }

  return NextResponse.json({ claims: data ?? [] })
}

/**
 * POST /api/warranty
 *
 * Create a new warranty claim. Body:
 *   { project_id, original_epc_id, claim_date?, description, work_required, notes? }
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { success } = await rateLimit(`warranty-create:${ip}`, { max: 20, windowMs: 60_000 })
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const session = await getSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { project_id, original_epc_id, claim_date, description, work_required, notes } = body

  if (!project_id || typeof project_id !== 'string') {
    return NextResponse.json({ error: 'project_id required' }, { status: 400 })
  }
  if (!original_epc_id || typeof original_epc_id !== 'string') {
    return NextResponse.json({ error: 'original_epc_id required' }, { status: 400 })
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return NextResponse.json({ error: 'description required' }, { status: 400 })
  }
  if (!work_required || typeof work_required !== 'string' || !work_required.trim()) {
    return NextResponse.json({ error: 'work_required required' }, { status: 400 })
  }

  const { data, error } = await session.supabase
    .from('workmanship_claims')
    .insert({
      project_id,
      original_epc_id,
      claim_date: claim_date ?? new Date().toISOString().slice(0, 10),
      description: description.trim(),
      work_required: work_required.trim(),
      notes: typeof notes === 'string' ? notes.trim() : null,
      status: 'pending',
      created_by_id: session.userId,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/warranty]', error.message)
    return NextResponse.json({ error: 'Failed to create warranty claim' }, { status: 500 })
  }

  return NextResponse.json({ claim: data }, { status: 201 })
}
