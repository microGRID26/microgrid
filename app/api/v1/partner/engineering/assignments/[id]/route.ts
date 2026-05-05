// GET  /api/v1/partner/engineering/assignments/:id — read detail
// PATCH /api/v1/partner/engineering/assignments/:id — update status + notes
//
// Scoped: the assignment must belong to the caller's org (assigned_org match)
// unless the caller is a platform tenant.

import { NextRequest, NextResponse } from 'next/server'
import { withPartnerAuth } from '@/lib/partner-api/middleware'
import { partnerApiAdmin } from '@/lib/partner-api/supabase-admin'
import { ApiError } from '@/lib/partner-api/errors'
import { updateAssignmentStatus, ASSIGNMENT_STATUSES, type AssignmentStatus } from '@/lib/api/engineering'
import { extractIdempotencyKey, bodyHash, readOrReserve, recordResponse, assertPriorBodyMatches } from '@/lib/partner-api/idempotency'
import { enforceRawBodyLimit } from '@/lib/partner-api/limits'
import { emitPartnerEvent } from '@/lib/partner-api/events/emit'

export const runtime = 'nodejs'

const ASSIGNMENT_COLUMNS = `id, project_id, assigned_org, requesting_org, assignment_type,
  status, priority, assigned_to, assigned_at, started_at, completed_at,
  due_date, notes, deliverables, revision_count, created_by, created_by_id,
  created_at, updated_at`

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadScoped(
  id: string,
  orgId: string,
  isPlatform: boolean,
): Promise<Record<string, unknown> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = partnerApiAdmin() as any
  const { data, error } = await sb
    .from('engineering_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ApiError('internal_error', error.message)
  if (!data) return null
  const row = data as { assigned_org: string }
  if (!isPlatform && row.assigned_org !== orgId) return null
  return data as Record<string, unknown>
}

export const GET = withPartnerAuth(
  { scopes: ['engineering:assignments:read'], category: 'read' },
  async (_req, ctx, routeCtx: { params: Promise<{ id: string }> }) => {
    const { id } = await routeCtx.params
    if (!UUID_RE.test(id)) throw new ApiError('invalid_request', 'id must be a UUID')
    const row = await loadScoped(id, ctx.orgId, ctx.orgType === 'platform')
    if (!row) throw new ApiError('not_found', 'Assignment not found or not accessible to this org')
    return NextResponse.json({ data: row }, { headers: { 'X-Request-Id': ctx.requestId } })
  },
)

const PATCHABLE_STATUSES: readonly AssignmentStatus[] = [
  'assigned', 'in_progress', 'review', 'revision_needed', 'complete', 'cancelled',
]

export const PATCH = withPartnerAuth(
  { scopes: ['engineering:assignments:write'], category: 'write' },
  async (req, ctx, routeCtx: { params: Promise<{ id: string }> }) => {
    const { id } = await routeCtx.params
    if (!UUID_RE.test(id)) throw new ApiError('invalid_request', 'id must be a UUID')

    const raw = await req.text()
    enforceRawBodyLimit(raw) // #502 R1 H1
    let body: { status?: string; notes?: string }
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      throw new ApiError('invalid_request', 'Body must be valid JSON')
    }

    // Idempotency: optional header for PATCH. If provided, cache + replay.
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

    // Scope + existence check.
    const existing = await loadScoped(id, ctx.orgId, ctx.orgType === 'platform')
    if (!existing) throw new ApiError('not_found', 'Assignment not found or not accessible to this org')

    if (body.status !== undefined) {
      if (!(ASSIGNMENT_STATUSES as readonly string[]).includes(body.status)) {
        throw new ApiError('invalid_request', `status must be one of: ${ASSIGNMENT_STATUSES.join(', ')}`)
      }
      if (!PATCHABLE_STATUSES.includes(body.status as AssignmentStatus)) {
        throw new ApiError('invalid_request', `Partners may not transition to status '${body.status}' directly`)
      }
    }
    if (body.notes !== undefined && typeof body.notes !== 'string') {
      throw new ApiError('invalid_request', 'notes must be a string')
    }

    // Route through the existing mutation helper so the partner-event emit fires.
    let updated: Record<string, unknown> | null = null
    if (body.status !== undefined) {
      updated = (await updateAssignmentStatus(
        id,
        body.status as AssignmentStatus,
        body.notes,
      )) as Record<string, unknown> | null
    } else if (body.notes !== undefined) {
      // Notes-only update: no status change, write directly, emit a
      // dedicated notes_updated event so subscribers see the change.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = partnerApiAdmin() as any
      const { data, error } = await sb
        .from('engineering_assignments')
        .update({ notes: body.notes })
        .eq('id', id)
        .select(ASSIGNMENT_COLUMNS)
        .single()
      if (error) throw new ApiError('internal_error', error.message)
      updated = data as Record<string, unknown>
      // R1 fix (Medium): notes-only edits get their own event type so
      // subscribers don't conflate them with real status transitions.
      void emitPartnerEvent('engineering.assignment.notes_updated', {
        assignment_id: (updated as { id?: string }).id ?? id,
        project_id: (updated as { project_id?: string }).project_id,
        notes: body.notes,
      })
    } else {
      throw new ApiError('invalid_request', 'Provide at least one of: status, notes')
    }

    if (!updated) throw new ApiError('internal_error', 'Update returned no row')

    const payload = { data: updated }
    if (idempKey) {
      await recordResponse(ctx.keyId, idempKey, 200, payload)
    }
    return NextResponse.json(payload, { headers: { 'X-Request-Id': ctx.requestId } })
  },
)
