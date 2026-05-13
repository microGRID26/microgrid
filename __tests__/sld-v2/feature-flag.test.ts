import { afterEach, describe, expect, it, vi } from 'vitest'

import { shouldUseSldV2 } from '../../lib/sld-v2/feature-flag'

describe('shouldUseSldV2', () => {
  const originalEnv = process.env.SLD_V2_DEFAULT
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SLD_V2_DEFAULT
    else process.env.SLD_V2_DEFAULT = originalEnv
    vi.unstubAllEnvs()
  })

  it('returns true when ?sld=v2 is in the URL', () => {
    const sp = new URLSearchParams('sld=v2')
    expect(shouldUseSldV2(sp)).toBe(true)
  })

  it('returns true when ?sld=V2 (uppercase) — case-insensitive value compare (R1-M4 contract)', () => {
    const sp = new URLSearchParams('sld=V2')
    expect(shouldUseSldV2(sp)).toBe(true)
  })

  it('returns false when ?sld=v2%20 (trailing space) — no trim, exact-value compare', () => {
    delete process.env.SLD_V2_DEFAULT
    // URLSearchParams decodes %20 to literal " " — exact compare ("v2 " !== "v2") fails.
    // Documented behaviour: callers are expected to send `?sld=v2` exactly; trailing
    // whitespace is treated as a typo and falls back to flag-off.
    const sp = new URLSearchParams('sld=v2 ')
    expect(shouldUseSldV2(sp)).toBe(false)
  })

  it('returns true when SLD_V2_DEFAULT=1 is set in the env', () => {
    process.env.SLD_V2_DEFAULT = '1'
    expect(shouldUseSldV2(new URLSearchParams())).toBe(true)
  })

  it('returns false otherwise (URL flag absent + env flag unset + no project)', () => {
    delete process.env.SLD_V2_DEFAULT
    expect(shouldUseSldV2(new URLSearchParams())).toBe(false)
    expect(shouldUseSldV2(new URLSearchParams('sld=v1'))).toBe(false)
  })

  it('returns true when project.use_sld_v2 is true (Phase 7a per-project path)', () => {
    delete process.env.SLD_V2_DEFAULT
    expect(shouldUseSldV2(new URLSearchParams(), { use_sld_v2: true })).toBe(true)
  })

  it('returns false when project.use_sld_v2 is explicitly false (no other flag)', () => {
    delete process.env.SLD_V2_DEFAULT
    expect(shouldUseSldV2(new URLSearchParams(), { use_sld_v2: false })).toBe(false)
    expect(shouldUseSldV2(new URLSearchParams(), { use_sld_v2: null })).toBe(false)
    expect(shouldUseSldV2(new URLSearchParams(), {})).toBe(false)
    expect(shouldUseSldV2(new URLSearchParams(), null)).toBe(false)
    expect(shouldUseSldV2(new URLSearchParams(), undefined)).toBe(false)
  })

  it('URL flag wins over project flag (testing always overrides production rollout)', () => {
    delete process.env.SLD_V2_DEFAULT
    expect(
      shouldUseSldV2(new URLSearchParams('sld=v2'), { use_sld_v2: false }),
    ).toBe(true)
  })

  it('env flag wins over project flag (preview/dev override is process-wide)', () => {
    process.env.SLD_V2_DEFAULT = '1'
    expect(
      shouldUseSldV2(new URLSearchParams(), { use_sld_v2: false }),
    ).toBe(true)
  })

  // Cumulative R1 H1 fix — URL flag must be a no-op in production. An authed
  // internal user cannot override a project owner's explicit use_sld_v2=false
  // by appending ?sld=v2 to the URL. The URL flag stays available in test +
  // dev + preview environments for the manual smoke harnesses.
  it('URL flag is a no-op in production (H1: cannot override use_sld_v2=false)', () => {
    delete process.env.SLD_V2_DEFAULT
    vi.stubEnv('NODE_ENV', 'production')
    expect(
      shouldUseSldV2(new URLSearchParams('sld=v2'), { use_sld_v2: false }),
    ).toBe(false)
    expect(
      shouldUseSldV2(new URLSearchParams('sld=v2'), { use_sld_v2: null }),
    ).toBe(false)
    expect(
      shouldUseSldV2(new URLSearchParams('sld=v2')),
    ).toBe(false)
  })

  it('URL flag still works in production when project.use_sld_v2 is true (the explicit opt-in path stays open)', () => {
    delete process.env.SLD_V2_DEFAULT
    vi.stubEnv('NODE_ENV', 'production')
    // Project flag is the authoritative production path; URL is moot.
    expect(
      shouldUseSldV2(new URLSearchParams('sld=v2'), { use_sld_v2: true }),
    ).toBe(true)
  })

  it('Env flag stays effective in production (Vercel preview controls SLD_V2_DEFAULT separately)', () => {
    process.env.SLD_V2_DEFAULT = '1'
    vi.stubEnv('NODE_ENV', 'production')
    expect(shouldUseSldV2(new URLSearchParams())).toBe(true)
  })
})
