import { describe, expect, it } from 'vitest'

import { loadNodeOverrides } from '../../lib/sld-v2/overrides/loader'

describe('loadNodeOverrides', () => {
  it('returns the overrides object for the example PROJ-DEMO file', async () => {
    const overrides = await loadNodeOverrides('PROJ-DEMO')
    expect(overrides).toBeDefined()
    expect(overrides).toEqual({
      msp: { x: 600, y: 320 },
      'service-disc': { x: 720, y: 320 },
    })
  })

  it('returns undefined when no overrides file exists for the project id', async () => {
    const overrides = await loadNodeOverrides('PROJ-DOES-NOT-EXIST')
    expect(overrides).toBeUndefined()
  })

  it('returns undefined for unsafe ids that try to escape the overrides dir', async () => {
    // The path-safety regex rejects anything outside [A-Za-z0-9_-].
    expect(await loadNodeOverrides('../../../etc/passwd')).toBeUndefined()
    expect(await loadNodeOverrides('PROJ DEMO')).toBeUndefined()
    expect(await loadNodeOverrides('proj/demo')).toBeUndefined()
  })
})
