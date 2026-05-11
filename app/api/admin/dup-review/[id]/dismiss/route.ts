// POST /api/admin/dup-review/:id/dismiss — mark a flagged project as a
// legitimate distinct deal (clears dup_review_pending + canonical id).
// Action #807, Phase 1.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireStrictAdmin } from '@/lib/admin/require-strict-admin'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireStrictAdmin(request)
  if (!gate.ok) return gate.response

  const { id } = await context.params
  if (!/^PROJ-\d{1,12}$/.test(id)) {
    return NextResponse.json({ error: 'project id must look like PROJ-NNN' }, { status: 400 })
  }

  let note: string | undefined
  try {
    const body = await request.json() as { note?: string }
    note = typeof body.note === 'string' ? body.note.slice(0, 500) : undefined
  } catch {
    // body is optional
  }

  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'Service-role key not configured' }, { status: 500 })
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  const { data, error } = await db.rpc('atlas_dup_review_dismiss', {
    p_loser_id:    id,
    p_actor_email: gate.session.userEmail,
    p_note:        note ?? null,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ data: { log_id: data } })
}
