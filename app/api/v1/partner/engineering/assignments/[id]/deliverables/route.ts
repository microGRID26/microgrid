// POST /api/v1/partner/engineering/assignments/:id/deliverables
//
// v1 shape: partner POSTs {name, url, type} where `url` points at a file they
// already host. We append to the deliverables JSONB array via addDeliverable()
// which also emits an engineering.deliverable.uploaded partner event.
//
// Phase 4 adds presigned Supabase Storage upload URLs so partners can push
// files through us. For v1 we assume the partner has their own storage.

import { NextResponse } from 'next/server'
import { withPartnerAuth } from '@/lib/partner-api/middleware'
import { ApiError } from '@/lib/partner-api/errors'
import { addDeliverable } from '@/lib/api/engineering'
import { partnerApiAdmin } from '@/lib/partner-api/supabase-admin'
import {
  extractIdempotencyKey,
  bodyHash,
  readOrReserve,
  recordResponse,
  assertPriorBodyMatches,
} from '@/lib/partner-api/idempotency'
import { validateOutboundUrl } from '@/lib/partner-api/events/ssrf'
import { enforceRawBodyLimit, validateMetadata } from '@/lib/partner-api/limits'

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_TYPES = new Set(['stamped_pdf', 'structural', 'electrical', 'site_plan', 'other'])

interface DeliverableInput {
  name?: string
  url?: string
  type?: string
  metadata?: Record<string, unknown>
}

export const POST = withPartnerAuth(
  { scopes: ['engineering:assignments:write'], category: 'upload' },
  async (req, ctx, routeCtx: { params: Promise<{ id: string }> }) => {
    const { id } = await routeCtx.params
    if (!UUID_RE.test(id)) throw new ApiError('invalid_request', 'id must be a UUID')

    const raw = await req.text()
    enforceRawBodyLimit(raw) // #502 R1 H1
    let body: DeliverableInput
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      throw new ApiError('invalid_request', 'Body must be valid JSON')
    }

    if (!body.name || typeof body.name !== 'string') {
      throw new ApiError('invalid_request', 'name is required (string)')
    }
    if (!body.url || typeof body.url !== 'string') {
      throw new ApiError('invalid_request', 'url is required (string)')
    }
    if (!body.type || typeof body.type !== 'string') {
      throw new ApiError('invalid_request', 'type is required (string)')
    }
    if (!VALID_TYPES.has(body.type)) {
      throw new ApiError(
        'invalid_request',
        `type must be one of: ${[...VALID_TYPES].join(', ')}`,
      )
    }
    // Reuse the SSRF guard to refuse obvious bad URLs. It's not strictly SSRF
    // (the URL is stored, not fetched) but the same heuristics catch garbage.
    validateOutboundUrl(body.url)
    // Bound metadata depth/keys/serialized size — same JSONB write-amplification
    // surface as the documents route on engineering_assignments.deliverables.
    // (#502 R1 H2)
    validateMetadata(body.metadata)

    // Idempotency required for uploads since network flakiness on a 20MB PDF
    // retry will otherwise create duplicate deliverable rows.
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

    // Scope check: partner must be the assigned org.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = partnerApiAdmin() as any
    const { data: existing, error: readErr } = await sb
      .from('engineering_assignments')
      .select('id, assigned_org')
      .eq('id', id)
      .maybeSingle()
    if (readErr) throw new ApiError('internal_error', readErr.message)
    if (!existing) throw new ApiError('not_found', 'Assignment not found')
    const row = existing as { assigned_org: string }
    if (ctx.orgType !== 'platform' && row.assigned_org !== ctx.orgId) {
      throw new ApiError('forbidden', 'Assignment is not assigned to this org')
    }

    const deliverable = {
      name: body.name,
      url: body.url,
      type: body.type,
      metadata: body.metadata ?? null,
      uploaded_by_org: ctx.orgSlug,
      uploaded_by_actor: ctx.actorExternalId,
    }
    const result = await addDeliverable(id, deliverable)
    if (!result) throw new ApiError('internal_error', 'Deliverable upload failed')

    const payload = { data: { assignment: result, deliverable } }
    if (idempKey) {
      await recordResponse(ctx.keyId, idempKey, 201, payload)
    }
    return NextResponse.json(payload, {
      status: 201,
      headers: { 'X-Request-Id': ctx.requestId },
    })
  },
)
