import { promises as fs } from 'fs'
import path from 'path'

import { afterAll, describe, expect, it } from 'vitest'

import { loadNodeOverrides } from '../../lib/sld-v2/overrides/loader'

// R3 catch — exercise the schema-validation paths added in R1-M2 by writing
// fixture files into the actual overrides directory and cleaning them up
// after the suite. Using the real dir (not a tmp dir) is intentional: the
// loader hard-codes process.cwd() + lib/sld-v2/overrides; writing a tmp
// fixture elsewhere would never reach the load path.
const OVERRIDES_DIR = path.join(process.cwd(), 'lib', 'sld-v2', 'overrides')
const TEST_FIXTURES: string[] = []

async function writeFixture(id: string, body: unknown): Promise<void> {
  const filePath = path.join(OVERRIDES_DIR, `${id}.json`)
  await fs.writeFile(filePath, JSON.stringify(body), 'utf8')
  TEST_FIXTURES.push(filePath)
}

// Write a literal JSON string (used for __proto__ tests, since the object
// literal `{__proto__: ...}` is special syntax that sets the prototype
// rather than creating an own key, so JSON.stringify({__proto__:...}) === '{}').
async function writeFixtureRaw(id: string, jsonString: string): Promise<void> {
  const filePath = path.join(OVERRIDES_DIR, `${id}.json`)
  await fs.writeFile(filePath, jsonString, 'utf8')
  TEST_FIXTURES.push(filePath)
}

afterAll(async () => {
  for (const f of TEST_FIXTURES) {
    await fs.unlink(f).catch(() => {})
  }
})

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

  it('throws when the file uses a forbidden prototype-pollution key', async () => {
    await writeFixtureRaw(
      'TEST-PROTO',
      '{"version":1,"nodes":{"__proto__":{"x":0,"y":0}}}',
    )
    await expect(loadNodeOverrides('TEST-PROTO')).rejects.toThrow(/forbidden key/)
  })

  it('throws on the constructor key (own enumerable; survives literal)', async () => {
    await writeFixture('TEST-CONSTRUCTOR', {
      version: 1,
      nodes: { constructor: { x: 0, y: 0 } },
    })
    await expect(loadNodeOverrides('TEST-CONSTRUCTOR')).rejects.toThrow(/forbidden key/)
  })

  it('throws when a node has non-finite coords', async () => {
    await writeFixture('TEST-COORDS', {
      version: 1,
      nodes: { msp: { x: 'not-a-number', y: 0 } },
    })
    await expect(loadNodeOverrides('TEST-COORDS')).rejects.toThrow(/must be \{x:number, y:number\}/)
  })

  it('throws when version != 1', async () => {
    await writeFixture('TEST-VERSION', { version: 2, nodes: {} })
    await expect(loadNodeOverrides('TEST-VERSION')).rejects.toThrow(/malformed/)
  })
})
