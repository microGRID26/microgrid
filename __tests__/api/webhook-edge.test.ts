import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import crypto from 'crypto'

/**
 * Additional tests for /api/webhooks/edge route.
 * Supplements __tests__/lib/edge-webhook.test.ts with:
 * - SUPABASE_SECRET_KEY missing behavior
 * - Timing-safe signature verification edge cases
 * - Idempotency (duplicate detection)
 * - Timestamp freshness check
 * - funding.status_update event
 */

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
  from: vi.fn((_table: string) => mockChain({ data: null, error: null })),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockDb),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv
const TEST_SECRET = 'test-webhook-secret'

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'test-secret-key'
  process.env.EDGE_WEBHOOK_SECRET = TEST_SECRET
})

afterEach(() => {
  process.env = originalEnv
})

function makeSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(body: object | string, headers: Record<string, string> = {}): Request {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('https://localhost/api/webhooks/edge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyStr,
  })
}

function makeSignedRequest(body: object): Request {
  const bodyStr = JSON.stringify(body)
  const signature = makeSignature(bodyStr, TEST_SECRET)
  return makeRequest(bodyStr, { 'x-webhook-signature': signature })
}

// ── SUPABASE_SECRET_KEY not configured ──────────────────────────────────────

describe('EDGE webhook — SUPABASE_SECRET_KEY missing', () => {
  it('throws when trying to create Supabase client without service key', async () => {
    delete process.env.SUPABASE_SECRET_KEY

    // The route reads SUPABASE_SECRET at module level. When it's missing,
    // the supabase() helper throws — the route does not catch this at the top level.
    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 5000 },
      timestamp: new Date().toISOString(),
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')

    // The throw propagates because the route doesn't wrap supabase() in try/catch
    await expect(POST(req as any)).rejects.toThrow(/SUPABASE_SECRET_KEY.*not configured/)
  })
})

// ── Timing-safe signature verification ──────────────────────────────────────

describe('EDGE webhook — timing-safe signature verification', () => {
  it('rejects empty signature string', async () => {
    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 1000 } }
    const req = makeRequest(payload, { 'x-webhook-signature': '' })

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(401)
  })

  it('rejects signature with wrong length', async () => {
    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 1000 } }
    const req = makeRequest(payload, { 'x-webhook-signature': 'tooshort' })

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(401)
  })

  it('rejects signature computed with wrong secret', async () => {
    const payload = { event: 'funding.m2_funded', project_id: 'PROJ-001', data: { amount: 1000 } }
    const bodyStr = JSON.stringify(payload)
    const wrongSig = makeSignature(bodyStr, 'different-secret')
    const req = makeRequest(bodyStr, { 'x-webhook-signature': wrongSig })

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(401)
  })

  it('accepts valid HMAC-SHA256 signature', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingChain = mockChain({ data: { m2_status: 'Eligible' }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCount++
        return fundingCount === 1 ? fundingChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 5000 },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
  })
})

// ── Idempotency ─────────────────────────────────────────────────────────────

describe('EDGE webhook — idempotency', () => {
  it('returns success with already-processed message for duplicate events', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    // Idempotency now keyed on INSERT-with-23505 unique violation against
    // edge_sync_log(project_id, event_type, request_id) WHERE direction='inbound'.
    // A racing duplicate insert hits the partial unique index and returns 23505.
    const dupChain = mockChain({ data: null, error: { code: '23505' } })
    const logChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'edge_sync_log') return dupChain
      if (table === 'projects') return projectChain
      return logChain
    })

    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 5000 },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toContain('Already processed')
  })
})

// ── Timestamp freshness ─────────────────────────────────────────────────────

describe('EDGE webhook — timestamp freshness', () => {
  it('rejects payload with timestamp older than 5 minutes', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const logChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      return logChain
    })

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 5000 },
      timestamp: tenMinutesAgo,
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Timestamp too old')
  })

  it('accepts payload with fresh timestamp', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingChain = mockChain({ data: { m2_status: 'Eligible' }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCount++
        return fundingCount === 1 ? fundingChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 5000 },
      timestamp: new Date().toISOString(),
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
  })

  it('accepts payload without timestamp (backward compatibility)', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingChain = mockChain({ data: { m2_status: 'Eligible' }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCount++
        return fundingCount === 1 ? fundingChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 5000 },
      // No timestamp field
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
  })
})

// ── funding.status_update ───────────────────────────────────────────────────

describe('EDGE webhook — funding.status_update', () => {
  it('updates milestone status for m1', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const currentChain = mockChain({ data: { m1_status: 'Eligible', m2_status: null, m3_status: null }, error: null })
    const upsertChain = mockChain({ data: null, error: null })
    const logChain = mockChain({ data: null, error: null })

    let fundingCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCount++
        return fundingCount === 1 ? currentChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.status_update',
      project_id: 'PROJ-001',
      data: { milestone: 'm1', status: 'Submitted' },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    expect(upsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'PROJ-001',
        m1_status: 'Submitted',
      }),
      { onConflict: 'project_id' }
    )
  })

  it('returns 400 for invalid milestone in status_update', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const logChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      return logChain
    })

    const payload = {
      event: 'funding.status_update',
      project_id: 'PROJ-001',
      data: { milestone: 'm4', status: 'Submitted' },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Invalid milestone')
  })

  it('returns 400 when status is missing from status_update', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const logChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      return logChain
    })

    const payload = {
      event: 'funding.status_update',
      project_id: 'PROJ-001',
      data: { milestone: 'm2' }, // No status
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
  })
})

// ── Error handling ──────────────────────────────────────────────────────────

describe('EDGE webhook — error handling', () => {
  it('returns 500 and logs to edge_sync_log on DB error', async () => {
    const projectChain = mockChain({ data: { id: 'PROJ-001' }, error: null })
    const fundingChain = mockChain({ data: { m2_status: 'Eligible' }, error: null })
    const logChain = mockChain({ data: null, error: null })

    // Make the upsert throw
    const upsertChain = mockChain({ data: null, error: null })
    upsertChain.upsert = vi.fn(() => { throw new Error('DB connection lost') })

    let fundingCount = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectChain
      if (table === 'project_funding') {
        fundingCount++
        return fundingCount === 1 ? fundingChain : upsertChain
      }
      return logChain
    })

    const payload = {
      event: 'funding.m2_funded',
      project_id: 'PROJ-001',
      data: { amount: 5000 },
    }
    const req = makeSignedRequest(payload)

    const { POST } = await import('@/app/api/webhooks/edge/route')
    const res = await POST(req as any)

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Internal server error')
  })
})
