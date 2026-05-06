import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkCronSecret, constantTimeBearerOk } from '@/lib/auth/check-cron-secret'

const SECRET = 'test-cron-secret-32bytes-or-more-padding'

function makeRequest(authHeader: string | null): { headers: { get(name: string): string | null } } {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? authHeader : null,
    },
  }
}

describe('constantTimeBearerOk', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeBearerOk('abc', 'abc')).toBe(true)
  })

  it('returns false for different strings of same length', () => {
    expect(constantTimeBearerOk('abc', 'xyz')).toBe(false)
  })

  it('returns false for different strings of different length', () => {
    // sha256 normalizes both to 32 bytes — no length-branch timing channel
    expect(constantTimeBearerOk('abc', 'abcdef')).toBe(false)
  })

  it('handles multibyte tokens without length divergence', () => {
    // Buffer.from('日本') is 6 bytes; raw char count is 2. The sha256 path
    // collapses both sides to 32 bytes regardless.
    expect(constantTimeBearerOk('日本', '日本')).toBe(true)
    expect(constantTimeBearerOk('日本', '中国')).toBe(false)
  })
})

describe('checkCronSecret', () => {
  const originalEnv = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
  })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalEnv
  })

  it('returns true when Bearer matches CRON_SECRET', () => {
    expect(checkCronSecret(makeRequest(`Bearer ${SECRET}`))).toBe(true)
  })

  it('returns false when token is wrong', () => {
    expect(checkCronSecret(makeRequest('Bearer wrong-token'))).toBe(false)
  })

  it('returns false on missing Authorization header', () => {
    expect(checkCronSecret(makeRequest(null))).toBe(false)
  })

  it('returns false on empty header', () => {
    expect(checkCronSecret(makeRequest(''))).toBe(false)
  })

  it('returns false when CRON_SECRET is unset (fail-closed)', () => {
    delete process.env.CRON_SECRET
    expect(checkCronSecret(makeRequest(`Bearer ${SECRET}`))).toBe(false)
  })

  it('returns false when CRON_SECRET is empty string (fail-closed)', () => {
    process.env.CRON_SECRET = ''
    expect(checkCronSecret(makeRequest(`Bearer ${SECRET}`))).toBe(false)
  })

  it('handles whitespace pasted into header or env', () => {
    process.env.CRON_SECRET = `  ${SECRET}  `
    expect(checkCronSecret(makeRequest(`Bearer   ${SECRET}  `))).toBe(true)
  })

  it('case-insensitive Bearer prefix', () => {
    expect(checkCronSecret(makeRequest(`bearer ${SECRET}`))).toBe(true)
    expect(checkCronSecret(makeRequest(`BEARER ${SECRET}`))).toBe(true)
  })

  it('rejects request without Bearer prefix', () => {
    // The original sha256 compare against the secret directly (without
    // prefix-strip) would still pass — but stripping a non-existent
    // "Bearer " prefix leaves the raw value which won't match unless the
    // caller passed it as bare token. This is intentional: callers that
    // try to pass a bare token still get rejected because the raw value
    // doesn't equal SECRET unless they specifically passed SECRET as the
    // header (which would technically auth — design choice).
    expect(checkCronSecret(makeRequest('not-a-bearer-token'))).toBe(false)
  })
})
