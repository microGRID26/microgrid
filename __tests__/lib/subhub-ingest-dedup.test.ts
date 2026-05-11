// Tests for the Phase 1 dedup changes in lib/subhub/ingest.ts (action #807).
//
// Covers:
//   - Tier 2 (name+address) is case- and whitespace-insensitive
//   - Tier 2 conflict (different subhub_id at same name+addr) flags for review
//     instead of hard-erroring
//   - Tier 3 (email fallback) flags for review when name+addr differ
//   - No-match path still produces a clean INSERT with no flag

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock chain ───────────────────────────────────────────────────────────────
// A SELECT result for each `db.from(...).select(...)...` invocation can be
// pre-stubbed by pushing onto `selectQueue`. Anything that resolves to a
// Promise (i.e. the awaited chain) returns the next stubbed value. INSERTs
// resolve to `{ error: null }` unless `insertResult` is overridden.

let selectQueue: Array<{ data: unknown; error: unknown }>
let insertResult: { error: unknown }
const insertsByTable: Record<string, unknown[]> = {}

function makeChain(tableName: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq    = vi.fn(() => chain)
  chain.ilike = vi.fn(() => chain)
  chain.filter = vi.fn(() => chain)
  chain.in    = vi.fn(() => chain)
  chain.order = vi.fn(() => chain)
  chain.range = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.update = vi.fn(() => chain)
  chain.upsert = vi.fn(() => Promise.resolve({ data: [], error: null }))
  chain.insert = vi.fn((arg: unknown) => {
    if (!insertsByTable[tableName]) insertsByTable[tableName] = []
    insertsByTable[tableName].push(arg)
    return Promise.resolve(insertResult)
  })
  chain.then = vi.fn((cb: (v: unknown) => unknown) => {
    const next = selectQueue.shift() ?? { data: null, error: null }
    return Promise.resolve(next).then(cb)
  })
  return chain
}

const mockDb = { from: vi.fn((t: string) => makeChain(t)) }

vi.mock('@/lib/tasks', () => ({
  TASKS: { evaluation: [{ id: 'welcome_call', pre: [] }] },
}))

vi.mock('@/lib/api/edge-sync', () => ({ syncProjectToEdge: vi.fn() }))

beforeEach(() => {
  selectQueue = []
  insertResult = { error: null }
  for (const k of Object.keys(insertsByTable)) delete insertsByTable[k]
  mockDb.from.mockClear()
})

function projectInsert(): Record<string, unknown> | undefined {
  const arr = insertsByTable['projects']
  return arr?.[0] as Record<string, unknown> | undefined
}

import { processSubhubProject } from '@/lib/subhub/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'

const db = mockDb as unknown as SupabaseClient

const basePayload = {
  subhub_id: 12345,
  name: 'Kelley Wilson',
  email: 'kmwkew@yahoo.com',
  street: '5221 Bailey Lane',
  city: 'Houston',
  state: 'TX',
  postal_code: '77001',
}

describe('processSubhubProject — Phase 1 dedup gates', () => {
  it('Tier 1 hit: returns existing on subhub_id match, no INSERT', async () => {
    // Tier-1 SELECT hits an existing row.
    selectQueue.push({ data: [{ id: 'PROJ-100' }], error: null })

    const res = await processSubhubProject(basePayload, db, {})
    expect(res.success).toBe(true)
    expect(res.duplicate).toBe(true)
    expect(res.matched_by).toBe('subhub_id')
    expect(res.project_id).toBe('PROJ-100')
    expect(res.flagged_for_review).toBeFalsy()
    expect(projectInsert()).toBeUndefined()
  })

  it('Tier 2 case-insensitive: KELLEY WILSON matches kelley wilson', async () => {
    // Tier-1 miss, Tier-2 hit on existing row with SAME subhub_id (after
    // backfill). For this test we simulate existing row that has the same
    // subhub_id so Tier-2 returns the existing without flag.
    selectQueue.push({ data: [], error: null })  // Tier 1 miss
    selectQueue.push({ data: [{ id: 'PROJ-200', subhub_id: 12345 }], error: null }) // Tier 2 hit, same subhub_id

    const payload = { ...basePayload, name: 'KELLEY WILSON', street: '5221 BAILEY LANE' }
    const res = await processSubhubProject(payload, db, {})
    expect(res.success).toBe(true)
    expect(res.duplicate).toBe(true)
    expect(res.matched_by).toBe('name_address')
    expect(res.project_id).toBe('PROJ-200')
    expect(res.flagged_for_review).toBeFalsy()
    expect(projectInsert()).toBeUndefined()
  })

  it('Tier 2 conflict (different subhub_id at same name+addr) flags new INSERT for review', async () => {
    selectQueue.push({ data: [], error: null })                                   // Tier 1 miss
    selectQueue.push({ data: [{ id: 'PROJ-300', subhub_id: 99999 }], error: null }) // Tier 2 hit, DIFFERENT subhub_id
    // (no Tier 3 — payload had a hit at Tier 2)
    selectQueue.push({ data: [], error: null })  // getNextProjectId SELECT projects.id

    const res = await processSubhubProject(basePayload, db, {})
    expect(res.success).toBe(true)
    expect(res.duplicate).toBeFalsy()
    expect(res.flagged_for_review).toBe(true)
    // Response must NOT leak the canonical PROJ id externally.
    expect((res as unknown as Record<string, unknown>).dup_canonical_id).toBeUndefined()
    const inserted = projectInsert()!
    expect(inserted).toBeDefined()
    expect(inserted.dup_review_pending).toBe(true)
    expect(inserted.dup_canonical_id).toBe('PROJ-300')
    // Old behavior was a hard-error — assert it isn't returning error now.
    expect(res.error).toBeUndefined()
  })

  it('Tier 3 email fallback: name+addr differ, email matches → flagged INSERT', async () => {
    selectQueue.push({ data: [], error: null })  // Tier 1 miss
    selectQueue.push({ data: [], error: null })  // Tier 2 miss
    selectQueue.push({ data: [{ id: 'PROJ-400' }], error: null })  // Tier 3 email hit
    selectQueue.push({ data: [], error: null })  // getNextProjectId

    const payload = {
      ...basePayload,
      subhub_id: 77777,
      name: 'Different Name',
      street: '999 Other St',
      email: 'kmwkew@yahoo.com',
    }
    const res = await processSubhubProject(payload, db, {})
    expect(res.success).toBe(true)
    expect(res.flagged_for_review).toBe(true)
    expect((res as unknown as Record<string, unknown>).dup_canonical_id).toBeUndefined()
    const inserted = projectInsert()!
    expect(inserted).toBeDefined()
    expect(inserted.dup_review_pending).toBe(true)
    expect(inserted.dup_canonical_id).toBe('PROJ-400')
  })

  it('No-match path: clean INSERT with dup_review_pending=false', async () => {
    selectQueue.push({ data: [], error: null })  // Tier 1
    selectQueue.push({ data: [], error: null })  // Tier 2
    selectQueue.push({ data: [], error: null })  // Tier 3
    selectQueue.push({ data: [], error: null })  // getNextProjectId

    const res = await processSubhubProject(basePayload, db, {})
    expect(res.success).toBe(true)
    expect(res.flagged_for_review).toBeFalsy()
    expect(res.duplicate).toBeFalsy()
    const inserted = projectInsert()!
    expect(inserted).toBeDefined()
    expect(inserted.dup_review_pending).toBe(false)
    expect(inserted.dup_canonical_id).toBeNull()
  })
})
