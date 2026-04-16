// lib/partner-api/events/partner-registry.ts — Env-configured partner list.
//
// v1 sidesteps the full subscription-CRUD workflow by reading partner webhook
// destinations from a single env var. Phase 4 replaces this file with a real
// `partner_webhook_subscriptions` reader. Until then, this is the source of
// truth for "who gets what event."
//
// Env format: PARTNER_WEBHOOKS is a JSON array of subscription objects:
//   [
//     {
//       "org_slug": "rush-engineering",
//       "url": "https://rush.example.com/webhook",
//       "secret": "wsec_xxx",
//       "event_patterns": ["engineering.*", "project.stage_changed"]
//     }
//   ]
//
// event_patterns are glob-style. Matching rules (OR across the list):
//   - `*` alone matches any event
//   - pattern ending in `.*` matches any suffix ("engineering.*" → engineering.anything.deep)
//   - otherwise `*` is single-segment ("engineering.*.created" → one segment in the middle)

import { checkOutboundUrl } from './ssrf'

export interface PartnerSubscription {
  org_slug: string
  url: string
  secret: string
  event_patterns: string[]
}

let cached: PartnerSubscription[] | null = null

export function loadPartnerRegistry(): PartnerSubscription[] {
  if (cached) return cached
  const raw = process.env.PARTNER_WEBHOOKS
  if (!raw) {
    cached = []
    return cached
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      console.error('[partner-registry] PARTNER_WEBHOOKS must be a JSON array')
      cached = []
      return cached
    }
    const out: PartnerSubscription[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const o = entry as Record<string, unknown>
      if (typeof o.org_slug !== 'string' ||
          typeof o.url !== 'string' ||
          typeof o.secret !== 'string' ||
          !Array.isArray(o.event_patterns)) {
        console.error('[partner-registry] entry missing required fields:', entry)
        continue
      }
      const urlCheck = checkOutboundUrl(o.url)
      if (!urlCheck.ok) {
        console.error(`[partner-registry] dropping ${o.org_slug}: URL rejected: ${urlCheck.reason}`)
        continue
      }
      out.push({
        org_slug: o.org_slug,
        url: o.url,
        secret: o.secret,
        event_patterns: o.event_patterns.filter((p): p is string => typeof p === 'string'),
      })
    }
    cached = out
    return out
  } catch (err) {
    console.error('[partner-registry] failed to parse PARTNER_WEBHOOKS:', err)
    cached = []
    return cached
  }
}

/** For tests — clears the module-level cache. */
export function _resetPartnerRegistryCache(): void {
  cached = null
}

/** Glob-ish match:
 *   `*` alone                = match everything
 *   pattern ending in `.*`   = match prefix + ANY suffix (cross-dot)
 *   middle `*`               = single segment only (no dots) */
export function eventMatches(pattern: string, eventType: string): boolean {
  if (pattern === '*') return true
  if (pattern === eventType) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    // "foo.*" matches "foo.<at least one char>". Reject "foo." and "foo".
    return eventType.length > prefix.length + 1 && eventType.startsWith(prefix + '.')
  }
  // Middle wildcards: `*` matches a single non-dot segment
  const escaped = pattern.replace(/[\\^$|()[\]{}+?]/g, '\\$&')
  const regexSrc = '^' + escaped
    .replace(/\./g, '\\.')
    .replace(/\*/g, '[^.]+') + '$'
  return new RegExp(regexSrc).test(eventType)
}

/** Return the subscriptions that want the given event type. */
export function subscriptionsForEvent(
  subs: readonly PartnerSubscription[],
  eventType: string,
): PartnerSubscription[] {
  return subs.filter((s) => s.event_patterns.some((p) => eventMatches(p, eventType)))
}
