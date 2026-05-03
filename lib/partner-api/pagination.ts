// lib/partner-api/pagination.ts — Cursor-based pagination helpers.
//
// Cursors are base64url-encoded JSON: {"t": <ISO>, "id": "<uuid-or-id>"}. Decoded
// by the handler, used as a tie-breaking bound on (created_at, id) so the list
// stays stable under inserts.
//
// Cursor inputs ARE interpolated into raw PostgREST `.or()` strings by the
// route handlers (`created_at.lt.<t>,and(created_at.eq.<t>,id.lt.<id>)`). That
// means decodeCursor MUST reject any value that could escape the filter (DoS
// via 500s, schema enumeration via Postgres error echo). The shape here
// therefore validates `t` as strict ISO-8601 and `id` as a conservative
// `[A-Za-z0-9_-]{1,64}` allowlist (covers UUIDs and the `LEAD-<hex>` ids the
// projects table uses). #473.

import { ApiError } from './errors'

export interface Cursor {
  /** Created-at value as ISO 8601. */
  t: string
  /** Row id for tie-breaking when multiple rows share created_at. */
  id: string
}

const MAX_PAGE = 100
const DEFAULT_PAGE = 25

// Strict ISO-8601 with mandatory date + time components, optional fractional
// seconds (up to 6 — PostgREST serializes timestamptz at microsecond
// precision), and a `Z` or ±HH(:?)MM(?:MM)? offset. Rejects anything with
// parens, commas, quotes, or PostgREST operator characters. Verified against
// real `projects.created_at` / `engineering_assignments.created_at` rows
// which serialize as `2026-03-30T16:00:08.432421+00:00`.
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/

// Conservative id allowlist. UUIDs match `[0-9a-f-]{36}`; `LEAD-<hex>` and
// `PROJ-<digits>` ids match this too. Anything else is rejected — no parens,
// commas, spaces, dots, slashes.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_PAGE
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) {
    throw new ApiError('invalid_request', '`limit` must be a positive integer')
  }
  return Math.min(n, MAX_PAGE)
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null

  // Reason strings are an allowlist — never echo back JSON.parse output, which
  // can contain attacker-controlled bytes ("Unexpected token X in JSON at
  // position N"). We classify the failure to one of these labels and surface
  // only the label to the client.
  let reason: string | null = null
  let cursor: Cursor | null = null
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      reason = 'cursor payload not valid JSON'
      throw null // jump to ApiError below with the static reason
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as Cursor).t !== 'string' ||
      typeof (parsed as Cursor).id !== 'string'
    ) {
      reason = 'cursor payload must have {t, id} strings'
      throw null
    }
    const c = parsed as Cursor
    if (!ISO_8601_RE.test(c.t)) {
      reason = 'cursor.t must be an ISO-8601 timestamp'
      throw null
    }
    if (!SAFE_ID_RE.test(c.id)) {
      reason = 'cursor.id must match [A-Za-z0-9_-]{1,64}'
      throw null
    }
    cursor = c
  } catch {
    if (reason === null) reason = 'cursor decode failed'
    throw new ApiError('invalid_request', 'Invalid cursor', { reason })
  }
  return cursor
}

/** Shape of a paginated list response. Consistent across all list endpoints. */
export interface ListResponse<T> {
  data: T[]
  cursor: string | null        // opaque — clients should echo back verbatim
  has_more: boolean
}

/** Build a paginated response from a batch of rows. Assumes rows already
 *  sorted by (created_at DESC, id DESC) and limited to `limit + 1`. */
export function buildListResponse<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): ListResponse<T> {
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]
  const cursor = hasMore && last
    ? encodeCursor({ t: last.created_at, id: last.id })
    : null
  return { data: page, cursor, has_more: hasMore }
}
