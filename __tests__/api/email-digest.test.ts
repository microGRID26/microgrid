import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

function mockChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    in: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    gte: vi.fn(() => chain),
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

const mockSendEmail = vi.fn((..._args: any[]) => Promise.resolve(true))
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}))

vi.mock('@/lib/utils', () => ({
  SLA_THRESHOLDS: {
    evaluation: { target: 3, risk: 5, crit: 7 },
    survey: { target: 5, risk: 10, crit: 14 },
    design: { target: 5, risk: 10, crit: 14 },
    permit: { target: 14, risk: 21, crit: 30 },
    install: { target: 7, risk: 14, crit: 21 },
    inspection: { target: 7, risk: 14, crit: 21 },
  },
  INTERNAL_DOMAINS: ['gomicrogridenergy.com', 'energydevelopmentgroup.com', 'trismartsolar.com'],
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mockSendEmail.mockResolvedValue(true)
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SECRET_KEY = 'test-service-key'
  process.env.CRON_SECRET = 'test-cron-secret'
})

afterEach(() => {
  process.env = originalEnv
})

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://localhost/api/email/digest', {
    method: 'GET',
    headers,
  })
}

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('GET /api/email/digest — auth', () => {
  it('returns 401 when CRON_SECRET is not configured (fail-closed uniformly; #555)', async () => {
    delete process.env.CRON_SECRET
    const req = makeRequest({ Authorization: 'Bearer anything' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    // Post-#555: unconfigured CRON_SECRET, missing header, and wrong token
    // all return 401 — no info-leak via status code about whether env is set.
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token is wrong', async () => {
    const req = makeRequest({ Authorization: 'Bearer wrong-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  it('returns 503 when Supabase is not configured', async () => {
    delete process.env.SUPABASE_SECRET_KEY
    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toBe('Supabase not configured')
  })
})

// ── User Loading ────────────────────────────────────────────────────────────

describe('GET /api/email/digest — user loading', () => {
  it('returns 500 when users query fails', async () => {
    const usersChain = mockChain({ data: null, error: { message: 'DB error' } })
    mockDb.from.mockReturnValue(usersChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    expect(res.status).toBe(500)
  })

  it('returns sent: 0 when no PMs with internal email domains found', async () => {
    const usersChain = mockChain({
      data: [{ id: 'u1', name: 'External', email: 'user@external.com', role: 'user' }],
      error: null,
    })
    mockDb.from.mockReturnValue(usersChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(json.message).toBe('No PMs to notify')
  })
})

// ── Digest Sending ──────────────────────────────────────────────────────────

describe('GET /api/email/digest — sending', () => {
  it('sends digest email to PMs with projects', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // users query
        return mockChain({
          data: [{ id: 'pm-1', name: 'Alice Smith', email: 'alice@gomicrogridenergy.com', role: 'manager' }],
          error: null,
        })
      }
      if (callCount === 2) {
        // projects query
        return mockChain({
          data: [{
            id: 'PROJ-001', name: 'Test Project', stage: 'evaluation',
            stage_date: '2026-03-01', pm: 'Alice Smith', pm_id: 'pm-1',
            blocker: null, disposition: null, follow_up_date: null, contract: 50000,
          }],
          error: null,
        })
      }
      // stuck tasks, schedule, follow-ups
      return mockChain({ data: [], error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toBe('alice@gomicrogridenergy.com')
  })

  it('skips PMs with no projects', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'pm-1', name: 'No Projects', email: 'np@gomicrogridenergy.com', role: 'manager' }],
          error: null,
        })
      }
      // Empty projects
      return mockChain({ data: [], error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('includes blocked project count in subject line', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'pm-1', name: 'Bob Jones', email: 'bob@gomicrogridenergy.com', role: 'manager' }],
          error: null,
        })
      }
      if (callCount === 2) {
        return mockChain({
          data: [
            { id: 'PROJ-1', name: 'Blocked', stage: 'permit', stage_date: '2026-03-01', pm: 'Bob', pm_id: 'pm-1', blocker: 'AHJ delay', disposition: null, follow_up_date: null, contract: 30000 },
          ],
          error: null,
        })
      }
      return mockChain({ data: [], error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    await GET(req)

    const subject = mockSendEmail.mock.calls[0][1]
    expect(subject).toContain('1 blocked')
  })

  it('builds HTML with stat cards and action items', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'pm-1', name: 'Carol Doe', email: 'carol@gomicrogridenergy.com', role: 'admin' }],
          error: null,
        })
      }
      if (callCount === 2) {
        return mockChain({
          data: [
            { id: 'PROJ-1', name: 'Project A', stage: 'evaluation', stage_date: '2026-04-01', pm: 'Carol', pm_id: 'pm-1', blocker: null, disposition: null, follow_up_date: null, contract: 100000 },
          ],
          error: null,
        })
      }
      return mockChain({ data: [], error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    await GET(req)

    const html = mockSendEmail.mock.calls[0][2]
    expect(html).toContain('Good morning, Carol')
    expect(html).toContain('Active')
    expect(html).toContain('Blocked')
    expect(html).toContain('Open Command Center')
  })

  it('reports email send errors in response', async () => {
    mockSendEmail.mockResolvedValue(false)

    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'pm-1', name: 'Fail', email: 'fail@gomicrogridenergy.com', role: 'user' }],
          error: null,
        })
      }
      if (callCount === 2) {
        return mockChain({
          data: [{ id: 'PROJ-1', name: 'P', stage: 'evaluation', stage_date: '2026-04-01', pm: 'Fail', pm_id: 'pm-1', blocker: null, disposition: null, follow_up_date: null, contract: 10000 }],
          error: null,
        })
      }
      return mockChain({ data: [], error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/digest/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(json.errors).toBe(1)
  })
})
