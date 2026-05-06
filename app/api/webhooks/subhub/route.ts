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
const SUPABASE_SECRET = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
// .trim() so stray whitespace pasted into Vercel UI doesn't silently break
// HMAC/bearer comparison (2026-04-17 incident: MG EDGE_WEBHOOK_SECRET had a
// leading space that broke MG↔EDGE for 14 days).
const WEBHOOK_SECRET = (process.env.SUBHUB_WEBHOOK_SECRET || '').trim() || undefined
// Bearer token re-introduced 2026-05-02 (#383) for SubHub specifically: their
// outbound-webhook UI only supports static headers, no payload signing. To
// avoid the #370 "same-secret-as-bearer-and-HMAC = leak amplifier" finding,
// the bearer uses a SEPARATE env var. Replay protection is reduced to
// transport-layer (HTTPS) plus subhub_id idempotency in lib/subhub/ingest —
// duplicate POSTs are deduped on the (subhub_id, contract sha) tuple.
const WEBHOOK_BEARER_TOKEN = (process.env.SUBHUB_WEBHOOK_BEARER_TOKEN || '').trim() || undefined
const WEBHOOK_ENABLED = process.env.SUBHUB_WEBHOOK_ENABLED === 'true'
const DRIVE_WEBHOOK_URL = process.env.NEXT_PUBLIC_DRIVE_WEBHOOK_URL ?? ''

function supabase() {
  if (!SUPABASE_SECRET) throw new Error('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) not configured')
  return createClient(SUPABASE_URL, SUPABASE_SECRET)
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_ENABLED) {
    return NextResponse.json({ error: 'Webhook is disabled. Set SUBHUB_WEBHOOK_ENABLED=true to activate.' }, { status: 503 })
  }

  // R1 audit Medium #3 (2026-05-02): Vercel APPENDS the client IP to
  // x-forwarded-for; the FIRST entry is attacker-controlled if the request
  // included its own X-Forwarded-For. Use the LAST entry (Vercel's appended
  // client IP) so rate-limit keys can't be trivially spoofed for unlimited
  // 401-bruteforce attempts.
  const xff = request.headers.get('x-forwarded-for') ?? ''
  const xffParts = xff.split(',').map(s => s.trim()).filter(Boolean)
  const clientIp = xffParts.length ? xffParts[xffParts.length - 1] : 'unknown'
  const { success } = await rateLimit(`subhub:${clientIp}`, { max: 20, prefix: 'subhub-webhook' })
  if (!success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const bodyText = await request.text()

  // Guard against misconfiguration: if the webhook is enabled but neither
  // an HMAC secret nor a bearer token is set, fail closed rather than accept
  // unsigned traffic. (Leak-amplifier guard from #370 still applies — the
  // two values must be different secrets, enforced at the comparison site
  // below by them being independent env vars.)
  if (WEBHOOK_ENABLED && !WEBHOOK_SECRET && !WEBHOOK_BEARER_TOKEN) {
    console.error('[subhub] SUBHUB_WEBHOOK_ENABLED=true but no SUBHUB_WEBHOOK_SECRET or SUBHUB_WEBHOOK_BEARER_TOKEN set — rejecting')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // Verify webhook auth. Two paths accepted, in this precedence order:
  //
  // 1. **HMAC** (preferred when sender supports it). Header formats:
  //      a. `X-MicroGRID-Signature: sha256=<hex>` (Stripe/GitHub-style prefix)
  //      b. `x-webhook-signature: <hex>` (legacy plain hex)
  //    Replay protection: if `X-MicroGRID-Timestamp` is present, HMAC is over
  //    `${ts}.${body}` and ts must be within (now-5min, now+30s). Otherwise
  //    HMAC is over body only, accepted with a deprecation warning.
  //
  // 2. **Bearer token** (#383, 2026-05-02). For senders whose webhook UI only
  //    supports static headers (SubHub specifically). `Authorization: Bearer
  //    <token>` compared timing-safe against SUBHUB_WEBHOOK_BEARER_TOKEN.
  //    Different secret from the HMAC one — leak of one doesn't compromise
  //    the other (#370 leak-amplifier guard). No replay protection at this
  //    layer; relies on (a) HTTPS in transit, (b) subhub_id idempotency in
  //    lib/subhub/ingest deduping replayed POSTs.
  //
  // If HMAC headers are present, ONLY the HMAC path is tried — a sender that
  // sends a malformed HMAC can't fall through to bearer. If no HMAC headers,
  // bearer is tried.
  const microgridHeader = request.headers.get('x-microgrid-signature') ?? ''
  const legacyHeader = request.headers.get('x-webhook-signature') ?? ''
  const hasHmacHeader = !!(microgridHeader || legacyHeader)

  // R1 audit High #1 (2026-05-02): if HMAC headers are present we MUST verify
  // them. If WEBHOOK_SECRET is unset, we cannot verify, so we MUST 401 — falling
  // through to bearer would let an attacker who learned the bearer attach junk
  // HMAC headers to downgrade an HMAC-required path. Gate on hasHmacHeader
  // alone, then check WEBHOOK_SECRET inside the branch.
  if (hasHmacHeader) {
    if (!WEBHOOK_SECRET) {
      console.error('[subhub] HMAC headers present but SUBHUB_WEBHOOK_SECRET unset — refusing to fall through to bearer')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const microgridHex = microgridHeader.startsWith('sha256=')
      ? microgridHeader.slice('sha256='.length)
      : microgridHeader
    const hmacCandidate = microgridHex || legacyHeader

    if (!hmacCandidate) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tsHeader = request.headers.get('x-microgrid-timestamp') ?? ''
    let signedPayload: string
    if (tsHeader) {
      const tsNum = Number(tsHeader)
      if (!Number.isFinite(tsNum)) {
        return NextResponse.json({ error: 'Invalid timestamp' }, { status: 400 })
      }
      const skew = Date.now() - tsNum
      if (skew < -30_000 || skew > 5 * 60 * 1000) {
        return NextResponse.json({ error: 'Timestamp outside window' }, { status: 401 })
      }
      signedPayload = `${tsHeader}.${bodyText}`
    } else {
      console.warn('[subhub] HMAC without X-MicroGRID-Timestamp; sender should migrate to ts.body scheme')
      signedPayload = bodyText
    }

    let secretMatch = false
    try {
      const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(signedPayload).digest('hex')
      const got = Buffer.from(hmacCandidate)
      const exp = Buffer.from(expected)
      secretMatch = got.length === exp.length && crypto.timingSafeEqual(got, exp)
    } catch { secretMatch = false }

    if (!secretMatch) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (WEBHOOK_BEARER_TOKEN) {
    // Bearer fallback for HMAC-incapable senders.
    const authHeader = request.headers.get('authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const provided = authHeader.slice('Bearer '.length).trim()
    // Explicit empty-token reject (R1 audit Medium #2). timingSafeEqual would
    // catch this via length mismatch, but cleaner to reject upfront.
    if (!provided) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    let bearerMatch = false
    try {
      const got = Buffer.from(provided)
      const exp = Buffer.from(WEBHOOK_BEARER_TOKEN)
      bearerMatch = got.length === exp.length && crypto.timingSafeEqual(got, exp)
    } catch { bearerMatch = false }
    if (!bearerMatch) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    // Webhook is enabled and either: (a) HMAC headers were sent but
    // WEBHOOK_SECRET is unset, or (b) no auth headers at all. Both are 401.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
