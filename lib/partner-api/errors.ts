// lib/partner-api/errors.ts — Uniform error shape for the partner API.
//
// Responses follow RFC 7807-ish: { error: { code, message, request_id, details? } }.
// Handlers throw ApiError; the middleware converts it to a Response.

import { NextResponse } from 'next/server'

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'payload_too_large'
  | 'rate_limited'
  | 'idempotency_conflict'
  | 'signature_required'
  | 'signature_invalid'
  | 'timestamp_invalid'
  | 'actor_required'
  | 'actor_unknown'
  | 'internal_error'
  | 'service_unavailable'

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  payload_too_large: 413,
  rate_limited: 429,
  idempotency_conflict: 409,
  signature_required: 401,
  signature_invalid: 401,
  timestamp_invalid: 401,
  actor_required: 400,
  actor_unknown: 403,
  internal_error: 500,
  service_unavailable: 503,
}

export class ApiError extends Error {
  public readonly code: ApiErrorCode
  public readonly status: number
  public readonly details: Record<string, unknown> | undefined

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = details
  }
}

export interface ErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    request_id: string
    details?: Record<string, unknown>
  }
}

// Generic message returned to clients on any internal_error. Schema enumeration
// via Postgres / handler error text was an audit-rotation 2026-05-02 finding
// (#475 L1) — Postgres messages embed column names, constraint names, and
// offending values, which a malformed PATCH body could probe to map the schema.
const INTERNAL_ERROR_PUBLIC_MESSAGE = 'Internal server error'

export function errorResponse(err: ApiError, requestId: string): NextResponse<ErrorBody> {
  // For internal_error: log the real message server-side keyed to the
  // request_id, but never echo it to the client. Partner sees a generic
  // message + request_id; an operator looking at server logs can correlate.
  const publicMessage = err.code === 'internal_error'
    ? INTERNAL_ERROR_PUBLIC_MESSAGE
    : err.message
  if (err.code === 'internal_error' && err.message !== INTERNAL_ERROR_PUBLIC_MESSAGE) {
    console.error(`[partner-api] internal_error request_id=${requestId}: ${err.message}`)
  }
  const body: ErrorBody = {
    error: {
      code: err.code,
      message: publicMessage,
      request_id: requestId,
    },
  }
  // details are still emitted for non-internal errors (validation hints etc).
  // Internal errors deliberately drop details to avoid the same leak vector.
  if (err.details && err.code !== 'internal_error') body.error.details = err.details
  return NextResponse.json(body, {
    status: err.status,
    headers: { 'X-Request-Id': requestId },
  })
}

export function internalError(requestId: string, message = INTERNAL_ERROR_PUBLIC_MESSAGE): NextResponse<ErrorBody> {
  return errorResponse(new ApiError('internal_error', message), requestId)
}
