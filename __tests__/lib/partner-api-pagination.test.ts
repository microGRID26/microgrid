// __tests__/lib/partner-api-pagination.test.ts — Cursor round-trip + list
// response shape.

import { describe, it, expect } from 'vitest'
import {
  encodeCursor,
  decodeCursor,
  parseLimit,
  buildListResponse,
} from '@/lib/partner-api/pagination'
import { ApiError } from '@/lib/partner-api/errors'

describe('parseLimit', () => {
  it('returns default when null/empty', () => {
    expect(parseLimit(null)).toBe(25)
    expect(parseLimit('')).toBe(25)
  })
  it('caps at MAX_PAGE (100)', () => {
    expect(parseLimit('9999')).toBe(100)
  })
  it('rejects non-positive integers', () => {
    expect(() => parseLimit('0')).toThrowError(ApiError)
    expect(() => parseLimit('-1')).toThrowError(ApiError)
    expect(() => parseLimit('abc')).toThrowError(ApiError)
  })
  it('accepts small valid values verbatim', () => {
    expect(parseLimit('5')).toBe(5)
    expect(parseLimit('100')).toBe(100)
  })
})

describe('encode/decode cursor', () => {
  it('round-trips a cursor', () => {
    const c = { t: '2026-04-16T12:34:56Z', id: 'abc-123' }
    const encoded = encodeCursor(c)
    expect(typeof encoded).toBe('string')
    expect(encoded).not.toContain('=')
    expect(encoded).not.toContain('/')
    const back = decodeCursor(encoded)
    expect(back).toEqual(c)
  })

  it('returns null for null input', () => {
    expect(decodeCursor(null)).toBeNull()
  })

  it('throws invalid_request for garbage cursor', () => {
    expect(() => decodeCursor('not-base64!')).toThrowError(ApiError)
  })

  it('throws invalid_request when decoded payload has wrong shape', () => {
    const bad = Buffer.from(JSON.stringify({ x: 1 }), 'utf8').toString('base64url')
    expect(() => decodeCursor(bad)).toThrowError(ApiError)
  })
})

describe('buildListResponse', () => {
  const rows = [
    { id: 'r1', created_at: '2026-04-16T10:00:00Z', name: 'A' },
    { id: 'r2', created_at: '2026-04-16T09:00:00Z', name: 'B' },
    { id: 'r3', created_at: '2026-04-16T08:00:00Z', name: 'C' },
  ]

  it('reports has_more=false when rows.length ≤ limit', () => {
    const res = buildListResponse(rows, 5)
    expect(res.has_more).toBe(false)
    expect(res.cursor).toBeNull()
    expect(res.data).toEqual(rows)
  })

  it('reports has_more=true and trims to limit when rows.length > limit', () => {
    const res = buildListResponse(rows, 2)
    expect(res.has_more).toBe(true)
    expect(res.data).toHaveLength(2)
    expect(res.data[1].id).toBe('r2')
    expect(res.cursor).not.toBeNull()
    const decoded = decodeCursor(res.cursor)
    expect(decoded).toEqual({ t: '2026-04-16T09:00:00Z', id: 'r2' })
  })
})
