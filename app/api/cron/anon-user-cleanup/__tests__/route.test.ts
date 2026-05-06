/**
 * Unit tests for /api/cron/anon-user-cleanup (#275).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/hq-fleet', () => ({
  reportFleetRun: vi.fn().mockResolvedValue(true),
}))

import { createClient } from '@supabase/supabase-js'
import { reportFleetRun } from '@/lib/hq-fleet'

const mkReq = (token: string | null) => {
  const headers: Record<string, string> = {}
  if (token !== null) headers.authorization = `Bearer ${token}`
  // Next's NextRequest is a superset of Request; the route only reads
  // headers.get(), which Request already supports.
  return new Request('http://localhost/api/cron/anon-user-cleanup', { headers }) as any
}

const mockSb = (impl: any) => (createClient as any).mockReturnValue(impl)

const ORIG = {
  CRON_SECRET: process.env.CRON_SECRET,
  URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SERVICE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  process.env.CRON_SECRET = 'test-secret'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://sb.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  // reportFleetRun must resolve — the route's fire-and-forget `.catch()`
  // needs a promise; `resetAllMocks` above wipes the top-level
  // `.mockResolvedValue(true)` default.
  ;(reportFleetRun as any).mockResolvedValue(true)
})

afterEach(() => {
  process.env.CRON_SECRET = ORIG.CRON_SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG.URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG.SERVICE_KEY
})

describe('anon-user-cleanup cron', () => {
  it('401 without bearer', async () => {
    const { GET } = await import('../route')
    const res = await GET(mkReq(null))
    expect(res.status).toBe(401)
  })

  it('401 with wrong bearer (different length)', async () => {
    const { GET } = await import('../route')
    const res = await GET(mkReq('nope'))
    expect(res.status).toBe(401)
  })

  it('401 with wrong bearer of matching length (exercise timingSafeEqual branch)', async () => {
    // 'test-secret' is 11 chars; 'wrong-secre' is also 11. Pre-fix this would
    // reach timingSafeEqual via the length-equal branch; post-fix sha256 path
    // runs uniformly.
    const { GET } = await import('../route')
    const res = await GET(mkReq('wrong-secre'))
    expect(res.status).toBe(401)
  })

  it('401 when CRON_SECRET missing (fail-closed uniformly; #555)', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('../route')
    const res = await GET(mkReq('whatever'))
    expect(res.status).toBe(401)
  })

  it('500 when service creds missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    expect(res.status).toBe(500)
  })

  const withRpc = (listResult: any, recheckResult: (id: string) => boolean) => {
    const calls: any[] = []
    return {
      calls,
      impl: {
        rpc: (fn: string, args: any) => {
          calls.push({ fn, args })
          if (fn === 'atlas_list_stale_anon_users') {
            return Promise.resolve({ data: listResult, error: null })
          }
          if (fn === 'atlas_anon_user_still_stale') {
            return Promise.resolve({
              data: recheckResult(args.p_id),
              error: null,
            })
          }
          return Promise.resolve({ data: null, error: { message: 'unknown rpc' } })
        },
      },
    }
  }

  it('deletes every eligible anon user + reports success', async () => {
    const deleted: string[] = []
    const helper = withRpc(
      [
        { id: 'u1', last_sign_in_at: null },
        { id: 'u2', last_sign_in_at: '2025-01-01T00:00:00Z' },
      ],
      () => true
    )
    mockSb({
      ...helper.impl,
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            deleted.push(id)
            return { error: null }
          },
        },
      },
    })
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({
      success: true,
      eligible: 2,
      deleted: 2,
      failed: 0,
      skipped_reraced: 0,
    })
    expect(deleted).toEqual(['u1', 'u2'])
    expect(helper.calls.filter((c) => c.fn === 'atlas_anon_user_still_stale')).toHaveLength(2)
    expect(reportFleetRun).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'mg-anon-user-cleanup',
        status: 'success',
        itemsProcessed: 2,
      })
    )
  })

  it('skips deletion when recheck says user became active (race closed)', async () => {
    const deleted: string[] = []
    const helper = withRpc(
      [
        { id: 'u1', last_sign_in_at: null },
        { id: 'u2', last_sign_in_at: null },
      ],
      (id) => id !== 'u2' // u2 got a feedback row between list + recheck
    )
    mockSb({
      ...helper.impl,
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            deleted.push(id)
            return { error: null }
          },
        },
      },
    })
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({
      success: true,
      eligible: 2,
      deleted: 1,
      failed: 0,
      skipped_reraced: 1,
    })
    expect(deleted).toEqual(['u1'])
  })

  it('partial when some deletes fail', async () => {
    const helper = withRpc(
      [
        { id: 'u1', last_sign_in_at: null },
        { id: 'u2', last_sign_in_at: null },
      ],
      () => true
    )
    mockSb({
      ...helper.impl,
      auth: {
        admin: {
          deleteUser: vi
            .fn()
            .mockResolvedValueOnce({ error: null })
            .mockResolvedValueOnce({ error: { message: 'boom' } }),
        },
      },
    })
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()
    expect(json).toEqual({
      success: false,
      eligible: 2,
      deleted: 1,
      failed: 1,
      skipped_reraced: 0,
    })
    expect(reportFleetRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial' })
    )
  })

  it('noop when the RPC returns empty list', async () => {
    mockSb({
      rpc: (fn: string) => {
        if (fn === 'atlas_list_stale_anon_users') {
          return Promise.resolve({ data: [], error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      auth: { admin: { deleteUser: vi.fn() } },
    })
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()
    expect(json).toEqual({
      success: true,
      eligible: 0,
      deleted: 0,
      failed: 0,
      skipped_reraced: 0,
    })
  })

  it('recheck errors counted as failures (not deletions)', async () => {
    const deleted: string[] = []
    mockSb({
      rpc: (fn: string, args: any) => {
        if (fn === 'atlas_list_stale_anon_users') {
          return Promise.resolve({
            data: [
              { id: 'u1', last_sign_in_at: null },
              { id: 'u2', last_sign_in_at: null },
            ],
            error: null,
          })
        }
        if (fn === 'atlas_anon_user_still_stale') {
          return args.p_id === 'u1'
            ? Promise.resolve({ data: null, error: { message: 'boom' } })
            : Promise.resolve({ data: true, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            deleted.push(id)
            return { error: null }
          },
        },
      },
    })
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()
    expect(json.deleted).toBe(1)
    expect(json.failed).toBe(1)
    expect(deleted).toEqual(['u2'])
  })

  it('500 when the list RPC errors', async () => {
    mockSb({
      rpc: (fn: string) => {
        if (fn === 'atlas_list_stale_anon_users') {
          return Promise.resolve({ data: null, error: { message: 'boom' } })
        }
        return Promise.resolve({ data: null, error: null })
      },
      auth: { admin: { deleteUser: vi.fn() } },
    })
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    expect(res.status).toBe(500)
    expect(reportFleetRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    )
  })
})
