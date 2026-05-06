// lib/auth/check-cron-secret.ts — canonical CRON_SECRET bearer check.
//
// Audit 2026-05 cron-fanout M2 (#555). Five+ near-identical inline copies
// across cron routes drifted in subtle ways: anon-user-cleanup used
// sha256-then-compare (constant-length on multibyte tokens, no length
// branch); the others used raw Buffer.from + length pre-check. One drift
// away from a timing-channel regression.
//
// This is the canonical impl. All cron routes call this; no inline copies.

import { createHash, timingSafeEqual } from 'crypto'

/** Constant-time bearer-token check. sha256 both sides before
 *  timingSafeEqual so the byte buffers are always 32 bytes — removes the
 *  length-branch timing channel and the utf-8 encoding quirk that would
 *  otherwise make `Buffer.from(multibyte)` vary in length from the raw
 *  char count. */
export function constantTimeBearerOk(token: string, secret: string): boolean {
  const a = createHash('sha256').update(token).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

/** Verify the request carries Authorization: Bearer <CRON_SECRET>. Returns
 *  true on match, false otherwise. The trim() handles stray whitespace
 *  pasted into Vercel UI (the same class of bug as the 2026-04-17
 *  EDGE_WEBHOOK_SECRET incident). Accepts any object with `.headers.get(name)`
 *  — works for both NextRequest and the bare Request type. */
export function checkCronSecret(request: { headers: { get(name: string): string | null } }): boolean {
  const expected = (process.env.CRON_SECRET ?? '').trim()
  if (!expected) return false
  const header = (request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '').trim()
  if (!header) return false
  return constantTimeBearerOk(header, expected)
}
