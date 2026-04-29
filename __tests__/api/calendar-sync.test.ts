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
    gte: vi.fn(() => chain),
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

// Default mocks: `users` lookup returns a manager so the new role-gate (added
// 2026-04-28 per audit-rotation #353) passes; `org_memberships` returns a
// matching org row so the crew-ownership gate (#362, added 2026-04-29) passes;
// everything else returns null. Tests that exercise role/org-rejection override
// this in-test. Lookup is by email per lib/auth/role-gate.ts (R2 audit fix —
// id-based lookup silently 403s most legitimate users).
const DEFAULT_ORG = 'a0000000-0000-0000-0000-000000000001'
const mockDb = {
  from: vi.fn((table: string) => {
    if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
    if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
    return mockChain({ data: null, error: null })
  }),
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockDb),
}))

// Mock Google Calendar module
const mockIsConfigured = vi.fn().mockReturnValue(true)
const mockCreateCalendar = vi.fn().mockResolvedValue('cal-123')
const mockUpsertEvent = vi.fn().mockResolvedValue({ eventId: 'evt-123', meetLink: null })
const mockDeleteEvent = vi.fn().mockResolvedValue(true)
const mockBuildTitle = vi.fn().mockReturnValue('Install - Smith Residence')
const mockBuildDescription = vi.fn().mockReturnValue('Install job for PROJ-1')

vi.mock('@/lib/google-calendar', () => ({
  isGoogleCalendarConfigured: () => mockIsConfigured(),
  createCalendar: (...args: any[]) => mockCreateCalendar(...args),
  upsertCalendarEvent: (...args: any[]) => mockUpsertEvent(...args),
  deleteCalendarEvent: (...args: any[]) => mockDeleteEvent(...args),
  buildEventTitle: (...args: any[]) => mockBuildTitle(...args),
  buildEventDescription: (...args: any[]) => mockBuildDescription(...args),
}))

// Mock @supabase/ssr for session validation
const mockAuthUser = { id: 'user-1', email: 'test@gomicrogridenergy.com' }
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: mockAuthUser }, error: null })),
    },
  })),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  originalEnv = { ...process.env }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  process.env.SUPABASE_SECRET_KEY = 'test-service-key'
  mockIsConfigured.mockReturnValue(true)
  // Restore default mockDb.from each test so per-test `mockImplementation`
  // overrides don't pollute subsequent tests.
  mockDb.from.mockImplementation((table: string) => {
    if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
    if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
    return mockChain({ data: null, error: null })
  })
})

afterEach(() => {
  process.env = originalEnv
})

