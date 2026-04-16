// __tests__/lib/partner-api-ssrf.test.ts — SSRF rejection matrix.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkOutboundUrl, validateOutboundUrl } from '@/lib/partner-api/events/ssrf'
import { ApiError } from '@/lib/partner-api/errors'

const PROD_REJECT_HTTPS = [
  'http://example.com/webhook',
]

const LITERAL_IP_REJECTS = [
  'https://127.0.0.1/x',
  'https://127.7.8.9/x',
  'https://10.0.0.1/x',
  'https://10.255.255.255/x',
  'https://172.16.0.1/x',
  'https://172.31.255.255/x',
  'https://192.168.1.1/x',
  'https://192.168.255.255/x',
  'https://169.254.169.254/latest/meta-data/',   // AWS metadata
  'https://169.254.169.254/computeMetadata/v1/', // GCP metadata (v4)
  'https://100.64.0.1/x',                        // CGNAT
  'https://0.0.0.0/x',
  'https://224.0.0.1/x',                         // multicast
  'https://198.18.0.1/x',                        // benchmark
]

const IPV6_REJECTS = [
  'https://[::1]/x',
  'https://[fc00::1]/x',
  'https://[fd00::1]/x',
  'https://[fe80::1]/x',
  'https://[ff00::1]/x',
  'https://[::ffff:127.0.0.1]/x',                // IPv4-mapped loopback
]

const SCHEME_REJECTS = [
  'javascript:alert(1)',
  'data:text/html,<script>',
  'file:///etc/passwd',
  'ftp://example.com/x',
  'gopher://example.com/',
]

const HOSTNAME_REJECTS = [
  'https://localhost/x',
  'https://LOCALHOST/x',
  'https://anything.localhost/x',
  'https://metadata.google.internal/x',
  'https://metadata/x',
  'https://instance-data/x',
]

const ACCEPTS = [
  'https://webhooks.rush.example.com/mg',
  'https://example.com/path?q=1',
  'https://sub.domain.tld/a/b/c',
]

describe('checkOutboundUrl — SSRF matrix', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PARTNER_WEBHOOK_ALLOW_HTTP', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  for (const u of LITERAL_IP_REJECTS) {
    it(`rejects literal-IP host ${u}`, () => {
      const r = checkOutboundUrl(u)
      expect(r.ok, r.reason).toBe(false)
    })
  }

  for (const u of IPV6_REJECTS) {
    it(`rejects IPv6 host ${u}`, () => {
      const r = checkOutboundUrl(u)
      expect(r.ok, r.reason).toBe(false)
    })
  }

  for (const u of SCHEME_REJECTS) {
    it(`rejects scheme ${u}`, () => {
      expect(checkOutboundUrl(u).ok).toBe(false)
    })
  }

  for (const u of HOSTNAME_REJECTS) {
    it(`rejects hostname ${u}`, () => {
      expect(checkOutboundUrl(u).ok).toBe(false)
    })
  }

  for (const u of PROD_REJECT_HTTPS) {
    it(`rejects non-https in prod: ${u}`, () => {
      expect(checkOutboundUrl(u).ok).toBe(false)
    })
  }

  it('allows http:// when PARTNER_WEBHOOK_ALLOW_HTTP=true (dev override)', () => {
    vi.stubEnv('PARTNER_WEBHOOK_ALLOW_HTTP', 'true')
    expect(checkOutboundUrl('http://example.com/x').ok).toBe(true)
  })

  it('rejects URLs with userinfo', () => {
    expect(checkOutboundUrl('https://user:pass@example.com/').ok).toBe(false)
    expect(checkOutboundUrl('https://user@example.com/').ok).toBe(false)
  })

  it('rejects empty / malformed URLs', () => {
    expect(checkOutboundUrl('').ok).toBe(false)
    expect(checkOutboundUrl('not a url').ok).toBe(false)
  })

  for (const u of ACCEPTS) {
    it(`accepts ${u}`, () => {
      expect(checkOutboundUrl(u).ok).toBe(true)
    })
  }
})

describe('validateOutboundUrl — throw variant', () => {
  beforeEach(() => { vi.stubEnv('NODE_ENV', 'production') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('throws ApiError on rejected URL', () => {
    expect(() => validateOutboundUrl('https://127.0.0.1/x')).toThrowError(ApiError)
  })
  it('does not throw on accepted URL', () => {
    expect(() => validateOutboundUrl('https://example.com/x')).not.toThrow()
  })
})
