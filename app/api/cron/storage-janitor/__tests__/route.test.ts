/**
 * Unit tests for /api/cron/storage-janitor (#522).
 *
 * Coverage:
 *   - 401/500 auth gates (matches anon-user-cleanup pattern).
 *   - Both buckets: list → batched remove → success counts.
 *   - List-rpc error on one bucket does not abort the other.
 *   - storage.remove error per bucket counted as failed.
 *   - Empty list noop.
 *   - removedRows shorter than paths counted as deleted (idempotent).
 *   - Constant-time bearer guard (sha256 length-equal branch).
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
  return new Request('http://localhost/api/cron/storage-janitor', { headers }) as any
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
  ;(reportFleetRun as any).mockResolvedValue(true)
})

afterEach(() => {
  process.env.CRON_SECRET = ORIG.CRON_SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG.URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG.SERVICE_KEY
})

type RpcResult = { data: any; error: { message: string } | null }
type RemoveResult = { data: any; error: { message: string } | null }

type VerifyResult = { data: any; error: { message: string } | null }

const buildSb = (
  rpcByFn: Record<string, RpcResult>,
  removeByBucket: Record<string, RemoveResult | ((paths: string[]) => RemoveResult)>,
  verifyByBucket: Record<string, VerifyResult> = {}
) => {
  const removed: Record<string, string[][]> = {}
  // The route's post-batch verify is admin.schema('storage').from('objects')
  //   .select('name').eq('bucket_id', bucket).in('name', paths)
  // → resolves to { data: Array<{name: string}>, error }.
  const makeQuery = (verify: VerifyResult) => {
    const q: any = {
      _bucket: null as string | null,
      select: () => q,
      eq: (col: string, val: any) => {
        if (col === 'bucket_id') q._bucket = val
        return q
      },
      in: () => Promise.resolve(verify),
    }
    return q
  }
  return {
    rpc: (fn: string, _args: any) => {
      const r = rpcByFn[fn]
      if (!r) return Promise.resolve({ data: null, error: { message: `unmocked rpc ${fn}` } })
      return Promise.resolve(r)
    },
    schema: (_s: string) => ({
      from: (_t: string) => {
        // The verify-by-bucket lookup happens via the .eq('bucket_id', X)
        // call that the route makes. We don't know which bucket until that
        // call; return a query object that resolves based on what bucket
        // the route ends up filtering on.
        const q: any = {
          _bucket: null as string | null,
          select: () => q,
          eq: (col: string, val: any) => {
            if (col === 'bucket_id') q._bucket = val
            return q
          },
          in: () => {
            const verify = q._bucket && verifyByBucket[q._bucket]
            return Promise.resolve(verify ?? { data: [], error: null })
          },
        }
        return q
      },
    }),
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          removed[bucket] = (removed[bucket] ?? []).concat([paths])
          const r = removeByBucket[bucket]
          const result = typeof r === 'function' ? r(paths) : r
          return Promise.resolve(result ?? { data: null, error: null })
        },
      }),
    },
    _removedCalls: removed,
  }
}

describe('storage-janitor cron', () => {
  it('401 without bearer', async () => {
    const { GET } = await import('../route')
    const res = await GET(mkReq(null))
    expect(res.status).toBe(401)
  })

  it('401 with wrong bearer (matching length, exercises sha256 path)', async () => {
    const { GET } = await import('../route')
    // 'test-secret' = 11 chars; 'wrong-secre' = 11 chars
    const res = await GET(mkReq('wrong-secre'))
    expect(res.status).toBe(401)
  })

  it('500 when CRON_SECRET missing', async () => {
    delete process.env.CRON_SECRET
    const { GET } = await import('../route')
    const res = await GET(mkReq('whatever'))
    expect(res.status).toBe(500)
  })

  it('500 when service creds missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    expect(res.status).toBe(500)
  })

  it('deletes orphans across both buckets and reports success', async () => {
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: {
          data: [{ name: 'project1/ticket1/img1.png' }, { name: 'project1/ticket1/img2.png' }],
          error: null,
        },
        atlas_list_orphan_customer_feedback_attachments: {
          data: [{ name: 'feedback1/screenshot.png' }],
          error: null,
        },
      },
      {
        'ticket-attachments': { data: [{ name: 'a' }, { name: 'b' }], error: null },
        'customer-feedback': { data: [{ name: 'c' }], error: null },
      }
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.total_deleted).toBe(3)
    expect(json.total_failed).toBe(0)
    expect(json.buckets['ticket-attachments']).toMatchObject({ listed: 2, deleted: 2, failed: 0 })
    expect(json.buckets['customer-feedback']).toMatchObject({ listed: 1, deleted: 1, failed: 0 })
    expect(sb._removedCalls['ticket-attachments']).toEqual([
      ['project1/ticket1/img1.png', 'project1/ticket1/img2.png'],
    ])
    expect(sb._removedCalls['customer-feedback']).toEqual([['feedback1/screenshot.png']])
    expect(reportFleetRun).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'mg-storage-janitor', status: 'success', itemsProcessed: 3 })
    )
  })

  it('list error on one bucket does not abort the other', async () => {
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: { data: null, error: { message: 'rpc boom' } },
        atlas_list_orphan_customer_feedback_attachments: {
          data: [{ name: 'feedback1/screenshot.png' }],
          error: null,
        },
      },
      {
        'ticket-attachments': { data: null, error: null },
        'customer-feedback': { data: [{ name: 'c' }], error: null },
      }
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(json.success).toBe(false)
    expect(json.buckets['ticket-attachments'].error).toMatch(/rpc boom/)
    expect(json.buckets['customer-feedback'].deleted).toBe(1)
    expect(reportFleetRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial' })
    )
  })

  it('storage.remove error per bucket counted as failed without aborting', async () => {
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: {
          data: [{ name: 'a' }, { name: 'b' }],
          error: null,
        },
        atlas_list_orphan_customer_feedback_attachments: {
          data: [{ name: 'c' }],
          error: null,
        },
      },
      {
        'ticket-attachments': { data: null, error: { message: 'storage 503' } },
        'customer-feedback': { data: [{ name: 'c' }], error: null },
      }
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(json.buckets['ticket-attachments'].failed).toBe(2)
    expect(json.buckets['ticket-attachments'].deleted).toBe(0)
    expect(json.buckets['customer-feedback'].deleted).toBe(1)
  })

  it('empty orphan list is a no-op', async () => {
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: { data: [], error: null },
        atlas_list_orphan_customer_feedback_attachments: { data: [], error: null },
      },
      {}
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.total_deleted).toBe(0)
    expect(sb._removedCalls).toEqual({})
  })

  it('idempotent: removedRows short, post-batch verify says all gone → counted as deleted', async () => {
    // supabase-js batch remove returns rows for files that existed; an
    // already-deleted file is silently absent. The route's post-batch
    // verify (red-team R1 M4 fix) re-queries storage.objects to confirm
    // — empty result means truly idempotent, count all as deleted.
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: {
          data: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
          error: null,
        },
        atlas_list_orphan_customer_feedback_attachments: { data: [], error: null },
      },
      {
        'ticket-attachments': { data: [{ name: 'a' }], error: null },
      },
      {
        // Verify says nothing left → all 3 considered deleted.
        'ticket-attachments': { data: [], error: null },
      }
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(json.buckets['ticket-attachments'].listed).toBe(3)
    expect(json.buckets['ticket-attachments'].deleted).toBe(3)
    expect(json.buckets['ticket-attachments'].failed).toBe(0)
    expect(json.success).toBe(true)
  })

  it('post-batch verify catches permanent failures (paths still in storage.objects)', async () => {
    // removedRows says 1 deleted, but verify finds 2 paths still present.
    // Those 2 should be counted as `failed`, NOT silently as deleted.
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: {
          data: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
          error: null,
        },
        atlas_list_orphan_customer_feedback_attachments: { data: [], error: null },
      },
      {
        'ticket-attachments': { data: [{ name: 'a' }], error: null },
      },
      {
        'ticket-attachments': { data: [{ name: 'b' }, { name: 'c' }], error: null },
      }
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(json.buckets['ticket-attachments'].listed).toBe(3)
    expect(json.buckets['ticket-attachments'].deleted).toBe(1)
    expect(json.buckets['ticket-attachments'].failed).toBe(2)
    expect(json.buckets['ticket-attachments'].error).toMatch(/2 path/)
    expect(json.success).toBe(false)
  })

  it('verify-query error treats whole gap as failed', async () => {
    // If the post-batch verify itself errors, we don't know per-path
    // outcome — surface the entire gap as failed rather than guessing.
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: {
          data: [{ name: 'a' }, { name: 'b' }],
          error: null,
        },
        atlas_list_orphan_customer_feedback_attachments: { data: [], error: null },
      },
      {
        'ticket-attachments': { data: [], error: null },
      },
      {
        'ticket-attachments': { data: null, error: { message: 'verify boom' } },
      }
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(json.buckets['ticket-attachments'].deleted).toBe(0)
    expect(json.buckets['ticket-attachments'].failed).toBe(2)
    expect(json.buckets['ticket-attachments'].error).toMatch(/verify boom/)
  })

  it('both buckets erroring on list reports overall error', async () => {
    const sb = buildSb(
      {
        atlas_list_orphan_ticket_attachments: { data: null, error: { message: 'a' } },
        atlas_list_orphan_customer_feedback_attachments: { data: null, error: { message: 'b' } },
      },
      {}
    )
    mockSb(sb)

    const { GET } = await import('../route')
    const res = await GET(mkReq('test-secret'))
    const json = await res.json()

    expect(json.success).toBe(false)
    expect(reportFleetRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' })
    )
  })
})