function makeRequest(body: object, headers: Record<string, string> = {}): Request {
  return new Request('https://localhost/api/calendar/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

// ── GET health check ─────────────────────────────────────────────────────────

describe('GET /api/calendar/sync — health check', () => {
  it('returns status with configured flag', async () => {
    const { GET } = await import('@/app/api/calendar/sync/route')
    const res = await GET()

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
    expect(json.configured).toBe(true)
    expect(json.timestamp).toBeDefined()
  })
})

// ── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/calendar/sync — auth', () => {
  it('returns 401 when no valid session', async () => {
    const { createServerClient } = await import('@supabase/ssr')
    ;(createServerClient as any).mockReturnValueOnce({
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      },
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('Unauthorized')
  })

  // ── Role-gate negative tests (R2 audit 2026-04-28) ─────────────────────────
  // The original P0 #353 was "any auth user can wipe any crew calendar" —
  // these tests document the closed surface.

  it('returns 403 when authenticated session has no public.users row (portal customer case)', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: null, error: null })  // no public.users row
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('manager+ required')
  })

  it('returns 403 when role=user (sales rep case)', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { role: 'user', active: true }, error: null })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
  })

  it('returns 403 when role is null', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { role: null, active: true }, error: null })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
  })

  // ── Crew-ownership gate (#362, R2 follow-up to #353) ───────────────────────
  // The role gate above bounds the blast radius to ~15 staff; #362 closes the
  // remaining "manager-A wipes crew-B" cross-org gap.

  it('returns 403 when caller has no org_memberships row (#363 backfill gap)', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [], error: null })  // no orgs
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('no org membership')
  })

  it('returns 403 when full_sync targets a crew in a different org', async () => {
    const OTHER_ORG = 'b0000000-0000-0000-0000-000000000002'
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'crews') return mockChain({ data: { id: 'crew-x', org_id: OTHER_ORG }, error: null })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ action: 'full_sync', crew_id: 'crew-x' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('crew not in your org')
  })

  it('returns 404 when full_sync targets a non-existent crew', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'crews') return mockChain({ data: null, error: null })  // no crew
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ action: 'full_sync', crew_id: 'crew-ghost' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(404)
  })

  it('returns 403 when delete targets schedule_ids whose crews are in another org', async () => {
    const OTHER_ORG = 'b0000000-0000-0000-0000-000000000002'
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'schedule') return mockChain({
        data: [{ id: 's-from-other-org', crew_id: 'crew-x' }],
        error: null,
      })
      if (table === 'crews') return mockChain({
        data: [{ id: 'crew-x', org_id: OTHER_ORG }],
        error: null,
      })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s-from-other-org'], action: 'delete' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('outside your org')
  })

  // R1 audit (HIGH): orphan-leak via missing rows. If the request mixes a
  // valid owned id with an id that doesn't exist (or whose crew was deleted),
  // the first-draft fix would silently let the orphan through to handleSync.
  it('returns 404 when one of the schedule_ids does not exist (orphan-leak guard)', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'schedule') return mockChain({
        // Caller asked for ['s-mine','s-ghost'] but schedule only returns the owned one.
        data: [{ id: 's-mine', crew_id: 'crew-1' }],
        error: null,
      })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s-mine', 's-ghost'], action: 'delete' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(404)
  })

  it('returns 403 when a schedule has a NULL crew_id (cannot prove org ownership)', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'schedule') return mockChain({
        data: [{ id: 's-orphan', crew_id: null }],
        error: null,
      })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s-orphan'], action: 'delete' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain('no crew assignment')
  })

  // R1 audit (MEDIUM): membership lookup error must surface as 500, not silent 403.
  it('returns 500 when org_memberships lookup errors (vs silently denying)', async () => {
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: null, error: { message: 'connection lost' } })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('Membership lookup')
  })

  it('admin role bypasses the org check (can act across orgs)', async () => {
    // Even with no org_memberships rows, an admin should pass. Admins are
    // explicitly trusted to cross orgs (e.g. Greg in a multi-org future).
    const syncEntries = [{ id: 'sync-1', schedule_id: 's1', calendar_id: 'cal-1', event_id: 'evt-1' }]
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'admin', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [], error: null })  // no orgs — would 403 a manager
      if (table === 'calendar_sync') return mockChain({ data: syncEntries, error: null })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'], action: 'delete' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)  // not 403
  })

  it('returns 403 when active=false', async () => {
    mockDb.from.mockImplementation((table: string) => {
      // The role-gate helper queries `WHERE active=true` so an inactive row
      // returns no match — same shape as the no-row case above.
      if (table === 'users') return mockChain({ data: null, error: null })
      return mockChain({ data: null, error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(403)
  })
})

// ── Configuration ────────────────────────────────────────────────────────────

describe('POST /api/calendar/sync — configuration', () => {
  it('returns 500 when SUPABASE_SECRET_KEY not configured', async () => {
    delete process.env.SUPABASE_SECRET_KEY

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(500)
  })

  it('returns 503 when Google Calendar not configured', async () => {
    mockIsConfigured.mockReturnValue(false)

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error).toContain('Google Calendar not configured')
  })
})

// ── Validation ───────────────────────────────────────────────────────────────

describe('POST /api/calendar/sync — validation', () => {
  it('returns 400 when no schedule_ids or action provided', async () => {
    const req = makeRequest({})
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Missing schedule_ids')
  })

  it('returns 400 when batch size exceeds maximum', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `s-${i}`)
    const req = makeRequest({ schedule_ids: ids })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Batch size exceeds maximum')
  })
})

// ── Sync action ──────────────────────────────────────────────────────────────

