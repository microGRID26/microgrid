// lib/partner-api/auth.ts — Bearer + HMAC signature verification for the partner API.
//
// Separation of duties:
//  - bearer token (in Authorization header) authenticates the caller
//  - signing secret (in X-MG-Signature header) authorizes the write
// A leaked bearer alone cannot mutate state — the attacker would also need the
// signing secret. Both are returned exactly once at key creation and stored only
// as SHA-256 hashes.

import { createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'crypto'
import { ApiError } from './errors'

// ── Key format ───────────────────────────────────────────────────────────────

const BEARER_PREFIX = 'mg_live_'        // production keys; consider mg_test_ in future
const KEY_BODY_LEN = 32                 // 32 base62 chars ≈ 190 bits of entropy
const KEY_DISPLAY_PREFIX_LEN = 12       // first N chars shown in admin UI
// Defense-in-depth: legitimate tokens are exactly BEARER_PREFIX (8) + 32 = 40 chars.
// A 64-char ceiling leaves headroom for any future prefix change while still
// rejecting pathological tokens before they hit sha256/DB lookup. (#475 L2)
const MAX_BEARER_LEN = 64

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function randomBase62(len: number): string {
  // Rejection-sample bytes to get uniform base62 without modulo bias.
  const out: string[] = []
  while (out.length < len) {
    const buf = randomBytes(len * 2)
    for (let i = 0; i < buf.length && out.length < len; i++) {
      const b = buf[i]
      if (b < 248) out.push(BASE62[b % 62])   // 248 = 62 * 4
    }
  }
  return out.join('')
}

export interface GeneratedKey {
  plaintext: string       // return to user ONCE; never persisted
  prefix: string          // first 12 chars — safe to display
  hash: string            // SHA-256 hex — persisted
}

export function generateBearerKey(): GeneratedKey {
  const plaintext = BEARER_PREFIX + randomBase62(KEY_BODY_LEN)
  return {
    plaintext,
    prefix: plaintext.slice(0, KEY_DISPLAY_PREFIX_LEN),
    hash: sha256Hex(plaintext),
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

// ── Bearer extraction ────────────────────────────────────────────────────────

/** Pull the bearer token off an `Authorization: Bearer <token>` header.
 *  Throws 401 if missing or malformed. Does NOT verify the token. */
export function extractBearer(headers: Headers): string {
  const auth = headers.get('authorization')
  if (!auth) throw new ApiError('unauthorized', 'Missing Authorization header')
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
  if (!m) throw new ApiError('unauthorized', 'Authorization header must be of the form "Bearer <token>"')
  const token = m[1].trim()
  if (!token.startsWith(BEARER_PREFIX)) {
    throw new ApiError('unauthorized', 'Invalid API key format')
  }
  if (token.length > MAX_BEARER_LEN) {
    throw new ApiError('unauthorized', 'Invalid API key format')
  }
  return token
}

// ── Timing-safe comparison ───────────────────────────────────────────────────
// Wrap Node's built-in to tolerate mismatched lengths without throwing.

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return nodeTimingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

// ── HMAC signature verification (Web Crypto — cross-runtime) ─────────────────
//
// v1 inbound auth is bearer-only (Stripe/GitHub pattern). Signing is reserved
// for two cases:
//   1. Outbound webhook delivery (this helper is consumed by the dispatcher)
//   2. Opt-in partner keys that set signing_secret_encrypted — future path
//
// Scheme (when used): signature = HMAC_SHA256(secret, `${ts}.${method}.${path}.${sha256(body)}`)
// with a 5-minute freshness window, matching the existing EDGE webhook
// pattern in app/api/webhooks/edge/route.ts.

const SIG_FRESHNESS_MS = 5 * 60 * 1000

export interface VerifySignatureArgs {
  secretPlaintext: string
  timestampHeader: string
  signatureHeader: string
  method: string
  path: string
  body: string
  nowMs?: number
}

export async function verifySignature(args: VerifySignatureArgs): Promise<void> {
  const now = args.nowMs ?? Date.now()
  const ts = Number(args.timestampHeader)
  if (!Number.isFinite(ts) || ts <= 0) {
    throw new ApiError('timestamp_invalid', 'X-MG-Timestamp must be a positive integer (seconds since epoch)')
  }
  // Asymmetric freshness window: tolerate legitimate past skew up to
  // SIG_FRESHNESS_MS (5 min), but only 30 sec of future skew. A symmetric
  // 5-min future window would let an attacker who captured a signature
  // extend their replay reach by up to 5 min beyond legitimate clock drift.
  // (audit-rotation 2026-04-28 webhook-signing-replay Low #1.)
  const skewMs = now - ts * 1000
  if (skewMs > SIG_FRESHNESS_MS) {
    throw new ApiError('timestamp_invalid', `Signature timestamp too old (age=${Math.round(skewMs / 1000)}s)`)
  }
  if (skewMs < -30_000) {
    throw new ApiError('timestamp_invalid', `Signature timestamp too far in the future (skew=${Math.round(-skewMs / 1000)}s)`)
  }

  const provided = args.signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(provided)) {
    throw new ApiError('signature_invalid', 'X-MG-Signature must be a 64-char lowercase hex SHA-256')
  }

  const bodyHash = sha256Hex(args.body)
  const payload = `${ts}.${args.method.toUpperCase()}.${args.path}.${bodyHash}`
  const expected = await hmacSha256Hex(args.secretPlaintext, payload)

  if (!timingSafeEqualStr(expected, provided)) {
    throw new ApiError('signature_invalid', 'Signature did not match expected HMAC-SHA256')
  }
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── Key lookup + revocation check ────────────────────────────────────────────

export interface PartnerKeyRow {
  id: string
  org_id: string
  name: string
  scopes: string[]
  rate_limit_tier: 'standard' | 'premium' | 'unlimited'
  customer_pii_scope: boolean
  /** True iff the row has an encrypted signing secret set — opt-in signed writes. */
  has_signing_secret: boolean
  expires_at: string
  revoked_at: string | null
}

/** Row shape + resolved org metadata needed to build a PartnerContext. */
export interface ResolvedPartnerKey extends PartnerKeyRow {
  org_slug: string
  org_type: string
}

/** Supabase admin client shape — accepts any value and does all typing at
 *  runtime. Matches the `db()` helper pattern used elsewhere in the repo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = any

/** Look up a key row by bearer hash. Returns null if not found or revoked/expired. */
export async function lookupKeyByHash(
  sb: AdminClient,
  bearerHash: string,
  nowIso: string = new Date().toISOString(),
): Promise<ResolvedPartnerKey | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = sb as any
  const { data, error } = await client
    .from('partner_api_keys')
    .select(
      `id, org_id, name, scopes, rate_limit_tier, customer_pii_scope,
       signing_secret_encrypted, expires_at, revoked_at,
       organizations:org_id (slug, org_type, active)`
    )
    .eq('key_hash', bearerHash)
    .maybeSingle()
  if (error || !data) return null

  const row = data as Omit<PartnerKeyRow, 'has_signing_secret'> & {
    signing_secret_encrypted: string | null
    organizations: { slug: string; org_type: string; active: boolean } | null
  }
  if (row.revoked_at) return null
  if (row.expires_at && row.expires_at < nowIso) return null
  if (!row.organizations) return null
  // R1 fix (High): deactivated org must invalidate its keys silently.
  // If an admin toggles organizations.active=false, all keys tied to that org
  // stop working on the next request without needing a manual revoke sweep.
  if (row.organizations.active === false) return null

  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    scopes: row.scopes,
    rate_limit_tier: row.rate_limit_tier,
    customer_pii_scope: row.customer_pii_scope,
    has_signing_secret: row.signing_secret_encrypted != null,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    org_slug: row.organizations.slug,
    org_type: row.organizations.org_type,
  }
}

/** Check a Redis-backed revocation bit for instant kill-switch. Returns true
 *  if the key is revoked.
 *
 *  Behavior split (R1 audit fix):
 *  - Redis not configured (no env vars): return false — Redis was never
 *    authoritative; the DB `revoked_at` gate in `lookupKeyByHash` is the
 *    only intended check. Deploy-time choice, not a runtime failure.
 *  - Redis configured but request fails (network error, non-ok response,
 *    malformed body): return true (FAIL CLOSED). A revoked key must not
 *    slip through during a Redis outage between admin revoke and next
 *    DB revoke-sweep. Cost of false-positive block is low (clear error
 *    to partner + retry after Redis recovers); cost of false-negative is
 *    letting a revoked partner continue to authenticate. */
export async function checkRevokedRedis(keyId: string): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return false
  try {
    const res = await fetch(`${url}/get/partner_key_revoked:${keyId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return true
    const body = (await res.json()) as { result: string | null }
    return body.result === '1'
  } catch {
    return true
  }
}

/** Set the Redis revocation bit. Called by the admin revoke flow. */
export async function setRevokedRedis(keyId: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return
  try {
    await fetch(`${url}/set/partner_key_revoked:${keyId}/1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    // Best-effort — DB revoke remains authoritative
  }
}
