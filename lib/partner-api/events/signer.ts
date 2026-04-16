// lib/partner-api/events/signer.ts — Outbound webhook signing.
//
// Header format matches GitHub + Stripe conventions so partner implementations
// can reuse existing libraries:
//   X-MG-Timestamp: <unix seconds>
//   X-MG-Signature-256: sha256=<hex>
//
// Signing payload: `${timestamp}.${body}` exactly. The receiver MUST reject
// payloads whose timestamp is more than 5 minutes off wall clock.
//
// All partners receive the same signature format; the secret they use to
// verify is their per-subscription secret.

import { hmacSha256Hex } from '../auth'

export interface SignedHeaders {
  'X-MG-Timestamp': string
  'X-MG-Signature-256': string
}

/** Produce the signing headers for a given body + secret. Timestamp is
 *  injectable for tests; defaults to now. */
export async function signOutbound(
  body: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SignedHeaders> {
  const ts = Math.floor(nowMs / 1000).toString()
  const payload = `${ts}.${body}`
  const sig = await hmacSha256Hex(secret, payload)
  return {
    'X-MG-Timestamp': ts,
    'X-MG-Signature-256': `sha256=${sig}`,
  }
}
