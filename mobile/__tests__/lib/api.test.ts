// Regression tests for lib/api.ts data fetches.
//
// Goal per the unified-app plan Phase 2: every load-bearing data fetch has
// a happy-path test and an auth-error / empty test, so a future refactor that
// breaks the chain (column rename, RLS regression, helper rewrite) shows up
// in CI before it ships.

import {
  getCustomerAccount,
  loadProject,
  loadTimeline,
  loadSchedule,
  loadTickets,
  updateNotificationPrefs,
  sendAtlasMessage,
} from '../../lib/api'
import { supabase } from '../../lib/supabase'

// Build a chainable thenable that mirrors supabase-js's QueryBuilder. Each
// chain method returns the same builder; awaiting the builder resolves to
// the configured { data, error } result.
function makeQuery<T>(result: { data: T; error: { message: string } | null }) {
  const q: any = {}
  ;[
    'select', 'eq', 'is', 'not', 'in', 'gt', 'lt', 'gte', 'lte',
    'order', 'limit', 'single', 'maybeSingle',
    'update', 'insert', 'upsert', 'delete',
  ].forEach((m) => {
    q[m] = jest.fn(() => q)
  })
  q.then = (onF: any, onR: any) => Promise.resolve(result).then(onF, onR)
  return q
}

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getUser: jest.fn(),
      getSession: jest.fn(),
    },
  },
}))

const mockedFrom = supabase.from as jest.Mock
const mockedGetUser = supabase.auth.getUser as jest.Mock
const mockedGetSession = supabase.auth.getSession as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

// ── getCustomerAccount ─────────────────────────────────────────────────────

describe('getCustomerAccount', () => {
  it('returns the account row on happy path', async () => {
    mockedGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    mockedFrom.mockReturnValueOnce(makeQuery({
      data: [{ id: 'a1', auth_user_id: 'u1', project_id: 'p1', status: 'active' }],
      error: null,
    }))
    const acct = await getCustomerAccount()
    expect(acct).toEqual(expect.objectContaining({ id: 'a1', auth_user_id: 'u1' }))
    expect(mockedFrom).toHaveBeenCalledWith('customer_accounts')
  })

  it('returns null when no auth user (auth-error path)', async () => {
    mockedGetUser.mockResolvedValueOnce({ data: { user: null } })
    const acct = await getCustomerAccount()
    expect(acct).toBeNull()
    // Important: never query customer_accounts when unauthenticated
    expect(mockedFrom).not.toHaveBeenCalled()
  })

  it('returns null when query returns empty array', async () => {
    mockedGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    mockedFrom.mockReturnValueOnce(makeQuery({ data: [], error: null }))
    const acct = await getCustomerAccount()
    expect(acct).toBeNull()
  })
})

// ── loadProject ────────────────────────────────────────────────────────────

describe('loadProject', () => {
  it('returns the project on happy path', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({
      data: { id: 'p1', disposition: 'won' },
      error: null,
    }))
    const p = await loadProject('p1')
    expect(p).toEqual(expect.objectContaining({ id: 'p1' }))
    expect(mockedFrom).toHaveBeenCalledWith('projects')
  })

  it('returns null on supabase error', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({
      data: null,
      error: { message: 'RLS denied' },
    }))
    const p = await loadProject('p1')
    expect(p).toBeNull()
  })
})

// ── loadTimeline / loadSchedule / loadTickets (happy + empty) ──────────────

describe('loadTimeline', () => {
  it('returns stage history rows', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({
      data: [{ id: 's1', project_id: 'p1', stage: 'install', entered: '2026-01-01' }],
      error: null,
    }))
    const rows = await loadTimeline('p1')
    expect(rows).toHaveLength(1)
    expect(mockedFrom).toHaveBeenCalledWith('stage_history')
  })

  it('returns [] when supabase returns null data', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({ data: null, error: { message: 'RLS' } }))
    const rows = await loadTimeline('p1')
    expect(rows).toEqual([])
  })
})

describe('loadSchedule', () => {
  it('returns schedule rows', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({
      data: [{ id: 's1', project_id: 'p1', job_type: 'install', date: '2026-01-01', status: 'scheduled' }],
      error: null,
    }))
    const rows = await loadSchedule('p1')
    expect(rows).toHaveLength(1)
    expect(mockedFrom).toHaveBeenCalledWith('schedule')
  })

  it('returns [] on error', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({ data: null, error: { message: 'RLS' } }))
    const rows = await loadSchedule('p1')
    expect(rows).toEqual([])
  })
})

describe('loadTickets', () => {
  it('returns ticket rows', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({
      data: [{ id: 't1', ticket_number: 1, title: 'A', status: 'open' }],
      error: null,
    }))
    const rows = await loadTickets('p1')
    expect(rows).toHaveLength(1)
    expect(mockedFrom).toHaveBeenCalledWith('tickets')
  })

  it('returns [] on error', async () => {
    mockedFrom.mockReturnValueOnce(makeQuery({ data: null, error: { message: 'RLS' } }))
    const rows = await loadTickets('p1')
    expect(rows).toEqual([])
  })
})

// ── updateNotificationPrefs (defense-in-depth auth check) ──────────────────

describe('updateNotificationPrefs', () => {
  it('returns false when no auth user — never writes', async () => {
    mockedGetUser.mockResolvedValueOnce({ data: { user: null } })
    const ok = await updateNotificationPrefs('a1', {} as any)
    expect(ok).toBe(false)
    expect(mockedFrom).not.toHaveBeenCalled()
  })

  it('writes and returns true on happy path', async () => {
    mockedGetUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } } })
    mockedFrom.mockReturnValueOnce(makeQuery({ data: null, error: null }))
    const ok = await updateNotificationPrefs('a1', { sms: true } as any)
    expect(ok).toBe(true)
    expect(mockedFrom).toHaveBeenCalledWith('customer_accounts')
  })
})

// ── sendAtlasMessage (auth-error path; happy path uses fetch + SSE) ────────

describe('sendAtlasMessage', () => {
  it('throws when there is no session (auth-error path)', async () => {
    mockedGetSession.mockResolvedValueOnce({ data: { session: null } })
    await expect(sendAtlasMessage([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('Not authenticated')
  })
})
