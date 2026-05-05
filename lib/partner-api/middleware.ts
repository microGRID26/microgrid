// lib/partner-api/middleware.ts — withPartnerAuth HOF wrapping route handlers.
//
// Enforces the full auth → rate limit → scope → (optional actor) → (optional
// signature) pipeline, attaches a PartnerContext to the handler, and logs
// every request to partner_api_logs fire-and-forget.

import { NextRequest, NextResponse } from 'next/server'
import {
  extractBearer,
  sha256Hex,
  lookupKeyByHash,
  checkRevokedRedis,
} from './auth'
import { ApiError, errorResponse, internalError } from './errors'
import { enforceRateLimit, type RateCategory } from './rate-limit'
import { requireScopes, type Scope } from './scopes'
import { type PartnerContext, newRequestId } from './context'
import { logPartnerRequest, touchKeyLastUsed } from './logger'
import { partnerApiAdmin } from './supabase-admin'
import { rateLimit as sharedRateLimit } from '@/lib/rate-limit'

export interface WithPartnerAuthOpts {
  /** Scopes the caller must have. Empty array = any authenticated key. */
  scopes: readonly Scope[]
  /** Rate-limit category for the endpoint. Determines per-tier throughput. */
  category: RateCategory
  /** When true, X-MG-Actor header is required and must resolve to an active
   *  partner_actors row for the caller's org. Used by lead create / modify. */
  requireActor?: boolean
}

export type PartnerRouteHandler<P> = (
  req: NextRequest,
  ctx: PartnerContext,
  routeCtx: P,
) => Promise<NextResponse | Response>

/**
 * Wrap a Next.js App Router handler with partner auth.
 * Example:
 *   export const GET = withPartnerAuth(
 *     { scopes: ['engineering:assignments:read'], category: 'read' },
 *     async (req, ctx) => NextResponse.json({ ok: true, org: ctx.orgSlug })
 *   )
 */
