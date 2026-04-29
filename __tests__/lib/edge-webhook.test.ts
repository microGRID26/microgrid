import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import crypto from 'crypto'

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock Supabase createClient used by the route
const mockChainResult = { data: null, error: null }

function mockChain(result: { data: any; error: any } = mockChainResult) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: any) => Promise.resolve(result).then(cb)),
  }
  return chain
}

const mockDb = {
  from: vi.fn((_table: string) => mockChain()),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockDb),
}))

// ── Helpers ─────────────────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  originalEnv = { ...process.env }
  // Set defaults for the route
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key'
})

afterEach(() => {
  process.env = originalEnv
})

const TEST_SECRET = 'test-webhook-secret'

function makeSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(body: object | string, headers: Record<string, string> = {}): Request {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://localhost/api/webhooks/edge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: bodyStr,
  })
}

/** Create a signed request with the test secret */
function makeSignedRequest(body: object): Request {
  const bodyStr = JSON.stringify(body)
  const signature = makeSignature(bodyStr, TEST_SECRET)
  return makeRequest(bodyStr, { 'x-webhook-signature': signature })
}

// ── Inbound Webhook Validation ──────────────────────────────────────────────

describe('EDGE inbound webhook — signature validation', () => {
  it('rejects request with wrong signature when secret is configured', async () => {
    process.env.EDGE_WEBHOOK_SECRET = 'real-secret'

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 5000 } }
    const req = makeRequest(payload, { 'x-webhook-signature': 'invalid-signature-here' })

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('accepts request with correct signature', async () => {
    process.env.EDGE_WEBHOOK_SECRET = 'test-webhook-secret'

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 5000 } }
    const bodyStr = JSON.stringify(payload)
    const signature = makeSignature(bodyStr, 'test-webhook-secret')

    // Mock project exists
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingChain = mockChain({ data: { m2_status: 'Eligible', m2_amount: null, m2_funded_date: null }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        callCount++
        return callCount === 1 ? fundingChain : upsertChain
      }
      return logChain
    })

    const req = makeRequest(bodyStr, { 'x-webhook-signature': signature })

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
  })

  it('returns 503 when no secret is configured', async () => {
    delete process.env.EDGE_WEBHOOK_SECRET

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 5000 } }

    const req = makeRequest(payload) // No signature header
    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    // Should reject because no secret = not configured
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('Webhook secret not configured')
  })
})

// ── Missing required fields ─────────────────────────────────────────────────

describe('EDGE inbound webhook — validation', () => {
  it('returns 400 when project_id is missing', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const payload = { event: 'funding.m2_funded', data: { amount: 5000 } }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Missing required fields')
  })

  it('returns 400 when event is missing', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const payload = { project_id: 'PROJ-001', data: { amount: 5000 } }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Missing required fields')
  })

  it('returns 400 when data field is missing', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001' }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Missing or invalid data')
  })

  it('returns 400 for invalid JSON', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const bodyStr = 'not-valid-json{{{'
    const signature = makeSignature(bodyStr, TEST_SECRET)
    const req = makeRequest(bodyStr, { 'x-webhook-signature': signature })
    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid JSON')
  })

  it('returns 404 when project does not exist', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      return logChain
    })

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-GHOST', data: { amount: 5000 } }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toContain('PROJ-GHOST')
  })

  it('returns 400 for unknown event type', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const logChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      return logChain
    })

    const payload = { event: 'unknown.event', project_id: 'PROJ-001', data: { foo: 'bar' } }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Unknown event type')
  })
})

// ── funding.m2_funded ───────────────────────────────────────────────────────

describe('EDGE inbound webhook — funding.m2_funded', () => {
  it('updates project_funding with M2 amount and date', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const currentFunding = { m2_status: 'Eligible', m2_amount: null, m2_funded_date: null }
    const selectChain = mockChain({ data: currentFunding, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        if (fundingCallCount === 1) return selectChain   // Current values for audit
        return upsertChain                                // Upsert
      }
      if (table === 'audit_log') return logChain
      if (table === 'edge_sync_log') return logChain
      return logChain
    })

    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 12500, funded_date: '2026-03-20' },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.event).toBe('funding.m2_funded')

    // Verify upsert was called with correct fields
    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'PROJ-001',
        m2_status: 'Funded',
        m2_amount: 12500,
        m2_funded_date: '2026-03-20',
      }),
      { onConflict: 'project_id' }
    )
  })

  it('uses today as funded_date when not provided', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const selectChain = mockChain({ data: { m2_status: 'Eligible', m2_amount: 10000, m2_funded_date: null }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        return fundingCallCount === 1 ? selectChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 8000 }, // No funded_date
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)

    const upsertCall = upsertChain.upsert.mock.calls[0][0]
    expect(upsertCall.m2_funded_date).toMatch(/^\d{4}-\d{2}-\d{2}$/) // Today's date in ISO format
  })
})

// ── funding.m3_funded ───────────────────────────────────────────────────────

describe('EDGE inbound webhook — funding.m3_funded', () => {
  it('updates project_funding with M3 amount and date', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-002' }, error: null })
    const currentFunding = { m3_status: 'Eligible', m3_amount: null, m3_funded_date: null }
    const selectChain = mockChain({ data: currentFunding, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        return fundingCallCount === 1 ? selectChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.m3_funded',
      project_id: 'PROJ-002',
      data: { amount: 7500, funded_date: '2026-04-01' },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.event).toBe('funding.m3_funded')

    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'PROJ-002',
        m3_status: 'Funded',
        m3_amount: 7500,
        m3_funded_date: '2026-04-01',
      }),
      { onConflict: 'project_id' }
    )
  })
})

// ── funding.rejected ────────────────────────────────────────────────────────

