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

// #473 — cursor inputs are interpolated raw into PostgREST `.or()` filters.
// Anything that escapes the strict ISO-8601 / [A-Za-z0-9_-] allowlists must
// be rejected at decode time before it can reach the query layer.
describe('decodeCursor injection guards (#473)', () => {
  const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')

  it('accepts a UUID-shape id', () => {
    const c = { t: '2026-04-16T12:34:56Z', id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }
    expect(decodeCursor(enc(c))).toEqual(c)
  })

  it('accepts a LEAD- prefixed id', () => {
    const c = { t: '2026-04-16T12:34:56.123Z', id: 'LEAD-3fA9b' }
    expect(decodeCursor(enc(c))).toEqual(c)
  })

  it('accepts ISO-8601 with timezone offset', () => {
    const c = { t: '2026-04-16T12:34:56-05:00', id: 'r-1' }
    expect(decodeCursor(enc(c))).toEqual(c)
  })

  it('rejects t without time component', () => {
    expect(() => decodeCursor(enc({ t: '2026-04-16', id: 'r1' }))).toThrowError(ApiError)
  })

  it('rejects t with missing timezone designator', () => {
    expect(() => decodeCursor(enc({ t: '2026-04-16T12:34:56', id: 'r1' }))).toThrowError(ApiError)
  })

  it('rejects t carrying a PostgREST operator payload (the .or() escape)', () => {
    expect(() => decodeCursor(enc({ t: '2025-01-01),or(true', id: 'x' }))).toThrowError(ApiError)
    expect(() => decodeCursor(enc({ t: '2025-01-01,foo.eq.bar', id: 'x' }))).toThrowError(ApiError)
  })

  it('rejects id with parentheses, commas, or quotes', () => {
    expect(() => decodeCursor(enc({ t: '2026-04-16T12:34:56Z', id: 'a)or(b' }))).toThrowError(ApiError)
    expect(() => decodeCursor(enc({ t: '2026-04-16T12:34:56Z', id: 'a,b' }))).toThrowError(ApiError)
    expect(() => decodeCursor(enc({ t: '2026-04-16T12:34:56Z', id: "a'b" }))).toThrowError(ApiError)
    expect(() => decodeCursor(enc({ t: '2026-04-16T12:34:56Z', id: 'a b' }))).toThrowError(ApiError)
  })

  it('rejects id over 64 chars', () => {
    expect(() => decodeCursor(enc({ t: '2026-04-16T12:34:56Z', id: 'x'.repeat(65) }))).toThrowError(ApiError)
  })

  it('rejects empty id', () => {
    expect(() => decodeCursor(enc({ t: '2026-04-16T12:34:56Z', id: '' }))).toThrowError(ApiError)
  })

  // Regression guard: legitimate cursors built from real Postgres
  // timestamptz values must round-trip through buildListResponse → opaque
  // string → decodeCursor without 400ing. PG serializes at microsecond
  // precision with `+HH:MM` offset.
  it('round-trips a real-PG-shape created_at value', () => {
    const realRow = { id: '0e6372c4-65fc-435d-b849-acece074417f', created_at: '2026-03-30T16:00:08.432421+00:00' }
    const list = buildListResponse([realRow, { ...realRow, id: 'b1', created_at: '2026-03-30T16:00:07.111111+00:00' }], 1)
    expect(list.cursor).not.toBeNull()
    const decoded = decodeCursor(list.cursor)
    expect(decoded).toEqual({ t: realRow.created_at, id: realRow.id })
  })

  it('accepts the 2-digit short-form offset (+00) Postgres can emit', () => {
    const c = { t: '2026-03-30T16:00:08.432421+00', id: 'r1' }
    expect(decodeCursor(enc(c))).toEqual(c)
  })

  it('does NOT echo JSON.parse error bytes in the reason', () => {
    // Crafted base64 of `{"x":` — JSON.parse fails with a SyntaxError whose
    // message includes attacker-controlled bytes. The new sanitizer must
    // surface only the static "cursor payload not valid JSON" label.
    const raw = Buffer.from('{"x":', 'utf8').toString('base64url')
    try {
      decodeCursor(raw)
      throw new Error('expected ApiError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError & { details?: { reason?: string } }
      expect(apiErr.details?.reason).toBe('cursor payload not valid JSON')
    }
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
