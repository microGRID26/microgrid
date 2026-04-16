// __tests__/lib/partner-api-auth.test.ts — Pure-logic tests for the
// partner-api auth helpers: bearer extraction, SHA-256 hashing, HMAC
// signature verification, timestamp freshness.

import { describe, it, expect } from 'vitest'
import {
  extractBearer,
  generateBearerKey,
  sha256Hex,
  timingSafeEqualStr,
  verifySignature,
  hmacSha256Hex,
} from '@/lib/partner-api/auth'
import { ApiError } from '@/lib/partner-api/errors'

function hdrs(init: Record<string, string> = {}): Headers {
  const h = new Headers()
  for (const [k, v] of Object.entries(init)) h.set(k, v)
  return h
}

describe('extractBearer', () => {
  it('returns the token for a well-formed header', () => {
    const out = extractBearer(hdrs({ Authorization: 'Bearer mg_live_abcd1234' }))
    expect(out).toBe('mg_live_abcd1234')
  })

  it('tolerates extra whitespace + mixed case', () => {
    const out = extractBearer(hdrs({ Authorization: '  bEaReR   mg_live_xyz  ' }))
    expect(out).toBe('mg_live_xyz')
  })

  it('throws 401 if header missing', () => {
    expect(() => extractBearer(hdrs({}))).toThrowError(ApiError)
    try { extractBearer(hdrs({})) } catch (e) {
      expect((e as ApiError).code).toBe('unauthorized')
    }
  })

  it('throws 401 if header is not Bearer scheme', () => {
    expect(() => extractBearer(hdrs({ Authorization: 'Basic abc' }))).toThrowError(ApiError)
  })

  it('throws 401 if token does not start with the mg_live_ prefix', () => {
    expect(() => extractBearer(hdrs({ Authorization: 'Bearer sk_test_nope' }))).toThrowError(ApiError)
  })
})

describe('sha256Hex', () => {
  it('matches a known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('is deterministic', () => {
    const a = sha256Hex('mg_live_same')
    const b = sha256Hex('mg_live_same')
    expect(a).toBe(b)
  })
})

describe('generateBearerKey', () => {
  it('returns plaintext, prefix (12 chars), and 64-char hash', () => {
    const k = generateBearerKey()
    expect(k.plaintext.startsWith('mg_live_')).toBe(true)
    expect(k.plaintext.length).toBe('mg_live_'.length + 32)
    expect(k.prefix.length).toBe(12)
    expect(k.prefix).toBe(k.plaintext.slice(0, 12))
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256Hex(k.plaintext)).toBe(k.hash)
  })

  it('produces distinct plaintexts on each call', () => {
    const a = generateBearerKey()
    const b = generateBearerKey()
    expect(a.plaintext).not.toBe(b.plaintext)
  })
})

describe('timingSafeEqualStr', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualStr('abcd', 'abcd')).toBe(true)
  })
  it('returns false for different lengths', () => {
    expect(timingSafeEqualStr('abcd', 'abcde')).toBe(false)
  })
  it('returns false for same-length differing strings', () => {
    expect(timingSafeEqualStr('abcd', 'abce')).toBe(false)
  })
})

describe('verifySignature', () => {
  const secret = 'mgsk_test_secret_123'
  const method = 'PATCH'
  const path = '/api/v1/partner/engineering/assignments/abc'
  const body = JSON.stringify({ status: 'in_progress' })
  const nowMs = 1_800_000_000_000 // deterministic instant
  const tsSec = Math.floor(nowMs / 1000)

  async function sign(): Promise<string> {
    const bodyHash = sha256Hex(body)
    const payload = `${tsSec}.${method}.${path}.${bodyHash}`
    return hmacSha256Hex(secret, payload)
  }

  it('passes with a fresh, correctly-signed request', async () => {
    const sig = await sign()
    await expect(
      verifySignature({
        secretPlaintext: secret,
        timestampHeader: String(tsSec),
        signatureHeader: `sha256=${sig}`,
        method, path, body, nowMs,
      }),
    ).resolves.toBeUndefined()
  })

  it('accepts signature without the sha256= prefix', async () => {
    const sig = await sign()
    await expect(
      verifySignature({
        secretPlaintext: secret,
        timestampHeader: String(tsSec),
        signatureHeader: sig,
        method, path, body, nowMs,
      }),
    ).resolves.toBeUndefined()
  })

  it('throws timestamp_invalid when timestamp is non-numeric', async () => {
    await expect(
      verifySignature({
        secretPlaintext: secret,
        timestampHeader: 'not-a-number',
        signatureHeader: 'sha256=deadbeef'.padEnd(71, '0'),
        method, path, body, nowMs,
      }),
    ).rejects.toMatchObject({ code: 'timestamp_invalid' })
  })

  it('throws timestamp_invalid when timestamp is > 5 min old', async () => {
    const stale = tsSec - 6 * 60  // 6 minutes old
    const bodyHash = sha256Hex(body)
    const payload = `${stale}.${method}.${path}.${bodyHash}`
    const sig = await hmacSha256Hex(secret, payload)
    await expect(
      verifySignature({
        secretPlaintext: secret,
        timestampHeader: String(stale),
        signatureHeader: `sha256=${sig}`,
        method, path, body, nowMs,
      }),
    ).rejects.toMatchObject({ code: 'timestamp_invalid' })
  })

  it('throws signature_invalid when body has been tampered with', async () => {
    const sig = await sign()
    await expect(
      verifySignature({
        secretPlaintext: secret,
        timestampHeader: String(tsSec),
        signatureHeader: `sha256=${sig}`,
        method, path, body: '{"status":"complete"}',    // DIFFERENT
        nowMs,
      }),
    ).rejects.toMatchObject({ code: 'signature_invalid' })
  })

  it('throws signature_invalid for malformed signature header', async () => {
    await expect(
      verifySignature({
        secretPlaintext: secret,
        timestampHeader: String(tsSec),
        signatureHeader: 'not-hex!',
        method, path, body, nowMs,
      }),
    ).rejects.toMatchObject({ code: 'signature_invalid' })
  })

  it('throws signature_invalid when signed with wrong secret', async () => {
    const bodyHash = sha256Hex(body)
    const payload = `${tsSec}.${method}.${path}.${bodyHash}`
    const sig = await hmacSha256Hex('mgsk_wrong_secret', payload)
    await expect(
      verifySignature({
        secretPlaintext: secret,
        timestampHeader: String(tsSec),
        signatureHeader: `sha256=${sig}`,
        method, path, body, nowMs,
      }),
    ).rejects.toMatchObject({ code: 'signature_invalid' })
  })
})
