// __tests__/lib/partner-api-idempotency.test.ts — readOrReserve + recordResponse.
//
// R2 coverage added with the stale-reservation recovery fix (M4). The earlier
// R1 pass left idempotency untested; we rely on the reserve-then-record pattern
// for every partner POST, so regressions here mean duplicate writes or 409
// loops.

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Make the supabase-admin module return a hand-rolled mock that we control
// per-test. Each call to from() pulls the next scripted response off a queue.
const scripted: Array<
  | { kind: 'insert'; ok: boolean }
  | { kind: 'select'; data: unknown; error: { message: string } | null }
  | { kind: 'update'; error: { message: string } | null }
> = []

function nextScript() {
  const s = scripted.shift()
  if (!s) throw new Error('test tried to hit supabase with no scripted response queued')
  return s
}

vi.mock('@/lib/partner-api/supabase-admin', () => ({
  partnerApiAdmin: () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(_table: string): any {
      // Return a chain object that terminates when .maybeSingle() / await is
      // reached. insert/select/update branches each pop one script entry.
      let op: 'insert' | 'select' | 'update' | null = null
      const chain = {
        insert() { op = 'insert'; return chain },
        select() { if (!op) op = 'select'; return chain },
        update() { op = 'update'; return chain },
        eq() { return chain },
        is() { return chain },
        async maybeSingle() {
          const s = nextScript()
          if (op === 'insert') {
            if (s.kind !== 'insert') throw new Error(`expected insert script, got ${s.kind}`)
            return s.ok
              ? { data: { api_key_id: 'key-1' }, error: null }
              : { data: null, error: { message: 'duplicate key' } }
          }
          if (op === 'update') {
            if (s.kind !== 'update') throw new Error(`expected update script, got ${s.kind}`)
            return { data: null, error: s.error }
          }
          if (s.kind !== 'select') throw new Error(`expected select script, got ${s.kind}`)
          return { data: s.data, error: s.error }
        },
        // For update+where+where without .maybeSingle(), allow direct await.
        then(cb: (v: unknown) => unknown) {
          const s = nextScript()
          if (s.kind !== 'update') throw new Error(`expected update script, got ${s.kind}`)
          return Promise.resolve({ error: s.error }).then(cb)
        },
      }
      return chain
    },
  }),
}))

import {
  bodyHash,
  extractIdempotencyKey,
  readOrReserve,
  recordResponse,
  STALE_RESERVATION_MS,
} from '@/lib/partner-api/idempotency'
import { ApiError } from '@/lib/partner-api/errors'

beforeEach(() => {
  scripted.length = 0
})

describe('bodyHash', () => {
  it('is stable', () => {
    const a = bodyHash('{"x":1}')
    const b = bodyHash('{"x":1}')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
  it('differs on body change', () => {
    expect(bodyHash('{"x":1}')).not.toBe(bodyHash('{"x":2}'))
  })
})

describe('extractIdempotencyKey', () => {
  it('returns null when absent', () => {
    expect(extractIdempotencyKey(new Headers())).toBeNull()
  })
  it('trims and returns when present', () => {
    const h = new Headers({ 'Idempotency-Key': '  abc-123  ' })
    expect(extractIdempotencyKey(h)).toBe('abc-123')
  })
  it('returns null on empty after trim', () => {
    const h = new Headers({ 'Idempotency-Key': '   ' })
    expect(extractIdempotencyKey(h)).toBeNull()
  })
  it('throws on > 255 chars', () => {
    const h = new Headers({ 'Idempotency-Key': 'a'.repeat(300) })
    expect(() => extractIdempotencyKey(h)).toThrowError(ApiError)
  })
})

describe('readOrReserve — fresh path', () => {
  it('returns { cached: false } when reservation insert succeeds', async () => {
    scripted.push({ kind: 'insert', ok: true })
    const out = await readOrReserve('key-1', 'idem-A', 'hashA')
    expect(out).toEqual({ cached: false })
  })
})

describe('readOrReserve — cached path', () => {
  it('returns the prior response when request_hash matches', async () => {
    // Insert fails (prior row exists), then select returns the completed row
    scripted.push({ kind: 'insert', ok: false })
    scripted.push({
      kind: 'select',
      data: {
        request_hash: 'hashA',
        response_status: 201,
        response_body: { data: { id: 'LEAD-abc' } },
        created_at: new Date().toISOString(),
      },
      error: null,
    })
    const out = await readOrReserve('key-1', 'idem-A', 'hashA')
    expect(out.cached).toBe(true)
    expect(out.response).toEqual({ status: 201, body: { data: { id: 'LEAD-abc' } } })
  })
})

describe('readOrReserve — hash mismatch', () => {
  it('throws idempotency_conflict when request_hash differs', async () => {
    scripted.push({ kind: 'insert', ok: false })
    scripted.push({
      kind: 'select',
      data: {
        request_hash: 'hashA',
        response_status: 201,
        response_body: {},
        created_at: new Date().toISOString(),
      },
      error: null,
    })
    try {
      await readOrReserve('key-1', 'idem-A', 'hashDIFFERENT')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('idempotency_conflict')
    }
  })
})

describe('readOrReserve — in-flight fresh reservation', () => {
  it('throws idempotency_conflict when prior is response_status=0 and young', async () => {
    scripted.push({ kind: 'insert', ok: false })
    scripted.push({
      kind: 'select',
      data: {
        request_hash: 'hashA',
        response_status: 0,
        response_body: {},
        created_at: new Date(Date.now() - 1_000).toISOString(), // 1s ago
      },
      error: null,
    })
    try {
      await readOrReserve('key-1', 'idem-A', 'hashA')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('idempotency_conflict')
      expect((err as ApiError).details).toMatchObject({ retry_recommended: true })
    }
  })
})

describe('readOrReserve — stale reservation recovery (M4)', () => {
  it('takes over the reservation when response_status=0 and older than STALE_RESERVATION_MS', async () => {
    scripted.push({ kind: 'insert', ok: false })
    scripted.push({
      kind: 'select',
      data: {
        request_hash: 'hashA',
        response_status: 0,
        response_body: {},
        created_at: new Date(Date.now() - (STALE_RESERVATION_MS + 1_000)).toISOString(),
      },
      error: null,
    })
    scripted.push({ kind: 'update', error: null }) // re-reserve succeeds
    const out = await readOrReserve('key-1', 'idem-A', 'hashA')
    expect(out).toEqual({ cached: false })
  })
})

describe('readOrReserve — racy empty select', () => {
  it('treats missing existing row as fresh reservation', async () => {
    scripted.push({ kind: 'insert', ok: false })
    scripted.push({ kind: 'select', data: null, error: null })
    const out = await readOrReserve('key-1', 'idem-A', 'hashA')
    expect(out).toEqual({ cached: false })
  })
})

describe('recordResponse', () => {
  it('fires a single UPDATE and resolves', async () => {
    scripted.push({ kind: 'update', error: null })
    await expect(
      recordResponse('key-1', 'idem-A', 201, { ok: true }),
    ).resolves.toBeUndefined()
  })
})
