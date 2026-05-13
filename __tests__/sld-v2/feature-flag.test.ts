import { afterEach, describe, expect, it } from 'vitest'

import { shouldUseSldV2 } from '../../lib/sld-v2/feature-flag'

describe('shouldUseSldV2', () => {
  const originalEnv = process.env.SLD_V2_DEFAULT
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SLD_V2_DEFAULT
    else process.env.SLD_V2_DEFAULT = originalEnv
  })

  it('returns true when ?sld=v2 is in the URL', () => {
    const sp = new URLSearchParams('sld=v2')
    expect(shouldUseSldV2(sp)).toBe(true)
  })

  it('returns true when SLD_V2_DEFAULT=1 is set in the env', () => {
    process.env.SLD_V2_DEFAULT = '1'
    expect(shouldUseSldV2(new URLSearchParams())).toBe(true)
  })

  it('returns false otherwise (URL flag absent + env flag unset)', () => {
    delete process.env.SLD_V2_DEFAULT
    expect(shouldUseSldV2(new URLSearchParams())).toBe(false)
    expect(shouldUseSldV2(new URLSearchParams('sld=v1'))).toBe(false)
  })
})
