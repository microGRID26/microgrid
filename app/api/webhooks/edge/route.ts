import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ── EDGE → MicroGRID Webhook: Funding Status Updates ────────────────────────────
// Receives POST from EDGE Portal when funding status changes.
// Updates MicroGRID's project_funding table and logs to audit_log.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY
const WEBHOOK_SECRET = process.env.EDGE_WEBHOOK_SECRET

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

/** Timing-safe secret comparison */
function verifySignature(body: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false
  try {
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex')
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT_MAX) return false
  entry.count++
  return true
}

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

async function logSync(
  db: ReturnType<typeof supabase>,
  projectId: string,
  eventType: string,
  payload: Record<string, unknown>,
  status: 'delivered' | 'failed',
  responseCode: number,
  errorMessage?: string
) {
  await db.from('edge_sync_log').insert({
    project_id: projectId,
    event_type: eventType,
    direction: 'inbound',
    payload,
    status,
    response_code: responseCode,
    error_message: errorMessage ?? null,
  })
}

export async function POST(request: NextRequest) {
  // Rate limit: 30 requests per minute
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(`edge:${clientIp}`)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const bodyText = await request.text()

  // #1: Reject all requests if webhook secret is not configured
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  // Verify webhook signature
  const signature = request.headers.get('x-webhook-signature') ?? ''
  if (!verifySignature(bodyText, signature)) {
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

  // #2: Idempotency — skip duplicate events (same project + event type within 1 hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: duplicate } = await db
    .from('edge_sync_log')
    .select('id')
    .eq('project_id', project_id)
    .eq('event_type', event)
    .eq('direction', 'inbound')
    .eq('status', 'delivered')
    .gte('created_at', oneHourAgo)
    .limit(1)
    .maybeSingle()

  if (duplicate) {
    return NextResponse.json({ success: true, message: 'Already processed' }, { status: 200 })
  }

  // Verify project exists
  const { data: existingProject, error: projErr } = await db
    .from('projects')
    .select('id')
    .eq('id', project_id)
    .maybeSingle()

  if (projErr || !existingProject) {
    await logSync(db, project_id, event, payload as Record<string, unknown>, 'failed', 404, 'Project not found')
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
          await logSync(db, project_id, event, payload as Record<string, unknown>, 'failed', 400, 'Invalid milestone')
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
          await logSync(db, project_id, event, payload as Record<string, unknown>, 'failed', 400, 'Invalid milestone or status')
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
        await logSync(db, project_id, event, payload as Record<string, unknown>, 'failed', 400, `Unknown event: ${event}`)
        return NextResponse.json({ error: `Unknown event type: ${event}` }, { status: 400 })
    }

    // Log successful sync
    // #7: Concurrent audit race is acceptable — the upsert on project_funding uses
    // onConflict: 'project_id', so parallel requests for the same project will
    // resolve to last-write-wins on the funding row. The audit_log is append-only,
    // so concurrent inserts are always safe (no lost writes).
    await logSync(db, project_id, event, payload as Record<string, unknown>, 'delivered', 200)

    console.log(`edge-webhook: processed ${event} for ${project_id}`)
    return NextResponse.json({ success: true, project_id, event }, { status: 200 })

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    console.error('edge-webhook error:', err)
    await logSync(db, project_id, event, payload as Record<string, unknown>, 'failed', 500, errorMessage)
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
