import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ── EDGE → MicroGRID Webhook: Funding Status Updates ────────────────────────────
// Receives POST from EDGE Portal when funding status changes.
// Updates MicroGRID's project_funding table and logs to audit_log.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY
// .trim() so stray whitespace pasted into Vercel UI doesn't silently break
// HMAC verification (2026-04-17 incident: MG EDGE_WEBHOOK_SECRET had a
// leading space that broke MG↔EDGE for 14 days).
const WEBHOOK_SECRET = (process.env.EDGE_WEBHOOK_SECRET || '').trim() || undefined

if (!SUPABASE_SECRET) {
  console.error('[edge-webhook] SUPABASE_SECRET_KEY not configured')
}
if (!WEBHOOK_SECRET) {
  console.error('[edge-webhook] EDGE_WEBHOOK_SECRET not configured')
}

function supabase() {
  if (!SUPABASE_SECRET) throw new Error('SUPABASE_SECRET_KEY not configured')
  return createClient(SUPABASE_URL, SUPABASE_SECRET)
}

/**
 * Timing-safe HMAC-SHA256 signature verification using Web Crypto.
 * Matches the signing implementation in EDGE (`lib/microgrid-sync.ts:signPayload`).
 */
async function verifySignature(body: string, signature: string): Promise<boolean> {
  if (!WEBHOOK_SECRET || !signature) return false
  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const expectedHex = Array.from(new Uint8Array(expected))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    if (signature.length !== expectedHex.length) return false
    let diff = 0
    for (let i = 0; i < signature.length; i++) {
      diff |= signature.charCodeAt(i) ^ expectedHex.charCodeAt(i)
    }
    return diff === 0
  } catch {
    return false
  }
}

import { rateLimit } from '@/lib/rate-limit'
import { createHash } from 'node:crypto'

interface EdgeInboundPayload {
  event?: string
  project_id?: string
  timestamp?: string
  data?: Record<string, unknown>
}

async function logToAudit(
  db: ReturnType<typeof supabase>,
  projectId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null
) {
  await db.from('audit_log').insert({
    project_id: projectId,
    field,
    old_value: oldValue,
    new_value: newValue,
    changed_by: 'EDGE Portal',
    changed_by_id: null,
  })
}

