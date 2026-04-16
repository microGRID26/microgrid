// __tests__/lib/partner-api-signer.test.ts — Outbound signing header shape.

import { describe, it, expect } from 'vitest'
import { signOutbound } from '@/lib/partner-api/events/signer'
import { hmacSha256Hex } from '@/lib/partner-api/auth'

describe('signOutbound', () => {
  const secret = 'wsec_test'
  const body = JSON.stringify({ event_type: 'x', payload: { a: 1 } })
  const nowMs = 1_800_000_000_000

  it('returns X-MG-Timestamp (seconds) + X-MG-Signature-256 (sha256=<hex>)', async () => {
    const headers = await signOutbound(body, secret, nowMs)
    expect(headers['X-MG-Timestamp']).toBe('1800000000')
    expect(headers['X-MG-Signature-256']).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('signature matches HMAC-SHA256(secret, `${ts}.${body}`)', async () => {
    const headers = await signOutbound(body, secret, nowMs)
    const expected = await hmacSha256Hex(secret, `1800000000.${body}`)
    expect(headers['X-MG-Signature-256']).toBe(`sha256=${expected}`)
  })

  it('produces distinct signatures for distinct bodies', async () => {
    const a = await signOutbound('body-A', secret, nowMs)
    const b = await signOutbound('body-B', secret, nowMs)
    expect(a['X-MG-Signature-256']).not.toBe(b['X-MG-Signature-256'])
  })
})
