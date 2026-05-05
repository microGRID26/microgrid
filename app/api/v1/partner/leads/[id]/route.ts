// GET   /api/v1/partner/leads/:id — read
// PATCH /api/v1/partner/leads/:id — update allowed customer-info fields
//
// Scope-checked: must be origination_partner_org_id = caller's org (unless
// platform). Stage + disposition are NOT partner-mutable — that's MG's job.

import { NextResponse } from 'next/server'
import { withPartnerAuth } from '@/lib/partner-api/middleware'
import { partnerApiAdmin } from '@/lib/partner-api/supabase-admin'
import { ApiError } from '@/lib/partner-api/errors'
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
import { validateLeadPatch } from '@/lib/partner-api/leads'

export const runtime = 'nodejs'

const LEAD_FIELDS = `
  id, name, stage, stage_date, sale_date, disposition,
  address, city, zip,
  systemkw, dealer,
  email, phone,
  origination_partner_org_id, origination_partner_actor_id,
  partner_documents,
  created_at
`

async function loadScopedLead(
  id: string,
  orgId: string,
  isPlatform: boolean,
): Promise<Record<string, unknown> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = partnerApiAdmin() as any
  const { data, error } = await sb
    .from('projects')
    .select(LEAD_FIELDS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ApiError('internal_error', error.message)
  if (!data) return null
  const row = data as { origination_partner_org_id: string | null }
  if (!isPlatform && row.origination_partner_org_id !== orgId) return null
  return data as Record<string, unknown>
}

export const GET = withPartnerAuth(
  { scopes: ['leads:read'], category: 'read' },
  async (_req, ctx, routeCtx: { params: Promise<{ id: string }> }) => {
    const { id } = await routeCtx.params
    if (!id) throw new ApiError('invalid_request', 'id required')
    const row = await loadScopedLead(id, ctx.orgId, ctx.orgType === 'platform')
    if (!row) throw new ApiError('not_found', 'Lead not found or not accessible to this org')
    const redacted = redactCustomerFields(row, ctx.customerPiiScope)
    return NextResponse.json({ data: redacted }, { headers: { 'X-Request-Id': ctx.requestId } })
  },
)

export const PATCH = withPartnerAuth(
  { scopes: ['leads:write'], category: 'write', requireActor: true },
  async (req, ctx, routeCtx: { params: Promise<{ id: string }> }) => {
    const { id } = await routeCtx.params
    if (!id) throw new ApiError('invalid_request', 'id required')

    const raw = await req.text()
    enforceRawBodyLimit(raw) // #502 R1 H1
    let parsed: unknown
    try {
      parsed = raw ? JSON.parse(raw) : {}
    } catch {
      throw new ApiError('invalid_request', 'Body must be valid JSON')
    }
    const { updates, ignored } = validateLeadPatch(parsed)

    // Idempotency optional on PATCH.
    const idempKey = extractIdempotencyKey(req.headers)
    const reqHash = bodyHash(raw)
    if (idempKey) {
      const prior = await readOrReserve(ctx.keyId, idempKey, reqHash)
      assertPriorBodyMatches(prior, reqHash, idempKey)
      if (prior.cached && prior.response) {
        return NextResponse.json(prior.response.body, {
          status: prior.response.status,
          headers: { 'X-Request-Id': ctx.requestId, 'X-Idempotent-Replay': 'true' },
        })
      }
    }

    const existing = await loadScopedLead(id, ctx.orgId, ctx.orgType === 'platform')
    if (!existing) throw new ApiError('not_found', 'Lead not found or not accessible to this org')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = partnerApiAdmin() as any
    const { data, error } = await sb
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select(LEAD_FIELDS)
      .single()
    if (error) throw new ApiError('internal_error', error.message)

    void emitPartnerEvent('lead.updated', {
      lead_id: id,
      updated_fields: Object.keys(updates),
      actor_external_id: ctx.actorExternalId,
    })

    const payload = {
      data: redactCustomerFields(data as Record<string, unknown>, ctx.customerPiiScope),
      ...(ignored.length > 0 ? { ignored_fields: ignored } : {}),
    }
    if (idempKey) {
      await recordResponse(ctx.keyId, idempKey, 200, payload)
    }
    return NextResponse.json(payload, { headers: { 'X-Request-Id': ctx.requestId } })
  },
)