describe('EDGE inbound webhook — funding.rejected', () => {
  it('updates M2 status to Rejected with reason', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-003' }, error: null })
    const currentFunding = { m2_status: 'Submitted', m3_status: null }
    const selectChain = mockChain({ data: currentFunding, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        return fundingCallCount === 1 ? selectChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.rejected',
      project_id: 'PROJ-003',
      data: { milestone: 'm2', reason: 'Missing documentation' },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)

    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'PROJ-003',
        m2_status: 'Rejected',
        m2_notes: 'Missing documentation',
      }),
      { onConflict: 'project_id' }
    )
  })

  it('updates M3 status to Rejected', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-004' }, error: null })
    const selectChain = mockChain({ data: { m2_status: 'Funded', m3_status: 'Submitted' }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        return fundingCallCount === 1 ? selectChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.rejected',
      project_id: 'PROJ-004',
      data: { milestone: 'm3', reason: 'PTO not verified' },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)

    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'PROJ-004',
        m3_status: 'Rejected',
        m3_notes: 'PTO not verified',
      }),
      { onConflict: 'project_id' }
    )
  })

  it('returns 400 for invalid milestone value', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-005' }, error: null })
    const logChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      return logChain
    })

    const payload = {
      event: 'funding.rejected',
      project_id: 'PROJ-005',
      data: { milestone: 'm1', reason: 'Not valid' }, // m1 is not valid for rejection
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Invalid milestone')
  })
})

// ── Idempotency (#378 — server-side request_id + INSERT ON CONFLICT) ─────────

describe('EDGE inbound webhook — idempotency claim', () => {
  it('claims an edge_sync_log row with status=pending before processing', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingSelect = mockChain({ data: { m2_status: 'Eligible', m2_amount: null, m2_funded_date: null }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const syncLogChain = mockChain({ data: null, error: null })
    const auditChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        return fundingCallCount === 1 ? fundingSelect : upsertChain
      }
      if (table === 'edge_sync_log') return syncLogChain
      if (table === 'audit_log') return auditChain
      return syncLogChain
    })

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 5000 } }
    const req = makeSignedRequest(payload)
    const { POST } = await import('@/app/api/webhooks/edge/route')
    await POST(req as any)

    // Initial claim insert with status: 'pending'
    expect(syncLogChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'PROJ-001',
        event_type: 'funding.m2_funded',
        direction: 'inbound',
        status: 'pending',
        response_code: 0,
        request_id: expect.any(String),
      }),
    )
    // Final update flips status to 'delivered' / 200
    expect(syncLogChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered', response_code: 200, error_message: null }),
    )
  })

  it('uses X-EDGE-Event-Id header as request_id when provided', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingSelect = mockChain({ data: { m2_status: 'Eligible', m2_amount: null, m2_funded_date: null }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const syncLogChain = mockChain({ data: null, error: null })
    const auditChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        return fundingCallCount === 1 ? fundingSelect : upsertChain
      }
      if (table === 'edge_sync_log') return syncLogChain
      if (table === 'audit_log') return auditChain
      return syncLogChain
    })

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 5000 } }
    const bodyStr = JSON.stringify(payload)
    const signature = makeSignature(bodyStr, TEST_SECRET)
    const req = makeRequest(bodyStr, {
      'x-webhook-signature': signature,
      'X-EDGE-Event-Id': 'edge-evt-deadbeef',
    })
    const { POST } = await import('@/app/api/webhooks/edge/route')
    await POST(req as any)

    expect(syncLogChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: 'edge-evt-deadbeef' }),
    )
  })

  it('falls back to sha256(body) when X-EDGE-Event-Id is absent', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingSelect = mockChain({ data: { m2_status: 'Eligible', m2_amount: null, m2_funded_date: null }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const syncLogChain = mockChain({ data: null, error: null })
    const auditChain = mockChain({ data: null, error: null })

    let fundingCallCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCallCount++
        return fundingCallCount === 1 ? fundingSelect : upsertChain
      }
      if (table === 'edge_sync_log') return syncLogChain
      if (table === 'audit_log') return auditChain
      return syncLogChain
    })

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 5000 } }
    const bodyStr = JSON.stringify(payload)
    const expectedHash = crypto.createHash('sha256').update(bodyStr).digest('hex')
    const req = makeSignedRequest(payload)
    const { POST } = await import('@/app/api/webhooks/edge/route')
    await POST(req as any)

    expect(syncLogChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: expectedHash }),
    )
  })

  it('returns 200 "Already processed" when claim INSERT hits 23505 (concurrent replay)', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    // edge_sync_log INSERT returns Postgres unique-violation
    const dupChain = mockChain({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'edge_sync_log') return dupChain
      // projects + project_funding should NEVER be touched on this path
      return mockChain({ data: null, error: { message: 'should not be called after dedup' } })
    })

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 5000 } }
    const req = makeSignedRequest(payload)
    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.duplicate).toBe(true)
  })

  it('finalizes status=failed when project lookup misses', async () => {
    process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET

    const projectChain = mockChain({ data: null, error: null }) // missing
    const syncLogChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'edge_sync_log') return syncLogChain
      return syncLogChain
    })

    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-GHOST', data: { amount: 5000 } }
    const req = makeSignedRequest(payload)
    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(404)
    expect(syncLogChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', response_code: 404, error_message: 'Project not found' }),
    )
  })
})

// ── GET health check ────────────────────────────────────────────────────────

describe('EDGE inbound webhook — GET health check', () => {
  it('returns status indicating secret configuration', async () => {
    process.env.EDGE_WEBHOOK_SECRET = 'configured'

    const { GET } = await import('@/app/api/webhooks/edge/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('configured')
  })
})
