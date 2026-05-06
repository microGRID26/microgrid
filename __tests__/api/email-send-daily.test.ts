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

vi.mock('@/lib/email-templates', () => ({
  getTemplate: vi.fn((day: number, name: string) => {
    if (day > 30) return null
    return { subject: `Day ${day} — Welcome ${name}`, html: `<p>Day ${day} content</p>` }
  }),
  getMaxDay: vi.fn(() => 30),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mockSendEmail.mockResolvedValue(true)
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.CRON_SECRET = 'test-cron-secret'
})

afterEach(() => {
  process.env = originalEnv
})

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://localhost/api/email/send-daily', {
    method: 'GET',
    headers,
  })
}

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('GET /api/email/send-daily — auth', () => {
  it('returns 401 when CRON_SECRET is not configured (fail-closed uniformly; #555)', async () => {
    delete process.env.CRON_SECRET
    const req = makeRequest({ Authorization: 'Bearer anything' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token is wrong', async () => {
    const req = makeRequest({ Authorization: 'Bearer wrong-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })
})

// ── Enrollment Loading ──────────────────────────────────────────────────────

describe('GET /api/email/send-daily — enrollment loading', () => {
  it('returns sent: 0 when no active enrollments', async () => {
    const enrollChain = mockChain({ data: [], error: null })
    mockDb.from.mockReturnValue(enrollChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.sent).toBe(0)
    expect(json.message).toBe('No active enrollments')
  })

  it('returns 500 when enrollment query fails', async () => {
    const enrollChain = mockChain({ data: null, error: { message: 'DB error' } })
    mockDb.from.mockReturnValue(enrollChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Failed to load enrollments')
  })

  it('queries email_onboarding with paused=false, completed=false', async () => {
    const enrollChain = mockChain({ data: [], error: null })
    mockDb.from.mockReturnValue(enrollChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    await GET(req)

    expect(mockDb.from).toHaveBeenCalledWith('email_onboarding')
    expect(enrollChain.eq).toHaveBeenCalledWith('paused', false)
    expect(enrollChain.eq).toHaveBeenCalledWith('completed', false)
  })
})

// ── Email Sending & Day Advancement ─────────────────────────────────────────

describe('GET /api/email/send-daily — sending', () => {
  it('sends email and advances day for active enrollment', async () => {
    const updateChain = mockChain({ data: null, error: null })
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{
            id: 'enroll-1',
            user_email: 'user@example.com',
            user_name: 'Sam',
            current_day: 3,
            last_sent_at: null,
            paused: false,
            completed: false,
          }],
          error: null,
        })
      }
      return updateChain
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.sent).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledWith('user@example.com', 'Day 4 — Welcome Sam', '<p>Day 4 content</p>')
  })

  it('skips enrollment if already sent today (double-send prevention)', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const enrollChain = mockChain({
      data: [{
        id: 'enroll-1',
        user_email: 'user@example.com',
        user_name: 'Sam',
        current_day: 3,
        last_sent_at: `${today}T10:00:00Z`,
        paused: false,
        completed: false,
      }],
      error: null,
    })
    mockDb.from.mockReturnValue(enrollChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.skipped).toBe(1)
    expect(json.sent).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('marks enrollment as completed when past max day', async () => {
    const updateChain = mockChain({ data: null, error: null })
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{
            id: 'enroll-1',
            user_email: 'user@example.com',
            user_name: 'Sam',
            current_day: 30, // At max, so next would be 31
            last_sent_at: '2026-03-01T10:00:00Z',
            paused: false,
            completed: false,
          }],
          error: null,
        })
      }
      return updateChain
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.completed).toBe(1)
    expect(json.sent).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('handles sendEmail failure gracefully', async () => {
    mockSendEmail.mockResolvedValue(false)

    const enrollChain = mockChain({
      data: [{
        id: 'enroll-1',
        user_email: 'fail@example.com',
        user_name: 'Fail',
        current_day: 1,
        last_sent_at: null,
        paused: false,
        completed: false,
      }],
      error: null,
    })
    mockDb.from.mockReturnValue(enrollChain)

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.failed).toBe(1)
    expect(json.sent).toBe(0)
    expect(json.errors).toContain('Failed to send to fail@example.com')
  })

  it('uses default name when user_name is null', async () => {
    const updateChain = mockChain({ data: null, error: null })
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [{
            id: 'enroll-1',
            user_email: 'user@example.com',
            user_name: null,
            current_day: 0,
            last_sent_at: null,
            paused: false,
            completed: false,
          }],
          error: null,
        })
      }
      return updateChain
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    await GET(req)

    expect(mockSendEmail.mock.calls[0][1]).toContain('Welcome there')
  })

  it('processes multiple enrollments independently', async () => {
    const updateChain = mockChain({ data: null, error: null })
    let callCount = 0
    mockDb.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return mockChain({
          data: [
            { id: 'e1', user_email: 'a@test.com', user_name: 'A', current_day: 1, last_sent_at: null, paused: false, completed: false },
            { id: 'e2', user_email: 'b@test.com', user_name: 'B', current_day: 5, last_sent_at: null, paused: false, completed: false },
          ],
          error: null,
        })
      }
      return updateChain
    })

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const { GET } = await import('@/app/api/email/send-daily/route')
    const res = await GET(req)
    const json = await res.json()
    expect(json.sent).toBe(2)
    expect(json.total).toBe(2)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })
})

// ── Rate Limiting ───────────────────────────────────────────────────────────

describe('GET /api/email/send-daily — rate limiting', () => {
  it('returns 429 after exceeding rate limit', async () => {
    const { GET } = await import('@/app/api/email/send-daily/route')

    const enrollChain = mockChain({ data: [], error: null })
    mockDb.from.mockReturnValue(enrollChain)

    for (let i = 0; i < 10; i++) {
      const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
      await GET(req)
    }

    const req = makeRequest({ Authorization: 'Bearer test-cron-secret' })
    const res = await GET(req)
    expect(res.status).toBe(429)
  })
})
