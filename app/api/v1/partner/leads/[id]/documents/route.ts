// POST /api/v1/partner/leads/:id/documents
//
// Partner uploads a reference to a document they're hosting themselves
// (signed contract, utility bill, ID, etc). We append it to the project's
// partner_documents JSONB array.

import { NextResponse } from 'next/server'
import { withPartnerAuth } from '@/lib/partner-api/middleware'
import { partnerApiAdmin } from '@/lib/partner-api/supabase-admin'
import { ApiError } from '@/lib/partner-api/errors'
import {
  extractIdempotencyKey,
  bodyHash,
  readOrReserve,
  recordResponse,
} from '@/lib/partner-api/idempotency'
import { validateOutboundUrl } from '@/lib/partner-api/events/ssrf'
import { emitPartnerEvent } from '@/lib/partner-api/events/emit'
import { VALID_LEAD_DOC_TYPES } from '@/lib/partner-api/leads'

export const runtime = 'nodejs'

interface DocInput {
  name?: string
  url?: string
  type?: string
  metadata?: Record<string, unknown>
}

export const POST = withPartnerAuth(
  { scopes: ['leads:write'], category: 'upload', requireActor: true },
  async (req, ctx, routeCtx: { params: Promise<{ id: string }> }) => {
    const { id } = await routeCtx.params
    if (!id) throw new ApiError('invalid_request', 'id required')

    const raw = await req.text()
    let body: DocInput
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
    if (!VALID_LEAD_DOC_TYPES.has(body.type)) {
      throw new ApiError('invalid_request', `type must be one of: ${[...VALID_LEAD_DOC_TYPES].join(', ')}`)
    }
    validateOutboundUrl(body.url)

    const idempKey = extractIdempotencyKey(req.headers)
    const reqHash = bodyHash(raw)
    if (idempKey) {
      const prior = await readOrReserve(ctx.keyId, idempKey, reqHash)
      if (prior.cached && prior.response) {
        return NextResponse.json(prior.response.body, {
          status: prior.response.status,
          headers: { 'X-Request-Id': ctx.requestId, 'X-Idempotent-Replay': 'true' },
        })
      }
    }

    // Atomic append via RPC. The earlier read-modify-write path lost
    // concurrent uploads when two POSTs raced on the same project (#472).
    // The RPC uses SELECT FOR UPDATE on the projects row so concurrent
    // appends serialize. Scope check (origination_partner_org_id) is also
    // re-enforced inside the RPC for defense in depth.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = partnerApiAdmin() as any

    const doc = {
      id: crypto.randomUUID(),
      name: body.name,
      url: body.url,
      type: body.type,
      metadata: body.metadata ?? null,
      uploaded_by_actor: ctx.actorExternalId,
      uploaded_at: new Date().toISOString(),
    }

    const { data: rpcResult, error: rpcErr } = await sb.rpc('partner_api_append_lead_document', {
      p_project_id: id,
      p_caller_org_type: ctx.orgType,
      p_caller_org_id: ctx.orgId,
      p_doc: doc,
    })
    if (rpcErr) {
      // Map the RPC's RAISE EXCEPTIONs back to the existing ApiError shape.
      // SQLSTATE P0002 = lead_not_found; 42501 = forbidden.
      if (rpcErr.code === 'P0002' || /lead_not_found/i.test(rpcErr.message ?? '')) {
        throw new ApiError('not_found', 'Lead not found')
      }
      if (rpcErr.code === '42501' || /forbidden/i.test(rpcErr.message ?? '')) {
        throw new ApiError('forbidden', 'Lead is not owned by this org')
      }
      throw new ApiError('internal_error', rpcErr.message)
    }

    const documentCount = Array.isArray(rpcResult) && rpcResult[0]
      ? Number((rpcResult[0] as { document_count: number }).document_count)
      : 0

    void emitPartnerEvent('lead.document_uploaded', {
      lead_id: id,
      document_id: doc.id,
      type: body.type,
      actor_external_id: ctx.actorExternalId,
    })

    const payload = { data: { lead_id: id, document: doc, document_count: documentCount } }
    if (idempKey) {
      await recordResponse(ctx.keyId, idempKey, 201, payload)
    }
    return NextResponse.json(payload, {
      status: 201,
      headers: { 'X-Request-Id': ctx.requestId },
    })
  },
)
