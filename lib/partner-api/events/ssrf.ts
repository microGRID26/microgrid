// lib/partner-api/events/ssrf.ts — Outbound-URL SSRF guard.
//
// Blocks the obvious attack patterns at validation time:
//   - non-http(s) schemes (javascript:, data:, file:, gopher:, ...)
//   - http:// in production (force https except in dev/test)
//   - literal-IP hostnames in private ranges (loopback, RFC1918, link-local, ULA)
//   - cloud-provider metadata endpoints (169.254.169.254 etc)
//   - URLs carrying userinfo in the authority ("https://user:pass@host/")
//
// Known limitation (v1): does NOT resolve DNS. A hostname that resolves to a
// private IP slips through. Full defense requires DNS resolution + IP pinning
// on the fetch agent, which is Phase 4 work. For v1 the partner registry is
// env-configured by a trusted admin (us), so the DNS-rebinding surface is
// low. When partner-supplied URLs (webhook subscription CRUD) ships in Phase
// 4, upgrade this guard to resolve + pin.

import { ApiError } from '../errors'

/** Decide whether to require HTTPS for outbound URLs. Overridable for local
 *  dev where Rush's webhook may be http://localhost:3001 via ngrok. */
function httpsRequired(): boolean {
  if (process.env.PARTNER_WEBHOOK_ALLOW_HTTP === 'true') return false
  return process.env.NODE_ENV === 'production'
}

// ── IPv4 private/reserved ranges, stored as [start, end] 32-bit ints ─────────
const IPV4_BLOCKS: ReadonlyArray<[number, number, string]> = [
  [0x00_00_00_00, 0x00_FF_FF_FF, 'RFC6890 "this" network 0.0.0.0/8'],
  [0x0A_00_00_00, 0x0A_FF_FF_FF, 'RFC1918 private 10.0.0.0/8'],
  [0x64_40_00_00, 0x64_7F_FF_FF, 'RFC6598 shared-address 100.64.0.0/10'],
  [0x7F_00_00_00, 0x7F_FF_FF_FF, 'loopback 127.0.0.0/8'],
  [0xA9_FE_00_00, 0xA9_FE_FF_FF, 'link-local 169.254.0.0/16 (includes cloud metadata)'],
  [0xAC_10_00_00, 0xAC_1F_FF_FF, 'RFC1918 private 172.16.0.0/12'],
  [0xC0_A8_00_00, 0xC0_A8_FF_FF, 'RFC1918 private 192.168.0.0/16'],
  [0xC6_12_00_00, 0xC6_13_FF_FF, 'benchmark 198.18.0.0/15'],
  [0xE0_00_00_00, 0xFF_FF_FF_FF, 'multicast + reserved 224.0.0.0/4'],
]

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null
    const o = Number.parseInt(p, 10)
    if (o < 0 || o > 255) return null
    n = (n * 256) + o
  }
  // shift >>> 0 to avoid JS sign issues with 32-bit ints
  return n >>> 0
}

function matchesIpv4Block(ip: string): string | null {
  const n = ipv4ToInt(ip)
  if (n == null) return null
  for (const [start, end, label] of IPV4_BLOCKS) {
    if (n >= start && n <= end) return label
  }
  return null
}

/** IPv6 blocklist: any match means reject. */
function matchesIpv6Block(host: string): string | null {
  // Strip brackets if present
  const ip = host.replace(/^\[|\]$/g, '').toLowerCase()
  // Block ALL IPv4-mapped IPv6 addresses (::ffff:<anything>) outright.
  // This catches both dotted (::ffff:127.0.0.1) and compressed-hex
  // (::ffff:7f00:1) forms without needing to cross-check each one against
  // the IPv4 blocklist. Legitimate partners never send webhook URLs of
  // this shape — it's always a bypass attempt.
  if (ip.startsWith('::ffff:')) return 'IPv4-mapped IPv6 (::ffff: is always blocked)'
  if (ip === '::1' || ip === '::') return 'loopback/unspecified'
  if (ip.startsWith('fc') || ip.startsWith('fd')) return 'unique local address (fc00::/7)'
  if (ip.startsWith('fe80')) return 'link-local (fe80::/10)'
  if (ip.startsWith('ff')) return 'multicast (ff00::/8)'
  return null
}

export interface SsrfCheckResult {
  ok: boolean
  reason?: string
}

/** Throws ApiError if the URL fails SSRF validation. */
export function validateOutboundUrl(rawUrl: string): void {
  const res = checkOutboundUrl(rawUrl)
  if (!res.ok) {
    throw new ApiError('invalid_request', `Outbound URL rejected: ${res.reason ?? 'unknown'}`, {
      url: rawUrl,
    })
  }
}

/** Non-throwing variant for callers that want to log + skip instead of fail. */
export function checkOutboundUrl(rawUrl: string): SsrfCheckResult {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'URL parse failed' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `scheme ${u.protocol} is not http or https` }
  }
  if (u.protocol === 'http:' && httpsRequired()) {
    return { ok: false, reason: 'http:// is not allowed in production' }
  }
  if (u.username || u.password) {
    return { ok: false, reason: 'URL must not carry userinfo' }
  }
  const host = u.hostname
  if (!host) {
    return { ok: false, reason: 'URL missing hostname' }
  }
  // Block bare IP hostnames in reserved / private ranges.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const hit = matchesIpv4Block(host)
    if (hit) return { ok: false, reason: `IPv4 host in blocked range: ${hit}` }
  }
  if (host.includes(':')) {
    const hit = matchesIpv6Block(host)
    if (hit) return { ok: false, reason: `IPv6 host in blocked range: ${hit}` }
  }
  // Reject obvious hostname-based localhost tricks.
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower === 'ip6-localhost') {
    return { ok: false, reason: 'hostname resolves to localhost' }
  }
  // Reject cloud metadata hostnames even when not using the IP literal.
  if (lower === 'metadata.google.internal' || lower === 'metadata' || lower === 'instance-data') {
    return { ok: false, reason: 'hostname is a known cloud metadata endpoint' }
  }
  return { ok: true }
}
