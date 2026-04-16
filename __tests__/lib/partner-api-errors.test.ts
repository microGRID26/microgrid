// __tests__/lib/partner-api-errors.test.ts — ApiError + RFC 7807 error body.

import { describe, it, expect } from 'vitest'
import { ApiError, errorResponse, internalError } from '@/lib/partner-api/errors'

describe('ApiError', () => {
  it('maps codes to status codes', () => {
    expect(new ApiError('unauthorized', '').status).toBe(401)
    expect(new ApiError('forbidden', '').status).toBe(403)
    expect(new ApiError('not_found', '').status).toBe(404)
    expect(new ApiError('rate_limited', '').status).toBe(429)
    expect(new ApiError('idempotency_conflict', '').status).toBe(409)
    expect(new ApiError('internal_error', '').status).toBe(500)
  })

  it('preserves details', () => {
    const err = new ApiError('forbidden', 'missing scope', { missing: ['x'] })
    expect(err.details).toEqual({ missing: ['x'] })
  })
})

describe('errorResponse', () => {
  it('produces an RFC 7807-shaped body with request_id', async () => {
    const err = new ApiError('forbidden', 'nope')
    const res = errorResponse(err, 'req_test123')
    expect(res.status).toBe(403)
    expect(res.headers.get('X-Request-Id')).toBe('req_test123')
    const body = await res.json() as { error: { code: string; message: string; request_id: string } }
    expect(body.error.code).toBe('forbidden')
    expect(body.error.message).toBe('nope')
    expect(body.error.request_id).toBe('req_test123')
  })

  it('includes details when present', async () => {
    const err = new ApiError('forbidden', 'missing', { missing: ['a'] })
    const res = errorResponse(err, 'req_x')
    const body = await res.json() as { error: { details?: unknown } }
    expect(body.error.details).toEqual({ missing: ['a'] })
  })
})

describe('internalError', () => {
  it('produces a 500', async () => {
    const res = internalError('req_x')
    expect(res.status).toBe(500)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('internal_error')
  })
})
