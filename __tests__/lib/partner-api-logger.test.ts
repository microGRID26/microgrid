// __tests__/lib/partner-api-logger.test.ts — R2 edge-case coverage for the
// sensitive-query-param redactor added in R1.

import { describe, it, expect } from 'vitest'
import { redactQueryParams } from '@/lib/partner-api/logger'

describe('redactQueryParams', () => {
  it('returns null for null input', () => {
    expect(redactQueryParams(null)).toBeNull()
  })

  it('passes non-sensitive keys through verbatim', () => {
    const out = redactQueryParams({ status: 'pending', limit: '25' })
    expect(out).toEqual({ status: 'pending', limit: '25' })
  })

  it('redacts token-like keys regardless of case', () => {
    const out = redactQueryParams({
      Token: 'abc',
      API_KEY: 'xyz',
      Secret: 'deadbeef',
      authorization: 'Bearer x',
    })
    expect(out).toEqual({
      Token: '[REDACTED]',
      API_KEY: '[REDACTED]',
      Secret: '[REDACTED]',
      authorization: '[REDACTED]',
    })
  })

  it('redacts access_token / refresh_token / id_token', () => {
    const out = redactQueryParams({
      access_token: 'a',
      refresh_token: 'r',
      id_token: 'i',
      other: 'keep',
    })
    expect(out).toEqual({
      access_token: '[REDACTED]',
      refresh_token: '[REDACTED]',
      id_token: '[REDACTED]',
      other: 'keep',
    })
  })

  it('redacts signature header leak into query string', () => {
    const out = redactQueryParams({
      signature: 'sha256=deadbeef',
      x_mg_signature: 'sha256=also',
      status: 'ok',
    })
    expect(out).toEqual({
      signature: '[REDACTED]',
      x_mg_signature: '[REDACTED]',
      status: 'ok',
    })
  })

  it('preserves key order', () => {
    const out = redactQueryParams({ a: '1', token: 'x', b: '2' })
    expect(Object.keys(out as object)).toEqual(['a', 'token', 'b'])
  })

  it('does NOT recursively redact nested objects (documented limitation)', () => {
    // Query strings are flat in practice; if someone JSON-stringifies a filter
    // into a query param, the whole blob ends up as one string value.
    const out = redactQueryParams({ filter: '{"token":"leak"}' })
    // The KEY 'filter' isn't sensitive, so the value passes through. This is
    // the documented behavior — we don't parse nested JSON. If this ever
    // becomes a real leak vector, the redaction logic needs a second pass.
    expect(out).toEqual({ filter: '{"token":"leak"}' })
  })
})