describe('POST /api/calendar/sync — sync action', () => {
  it('syncs schedule entries and returns results', async () => {
    const schedule = {
      id: 's1',
      project_id: 'PROJ-1',
      crew_id: 'crew-1',
      job_type: 'install',
      date: '2026-04-10',
      end_date: '2026-04-11',
      time: '08:00',
      notes: 'Big system',
      status: 'scheduled',
      project: { name: 'Smith Residence', city: 'Houston', address: '123 Main St' },
    }

    const schedChain = mockChain({ data: [schedule], error: null })
    // Three `from('schedule')` calls happen now:
    //   1. assertSchedulesInOrgs: select id, crew_id  → must return id
    //   2. (then 'crews' select id, org_id is called separately)
    //   3. handleSync: select *, project:projects(...)  → returns full schedule row
    const schedAssertChain = mockChain({ data: [{ id: 's1', crew_id: 'crew-1' }], error: null })
    let scheduleCallCount = 0
    let crewsCallCount = 0
    const crewsAssertChain = mockChain({ data: [{ id: 'crew-1', org_id: DEFAULT_ORG }], error: null })
    const crewsListChain = mockChain({ data: [{ id: 'crew-1', name: 'Alpha Crew' }], error: null })
    const settingsChain = mockChain({
      data: [{ crew_id: 'crew-1', calendar_id: 'cal-abc', enabled: true, auto_sync: true }],
      error: null,
    })
    const syncChain = mockChain({ data: [], error: null })
    const upsertChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'schedule') {
        scheduleCallCount++
        return scheduleCallCount === 1 ? schedAssertChain : schedChain
      }
      if (table === 'crews') {
        crewsCallCount++
        return crewsCallCount === 1 ? crewsAssertChain : crewsListChain
      }
      if (table === 'calendar_settings') return settingsChain
      if (table === 'calendar_sync') return syncChain
      return upsertChain
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.synced).toBe(1)
    expect(json.failed).toBe(0)
    expect(json.results).toHaveLength(1)
    expect(json.results[0].status).toBe('synced')
    expect(json.results[0].event_id).toBe('evt-123')

    // Verify upsertCalendarEvent was called
    expect(mockUpsertEvent).toHaveBeenCalledTimes(1)
  })

  it('handles sync failure when upsertCalendarEvent returns null', async () => {
    mockUpsertEvent.mockResolvedValueOnce({ eventId: null, meetLink: null }) // Simulate failure

    const schedule = {
      id: 's1',
      project_id: 'PROJ-1',
      crew_id: 'crew-1',
      job_type: 'install',
      date: '2026-04-10',
      end_date: null,
      time: null,
      notes: null,
      status: 'scheduled',
      project: { name: 'Test', city: null, address: null },
    }

    let scheduleCallCount2 = 0
    let crewsCallCount2 = 0
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'schedule') {
        scheduleCallCount2++
        return scheduleCallCount2 === 1
          ? mockChain({ data: [{ id: 's1', crew_id: 'crew-1' }], error: null })
          : mockChain({ data: [schedule], error: null })
      }
      if (table === 'crews') {
        crewsCallCount2++
        return crewsCallCount2 === 1
          ? mockChain({ data: [{ id: 'crew-1', org_id: DEFAULT_ORG }], error: null })
          : mockChain({ data: [{ id: 'crew-1', name: 'A Crew' }], error: null })
      }
      if (table === 'calendar_settings') return mockChain({
        data: [{ crew_id: 'crew-1', calendar_id: 'cal-abc', enabled: true }],
        error: null,
      })
      return mockChain({ data: [], error: null })
    })

    const req = makeRequest({ schedule_ids: ['s1'] })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.failed).toBe(1)
    expect(json.results[0].status).toBe('error')
  })
})

// ── Delete action ────────────────────────────────────────────────────────────

describe('POST /api/calendar/sync — delete action', () => {
  it('deletes calendar events for given schedule_ids', async () => {
    const syncEntries = [
      { id: 'sync-1', schedule_id: 's1', calendar_id: 'cal-1', event_id: 'evt-1' },
      { id: 'sync-2', schedule_id: 's2', calendar_id: 'cal-1', event_id: 'evt-2' },
    ]

    const syncChain = mockChain({ data: syncEntries, error: null })
    const deleteChain = mockChain({ data: null, error: null })

    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'schedule') return mockChain({
        data: [
          { id: 's1', crew_id: 'crew-1' },
          { id: 's2', crew_id: 'crew-1' },
        ],
        error: null,
      })
      if (table === 'crews') return mockChain({
        data: [{ id: 'crew-1', org_id: DEFAULT_ORG }],
        error: null,
      })
      if (table === 'calendar_sync') {
        // Return different chains for select vs delete operations
        return syncChain
      }
      return deleteChain
    })

    const req = makeRequest({ schedule_ids: ['s1', 's2'], action: 'delete' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.deleted).toBe(2)
    expect(json.failed).toBe(0)

    // Verify deleteCalendarEvent was called for each entry
    expect(mockDeleteEvent).toHaveBeenCalledTimes(2)
    expect(mockDeleteEvent).toHaveBeenCalledWith('cal-1', 'evt-1')
    expect(mockDeleteEvent).toHaveBeenCalledWith('cal-1', 'evt-2')
  })

  it('handles partial delete failures', async () => {
    const syncEntries = [
      { id: 'sync-1', schedule_id: 's1', calendar_id: 'cal-1', event_id: 'evt-1' },
      { id: 'sync-2', schedule_id: 's2', calendar_id: 'cal-1', event_id: 'evt-2' },
    ]

    const syncChain = mockChain({ data: syncEntries, error: null })
    mockDb.from.mockImplementation((table: string) => {
      if (table === 'users') return mockChain({ data: { id: 'pub-user-1', role: 'manager', active: true }, error: null })
      if (table === 'org_memberships') return mockChain({ data: [{ org_id: DEFAULT_ORG }], error: null })
      if (table === 'schedule') return mockChain({
        data: [
          { id: 's1', crew_id: 'crew-1' },
          { id: 's2', crew_id: 'crew-1' },
        ],
        error: null,
      })
      if (table === 'crews') return mockChain({
        data: [{ id: 'crew-1', org_id: DEFAULT_ORG }],
        error: null,
      })
      return syncChain
    })

    // First delete succeeds, second fails
    mockDeleteEvent.mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const req = makeRequest({ schedule_ids: ['s1', 's2'], action: 'delete' })
    const { POST } = await import('@/app/api/calendar/sync/route')
    const res = await POST(req as any)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.deleted).toBe(1)
    expect(json.failed).toBe(1)
  })
})
