import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

function mockChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    in: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: any) => Promise.resolve(result).then(cb)),
  }
  return chain
}

const mockDb = {
  from: vi.fn((_table: string) => mockChain({ data: null, error: null })),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockDb),
}))

vi.mock('@/lib/tasks', () => ({
  TASKS: {
    evaluation: [
      { id: 'welcome_call', pre: [] },
      { id: 'site_audit', pre: ['welcome_call'] },
    ],
    survey: [
      { id: 'schedule_survey', pre: [] },
    ],
  },
}))

vi.mock('@/lib/api/edge-sync', () => ({
  syncProjectToEdge: vi.fn(),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'test-service-key'
  process.env.SUBHUB_WEBHOOK_SECRET = 'webhook-secret-123'
  process.env.SUBHUB_WEBHOOK_ENABLED = 'true'
})

afterEach(() => {
  process.env = originalEnv
  vi.unstubAllGlobals()
})

function makeRequest(body: object, headers: Record<string, string> = {}): Request {
  const bodyText = JSON.stringify(body)
  const finalHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...headers }
  // Bearer fallback removed 2026-04-29 (audit Critical / #370). To keep the
  // existing test corpus readable, the canonical `Authorization: Bearer
  // webhook-secret-123` and `x-webhook-secret: webhook-secret-123` shorthands
  // are auto-converted into a real body-only HMAC signature here. Tests that
  // exercise rejection paths (wrong / short bearer) bypass this branch.
  const isCorrectBearer =
    finalHeaders.Authorization === 'Bearer webhook-secret-123' ||
    finalHeaders['x-webhook-secret'] === 'webhook-secret-123'
  if (isCorrectBearer) {
    delete finalHeaders.Authorization
    delete finalHeaders['x-webhook-secret']
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const hex = createHmac('sha256', 'webhook-secret-123').update(bodyText).digest('hex')
    finalHeaders['X-MicroGRID-Signature'] = `sha256=${hex}`
  }
  return new Request('https://localhost/api/webhooks/subhub', {
    method: 'POST',
    headers: finalHeaders,
    body: bodyText,
  })
}

// ── GET Health Check ────────────────────────────────────────────────────────

