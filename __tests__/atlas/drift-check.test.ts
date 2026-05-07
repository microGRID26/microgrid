import { describe, it, expect } from 'vitest'
import { evaluateDrift, type DriftRunResult } from '@/lib/atlas/drift-check'

function baseRun(overrides: Partial<DriftRunResult> = {}): DriftRunResult {
  return {
    report_id: 'r1',
    function_name: 'atlas_canonical_r1',
    verified_params: {},
    expected_row_count: 100,
    expected_aggregates: null,
    verified_sample_ids: null,
    drift_tolerance_pct: 0,
    verified_at: '2026-05-06T00:00:00Z',
    verified_by: 'greg@gomicrogridenergy.com',
    executed_at: '2026-05-07T00:00:00Z',
    duration_ms: 50,
    rows: Array.from({ length: 100 }, (_, i) => ({ id: `p${i}` })),
    error: null,
    ...overrides,
  }
}

describe('evaluateDrift — row count', () => {
  it('passes when actual matches expected exactly with 0 tolerance', () => {
    const out = evaluateDrift(baseRun())
    expect(out.passed).toBe(true)
    expect(out.driftReasons).toEqual([])
  })

  it('fails when actual deviates with 0 tolerance', () => {
    const out = evaluateDrift(
      baseRun({ rows: Array.from({ length: 99 }, (_, i) => ({ id: `p${i}` })) }),
    )
    expect(out.passed).toBe(false)
    expect(out.driftReasons[0]).toMatch(/row_count: expected=100, actual=99/)
  })

  it('passes within tolerance', () => {
    // 10% tolerance on expected=100 → ±10 allowed
    const out = evaluateDrift(
      baseRun({
        drift_tolerance_pct: 10,
        rows: Array.from({ length: 109 }, (_, i) => ({ id: `p${i}` })),
      }),
    )
    expect(out.passed).toBe(true)
  })

  it('fails just outside tolerance', () => {
    const out = evaluateDrift(
      baseRun({
        drift_tolerance_pct: 10,
        rows: Array.from({ length: 111 }, (_, i) => ({ id: `p${i}` })),
      }),
    )
    expect(out.passed).toBe(false)
  })

  it('handles expected=0 — actual must also be 0', () => {
    const out = evaluateDrift(
      baseRun({
        expected_row_count: 0,
        drift_tolerance_pct: 200,
        rows: [{ id: 'p1' }],
      }),
    )
    expect(out.passed).toBe(false)
    expect(out.driftReasons[0]).toMatch(/row_count: expected=0, actual=1/)
  })

  it('skips row count check when expected_row_count is null', () => {
    const out = evaluateDrift(
      baseRun({ expected_row_count: null, rows: [{ id: 'p1' }] }),
    )
    expect(out.passed).toBe(true)
  })
})

describe('evaluateDrift — sample IDs', () => {
  it('passes when all verified_sample_ids appear in result', () => {
    const out = evaluateDrift(
      baseRun({
        verified_sample_ids: ['p1', 'p2', 'p3'],
        rows: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }, { id: 'p5' }],
        expected_row_count: 5,
      }),
    )
    expect(out.passed).toBe(true)
  })

  it('fails when a verified sample id is missing', () => {
    const out = evaluateDrift(
      baseRun({
        verified_sample_ids: ['p1', 'p2', 'p999'],
        rows: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        expected_row_count: 3,
      }),
    )
    expect(out.passed).toBe(false)
    expect(out.driftReasons.some((r) => r.includes('p999'))).toBe(true)
  })

  it('matches sample ids stored under any column name', () => {
    // pipeline_by_stage rows have shape {stage, project_count, ...} — no id key.
    const out = evaluateDrift(
      baseRun({
        verified_sample_ids: ['evaluation', 'permit'],
        rows: [
          { stage: 'evaluation', project_count: 1864 },
          { stage: 'permit', project_count: 313 },
        ],
        expected_row_count: 2,
      }),
    )
    expect(out.passed).toBe(true)
  })

  it('matches numeric ids cast to strings', () => {
    const out = evaluateDrift(
      baseRun({
        verified_sample_ids: ['57245', '57384'],
        rows: [{ subhub_id: '57245' }, { subhub_id: '57384' }, { subhub_id: '57000' }],
        expected_row_count: 3,
      }),
    )
    expect(out.passed).toBe(true)
  })
})

describe('evaluateDrift — aggregates', () => {
  it('passes when summed field matches snapshot exactly', () => {
    const out = evaluateDrift(
      baseRun({
        expected_aggregates: { systemkw: 30 },
        rows: [{ id: 'p1', systemkw: 10 }, { id: 'p2', systemkw: 20 }],
        expected_row_count: 2,
      }),
    )
    expect(out.passed).toBe(true)
  })

  it('fails when summed field deviates beyond tolerance', () => {
    const out = evaluateDrift(
      baseRun({
        expected_aggregates: { systemkw: 100 },
        drift_tolerance_pct: 5,
        rows: [{ id: 'p1', systemkw: 90 }],
        expected_row_count: 1,
      }),
    )
    expect(out.passed).toBe(false)
    expect(out.driftReasons.some((r) => r.startsWith('aggregate.systemkw'))).toBe(true)
  })

  it('ignores non-numeric expected aggregates', () => {
    const out = evaluateDrift(
      baseRun({
        expected_aggregates: { label: 'not a number' },
        rows: [{ id: 'p1' }],
        expected_row_count: 1,
      }),
    )
    expect(out.passed).toBe(true)
  })
})

describe('evaluateDrift — error path', () => {
  it('fails immediately when run returned an error', () => {
    const out = evaluateDrift(
      baseRun({ error: 'function does not exist', rows: [], expected_row_count: 100 }),
    )
    expect(out.passed).toBe(false)
    expect(out.error).toBe('function does not exist')
    expect(out.driftReasons[0]).toMatch(/execution_failed/)
  })
})