export function withPartnerAuth<P = unknown>(
  opts: WithPartnerAuthOpts,
  handler: PartnerRouteHandler<P>,
): (req: NextRequest, routeCtx: P) => Promise<NextResponse | Response> {
  return async (req: NextRequest, routeCtx: P) => {
    const startedAtMs = Date.now()
    const requestId = newRequestId()
    const method = req.method
    // R1 fix (Medium): cap user-controlled strings before persisting to
    // partner_api_logs. A partner can otherwise stuff arbitrarily large
    // values into the path / headers and bloat the logs table.
    const path = new URL(req.url).pathname.slice(0, 512)
    // Resolve client IP for rate-limit + audit log. The pre-auth bucket at
    // step 0 is the bearer-guess gate, so an attacker who can rotate this
    // value defeats it. NextRequest.ip (set by Vercel from its trusted edge)
    // is the right answer when present. Fallback: x-forwarded-for is a
    // comma-separated chain (`client, proxy1, proxy2`) where each hop appends.
    // The LEFTMOST entry is attacker-controlled (any client can prepend any
    // value before sending to the first proxy); only the RIGHTMOST entry is
    // set by our trusted edge. Take the rightmost. (#475 L3)
    const ip = resolveClientIp(req)
    const userAgent = req.headers.get('user-agent')?.slice(0, 512) ?? null

    let ctx: PartnerContext | null = null
    let apiKeyId: string | null = null
    let actorExternalIdRaw: string | null = null
    let queryParams: Record<string, unknown> | null = null
    try {
      const url = new URL(req.url)
      if ([...url.searchParams.keys()].length > 0) {
        queryParams = Object.fromEntries(url.searchParams.entries())
      }
    } catch { /* ignore */ }

    let response: NextResponse | Response
    try {
      // ── 0. Pre-auth IP rate limit ───────────────────────────────────────
      // R1 fix (High): defend the key-lookup path against bearer-guessing
      // attacks. 120 req/min per IP is generous for legitimate partners but
      // kills a brute-force scan of the 62^32 bearer space. Falls back to
      // in-memory when Upstash isn't configured (lib/rate-limit default).
      {
        const ipKey = ip ?? 'unknown'
        const preAuth = await sharedRateLimit(`partner-api:preauth:${ipKey}`, {
          windowMs: 60_000,
          max: 120,
          prefix: 'partner-api-preauth',
        })
        if (!preAuth.success) {
          throw new ApiError('rate_limited', 'Too many requests from this IP')
        }
      }

      // ── 1. Extract + validate bearer ────────────────────────────────────
      const bearer = extractBearer(req.headers)
      const bearerHash = sha256Hex(bearer)

      // ── 2. Look up key in DB ────────────────────────────────────────────
      const sb = partnerApiAdmin()
      const key = await lookupKeyByHash(sb, bearerHash)
      if (!key) {
        throw new ApiError('unauthorized', 'API key is invalid, expired, or revoked')
      }
      apiKeyId = key.id

      // ── 3. Check Redis revocation bit (instant kill switch) ─────────────
      const revoked = await checkRevokedRedis(key.id)
      if (revoked) {
        throw new ApiError('unauthorized', 'API key has been revoked')
      }

      // ── 4. Enforce rate limit ───────────────────────────────────────────
      await enforceRateLimit({
        keyId: key.id,
        tier: key.rate_limit_tier,
        category: opts.category,
      })

      // ── 5. Enforce scopes ───────────────────────────────────────────────
      requireScopes(key.scopes, opts.scopes)

      // ── 6. Resolve actor if required ────────────────────────────────────
      // R1 fix (Medium): cap X-MG-Actor at 128 chars before any DB lookup or
      // log write. partner_actors.external_id is declared for ≤128 anyway, so
      // anything longer can never match.
      actorExternalIdRaw = req.headers.get('x-mg-actor')?.slice(0, 128) ?? null
      let actorExternalId: string | null = null
      if (opts.requireActor) {
        if (!actorExternalIdRaw) {
          throw new ApiError('actor_required', 'X-MG-Actor header required for this endpoint')
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const client = sb as any
        const { data: actor } = await client
          .from('partner_actors')
          .select('external_id, active')
          .eq('org_id', key.org_id)
          .eq('external_id', actorExternalIdRaw)
          .maybeSingle()
        if (!actor || !(actor as { active: boolean }).active) {
          throw new ApiError('actor_unknown', 'X-MG-Actor does not match an active partner_actors row for your org', {
            actor: actorExternalIdRaw,
          })
        }
        actorExternalId = actorExternalIdRaw
      } else if (actorExternalIdRaw) {
        // Even when not required, record the claim for audit (handlers can trust-but-verify).
        actorExternalId = actorExternalIdRaw
      }

      // ── 7. Build context ────────────────────────────────────────────────
      ctx = {
        orgId: key.org_id,
        orgType: key.org_type,
        orgSlug: key.org_slug,
        keyId: key.id,
        keyName: key.name,
        scopes: key.scopes,
        rateLimitTier: key.rate_limit_tier,
        customerPiiScope: key.customer_pii_scope,
        actorExternalId,
        requestId,
        startedAtMs,
      }

      // Touch last-used metadata (fire-and-forget)
      touchKeyLastUsed(key.id, ip, userAgent)

      // ── 8. Invoke the route handler ─────────────────────────────────────
      response = await handler(req, ctx, routeCtx)

      // Ensure X-Request-Id on the response
      try {
        response.headers.set('X-Request-Id', requestId)
      } catch {
        // Some Response types have immutable headers; skip
      }
    } catch (err) {
      if (err instanceof ApiError) {
        response = errorResponse(err, requestId)
      } else {
        console.error(`[partner-api] ${method} ${path} threw:`, err)
        response = internalError(requestId, err instanceof Error ? err.message : 'Unknown error')
      }
    }

    // ── 9. Fire-and-forget request log ────────────────────────────────────
    const status = (response as NextResponse).status ?? 500
    const errMsg = status >= 400
      ? (await safeReadErrorMessage(response))
      : null
    logPartnerRequest({
      ctx,
      method,
      path,
      queryParams,
      statusCode: status,
      durationMs: Date.now() - startedAtMs,
      errorMessage: errMsg,
      apiKeyId,
      actorExternalId: actorExternalIdRaw,
      ip,
      userAgent,
    })

    return response
  }
}

/** Resolve the trusted client IP for rate-limit + log. (#475 L3)
 *
 *  Order:
 *  1. NextRequest.ip — set by Vercel's edge from its trusted proxy chain.
 *     Not spoofable from outside Vercel's network.
 *  2. Rightmost x-forwarded-for entry — added by the last trusted proxy.
 *  3. null — caller buckets to 'unknown' (still rate-limited together).
 */
function resolveClientIp(req: NextRequest): string | null {
  // NextRequest exposes `ip` as a top-level property in App Router runtimes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromVercel = (req as any).ip as string | undefined
  if (fromVercel) return fromVercel.trim().slice(0, 64)
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) {
      // Rightmost (closest-to-trusted-proxy) hop.
      return parts[parts.length - 1].slice(0, 64)
    }
  }
  // R1 MEDIUM: on Vercel prod, NextRequest.ip is always set by the edge.
  // Reaching here in NODE_ENV=production means the deploy topology changed
  // (different host? edge-bypass route?) — surface it loudly so we notice
  // before a brute-force pools onto the shared 'unknown' rate-limit bucket.
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[partner-api] resolveClientIp: no NextRequest.ip and no x-forwarded-for in production — ' +
        'rate-limit bucket will fall back to "unknown" (shared across all callers without IP). ' +
        'Check edge config.',
    )
  }
  return null
}

/** Clone a response to peek at its JSON error.message without consuming it. */
async function safeReadErrorMessage(response: NextResponse | Response): Promise<string | null> {
  try {
    const cloned = response.clone()
    const json = (await cloned.json()) as { error?: { message?: string } }
    return json?.error?.message ?? null
  } catch {
    return null
  }
}
