// lib/atlas/drift-check.ts — pure drift evaluation. No I/O.
//
// Takes the jsonb result of atlas_canonical_drift_run() and decides whether
// the report's current numbers match the verification snapshot within
// drift_tolerance_pct. Splitting this from the cron route keeps it unit-
// testable without standing up a Supabase mock.

export type DriftRunResult = {
  report_id: string
  function_name: string
  verified_params: Record<string, unknown>
  expected_row_count: number | null
  expected_aggregates: Record<string, unknown> | null
  verified_sample_ids: string[] | null
  drift_tolerance_pct: number | null
  verified_at: string | null
  verified_by: string | null
  executed_at: string
  duration_ms: number
  rows: Array<Record<string, unknown>>
  error: string | null
}

export type DriftDetection = {
  reportId: string
  passed: boolean
  rowCount: number
  expectedRowCount: number | null
  driftReasons: string[]
  error: string | null
}

function withinTolerance(expected: number, actual: number, tolerancePct: number): boolean {
  if (expected === 0) return actual === 0
  if (tolerancePct === 0) return actual === expected
  const allowed = Math.abs(expected) * (tolerancePct / 100)
  return Math.abs(actual - expected) <= allowed
}

// Different reports identify rows by different keys: ec_booked_sales_since
// uses `project_id`, subhub_signed_with_vwc uses `subhub_id`, pipeline_by_stage
// uses `stage`, and so on. Rather than store per-report metadata, scan every
// scalar value in the row — verified_sample_ids are unique enough that a
// false-positive collision (a sample id appearing in some unrelated string
// field) is implausible. False-negatives (missing detection) are the failure
// mode this guards against, since they would let real drift through.
function rowValueSet(row: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const v of Object.values(row)) {
    if (typeof v === 'string' && v.length > 0) out.add(v)
    else if (typeof v === 'number') out.add(String(v))
  }
  return out
}

export function evaluateDrift(run: DriftRunResult): DriftDetection {
  const reasons: string[] = []
  const rowCount = Array.isArray(run.rows) ? run.rows.length : 0

  if (run.error) {
    reasons.push(`execution_failed: ${run.error}`)
    return {
      reportId: run.report_id,
      passed: false,
      rowCount,
      expectedRowCount: run.expected_row_count,
      driftReasons: reasons,
      error: run.error,
    }
  }

  const tolerance = Number(run.drift_tolerance_pct ?? 0)

  // Row count
  if (run.expected_row_count !== null && run.expected_row_count !== undefined) {
    const expected = Number(run.expected_row_count)
    if (!withinTolerance(expected, rowCount, tolerance)) {
      reasons.push(
        `row_count: expected=${expected}, actual=${rowCount}, tolerance=${tolerance}%`,
      )
    }
  }

  // Sample IDs — every verified_sample_ids entry must appear in current
  // result. Scan all scalar row values; sample IDs are project ids,
  // subhub ids, stage names, etc. — not always under the same key.
  if (run.verified_sample_ids && run.verified_sample_ids.length > 0) {
    const presentIds = new Set<string>()
    for (const row of run.rows) {
      for (const v of rowValueSet(row)) presentIds.add(v)
    }
    const missing = run.verified_sample_ids.filter((id) => !presentIds.has(id))
    if (missing.length > 0) {
      reasons.push(`missing_sample_ids: ${missing.join(',')}`)
    }
  }

  // Aggregates — sum each numeric field across rows and compare to snapshot.
  if (run.expected_aggregates && typeof run.expected_aggregates === 'object') {
    for (const [key, expectedRaw] of Object.entries(run.expected_aggregates)) {
      const expectedVal = Number(expectedRaw)
      if (!Number.isFinite(expectedVal)) continue
      let actualVal = 0
      for (const row of run.rows) {
        const v = Number(row[key])
        if (Number.isFinite(v)) actualVal += v
      }
      if (!withinTolerance(expectedVal, actualVal, tolerance)) {
        reasons.push(
          `aggregate.${key}: expected=${expectedVal}, actual=${actualVal}, tolerance=${tolerance}%`,
        )
      }
    }
  }

  return {
    reportId: run.report_id,
    passed: reasons.length === 0,
    rowCount,
    expectedRowCount: run.expected_row_count,
    driftReasons: reasons,
    error: null,
  }
}
