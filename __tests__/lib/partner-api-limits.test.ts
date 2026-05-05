/**
 * Unit tests for lib/partner-api/limits.ts (#502).
 *
 * Covers:
 *   - enforceRawBodyLimit: under, exactly at, over, multibyte
 *   - validateMetadata: null/undefined accepted, non-object rejected,
 *     key-count / depth / size caps each enforced, circular refs handled
 */
import { describe, it, expect } from 'vitest'
import {
  enforceRawBodyLimit,
  validateMetadata,
  MAX_RAW_BODY_BYTES,
  MAX_METADATA_KEYS,
  MAX_METADATA_DEPTH,
  MAX_DOC_BODY_BYTES,
} from '@/lib/partner-api/limits'
import { ApiError } from '@/lib/partner-api/errors'

describe('enforceRawBodyLimit', () => {
  it('accepts empty string', () => {
    expect(() => enforceRawBodyLimit('')).not.toThrow()
  })

  it('accepts a small body', () => {
    expect(() => enforceRawBodyLimit('{"hello":"world"}')).not.toThrow()
  })

  it('accepts a body exactly at the limit', () => {
    const raw = 'a'.repeat(MAX_RAW_BODY_BYTES)
    expect(() => enforceRawBodyLimit(raw)).not.toThrow()
  })

  it('rejects a body one byte over the limit', () => {
    const raw = 'a'.repeat(MAX_RAW_BODY_BYTES + 1)
    let thrown: ApiError | null = null
    try {
      enforceRawBodyLimit(raw)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown?.code).toBe('payload_too_large')
    expect(thrown?.status).toBe(413)
  })

  it('counts multibyte characters by byte length, not string length', () => {
    // Each '🌞' is 4 bytes in UTF-8. (limit / 4) + 1 emojis exceeds the
    // byte cap even though `.length` would only be ~half that.
    const emojiCount = Math.floor(MAX_RAW_BODY_BYTES / 4) + 1
    const raw = '🌞'.repeat(emojiCount)
    let thrown: ApiError | null = null
    try {
      enforceRawBodyLimit(raw)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown?.code).toBe('payload_too_large')
  })
})

describe('validateMetadata', () => {
  it('accepts null', () => {
    expect(() => validateMetadata(null)).not.toThrow()
  })

  it('accepts undefined', () => {
    expect(() => validateMetadata(undefined)).not.toThrow()
  })

  it('accepts a small object', () => {
    expect(() => validateMetadata({ filename: 'doc.pdf', size: 12345 })).not.toThrow()
  })

  it('accepts a small nested object within depth limit', () => {
    const m = { a: { b: { c: 'deep but ok' } } }
    expect(() => validateMetadata(m)).not.toThrow()
  })

  it('rejects a non-object metadata', () => {
    let thrown: ApiError | null = null
    try {
      validateMetadata('not an object' as unknown)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown?.code).toBe('invalid_request')
    expect(thrown?.message).toMatch(/object/i)
  })

  it('rejects a root-level array as metadata (#502 R1 H3)', () => {
    // typeof [] === 'object' would otherwise sneak past the type check and
    // store an array in partner_documents[].metadata. Explicit rejection.
    let thrown: ApiError | null = null
    try {
      validateMetadata([1, 2, 3] as unknown)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown?.code).toBe('invalid_request')
    expect(thrown?.message).toMatch(/array/i)
  })

  it('rejects an array of objects as metadata (still array at root)', () => {
    let thrown: ApiError | null = null
    try {
      validateMetadata([{ a: 1 }, { b: 2 }] as unknown)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown?.code).toBe('invalid_request')
    expect(thrown?.message).toMatch(/array/i)
  })

  it('rejects metadata exceeding the key-count cap', () => {
    const m: Record<string, number> = {}
    for (let i = 0; i <= MAX_METADATA_KEYS; i += 1) m[`k${i}`] = i
    let thrown: ApiError | null = null
    try {
      validateMetadata(m)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown?.code).toBe('invalid_request')
    expect(thrown?.message).toMatch(/keys/i)
  })

  it('rejects metadata exceeding the nesting-depth cap', () => {
    let m: unknown = 'leaf'
    // wrap into MAX_METADATA_DEPTH + 1 layers of objects (depth from root)
    for (let i = 0; i <= MAX_METADATA_DEPTH + 1; i += 1) {
      m = { nested: m }
    }
    let thrown: ApiError | null = null
    try {
      validateMetadata(m)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown?.code).toBe('invalid_request')
    expect(thrown?.message).toMatch(/nesting/i)
  })

  it('rejects metadata exceeding the serialized-size cap', () => {
    // Single key with a giant string value, serialized > MAX_DOC_BODY_BYTES.
    const big = 'x'.repeat(MAX_DOC_BODY_BYTES + 100)
    let thrown: ApiError | null = null
    try {
      validateMetadata({ payload: big })
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown?.code).toBe('invalid_request')
    expect(thrown?.message).toMatch(/serialized/i)
  })

  it('rejects circular metadata gracefully (not a 500)', () => {
    const m: Record<string, unknown> = { a: 1 }
    m.self = m
    let thrown: ApiError | null = null
    try {
      validateMetadata(m)
    } catch (e) {
      thrown = e as ApiError
    }
    // The depth walk hits the cap first on the self-reference, so we
    // accept either invalid_request from depth OR the JSON.stringify
    // catch — both are surfaced as ApiError, never a 500.
    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown?.code).toBe('invalid_request')
  })

  it('counts array entries toward depth but not key-count', () => {
    // 60 array entries (above MAX_METADATA_KEYS=50) — but they have no
    // keys, so the key-count check should not fire.
    const m = { items: Array.from({ length: 60 }, (_, i) => i) }
    expect(() => validateMetadata(m)).not.toThrow()
  })

  it('counts keys across nested objects (additive)', () => {
    // 30 keys at root + 25 keys at level 2 = 55 total > 50 cap.
    const root: Record<string, unknown> = {}
    for (let i = 0; i < 30; i += 1) root[`k${i}`] = i
    const child: Record<string, unknown> = {}
    for (let i = 0; i < 25; i += 1) child[`c${i}`] = i
    root.child = child
    let thrown: ApiError | null = null
    try {
      validateMetadata(root)
    } catch (e) {
      thrown = e as ApiError
    }
    expect(thrown?.code).toBe('invalid_request')
    expect(thrown?.message).toMatch(/keys/i)
  })
})
