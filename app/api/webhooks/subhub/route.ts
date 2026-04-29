import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { processSubhubProject, type SubHubPayload } from '@/lib/subhub/ingest'
import { rateLimit } from '@/lib/rate-limit'

// ── SubHub Webhook: Project Created ─────────────────────────────────────────
// Receives a POST from SubHub when a contract is signed.
// Creates the project, initial task states, and Google Drive folder in MicroGRID.
//
// To enable: set SUBHUB_WEBHOOK_SECRET in .env.local
// To test: POST to /api/webhooks/subhub with the payload from docs/subhub-webhook-sample.json
//
// DISABLED by default — set SUBHUB_WEBHOOK_ENABLED=true in .env.local to activate

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY?.trim()
// .trim() so stray whitespace pasted into Vercel UI doesn't silently break
// HMAC/bearer comparison (2026-04-17 incident: MG EDGE_WEBHOOK_SECRET had a
// leading space that broke MG↔EDGE for 14 days).
const WEBHOOK_SECRET = (process.env.SUBHUB_WEBHOOK_SECRET || '').trim() || undefined
const WEBHOOK_ENABLED = process.env.SUBHUB_WEBHOOK_ENABLED === 'true'
const DRIVE_WEBHOOK_URL = process.env.NEXT_PUBLIC_DRIVE_WEBHOOK_URL ?? ''

function supabase() {
  if (!SUPABASE_SECRET) throw new Error('SUPABASE_SECRET_KEY not configured')
  return createClient(SUPABASE_URL, SUPABASE_SECRET)
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_ENABLED) {
    return NextResponse.json({ error: 'Webhook is disabled. Set SUBHUB_WEBHOOK_ENABLED=true to activate.' }, { status: 503 })
  }

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const { success } = await rateLimit(`subhub:${clientIp}`, { max: 20, prefix: 'subhub-webhook' })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const bodyText = await request.text()

  // Guard against misconfiguration: if the webhook is enabled but no secret
  // has been set, fail closed rather than accept unsigned traffic. Matches
  // the subhub-vwc posture (R2 2026-04-17 audit).
  if (WEBHOOK_ENABLED && !WEBHOOK_SECRET) {
    console.error('[subhub] SUBHUB_WEBHOOK_ENABLED=true but SUBHUB_WEBHOOK_SECRET not set — rejecting')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // Verify webhook secret if configured.
  //
  // Two HMAC header formats are accepted for backward compatibility:
  //   1. `X-MicroGRID-Signature: sha256=<hex>`  — SPARK's SparkSign → MG
  //       webhook sender (see SPARK src/lib/microgrid-webhook.ts). Matches
  //       the GitHub/Stripe convention of an algorithm prefix on the value.
  //   2. `x-webhook-signature: <hex>`           — legacy header name used by
  //       earlier senders and the EDGE ↔ MG webhook path.
  //
  // Either header → HMAC-SHA256(bodyText, SUBHUB_WEBHOOK_SECRET). If neither
  // HMAC header is present, fall back to a bearer-token comparison for
  // back-compat during HMAC rollout.
  if (WEBHOOK_SECRET) {
    const microgridHeader = request.headers.get('x-microgrid-signature') ?? ''
    const legacyHeader = request.headers.get('x-webhook-signature') ?? ''
    const microgridHex = microgridHeader.startsWith('sha256=')
      ? microgridHeader.slice('sha256='.length)
      : microgridHeader
    const hmacCandidate = microgridHex || legacyHeader

    let secretMatch = false

    if (hmacCandidate) {
      try {
        const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(bodyText).digest('hex')
        const got = Buffer.from(hmacCandidate)
        const exp = Buffer.from(expected)
        secretMatch = got.length === exp.length && crypto.timingSafeEqual(got, exp)
      } catch { secretMatch = false }
    } else {
      const authHeader = request.headers.get('authorization') ?? request.headers.get('x-webhook-secret') ?? ''
      const candidate = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
      try {
        const a = Buffer.from(candidate)
        const b = Buffer.from(WEBHOOK_SECRET)
        secretMatch = a.length === b.length && crypto.timingSafeEqual(a, b)
      } catch { secretMatch = false }
    }

    if (!secretMatch) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let payload: SubHubPayload
  try {
    payload = JSON.parse(bodyText) as SubHubPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const db = supabase()
    const result = await processSubhubProject(payload, db, {
      driveWebhookUrl: DRIVE_WEBHOOK_URL || undefined,
      createDriveFolder: true,
      ingestDocuments: true,
      syncToEdge: true,
    })

    if (!result.success) {
      // R1 audit High 5 (2026-04-28): never bubble raw Postgres / helper error
      // strings to the webhook caller. Map to safe categories. Server-side
      // detail is logged for ops.
      console.error(`[subhub] ingest failed: ${result.error}`)
      const errLower = (result.error ?? '').toLowerCase()
      if (errLower.startsWith('missing required fields') || errLower.startsWith('missing subhub_id')) {
        return NextResponse.json({ error: 'Validation failed', detail: 'Required fields missing' }, { status: 400 })
      }
      if (errLower.startsWith('subhub_id_conflict')) {
        return NextResponse.json({ error: 'Conflict', detail: 'Existing project conflict' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Internal server error', detail: 'Internal error' }, { status: 500 })
    }

    if (result.duplicate) {
      return NextResponse.json({
        success: true,
        project_id: result.project_id,
        documents_inserted: result.documents_inserted ?? 0,
        message: `Project already exists (matched by ${result.matched_by})`,
        duplicate: true,
      }, { status: 200 })
    }

    console.log(`SubHub webhook: created ${result.project_id} (docs ingested: ${result.documents_inserted ?? 0})`)
    return NextResponse.json({
      success: true,
      project_id: result.project_id,
      documents_inserted: result.documents_inserted ?? 0,
      message: `Project ${result.project_id} created successfully`,
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('SubHub webhook error:', err)
    return NextResponse.json({ error: 'Internal server error', detail: 'Internal error' }, { status: 500 })
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: WEBHOOK_ENABLED ? 'enabled' : 'disabled',
    message: WEBHOOK_ENABLED
      ? 'SubHub webhook is active and accepting project creation events.'
      : 'SubHub webhook is disabled. Set SUBHUB_WEBHOOK_ENABLED=true in environment variables to activate.',
  })
}