describe('GET /api/webhooks/subhub', () => {
  it('returns enabled status when webhook is enabled', async () => {
    const { GET } = await import('@/app/api/webhooks/subhub/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('enabled')
  })

  it('returns disabled status when webhook is disabled', async () => {
    delete process.env.SUBHUB_WEBHOOK_ENABLED
    const { GET } = await import('@/app/api/webhooks/subhub/route')
    const res = await GET()
    const json = await res.json()
    expect(json.status).toBe('disabled')
  })
})

// ── Webhook Enabled Check ───────────────────────────────────────────────────

describe('POST /api/webhooks/subhub — enabled check', () => {
  it('returns 503 when webhook is disabled', async () => {
    delete process.env.SUBHUB_WEBHOOK_ENABLED
    const req = makeRequest(
      { name: 'Test', street: '123 Main St' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toContain('disabled')
  })

  it('returns 503 when enabled but SUBHUB_WEBHOOK_SECRET is unset (R2 fail-closed)', async () => {
    process.env.SUBHUB_WEBHOOK_ENABLED = 'true'
    delete process.env.SUBHUB_WEBHOOK_SECRET
    const req = makeRequest({ name: 'Test', street: '123 Main St' }, {})
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toContain('not configured')
  })
})

// ── Auth / Secret Verification ──────────────────────────────────────────────

describe('POST /api/webhooks/subhub — auth', () => {
  it('returns 401 when webhook secret is wrong', async () => {
    const req = makeRequest(
      { name: 'Test', street: '123 Main St' },
      { Authorization: 'Bearer wrong-secret' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 401 when no auth header provided', async () => {
    const req = makeRequest({ name: 'Test', street: '123 Main St' })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('accepts x-webhook-secret header', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30100' }], error: null }) // getNextProjectId
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest(
      { subhub_id: 'SH-WHS', name: 'John Doe', street: '123 Main St' },
      { 'x-webhook-secret': 'webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).not.toBe(401)
  })

  it('uses timing-safe comparison for secret validation', async () => {
    // Verify that different-length secrets don't crash (timingSafeEqual would throw)
    const req = makeRequest(
      { name: 'Test', street: '123 Main St' },
      { Authorization: 'Bearer short' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })
})

// ── Validation ──────────────────────────────────────────────────────────────

describe('POST /api/webhooks/subhub — validation', () => {
  it('returns 400 when name is missing', async () => {
    const req = makeRequest(
      { subhub_id: 'SH-1', street: '123 Main St' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
  })

  it('returns 400 when address/street is missing', async () => {
    const req = makeRequest(
      { subhub_id: 'SH-2', name: 'John Doe' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
  })

  it('returns 400 when both subhub_id and subhub_uuid are missing (R1 audit High 3)', async () => {
    const req = makeRequest(
      { name: 'Anon', street: '789 Test Ln' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Validation failed')
  })

  it('builds name from first_name + last_name when name is not provided', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30050' }], error: null }) // getNextProjectId
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest(
      { subhub_id: 'SH-3', first_name: 'Jane', last_name: 'Smith', street: '456 Oak Ave' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.project_id).toBe('PROJ-30051')
  })
})

// ── Duplicate Detection ─────────────────────────────────────────────────────

describe('POST /api/webhooks/subhub — duplicate detection', () => {
  it('returns existing project when duplicate is found', async () => {
    const dupChain = mockChain({ data: [{ id: 'PROJ-30001', subhub_id: 'SH-DUP' }], error: null })
    mockDb.from.mockReturnValue(dupChain)

    const req = makeRequest(
      { subhub_id: 'SH-DUP', name: 'John Doe', street: '123 Main St' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.duplicate).toBe(true)
    expect(json.project_id).toBe('PROJ-30001')
  })
})

// ── Project Creation ────────────────────────────────────────────────────────

describe('POST /api/webhooks/subhub — project creation', () => {
  it('creates project with all SubHub fields mapped', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30100' }], error: null }) // getNextProjectId
      return mockChain({ data: null, error: null })
    })

    const payload = {
      subhub_id: 'SH-999',
      name: 'Sarah Connor',
      email: 'sarah@example.com',
      phone: '555-1234',
      street: '100 Future Way',
      city: 'Dallas',
      state: 'TX',
      postal_code: '75001',
      contract_signed_date: '2026-04-01',
      contract_amount: 45000,
      system_size_kw: 12.5,
      finance_partner: 'GoodLeap',
      module_name: 'Duracell 400W',
      module_total_panels: 30,
      battery_name: 'Duracell 80kWh',
      battery_quantity: 1,
    }

    const req = makeRequest(payload, { Authorization: 'Bearer webhook-secret-123' })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.project_id).toBe('PROJ-30101')

    expect(mockDb.from).toHaveBeenCalledWith('projects')
    expect(mockDb.from).toHaveBeenCalledWith('task_state')
    expect(mockDb.from).toHaveBeenCalledWith('stage_history')
    expect(mockDb.from).toHaveBeenCalledWith('project_funding')
  })

  it('returns 500 when project insert fails', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30000' }], error: null }) // getNextProjectId
      if (callCount === 4) return mockChain({ data: null, error: { message: 'Unique constraint violation' } })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest(
      { subhub_id: 'SH-FAIL', name: 'Fail Test', street: '789 Error Blvd' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    // R1 audit High 5: error is sanitized; raw Postgres message is logged but not returned.
    expect(json.error).toBe('Internal server error')
  })

  it('imports adders when present in payload', async () => {
    let callCount = 0
    const insertedTables: string[] = []
    mockDb.from.mockImplementation((table: string) => {
      callCount++
      insertedTables.push(table)
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30200' }], error: null }) // getNextProjectId
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest(
      {
        subhub_id: 'SH-ADDER',
        name: 'Adder Test',
        street: '123 Solar Ln',
        adders: [
          { name: 'Critter Guard', unit_price: 500, cost_total: 500, qty: 1 },
          { name: 'Trench', unit_price: 25, cost_total: 250, qty: 10 },
        ],
      },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    expect(insertedTables).toContain('project_adders')
  })

  it('creates Google Drive folder when DRIVE_WEBHOOK_URL is set', async () => {
    process.env.NEXT_PUBLIC_DRIVE_WEBHOOK_URL = 'https://drive.example.com/webhook'

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ folder_url: 'https://drive.google.com/folder/123' })),
    })
    vi.stubGlobal('fetch', mockFetch)

    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30300' }], error: null }) // getNextProjectId
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest(
      { subhub_id: 'SH-DRIVE', name: 'Drive Test', street: '111 Cloud St' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://drive.example.com/webhook',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('generates sequential project IDs', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30500' }], error: null }) // getNextProjectId
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest(
      { subhub_id: 'SH-SEQ', name: 'ID Test', street: '999 Sequence Ave' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    const json = await res.json()
    expect(json.project_id).toBe('PROJ-30501')
  })
})

// ── Error Handling ──────────────────────────────────────────────────────────

describe('POST /api/webhooks/subhub — error handling', () => {
  it('returns 500 on unexpected error', async () => {
    mockDb.from.mockImplementation(() => {
      throw new Error('Unexpected crash')
    })

    const req = makeRequest(
      { subhub_id: 'SH-CRASH', name: 'Crash Test', street: '000 Error Ln' },
      { Authorization: 'Bearer webhook-secret-123' }
    )
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Internal server error')
  })
})

// ── HMAC header compatibility (greg_actions #131) ──────────────────────────
//
// SPARK signs outbound SparkSign → MG webhooks with
// `X-MicroGRID-Signature: sha256=<hex>`. Older senders used
// `x-webhook-signature: <hex>` (no prefix). Both must authenticate, plus
// the legacy bearer-token path for any caller that hasn't been upgraded.

describe('POST /api/webhooks/subhub — HMAC header compatibility', () => {
  // Match the file-level helper makeRequest but with a real body so the
  // HMAC over the body text is deterministic.
  function signedRequest(body: object, headerName: string, withPrefix: boolean) {
    const bodyText = JSON.stringify(body)
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const hex = createHmac('sha256', 'webhook-secret-123').update(bodyText).digest('hex')
    const value = withPrefix ? `sha256=${hex}` : hex
    return new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [headerName]: value },
      body: bodyText,
    })
  }

  function dbForProjectCreate() {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null }) // subhub_id lookup
      if (callCount === 2) return mockChain({ data: [], error: null }) // (name,address) lookup
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30100' }], error: null }) // getNextProjectId
      return mockChain({ data: null, error: null })
    })
  }

  it('accepts X-MicroGRID-Signature with sha256= prefix (SPARK format)', async () => {
    dbForProjectCreate()
    const req = signedRequest({ subhub_id: 'SH-HMAC1', name: 'SparkSign Customer', street: '1 SparkSign Way' }, 'X-MicroGRID-Signature', true)
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).not.toBe(401)
  })

  it('accepts X-MicroGRID-Signature without sha256= prefix (tolerant parsing)', async () => {
    dbForProjectCreate()
    const req = signedRequest({ subhub_id: 'SH-HMAC2', name: 'SparkSign Customer', street: '1 SparkSign Way' }, 'X-MicroGRID-Signature', false)
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).not.toBe(401)
  })

  it('still accepts legacy x-webhook-signature header (no prefix)', async () => {
    dbForProjectCreate()
    const req = signedRequest({ subhub_id: 'SH-HMAC3', name: 'Legacy Customer', street: '1 Legacy Ln' }, 'x-webhook-signature', false)
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).not.toBe(401)
  })

  it('rejects X-MicroGRID-Signature with wrong HMAC', async () => {
    const bodyText = JSON.stringify({ name: 'Spoof', street: '1 Spoof St' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MicroGRID-Signature': `sha256=${'0'.repeat(64)}` },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects X-MicroGRID-Signature whose HMAC is a different length (malformed) without crashing', async () => {
    const bodyText = JSON.stringify({ name: 'Malformed', street: '1 Malformed St' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MicroGRID-Signature': 'sha256=deadbeef' },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects X-MicroGRID-Signature computed against a body that was tampered after signing', async () => {
    const signedBody = { name: 'Honest Customer', street: '1 Honest Ln', contract_amount: 10000 }
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const hex = createHmac('sha256', 'webhook-secret-123').update(JSON.stringify(signedBody)).digest('hex')
    // Attacker flips the contract amount after the HMAC was computed.
    const tamperedBody = { ...signedBody, contract_amount: 99999999 }
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MicroGRID-Signature': `sha256=${hex}` },
      body: JSON.stringify(tamperedBody),
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('bearer-only request without any HMAC header is rejected when SUBHUB_WEBHOOK_BEARER_TOKEN is unset', async () => {
    // Bearer fallback was removed in #370 then re-added in #383, but ONLY
    // when the dedicated SUBHUB_WEBHOOK_BEARER_TOKEN env var is set. Without
    // that env var the receiver must reject bearer attempts (otherwise a
    // misconfigured deploy would re-open the leak-amplifier window).
    delete process.env.SUBHUB_WEBHOOK_BEARER_TOKEN
    const bodyText = JSON.stringify({ subhub_id: 'SH-BEARER', name: 'Bearer Customer', street: '1 Bearer Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer webhook-secret-123' },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })
})

// ── Bearer fallback (#383, 2026-05-02) ──────────────────────────────────────
// SubHub's webhook UI only supports static headers — no payload signing. The
// bearer fallback uses a SEPARATE env var (SUBHUB_WEBHOOK_BEARER_TOKEN) from
// the HMAC secret to avoid the #370 leak-amplifier finding (one secret used
// for both bearer and HMAC = leak of either compromises both paths).

describe('POST /api/webhooks/subhub — bearer fallback (#383)', () => {
  const BEARER = 'bearer-token-distinct-from-hmac-secret'
  const HMAC = 'webhook-secret-123'

  it('accepts a valid bearer token when no HMAC headers are present', async () => {
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    const bodyText = JSON.stringify({ subhub_id: 'SH-B1', name: 'Bearer Customer 1', street: '1 Bearer Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BEARER}` },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    // Expect 201 (created) or 200 (duplicate) — not 401. The mocked supabase
    // pipeline in this file returns success.
    expect([200, 201]).toContain(res.status)
  })

  it('rejects a wrong bearer token with timing-safe comparison', async () => {
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    const bodyText = JSON.stringify({ subhub_id: 'SH-B2', name: 'Bearer Customer 2', street: '2 Bearer Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects malformed Authorization header (no Bearer prefix)', async () => {
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    const bodyText = JSON.stringify({ subhub_id: 'SH-B3', name: 'Bearer Customer 3', street: '3 Bearer Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: BEARER }, // missing "Bearer " prefix
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects bearer token when no Authorization header is sent', async () => {
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    const bodyText = JSON.stringify({ subhub_id: 'SH-B4', name: 'Bearer Customer 4', street: '4 Bearer Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('does NOT fall through to bearer when HMAC headers are present (HMAC strict-only)', async () => {
    // Send an INVALID HMAC plus a valid bearer. Without the strict-on-HMAC
    // gate, an attacker who learned the bearer could bypass HMAC by sending
    // a deliberately-invalid signature plus the bearer. Code must reject.
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    const bodyText = JSON.stringify({ subhub_id: 'SH-B5', name: 'Bearer Customer 5', street: '5 Bearer Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MicroGRID-Signature': 'sha256=deadbeef',
        Authorization: `Bearer ${BEARER}`,
      },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects HMAC headers with junk signature even when only bearer is configured (R1 High #1 downgrade-attack guard)', async () => {
    // R1 audit caught this: if SECRET is unset but BEARER_TOKEN is set,
    // an attacker who learned the bearer could attach a junk HMAC header
    // PLUS a valid bearer to bypass the strict-on-HMAC gate. Code must
    // refuse to fall through from a bad-HMAC request to bearer.
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    delete process.env.SUBHUB_WEBHOOK_SECRET
    const bodyText = JSON.stringify({ subhub_id: 'SH-DOWNGRADE', name: 'Downgrade Customer', street: '7 Downgrade Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MicroGRID-Signature': 'sha256=deadbeef',
        Authorization: `Bearer ${BEARER}`,
      },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects empty bearer token (`Authorization: Bearer ` with only whitespace)', async () => {
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    const bodyText = JSON.stringify({ subhub_id: 'SH-EMPTY', name: 'Empty Bearer', street: '8 Empty Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer    ' },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('uses a SEPARATE secret from the HMAC one (#370 leak-amplifier guard)', async () => {
    // If a future refactor accidentally aliases the bearer token to the HMAC
    // secret, this test fails — sending the HMAC secret as a bearer token
    // would succeed, which is the exact regression #370 closed.
    process.env.SUBHUB_WEBHOOK_BEARER_TOKEN = BEARER
    process.env.SUBHUB_WEBHOOK_SECRET = HMAC
    const bodyText = JSON.stringify({ subhub_id: 'SH-B6', name: 'Bearer Customer 6', street: '6 Bearer Ln' })
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HMAC}` },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })
})

// ── Timestamp window (#381 — replay protection) ─────────────────────────────

describe('POST /api/webhooks/subhub — timestamp window', () => {
  function tsSignedRequest(body: object, ts: number) {
    const bodyText = JSON.stringify(body)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const hex = createHmac('sha256', 'webhook-secret-123').update(`${ts}.${bodyText}`).digest('hex')
    return new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MicroGRID-Signature': `sha256=${hex}`,
        'X-MicroGRID-Timestamp': String(ts),
      },
      body: bodyText,
    })
  }

  function dbForProjectCreate() {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: [], error: null })
      if (callCount === 2) return mockChain({ data: [], error: null })
      if (callCount === 3) return mockChain({ data: [{ id: 'PROJ-30100' }], error: null })
      return mockChain({ data: null, error: null })
    })
  }

  it('accepts request with X-MicroGRID-Timestamp inside the 5-min past window', async () => {
    dbForProjectCreate()
    const ts = Date.now() - 60_000 // 1 min ago
    const req = tsSignedRequest({ subhub_id: 'SH-TS1', name: 'Recent Customer', street: '1 Recent Ln' }, ts)
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).not.toBe(401)
  })

  it('rejects request with timestamp older than 5 min', async () => {
    const ts = Date.now() - 6 * 60_000 // 6 min ago
    const req = tsSignedRequest({ subhub_id: 'SH-TS2', name: 'Stale Customer', street: '1 Stale Ln' }, ts)
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects request with timestamp more than 30 sec in the future (asymmetric window)', async () => {
    const ts = Date.now() + 60_000 // 1 min ahead
    const req = tsSignedRequest({ subhub_id: 'SH-TS3', name: 'Future Customer', street: '1 Future Ln' }, ts)
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('rejects malformed (non-numeric) X-MicroGRID-Timestamp', async () => {
    const bodyText = JSON.stringify({ subhub_id: 'SH-TS4', name: 'Bad TS', street: '1 Bad Ln' })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require('node:crypto') as typeof import('node:crypto')
    const hex = createHmac('sha256', 'webhook-secret-123').update(`notanumber.${bodyText}`).digest('hex')
    const req = new Request('https://localhost/api/webhooks/subhub', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MicroGRID-Signature': `sha256=${hex}`,
        'X-MicroGRID-Timestamp': 'notanumber',
      },
      body: bodyText,
    })
    const { POST } = await import('@/app/api/webhooks/subhub/route')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })
})