export async function POST(request: NextRequest) {
  // Rate limit: 30 requests per minute
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { success } = await rateLimit(`edge:${clientIp}`, { max: 30, prefix: 'edge-webhook' })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const bodyText = await request.text()

  // #1: Reject all requests if webhook secret is not configured
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  // Verify webhook signature
  const signature = request.headers.get('x-webhook-signature') ?? ''
  if (!await verifySignature(bodyText, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: EdgeInboundPayload
  try {
    payload = JSON.parse(bodyText) as EdgeInboundPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { event, project_id, data, timestamp } = payload

  // #6: Timestamp freshness check — reject payloads older than 5 minutes
  if (timestamp) {
    const payloadAge = Date.now() - new Date(timestamp).getTime()
    if (isNaN(payloadAge) || payloadAge > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Timestamp too old or invalid' }, { status: 400 })
    }
  } else {
    // Backward compatibility: accept payloads without timestamp but log a warning
    console.warn('edge-webhook: received payload without timestamp field')
  }

  // Validate required fields
  if (!event || !project_id) {
    return NextResponse.json({ error: 'Missing required fields: event and project_id' }, { status: 400 })
  }

  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'Missing or invalid data field' }, { status: 400 })
  }

  const db = supabase()

  // #2: Idempotency (greg_action #378, audit-rotation 2026-04-28).
  //
  // Old: racy SELECT-then-INSERT against edge_sync_log within a 1-hour window
  // (concurrent identical signed payloads both passed the SELECT and wrote
  // duplicate audit_log + edge_sync_log rows).
  //
  // New: server-computed request_id keys a partial unique index
  // (project_id, event_type, request_id) WHERE direction='inbound'.
  // - Preferred: X-EDGE-Event-Id header set by EDGE sender (deterministic
  //   per-event id, survives content-equal events).
  // - Fallback: sha256(bodyText). Caveat — two genuinely-distinct events with
  //   identical bytes (e.g. a heartbeat repeated within 5 min freshness
  //   window) would collide and the second be dropped. Acceptable bridge
  //   state until the EDGE-side sender migration adds the header.
  // - The 5-min freshness window above already bounds replay-attack reuse.
  const headerEventId = request.headers.get('x-edge-event-id')?.trim() || ''
  const requestId = headerEventId || createHash('sha256').update(bodyText).digest('hex')

  // Reserve the idempotency key BEFORE any side-effects. If a concurrent
  // request raced us to the same key, the partial unique index rejects this
  // INSERT with 23505 — we treat that as "already processed" and return 200
  // without touching project_funding or audit_log. The row is inserted with
  // status='pending' and finalized to 'delivered' / 'failed' at end-of-flow
  // (so the log never advertises a failed event as delivered).
  const { error: claimErr } = await db
    .from('edge_sync_log')
    .insert({
      project_id,
      event_type: event,
      direction: 'inbound',
      payload: payload as Record<string, unknown>,
      status: 'pending',
      response_code: 0,
      request_id: requestId,
    })

  if (claimErr) {
    if ((claimErr as { code?: string }).code === '23505') {
      return NextResponse.json({ success: true, message: 'Already processed', duplicate: true }, { status: 200 })
    }
    // Any other DB error: bubble as 500. Don't proceed to side-effects.
    console.error('edge-webhook idempotency-claim error:', claimErr)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Finalize the claim row at end of flow. Updates status/response_code/error
  // on the row keyed by (project_id, event_type, request_id, direction).
  async function finalize(
    status: 'delivered' | 'failed',
    responseCode: number,
    errorMessage?: string,
  ) {
    await db
      .from('edge_sync_log')
      .update({
        status,
        response_code: responseCode,
        error_message: errorMessage ?? null,
      })
      .eq('project_id', project_id)
      .eq('event_type', event)
      .eq('request_id', requestId)
      .eq('direction', 'inbound')
  }

  // Verify project exists
  const { data: existingProject, error: projErr } = await db
    .from('projects')
    .select('id')
    .eq('id', project_id)
    .maybeSingle()

  if (projErr || !existingProject) {
    await finalize('failed', 404, 'Project not found')
    return NextResponse.json({ error: `Project ${project_id} not found` }, { status: 404 })
  }

  try {
    switch (event) {
      case 'funding.m2_funded': {
        const amount = data.amount as number | null
        const fundedDate = (data.funded_date as string) ?? new Date().toISOString().slice(0, 10)

        // Get current values for audit
        const { data: current } = await db.from('project_funding').select('m2_status, m2_amount, m2_funded_date').eq('project_id', project_id).maybeSingle()

        const { error } = await db.from('project_funding').upsert(
          {
            project_id,
            m2_status: 'Funded',
            m2_amount: amount ?? current?.m2_amount ?? null,
            m2_funded_date: fundedDate,
          },
          { onConflict: 'project_id' }
        )
        if (error) throw error

        await logToAudit(db, project_id, 'm2_status', current?.m2_status ?? null, 'Funded')
        if (amount != null) await logToAudit(db, project_id, 'm2_amount', String(current?.m2_amount ?? ''), String(amount))
        await logToAudit(db, project_id, 'm2_funded_date', current?.m2_funded_date ?? null, fundedDate)
        break
      }

      case 'funding.m3_funded': {
        const amount = data.amount as number | null
        const fundedDate = (data.funded_date as string) ?? new Date().toISOString().slice(0, 10)

        const { data: current } = await db.from('project_funding').select('m3_status, m3_amount, m3_funded_date').eq('project_id', project_id).maybeSingle()

        const { error } = await db.from('project_funding').upsert(
          {
            project_id,
            m3_status: 'Funded',
            m3_amount: amount ?? current?.m3_amount ?? null,
            m3_funded_date: fundedDate,
          },
          { onConflict: 'project_id' }
        )
        if (error) throw error

        await logToAudit(db, project_id, 'm3_status', current?.m3_status ?? null, 'Funded')
        if (amount != null) await logToAudit(db, project_id, 'm3_amount', String(current?.m3_amount ?? ''), String(amount))
        await logToAudit(db, project_id, 'm3_funded_date', current?.m3_funded_date ?? null, fundedDate)
        break
      }

      case 'funding.rejected': {
        const milestone = data.milestone as string // 'm2' or 'm3'
        const reason = data.reason as string | null
        const statusField = milestone === 'm2' ? 'm2_status' : milestone === 'm3' ? 'm3_status' : null

        if (!statusField) {
          await finalize('failed', 400, 'Invalid milestone')
          return NextResponse.json({ error: 'Invalid milestone: must be m2 or m3' }, { status: 400 })
        }

        const { data: current } = await db.from('project_funding').select('m2_status, m3_status').eq('project_id', project_id).maybeSingle()
        const currentStatus = current ? (current as Record<string, unknown>)[statusField] as string | null : null

        const notesField = milestone === 'm2' ? 'm2_notes' : 'm3_notes'
        const update: Record<string, unknown> = {
          project_id,
          [statusField]: 'Rejected',
        }
        if (reason) update[notesField] = reason

        const { error } = await db.from('project_funding').upsert(update, { onConflict: 'project_id' })
        if (error) throw error

        await logToAudit(db, project_id, statusField, currentStatus ?? null, 'Rejected')
        if (reason) await logToAudit(db, project_id, notesField, null, reason)
        break
      }

      case 'funding.status_update': {
        const milestone = data.milestone as string
        const status = data.status as string
        const statusField = milestone === 'm1' ? 'm1_status' : milestone === 'm2' ? 'm2_status' : milestone === 'm3' ? 'm3_status' : null

        if (!statusField || !status) {
          await finalize('failed', 400, 'Invalid milestone or status')
          return NextResponse.json({ error: 'Invalid milestone or missing status' }, { status: 400 })
        }

        const { data: current } = await db.from('project_funding').select('m1_status, m2_status, m3_status').eq('project_id', project_id).maybeSingle()
        const currentStatus = current ? (current as Record<string, unknown>)[statusField] as string | null : null

        const { error } = await db.from('project_funding').upsert(
          { project_id, [statusField]: status },
          { onConflict: 'project_id' }
        )
        if (error) throw error

        await logToAudit(db, project_id, statusField, currentStatus ?? null, status)
        break
      }

      default:
        await finalize('failed', 400, `Unknown event: ${event}`)
        return NextResponse.json({ error: `Unknown event type: ${event}` }, { status: 400 })
    }

    // The idempotency claim row is now finalized to delivered/200. The
    // upserts above use onConflict: 'project_id' so concurrent races on
    // project_funding resolve last-write-wins; audit_log is append-only.
    // The (project_id, event_type, request_id) unique index ensures only
    // one logical handler reaches this point per logical event.
    await finalize('delivered', 200)

    console.log(`edge-webhook: processed ${event} for ${project_id}`)
    return NextResponse.json({ success: true, project_id, event }, { status: 200 })

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error('edge-webhook error:', err)
    await finalize('failed', 500, errorMessage)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: WEBHOOK_SECRET ? 'configured' : 'no_secret',
    message: 'EDGE → MicroGRID webhook endpoint. Accepts funding status updates.',
  })
}
