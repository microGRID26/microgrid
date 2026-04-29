import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

/**
 * POST /api/webhooks/subhub-vwc
 *
 * Receives Welcome Call survey event data from SubHub.
 * Phase 1: Logs raw payload to welcome_call_logs table for inspection.
 * Phase 2: After payload shape is known, parse and store structured data.
 *
 * Auth: Optional SUBHUB_WEBHOOK_SECRET via Authorization or X-Webhook-Secret header.
 */
export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim()
  if (!supabaseUrl || !serviceKey) {
    console.error('[subhub-vwc] SUPABASE_SECRET_KEY not configured')
    return NextResponse.json({ error: 'Server not configured' }, { status: 503 })
  }

  // Auth — require secret when configured, reject all requests when not configured.
  // .trim() so stray whitespace in Vercel UI doesn't silently break comparison
  // (2026-04-17 incident on MG EDGE_WEBHOOK_SECRET).
  const webhookSecret = (process.env.SUBHUB_WEBHOOK_SECRET || '').trim()
  if (!webhookSecret) {
    console.error('[subhub-vwc] SUBHUB_WEBHOOK_SECRET not configured — rejecting request')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }
  {
    const authHeader = req.headers.get('authorization') ?? req.headers.get('x-webhook-secret') ?? ''
    const candidate = authHeader.replace(/^Bearer\s+/i, '')
    const a = Buffer.from(candidate)
    const b = Buffer.from(webhookSecret)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('[subhub-vwc] Invalid webhook secret')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Read body once so we can hash the exact bytes we parse.
  const bodyText = await req.text()
  let payload: unknown
  try {
    payload = JSON.parse(bodyText)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Try to extract identifiers from common SubHub fields
  const data = payload as Record<string, unknown>
  const projectId = data.subhub_id ?? data.subhub_uuid ?? data.proposal_id ?? data.project_id ?? null
  const customerName = data.name ?? data.customer_name ?? data.first_name ?? null
  const eventType = data.event_type ?? data.event ?? data.survey_type ?? 'unknown'

  // Timestamp window: SubHub may or may not send one — when present, reject
  // payloads whose skew from now exceeds 5 min in EITHER direction (R2 fix —
  // R1 only rejected past-dated, so attacker could set ts=+1h and slide
  // through). Absent timestamp → fall back to the payload_hash dedup below.
  const ts = data.timestamp ?? data.event_timestamp ?? data.received_at
  if (typeof ts === 'string' || typeof ts === 'number') {
    const skew = Date.now() - new Date(ts as string | number).getTime()
    if (Number.isFinite(skew) && Math.abs(skew) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Timestamp outside window' }, { status: 400 })
    }
  }

  // Replay defense: sha256 over the raw body; unique index on
  // (source_id, event_type, payload_hash) short-circuits a duplicate.
  const payloadHash = crypto.createHash('sha256').update(bodyText).digest('hex')

  const supabase = createClient(supabaseUrl, serviceKey)
  const { error } = await supabase
    .from('welcome_call_logs')
    .insert({
      source_id: projectId ? String(projectId) : null,
      customer_name: customerName ? String(customerName) : null,
      event_type: String(eventType),
      payload: payload,
      payload_hash: payloadHash,
      received_at: new Date().toISOString(),
    })

  if (error) {
    // 23505 = unique_violation → exact replay, return success without storing.
    const code = (error as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('[subhub-vwc] insert error:', error.message)
    // Still return 200 so SubHub doesn't retry
    return NextResponse.json({ received: true, stored: false, error: 'Storage failed' })
  }

  console.log(`[subhub-vwc] Logged welcome call event: ${eventType} for ${projectId ?? 'unknown'}`)
  return NextResponse.json({ received: true, stored: true })
}

/**
 * GET /api/webhooks/subhub-vwc
 * Health check — confirms endpoint is live.
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: 'subhub-vwc',
    description: 'SubHub Welcome Call webhook receiver',
  })
}
