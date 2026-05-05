// GET  /api/v1/partner/leads — list partner-originated leads (cursor paged)
// POST /api/v1/partner/leads — create a new lead (project row, stage=evaluation)
//
// Actor header (X-MG-Actor) REQUIRED on POST so we can attribute the rep.
// Idempotency key REQUIRED on POST to prevent duplicate leads on retry.

import { NextResponse } from 'next/server'
import { withPartnerAuth } from '@/lib/partner-api/middleware'
import { partnerApiAdmin } from '@/lib/partner-api/supabase-admin'
import { ApiError } from '@/lib/partner-api/errors'
import { parseLimit, decodeCursor, buildListResponse } from '@/lib/partner-api/pagination'
import { redactCustomerFields } from '@/lib/partner-api/pii'
import {
  extractIdempotencyKey,
  bodyHash,
  readOrReserve,
  recordResponse,
  assertPriorBodyMatches,
} from '@/lib/partner-api/idempotency'
import { enforceRawBodyLimit } from '@/lib/partner-api/limits'
import { emitPartnerEvent } from '@/lib/partner-api/events/emit'
import { validateLeadCreate, generateLeadId } from '@/lib/partner-api/leads'

export const runtime = 'nodejs'

// Same canonical MG Energy id used everywhere in the codebase; new partner
// leads roll up under MG's EPC tenant by default. Partner attribution lives
// separately in origination_partner_org_id.
const MG_ENERGY_ORG_ID = 'a0000000-0000-0000-0000-000000000001'

const LEAD_FIELDS = `
  id, name, stage, stage_date, sale_date, disposition,
  address, city, zip,
  systemkw, dealer,
  email, phone,
  origination_partner_org_id, origination_partner_actor_id,
  partner_documents,
  created_at
`

// ── GET list ─────────────────────────────────────────────────────────────────

export const GET = withPartnerAuth(
  { scopes: ['leads:read'], category: 'read' },
  async (req, ctx) => {
    const url = new URL(req.url)
    const limit = parseLimit(url.searchParams.get('limit'))
    const cursor = decodeCursor(url.searchParams.get('cursor'))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = partnerApiAdmin() as any
    let q = sb
      .from('projects')
      .select(LEAD_FIELDS)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (ctx.orgType !== 'platform') {
      q = q.eq('origination_partner_org_id', ctx.orgId)
    }
    if (cursor) {
      q = q.or(`created_at.lt.${cursor.t},and(created_at.eq.${cursor.t},id.lt.${cursor.id})`)
    }

    const { data, error } = await q
    if (error) throw new ApiError('internal_error', error.message)
    const rows = ((data as Array<{ id: string; created_at: string }> | null) ?? [])
      .map((r) => redactCustomerFields(r as Record<string, unknown> & { id: string; created_at: string }, ctx.customerPiiScope))
    const list = buildListResponse(rows, limit)
    return NextResponse.json(list, { headers: { 'X-Request-Id': ctx.requestId } })
  },
)

// ── POST create ──────────────────────────────────────────────────────────────

export const POST = withPartnerAuth(
  { scopes: ['leads:create'], category: 'write', requireActor: true },
  async (req, ctx) => {
    const raw = await req.text()
    // Pre-parse body-size cap (#502 R1 H1). Without this, a partner can
    // sustain CPU + GC pressure by POSTing 4 MB junk bodies that pass
    // validateLeadCreate (unknown fields are ignored) but spend bodyHash
    // sha256 + JSON.parse cycles regardless.
    enforceRawBodyLimit(raw)
    let parsed: unknown
    try {
      parsed = raw ? JSON.parse(raw) : {}
    } catch {
      throw new ApiError('invalid_request', 'Body must be valid JSON')
    }
    const body = validateLeadCreate(parsed)

    // Idempotency required — retry on a flaky mobile uplink must not create dupes.
    const idempKey = extractIdempotencyKey(req.headers)
    if (!idempKey) {
      throw new ApiError('invalid_request', 'Idempotency-Key header is required on POST /leads')
    }
    const reqHash = bodyHash(raw)
    const prior = await readOrReserve(ctx.keyId, idempKey, reqHash)
    assertPriorBodyMatches(prior, reqHash, idempKey)
    if (prior.cached && prior.response) {
      return NextResponse.json(prior.response.body, {
        status: prior.response.status,
        headers: { 'X-Request-Id': ctx.requestId, 'X-Idempotent-Replay': 'true' },
      })
    }

    // Resolve actor id from the X-MG-Actor header (middleware already
    // verified the external_id matches an active partner_actors row).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = partnerApiAdmin() as any
    const { data: actorRow } = await sb
      .from('partner_actors')
      .select('id')
      .eq('org_id', ctx.orgId)
      .eq('external_id', ctx.actorExternalId)
      .maybeSingle()
    const actorId = (actorRow as { id: string } | null)?.id ?? null

    const id = generateLeadId()
    const now = new Date().toISOString()
    const insertRow: Record<string, unknown> = {
      id,
      name: body.name,
      address: body.address,
      city: body.city,
      zip: body.zip,
      phone: body.phone,
      email: body.email,
      systemkw: body.systemkw,
      dealer: body.dealer,
      sale_date: body.sale_date,
      stage: 'evaluation',
      disposition: body.sale_date ? 'Sale' : null,
      org_id: MG_ENERGY_ORG_ID,
      origination_partner_org_id: ctx.orgId,
      origination_partner_actor_id: actorId,
      created_at: now,
    }

    const { data: inserted, error: insertErr } = await sb
      .from('projects')
      .insert(insertRow)
      .select(LEAD_FIELDS)
      .single()
    if (insertErr) throw new ApiError('internal_error', insertErr.message)

    void emitPartnerEvent('lead.created', {
      lead_id: id,
      origination_partner_org_id: ctx.orgId,
      origination_partner_actor_external_id: ctx.actorExternalId,
      stage: 'evaluation',
      sale_date: body.sale_date ?? null,
    })

    const payload = {
      data: redactCustomerFields(inserted as Record<string, unknown>, ctx.customerPiiScope),
    }
    await recordResponse(ctx.keyId, idempKey, 201, payload)
    return NextResponse.json(payload, {
      status: 201,
      headers: { 'X-Request-Id': ctx.requestId },
    })
  },
)
