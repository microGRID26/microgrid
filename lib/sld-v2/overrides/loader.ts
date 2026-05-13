// Phase 6 — node-overrides loader for the sld-v2 PDF route.
//
// Storage: per-project JSON file at lib/sld-v2/overrides/<project-id>.json.
// Shape:
//   {
//     "version": 1,
//     "nodes": { "<equipment-id>": { "x": <num>, "y": <num> }, ... }
//   }
//
// Returned shape matches `EquipmentGraph.nodeOverrides` exactly so the
// caller can splice the result directly into `graph.nodeOverrides` before
// calling `layoutEquipmentGraph` / `renderSldToPdf`. Missing files return
// `undefined` (no overrides applied — elkjs auto-layout wins).
//
// This is the file-storage path (Decision 2 default = b). Phase 7 may
// promote to a `sld_v2_node_overrides jsonb` column if 10+ projects need
// overrides.

import { promises as fs } from 'fs'
import path from 'path'

export type NodeOverrides = Record<string, { x: number; y: number }>

interface OverridesFile {
  version: number
  nodes: NodeOverrides
}

const OVERRIDES_DIR = path.join(process.cwd(), 'lib', 'sld-v2', 'overrides')

// Allow only filesystem-safe project ids (alphanumerics, dashes, underscores).
// Anything else gets rejected before path construction so a hostile id like
// `../../../etc/passwd` cannot escape the overrides directory.
const SAFE_ID = /^[A-Za-z0-9_-]+$/

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export async function loadNodeOverrides(projectId: string): Promise<NodeOverrides | undefined> {
  if (!SAFE_ID.test(projectId)) return undefined

  const filePath = path.join(OVERRIDES_DIR, `${projectId}.json`)

  // R1-M1 belt-and-suspenders — resolve the joined path and re-verify it
  // stays inside OVERRIDES_DIR. The SAFE_ID regex is the primary defense;
  // this catches symlinks and any future refactor that relaxes the regex.
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(OVERRIDES_DIR + path.sep)) return undefined

  let raw: string
  try {
    raw = await fs.readFile(resolved, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }

  const parsed = JSON.parse(raw) as OverridesFile
  if (parsed?.version !== 1 || !parsed.nodes || typeof parsed.nodes !== 'object') {
    throw new Error(`overrides file ${projectId}.json: malformed (expected version=1 + nodes object)`)
  }

  // R1-M2 schema validation — reject prototype-pollution keys and any
  // non-finite coordinates before the result reaches the layout engine.
  // Phase 7 plans to promote overrides storage from filesystem (Atlas-only)
  // to a DB column (user-writable), so harden the parser now.
  const safe: NodeOverrides = Object.create(null)
  for (const [key, value] of Object.entries(parsed.nodes)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`overrides file ${projectId}.json: forbidden key "${key}"`)
    }
    const v = value as { x?: unknown; y?: unknown }
    if (!isFiniteNumber(v?.x) || !isFiniteNumber(v?.y)) {
      throw new Error(`overrides file ${projectId}.json: node "${key}" must be {x:number, y:number}`)
    }
    safe[key] = { x: v.x, y: v.y }
  }
  return safe
}
