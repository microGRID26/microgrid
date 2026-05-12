// __tests__/lib/partner-api-fanout-idempotency.test.ts
//
// Snapshot guards that ensure both surfaces of the partner-dedup contract
// stay live on outbound deliveries (#575 M1 + docs/partners/webhooks.md):
//   1. X-MG-Event-Id header on every outbound POST.
//   2. event_id field in the signed JSON body.
//
// If either surface ever moves or gets renamed, partners' dedup logic breaks
// and at-least-once delivery silently turns into duplicate side-effects on
// the receiver side. This test exists to fail loudly before that happens.

import { describe, it, expect } from 'vitest'

import {
  buildFanoutHeaders,
  buildFanoutBody,
} from '@/lib/partner-api/events/fanout'

describe('partner webhook idempotency surfaces (#575 M1)', () => {
  const evt = {
    event_type: 'partner.project.signed',
    event_id: '00000000-0000-4000-8000-000000000001',
    emitted_at: '2026-05-12T00:00:00.000Z',
    payload: { project_id: 'PROJ-12345' },
  }
  const signedHeaders = {
    'X-MG-Timestamp': '1747008000',
    'X-MG-Signature-256': 'sha256=deadbeef',
  }

  it('outbound headers include X-MG-Event-Id with the event UUID', () => {
    const headers = buildFanoutHeaders(evt, signedHeaders)
    expect(headers['X-MG-Event-Id']).toBe(evt.event_id)
  })

  it('outbound headers include X-MG-Event-Type', () => {
    const headers = buildFanoutHeaders(evt, signedHeaders)
    expect(headers['X-MG-Event-Type']).toBe(evt.event_type)
  })

  it('signed body includes event_id matching the header surface', () => {
    const body = buildFanoutBody(evt)
    const parsed = JSON.parse(body)
    expect(parsed.event_id).toBe(evt.event_id)
  })

  it('signed body includes the four contract keys at top level', () => {
    const body = buildFanoutBody(evt)
    const parsed = JSON.parse(body)
    expect(Object.keys(parsed).sort()).toEqual(
      ['emitted_at', 'event_id', 'event_type', 'payload'].sort(),
    )
  })

  it('event_id is identical between header and body (dedup invariant)', () => {
    const headers = buildFanoutHeaders(evt, signedHeaders)
    const body = buildFanoutBody(evt)
    const parsed = JSON.parse(body)
    expect(headers['X-MG-Event-Id']).toBe(parsed.event_id)
  })
})
