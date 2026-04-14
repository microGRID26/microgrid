import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

import { rateLimit } from '@/lib/rate-limit'

const ALLOWED_ROLES = new Set(['admin', 'super_admin', 'manager', 'finance'])
const VALID_STATUSES = new Set(['pending', 'deployed', 'invoiced', 'recovered', 'voided'])

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
 * PATCH /api/warranty/[id]
 *
 * Update a warranty claim. Supported fields:
 *   status               — advance the lifecycle
 *   deployed_epc_id      — set when deploying a replacement EPC
 *   claim_amount         — set when the invoiced cost is known
 *   notes                — append/replace notes
 *
 * When status transitions to 'invoiced' and claim_amount is provided,
 * automatically creates a funding_deduction row for the original EPC
 * so the amount will be netted from their next EPC → EDGE invoice.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { success: rl } = await rateLimit(`warranty-patch:${ip}`, { max: 30, windowMs: 60_000 })
  if (!rl) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const session = await getSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Load current claim to validate transition
  const { data: current, error: loadErr } = await session.supabase
    .from('workmanship_claims')
    .select('id, status, original_epc_id, claim_amount')
    .eq('id', id)
    .single()
  if (loadErr || !current) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
  }
  const claim = current as {
    id: string
    status: string
    original_epc_id: string
    claim_amount: number | null
  }

  const updates: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status as string)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }
  if (body.deployed_epc_id !== undefined) {
    updates.deployed_epc_id = body.deployed_epc_id
    updates.deployed_at = new Date().toISOString()
  }
  if (body.claim_amount !== undefined) {
    const amt = Number(body.claim_amount)
    if (isNaN(amt) || amt <= 0) {
      return NextResponse.json({ error: 'claim_amount must be a positive number' }, { status: 400 })
    }
    updates.claim_amount = amt
  }
  if (body.notes !== undefined) {
    updates.notes = typeof body.notes === 'string' ? body.notes.trim() : null
  }

  const { data: updated, error: updateErr } = await session.supabase
    .from('workmanship_claims')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (updateErr) {
    console.error('[PATCH /api/warranty/:id]', updateErr.message)
    return NextResponse.json({ error: 'Failed to update warranty claim' }, { status: 500 })
  }

  // When the claim reaches 'invoiced' status and has a claim_amount,
  // auto-create a funding_deduction so it's queued for netting on the
  // EPC's next payment. Uses service-role client to bypass RLS on insert
  // (the claim itself is already authed above).
  const newStatus = (updates.status ?? claim.status) as string
  const newAmount = (updates.claim_amount ?? claim.claim_amount) as number | null

  if (newStatus === 'invoiced' && newAmount && newAmount > 0) {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
    const { error: deductErr } = await adminClient
      .from('funding_deductions')
      .upsert(
        {
          target_epc_id: claim.original_epc_id,
          source_claim_id: id,
          amount: newAmount,
          status: 'open',
          created_by_id: session.userId,
          notes: `Auto-created from warranty claim ${id} reaching invoiced status.`,
        },
        { onConflict: 'source_claim_id', ignoreDuplicates: false },
      )
    if (deductErr) {
      // Non-fatal: log it but don't fail the claim update
      console.error('[warranty] failed to upsert funding_deduction:', deductErr.message)
    }
  }

  return NextResponse.json({ claim: updated })
}

/**
 * GET /api/warranty/[id]
 *
 * Fetch a single warranty claim with its funding_deductions.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { success: rl } = await rateLimit(`warranty-get:${ip}`, { max: 60, windowMs: 60_000 })
  if (!rl) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  const session = await getSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const [claimRes, deductionsRes] = await Promise.all([
    session.supabase
      .from('workmanship_claims')
      .select(`
        id, project_id, claim_date, description, work_required,
        claim_amount, status, notes, created_at, updated_at,
        deployed_at,
        original_epc:organizations!original_epc_id(id, name, slug),
        deployed_epc:organizations!deployed_epc_id(id, name, slug),
        project:projects!project_id(id, job_number, customer_name, city, state)
      `)
      .eq('id', id)
      .single(),
    session.supabase
      .from('funding_deductions')
      .select('id, amount, status, applied_at, applied_to_invoice_id, notes')
      .eq('source_claim_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (claimRes.error || !claimRes.data) {
    return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
  }

  return NextResponse.json({
    claim: claimRes.data,
    deductions: deductionsRes.data ?? [],
  })
}
