// lib/partner-api/events/emit.ts — Transactional outbox writer.
//
// Call emitPartnerEvent() from the app-layer mutation sites
// (lib/api/engineering.ts, lib/api/projects.ts, etc.) AFTER the core write
// succeeds. The function inserts a row into partner_event_outbox, which the
// partner-event-fanout cron drains and fans out to matching subscriptions.
//
// The outbox lives in the same database as the mutation. For atomic outbox
// writes we would need to invoke the mutation as a Postgres RPC and call
// partner_emit_event inside the same transaction. For v1 we accept the
// tiny race window (server crash between mutation and emit) because the
// payoff is not worth reshaping every mutation path. Phase 4 can promote
// hot events to RPC-atomic when needed.
//
// emitPartnerEvent never throws and never blocks the caller. The caller's
// code path is authoritative; event delivery is best-effort beyond this
// point.

import { partnerApiAdmin } from '../supabase-admin'

export type PartnerEventType =
  | 'engineering.assignment.created'
  | 'engineering.assignment.status_changed'
  | 'engineering.assignment.notes_updated'
  | 'engineering.deliverable.uploaded'
  | 'project.stage_changed'
  | 'project.milestone_completed'
  | 'lead.created'
  | 'lead.updated'
  | 'lead.document_uploaded'

export interface EmitResult {
  ok: boolean
  event_id?: string
  error?: string
}

/**
 * Fire-and-forget insert into partner_event_outbox. Returns a promise that
 * always resolves (never rejects). Callers may await to get the event_id
 * back or simply `void` the call for true fire-and-forget semantics.
 */
export async function emitPartnerEvent(
  eventType: PartnerEventType,
  payload: Record<string, unknown>,
): Promise<EmitResult> {
  try {
    const sb = partnerApiAdmin()
    const { data, error } = await sb.rpc('partner_emit_event', {
      p_event_type: eventType,
      p_payload: payload,
    })
    if (error) {
      console.error(`[emitPartnerEvent] ${eventType} failed:`, error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true, event_id: typeof data === 'string' ? data : undefined }
  } catch (err) {
    console.error(`[emitPartnerEvent] ${eventType} threw:`, err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
