import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

function mockChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    lt: vi.fn(() => chain),
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

const mockSendEmail = vi.fn((..._args: any[]) => Promise.resolve(true))
vi.mock('@/lib/email', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
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
  return new Request('https://localhost/api/email/onboarding-reminder', {
    method: 'GET',
    headers,
  })
}

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('GET /api/email/onboarding-reminder — auth', () => {
  it('returns 401 when CRON_SECRET is not configured (fail-closed uniformly; #555)', async () => {
    delete process.env.CRON_SECRET
    const req = makeRequest({ Authorization: 'Bearer anything' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token is wrong', async () => {
    const req = makeRequest({ Authorization: 'Bearer wrong-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 503 when Supabase is not configured', async () => {
    delete process.env.SUPABASE_SECRET_KEY
    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    expect(res.status).toBe(503)
  })
})

// ── Stale Document Detection ────────────────────────────────────────────────

describe('GET /api/email/onboarding-reminder — stale detection', () => {
  it('returns sent: 0 when no stale documents found', async () => {
    const staleChain = mockChain({ data: [], error: null })
    mockDb.from.mockReturnValue(staleChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(json.message).toBe('No stale documents found')
  })

  it('returns 500 when stale documents query fails', async () => {
    const staleChain = mockChain({ data: null, error: { message: 'Query error' } })
    mockDb.from.mockReturnValue(staleChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Query failed')
  })

  it('queries onboarding_documents with sent status and cutoff filter', async () => {
    const staleChain = mockChain({ data: [], error: null })
    mockDb.from.mockReturnValue(staleChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    await GET(req)

    expect(mockDb.from).toHaveBeenCalledWith('onboarding_documents')
    expect(staleChain.eq).toHaveBeenCalledWith('status', 'sent')
    expect(staleChain.lt).toHaveBeenCalledWith('sent_at', expect.any(String))
  })
})

// ── Reminder Sending ────────────────────────────────────────────────────────

describe('GET /api/email/onboarding-reminder — sending', () => {
  it('sends reminder emails to reps with stale documents', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // onboarding_documents
        return mockChain({
          data: [{
            id: 'doc-1', rep_id: 'rep-1', requirement_id: 'req-1',
            sent_at: '2026-03-30T00:00:00Z',
          }],
          error: null,
        })
      }
      if (callCount === 2) {
        // sales_reps
        return mockChain({
          data: [{ id: 'rep-1', first_name: 'John', last_name: 'Doe', email: 'john@example.com' }],
          error: null,
        })
      }
      if (callCount === 3) {
        // onboarding_requirements
        return mockChain({
          data: [{ id: 'req-1', name: 'W-9 Form' }],
          error: null,
        })
      }
      // update calls
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0][0]).toBe('john@example.com')
    expect(mockSendEmail.mock.calls[0][1]).toContain('W-9 Form')
  })

  it('updates document notes after successful reminder', async () => {
    const updateChain = mockChain({ data: null, error: null })
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'doc-1', rep_id: 'rep-1', requirement_id: 'req-1', sent_at: '2026-03-30T00:00:00Z' }],
          error: null,
        })
      }
      if (callCount === 2) {
        return mockChain({
          data: [{ id: 'rep-1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' }],
          error: null,
        })
      }
      if (callCount === 3) {
        return mockChain({
          data: [{ id: 'req-1', name: 'License' }],
          error: null,
        })
      }
      return updateChain
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    await GET(req)

    // Verify update was called on onboarding_documents
    expect(mockDb.from).toHaveBeenCalledWith('onboarding_documents')
  })

  it('skips reps without email', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'doc-1', rep_id: 'rep-1', requirement_id: 'req-1', sent_at: '2026-03-30T00:00:00Z' }],
          error: null,
        })
      }
      if (callCount === 2) {
        return mockChain({
          data: [{ id: 'rep-1', first_name: 'No', last_name: 'Email', email: null }],
          error: null,
        })
      }
      if (callCount === 3) {
        return mockChain({
          data: [{ id: 'req-1', name: 'Doc' }],
          error: null,
        })
      }
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('reports failures when sendEmail returns false', async () => {
    mockSendEmail.mockResolvedValue(false)

    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'doc-1', rep_id: 'rep-1', requirement_id: 'req-1', sent_at: '2026-03-30T00:00:00Z' }],
          error: null,
        })
      }
      if (callCount === 2) {
        return mockChain({
          data: [{ id: 'rep-1', first_name: 'Bob', last_name: 'Fail', email: 'bob@example.com' }],
          error: null,
        })
      }
      if (callCount === 3) {
        return mockChain({
          data: [{ id: 'req-1', name: 'Agreement' }],
          error: null,
        })
      }
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(json.errors).toBe(1)
  })

  it('uses fallback document name when requirement not found', async () => {
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{ id: 'doc-1', rep_id: 'rep-1', requirement_id: 'unknown-req', sent_at: '2026-03-30T00:00:00Z' }],
          error: null,
        })
      }
      if (callCount === 2) {
        return mockChain({
          data: [{ id: 'rep-1', first_name: 'Pat', last_name: 'User', email: 'pat@example.com' }],
          error: null,
        })
      }
      if (callCount === 3) {
        // No matching requirements
        return mockChain({ data: [], error: null })
      }
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/onboarding-reminder/route')
    await GET(req)

    const subject = mockSendEmail.mock.calls[0][1]
    expect(subject).toContain('Document')
  })
})
