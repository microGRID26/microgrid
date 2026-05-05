// lib/partner-api/limits.ts — Inbound payload bounds for the partner API.
//
// The doc-upload route writes its `metadata` payload into a JSONB array on
// the projects row (partner_documents). The append RPC re-writes the entire
// array on every call, so unbounded metadata size or unbounded body size
// causes write amplification + TOAST bloat over time. greg_actions #502
// (red-teamer 2026-05-03 audit, Medium #1) called for explicit caps.
//
// Limits are deliberately tight. Real-world partner doc metadata is small
// (filenames, mime types, originator IDs) — 50 keys / depth 5 / 8 KB
// serialized is generous for any honest use, restrictive enough to defeat
// adversarial nesting / size attacks. Outer raw-body cap of 64 KB sits
// above the doc-body cap so JSON whitespace + the small wrapping fields
// (name, url, type) fit comfortably without reaching the hard limit.
//
// Constants are exported so the integration tests + future routes can
// share them. Increasing any of them is a deliberate change, not an
// inline tweak.

import { ApiError } from './errors'

export const MAX_RAW_BODY_BYTES = 64 * 1024 // 64 KiB on the wire
export const MAX_DOC_BODY_BYTES = 8 * 1024 //  8 KiB once parsed (smaller — leaves headroom for wrapper)
export const MAX_METADATA_KEYS = 50
export const MAX_METADATA_DEPTH = 5
// Cap on partner_documents JSONB array length per project. The append RPC
// rewrites the entire array on every call — unbounded length would drift
// the projects row toward TOAST bloat over time. 50 is generous for any
// honest partner-document use (signed contract, utility bill, ID, photos)
// and tight enough to defeat balloon attacks via leads:write. (#474 M4)
export const MAX_PARTNER_DOCS_PER_LEAD = 50

/**
 * Throws ApiError('payload_too_large') if `raw` exceeds the wire limit.
 * Length is byte-counted via TextEncoder so multibyte characters can't
 * sneak past a `.length` check on the JS string.
 */
export function enforceRawBodyLimit(raw: string): void {
  // TextEncoder is available in the Vercel Node + Edge runtimes.
  const byteLen = new TextEncoder().encode(raw).byteLength
  if (byteLen > MAX_RAW_BODY_BYTES) {
    // Echo only `max_bytes` (public config). The attacker-controlled
    // `byte_length` is dropped — gives no defender value, leaks an
    // oracle for binary-search probing of the cap. (#502 R1 M2)
    throw new ApiError(
      'payload_too_large',
      `Request body exceeds ${MAX_RAW_BODY_BYTES} bytes`,
      { max_bytes: MAX_RAW_BODY_BYTES }
    )
  }
}

/**
 * Validates a parsed metadata object (or null/undefined). Throws
 * ApiError('invalid_request') if any of the bounds is exceeded:
 *   - total key count across all nested objects > MAX_METADATA_KEYS
 *   - nesting depth > MAX_METADATA_DEPTH
 *   - JSON-serialized size > MAX_METADATA_BYTES
 *
 * `null` / `undefined` are accepted (no metadata is fine). Arrays count
 * as a level of depth but their entries are not key-counted (they have
 * no keys); object entries inside the array are. This matches what a
 * realistic JSONB metadata blob looks like.
 *
 * Caller must have already JSON.parsed the metadata; this function does
 * a structural walk + a serialization size check, not parsing.
 */
export function validateMetadata(metadata: unknown): void {
  if (metadata === null || metadata === undefined) return
  if (typeof metadata !== 'object') {
    throw new ApiError(
      'invalid_request',
      'metadata must be an object (or omitted)'
    )
  }
  // Reject root arrays explicitly (#502 R1 H3). `typeof [] === 'object'`
  // would otherwise sneak past the type check and store an array in the
  // partner_documents[].metadata slot — downstream code that does
  // `doc.metadata.someKey` would silently return undefined or expose
  // array methods to consumers that iterate Object.keys.
  if (Array.isArray(metadata)) {
    throw new ApiError(
      'invalid_request',
      'metadata must be an object, not an array'
    )
  }

  let totalKeys = 0
  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_METADATA_DEPTH) {
      throw new ApiError(
        'invalid_request',
        `metadata exceeds ${MAX_METADATA_DEPTH} levels of nesting`,
        { max_depth: MAX_METADATA_DEPTH }
      )
    }
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    for (const key of Object.keys(node)) {
      totalKeys += 1
      if (totalKeys > MAX_METADATA_KEYS) {
        throw new ApiError(
          'invalid_request',
          `metadata exceeds ${MAX_METADATA_KEYS} total keys`,
          { max_keys: MAX_METADATA_KEYS }
        )
      }
      walk((node as Record<string, unknown>)[key], depth + 1)
    }
  }
  walk(metadata, 1)

  // Serialized-size check. JSON.stringify can throw on circular refs;
  // surface that as invalid_request rather than a 500. Multibyte chars
  // counted via TextEncoder.
  let serialized: string
  try {
    serialized = JSON.stringify(metadata)
  } catch {
    throw new ApiError('invalid_request', 'metadata is not JSON-serializable')
  }
  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes > MAX_DOC_BODY_BYTES) {
    // `byte_length` dropped from details — see comment in enforceRawBodyLimit.
    throw new ApiError(
      'invalid_request',
      `metadata exceeds ${MAX_DOC_BODY_BYTES} bytes when serialized`,
      { max_bytes: MAX_DOC_BODY_BYTES }
    )
  }
}
