import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

function mockChain(result: { data: any; error: any; count?: number }) {
  const chain: any = {
    select: vi.fn((..._args: any[]) => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    in: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    gt: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    is: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: any) => Promise.resolve({ data: result.data, error: result.error, count: result.count ?? 0 }).then(cb)),
  }
  return chain
}

const mockDb = {
  from: vi.fn((_table: string) => mockChain({ data: [], error: null, count: 0 })),
  auth: {
    getUser: vi.fn((): Promise<{ data: { user: any }; error: any }> => Promise.resolve({
      data: { user: { id: 'user-1', email: 'test@gomicrogridenergy.com' } },
      error: null,
    })),
  },
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockDb),
}))

// Route now uses @supabase/ssr's createServerClient + next/headers cookies()
// for the auth-checking client (the basic createClient doesn't parse Supabase
// auth cookies). Mock both so getUserSupabase() returns the same mockDb.
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => mockDb),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [{ name: 'sb-test', value: 'session-cookie' }],
    setAll: () => {},
  })),
}))

vi.mock('@/lib/utils', () => ({
  escapeIlike: vi.fn((str: string) => str),
}))

const mockAnthropicCreate = vi.fn()
class MockAnthropic {
  messages = { create: mockAnthropicCreate }
}
vi.mock('@anthropic-ai/sdk', () => ({
  default: MockAnthropic,
  __esModule: true,
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key'
})

afterEach(() => {
  process.env = originalEnv
})

function makeRequest(body: object | string = {}): Request {
  const req = new Request('https://localhost/api/reports/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'sb-test=session-cookie',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  // Polyfill cookies for NextRequest compatibility
  ;(req as any).cookies = {
    getAll: () => [{ name: 'sb-test', value: 'session-cookie' }],
  }
  return req
}

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/reports/chat — auth', () => {
  it('returns 503 when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const req = makeRequest({ message: 'Show me blocked projects' })
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toContain('ANTHROPIC_API_KEY')
  })

  it('returns 401 when user is not authenticated', async () => {
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    })

    const req = makeRequest({ message: 'Show blocked' })
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 when user role is insufficient (not manager+)', async () => {
    // User auth passes
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    // Role check returns 'user' (below manager)
    const roleChain = mockChain({ data: { role: 'user' }, error: null })
    mockDb.from.mockReturnValueOnce(roleChain)

    const req = makeRequest({ message: 'Show all' })
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('Manager role required')
  })
})

// ── Input Validation ────────────────────────────────────────────────────────

describe('POST /api/reports/chat — validation', () => {
  it('returns 400 when message is missing', async () => {
    // Auth passes with manager role
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: { role: 'manager' }, error: null }))

    const req = makeRequest({})
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('message')
  })

  it('returns 400 for invalid JSON body', async () => {
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: { role: 'admin' }, error: null }))

    const req = makeRequest('not-valid-json')
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid JSON body')
  })
})

// ── Query Generation & Execution ────────────────────────────────────────────

describe('POST /api/reports/chat — query execution', () => {
  it('generates and executes a valid query plan', async () => {
    // Auth + role
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: { role: 'admin' }, error: null }))

    // Claude returns valid query plan
    mockAnthropicCreate.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          description: 'All blocked projects',
          query: {
            table: 'projects',
            select: 'id, name, blocker',
            filters: [{ field: 'blocker', op: 'is_not_null' }],
            limit: 100,
          },
          followUp: 'Want to see details?',
        }),
      }],
    })

    // Query execution result
    const queryChain = mockChain({
      data: [{ id: 'PROJ-1', name: 'Test', blocker: 'AHJ delay' }],
      error: null,
      count: 1,
    })
    mockDb.from.mockReturnValueOnce(queryChain)

    const req = makeRequest({ message: 'Show me blocked projects' })
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.description).toBe('All blocked projects')
    expect(json.results).toHaveLength(1)
    expect(json.followUp).toBe('Want to see details?')
  })

  it('rejects query plan targeting disallowed table', async () => {
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: { role: 'super_admin' }, error: null }))

    mockAnthropicCreate.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          description: 'User list',
          query: {
            table: 'users',
            select: 'id, email',
            filters: [],
            limit: 50,
          },
        }),
      }],
    })

    const req = makeRequest({ message: 'List all users' })
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('not in the allowed list')
  })

  it('handles unparseable AI response', async () => {
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: { role: 'manager' }, error: null }))

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Sorry, I cannot parse that request' }],
    })

    const req = makeRequest({ message: 'What is the meaning of life?' })
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('Failed to parse')
  })

  it('strips markdown code fences from AI response', async () => {
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: { role: 'admin' }, error: null }))

    const plan = {
      description: 'Test',
      query: { table: 'projects', select: 'id', filters: [], limit: 10 },
    }
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n' + JSON.stringify(plan) + '\n```' }],
    })

    mockDb.from.mockReturnValueOnce(mockChain({ data: [], error: null, count: 0 }))

    const req = makeRequest({ message: 'List projects' })
    const { POST } = await import('@/app/api/reports/chat/route')
    const res = await POST(req as any)
    expect(res.status).toBe(200)
  })

  it('passes conversation history for context', async () => {
    mockDb.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: { role: 'admin' }, error: null }))

    const plan = {
      description: 'Follow up',
      query: { table: 'projects', select: 'id', filters: [], limit: 10 },
    }
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(plan) }],
    })
    mockDb.from.mockReturnValueOnce(mockChain({ data: [], error: null, count: 0 }))

    const req = makeRequest({
      message: 'Now filter by Houston',
      history: [
        { role: 'user', content: 'Show all projects' },
        { role: 'assistant', content: '{"description":"all"}' },
      ],
    })
    const { POST } = await import('@/app/api/reports/chat/route')
    await POST(req as any)

    const callArgs = mockAnthropicCreate.mock.calls[0][0]
    expect(callArgs.messages).toHaveLength(3)
    expect(callArgs.messages[0].content).toBe('Show all projects')
    expect(callArgs.messages[2].content).toBe('Now filter by Houston')
  })
})

// ── Rate Limiting ───────────────────────────────────────────────────────────

describe('POST /api/reports/chat — rate limiting', () => {
  it('returns 429 after exceeding per-minute rate limit', async () => {
    const { POST } = await import('@/app/api/reports/chat/route')

    // Setup auth + role to pass on every call
    mockDb.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@test.com' } },
      error: null,
    })
    mockDb.from.mockReturnValue(mockChain({ data: { role: 'admin' }, error: null }))

    const plan = { description: 'Test', query: { table: 'projects', select: 'id', filters: [], limit: 10 } }
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(plan) }],
    })

    for (let i = 0; i < 10; i++) {
      const req = makeRequest({ message: `query ${i}` })
      await POST(req as any)
    }

    const req = makeRequest({ message: 'one more' })
    const res = await POST(req as any)
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error).toContain('Rate limit')
  })
})
