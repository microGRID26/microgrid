// lib/partner-api/idempotency.ts — 24h response cache keyed on Idempotency-Key.
//
// Flow on a write endpoint:
//  1. Extract Idempotency-Key header (optional on PATCH, recommended on POST)
//  2. Compute sha256(body) as request_hash
//  3. readOrReserve(keyId, idempKey, reqHash):
//     - if no prior row: INSERT a reservation with status=0 and return { cached: false }
//     - if prior row with matching hash: return { cached: true, response }
//     - if prior row with different hash: throw 409 idempotency_conflict
//  4. Handler runs, produces response
//  5. recordResponse(keyId, idempKey, status, body) persists the response
//
// This is at-least-once semantics on the server's view, but since the client
// sees the cached response on retry, it's effectively exactly-once.

import { createHash } from 'crypto'
import { ApiError } from './errors'
import { partnerApiAdmin } from './supabase-admin'

const IDEMP_HEADER = 'Idempotency-Key'
const MAX_KEY_LEN = 255

export interface IdempotencyResult {
  cached: boolean
  response?: { status: number; body: unknown }
  /**
   * Hash of the request body that originally completed under this
   * Idempotency-Key. Populated on cache hits ONLY (cached=true). Routes
   * pass this through `assertPriorBodyMatches` as a belt-and-suspenders
   * check on top of readOrReserve's own hash compare — guards against a
   * future helper refactor silently regressing the hash check (#504).
   */
  requestHash?: string
}

export function bodyHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

export function extractIdempotencyKey(headers: Headers): string | null {
  const raw = headers.get(IDEMP_HEADER) ?? headers.get(IDEMP_HEADER.toLowerCase())
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > MAX_KEY_LEN) {
    throw new ApiError('invalid_request', `Idempotency-Key must be ≤${MAX_KEY_LEN} characters`)
  }
  return trimmed
}

/**
 * Reserve an idempotency slot, or return the cached prior response.
 * The reservation row uses status=0 to indicate "in flight" — handlers then
 * call recordResponse() to commit the actual status + body.
 */
export async function readOrReserve(
  apiKeyId: string,
  idempKey: string,
  reqHash: string,
): Promise<IdempotencyResult> {
  const sb = partnerApiAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = sb as any

  // Try to insert a reservation. ON CONFLICT DO NOTHING means:
  //   - Insert succeeded: no prior request, we reserved the slot
  //   - No row returned: there's a prior row, go fetch it
  const reserve = await client
    .from('partner_idempotency_keys')
    .insert({
      api_key_id: apiKeyId,
      idempotency_key: idempKey,
      request_hash: reqHash,
      response_status: 0,               // 0 = reserved, not yet completed
      response_body: {},
    })
    .select('api_key_id')
    .maybeSingle()

  // supabase-js returns error on conflict (PGRST116 / 23505) — detect prior row
  if (reserve.error == null && reserve.data != null) {
    return { cached: false }
  }

  // Prior row exists — fetch and compare
  const existing = await client
    .from('partner_idempotency_keys')
    .select('request_hash, response_status, response_body, created_at')
    .eq('api_key_id', apiKeyId)
    .eq('idempotency_key', idempKey)
    .maybeSingle()

  if (existing.error || !existing.data) {
    // Racy: reservation insert collided but SELECT came back empty. Treat as fresh.
    return { cached: false }
  }

  const row = existing.data as {
    request_hash: string
    response_status: number
    response_body: unknown
    created_at: string
  }
  if (row.request_hash !== reqHash) {
    throw new ApiError(
      'idempotency_conflict',
      'Idempotency-Key reused with a different request body',
      { idempotency_key: idempKey },
    )
  }

  if (row.response_status === 0) {
    // R1 fix (Medium): reservation rows that never got recordResponse'd
    // (handler crash, process kill between reserve + record) would otherwise
    // soft-lock the (key, idempotency_key) pair forever. If the reservation
    // is older than STALE_RESERVATION_MS, take it over with a fresh write
    // so the retry can proceed. 60s is long enough for any legitimate
    // request to finish and short enough that a retrying client gets a
    // quick recovery path.
    const ageMs = Date.now() - new Date(row.created_at).getTime()
    if (ageMs > STALE_RESERVATION_MS) {
      // R2 fix: the prior UPDATE had no timestamp predicate, so two concurrent
      // requests could both see response_status=0 and both pass the .eq()
      // filter — resulting in both writes succeeding and both callers
      // proceeding to create duplicate rows. Adding .eq('created_at', row.created_at)
      // turns this into optimistic concurrency control: only one of the racing
      // UPDATEs matches the original timestamp, the loser's update affects 0
      // rows and falls through to the in-flight reject path.
      const takeover = await client
        .from('partner_idempotency_keys')
        .update({ request_hash: reqHash, response_status: 0, response_body: {}, created_at: new Date().toISOString() })
        .eq('api_key_id', apiKeyId)
        .eq('idempotency_key', idempKey)
        .eq('response_status', 0)
        .eq('created_at', row.created_at)
        .select('api_key_id')
      if (takeover.data && takeover.data.length > 0) {
        return { cached: false }
      }
      // Lost the takeover race — another request is already reprocessing.
      throw new ApiError(
        'idempotency_conflict',
        'A request with this Idempotency-Key is currently in flight',
        { idempotency_key: idempKey, retry_recommended: true },
      )
    }
    // Still in flight from a parallel request — reject with 409 so client retries later
    throw new ApiError(
      'idempotency_conflict',
      'A request with this Idempotency-Key is currently in flight',
      { idempotency_key: idempKey, retry_recommended: true },
    )
  }

  return {
    cached: true,
    response: { status: row.response_status, body: row.response_body },
    requestHash: row.request_hash,
  }
}

/**
 * Belt-and-suspenders body-hash assertion (#504). `readOrReserve` already
 * throws idempotency_conflict on hash mismatch, but the route doesn't
 * verify that contract — a future helper refactor that regresses the
 * mismatch check would silently let mismatched replays succeed. Calling
 * this immediately after `readOrReserve` ensures every cache hit's prior
 * body still matches the current request body, regardless of helper drift.
 *
 * Throws ApiError('idempotency_conflict', 409) on mismatch. Safe to call
 * unconditionally — does nothing on cache miss (requestHash undefined).
 */
export function assertPriorBodyMatches(
  prior: IdempotencyResult,
  reqHash: string,
  idempKey: string,
): void {
  if (!prior.cached) return
  // readOrReserve only sets requestHash on cache hits. If it's undefined
  // here, that's a HELPER CONTRACT VIOLATION (Greg's bug), not a partner
  // bug — surface as 500 so monitoring pages an operator and the partner's
  // 4xx-retry logic doesn't loop forever on a stuck idempotency key.
  // (#504 R1 M3)
  if (prior.requestHash === undefined) {
    throw new ApiError(
      'internal_error',
      'Idempotency cache hit missing request_hash — readOrReserve contract violation',
    )
  }
  if (prior.requestHash !== reqHash) {
    throw new ApiError(
      'idempotency_conflict',
      'Body content does not match prior request with same Idempotency-Key',
      { idempotency_key: idempKey },
    )
  }
}

export const STALE_RESERVATION_MS = 60_000

export async function recordResponse(
  apiKeyId: string,
  idempKey: string,
  status: number,
  body: unknown,
): Promise<void> {
  const sb = partnerApiAdmin()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any)
    .from('partner_idempotency_keys')
    .update({ response_status: status, response_body: body })
    .eq('api_key_id', apiKeyId)
    .eq('idempotency_key', idempKey)
}
