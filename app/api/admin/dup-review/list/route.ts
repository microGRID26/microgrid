// GET /api/admin/dup-review/list — paginated list of flagged duplicates
// joined to their canonical winner. Action #807, Phase 1.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireStrictAdmin } from '@/lib/admin/require-strict-admin'

export const runtime = 'nodejs'

const PAGE_SIZE = 25

export async function GET(request: NextRequest) {
  const gate = await requireStrictAdmin(request)
  if (!gate.ok) return gate.response

  const { searchParams } = new URL(request.url)
  const pageRaw = parseInt(searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1
  const from = (page - 1) * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1

  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ error: 'Service-role key not configured' }, { status: 500 })
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey)

  const projectCols = 'id, name, address, email, phone, stage, disposition, sale_date, contract, systemkw, module, module_qty, inverter, inverter_qty, battery, battery_qty, financier, consultant, subhub_id, created_at, dup_canonical_id'

  const { data: losers, count, error } = await db
    .from('projects')
    .select(projectCols, { count: 'exact' })
    .eq('dup_review_pending', true)
    .order('created_at', { ascending: false })
    .range(from, to)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const loserRows = (losers ?? []) as Array<{ dup_canonical_id: string | null }>

  // Bulk-fetch the canonicals in one round-trip.
  const canonicalIds = Array.from(
    new Set(loserRows.map((l) => l.dup_canonical_id).filter((id): id is string => !!id)),
  )
  const { data: winners } = canonicalIds.length > 0
    ? await db.from('projects').select(projectCols).in('id', canonicalIds)
    : { data: [] as unknown[] }
  const winnersById = new Map<string, unknown>()
  for (const w of (winners ?? []) as Array<{ id: string }>) {
    winnersById.set(w.id, w)
  }

  const pairs = loserRows.map((loser) => ({
    loser,
    winner: loser.dup_canonical_id ? winnersById.get(loser.dup_canonical_id) ?? null : null,
  }))

  return NextResponse.json({
    data: { page, page_size: PAGE_SIZE, total: count ?? 0, pairs },
  })
}
