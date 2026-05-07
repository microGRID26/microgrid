/**
 * GET /api/cron/atlas-canonical-drift-check
 *
 * Daily at 11:00 UTC (6am CT). For each verified row in
 * atlas_canonical_reports, replay the underlying function with the
 * snapshot verified_params via atlas_canonical_drift_run, evaluate drift
 * (row count + sample IDs + aggregate sums) in TS, persist the catalog's
 * last_drift_check_* columns via atlas_canonical_record_drift_check, and
 * file a deduped P1 greg_actions row on any drift.
 *
 * Also detects "demoted reports" (verified_at IS NOT NULL AND status =
 * 'draft') — a previously-verified report that has been silently demoted
 * to draft escapes the verified-loop and would otherwise be invisible to
 * drift monitoring (R1 audit HIGH-1).
 *
 * P4 of ~/.claude/plans/twinkly-jumping-thimble.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { reportFleetRun, type FleetRunStatus } from '@/lib/hq-fleet'
import { checkCronSecret } from '@/lib/auth/check-cron-secret'
import { evaluateDrift, type DriftRunResult } from '@/lib/atlas/drift-check'

export const runtime = 'nodejs'
export const maxDuration = 60

const SOURCE_SESSION_PREFIX = 'atlas-canonical-drift-cron'
const FLEET_SLUG = 'atlas-canonical-drift-check'
// Vercel kills the function at maxDuration. Keep a 6s safety margin so the
// final reportFleetRun + JSON response still get to fire.
const ROUTE_BUDGET_MS = 54_000
// Each per-report RPC sets statement_timeout=15s. Don't start a new
// per-report iteration if we've already burned past the budget.
const PER_REPORT_HEADROOM_MS = 16_000
const BODY_MD_MAX = 10_000

type ReportSummary = {
  id: string
  passed: boolean
  rowCount: number
  expectedRowCount: number | null
  driftReasons: string[]
  error: string | null
  skipped?: 'time_budget'
}

type SilentFailure = {
  reportId: string | null
  stage: string
  message: string
}

function escapeBackticks(s: string): string {
  return s.replace(/`/g, "'")
}

export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'Supabase service credentials not configured' },
      { status: 500 },
    )
  }

  const fleetStartedAt = new Date()
  const startMs = Date.now()
  const failures: SilentFailure[] = []
  let fleetStatus: FleetRunStatus = 'success'
  let fleetError: string | null = null

  try {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: verifiedRows, error: vErr } = await admin
      .from('atlas_canonical_reports')
      .select('id')
      .eq('status', 'verified')
      .order('id')
    if (vErr) throw new Error(`fetch verified reports failed: ${vErr.message}`)

    const reportIds = (verifiedRows ?? []).map((r) => (r as { id: string }).id)
    const summaries: ReportSummary[] = []
    let driftCount = 0
    let skippedCount = 0

    // Demotion scan FIRST so it runs even if the per-report loop blows the
    // time budget (R2 MED). A demoted report with verified_at set is the
    // signal that someone called atlas_canonical_save_draft against a
    // verified row — drift monitoring on it has been silently disabled.
    let demotionCount = 0
    {
      const { data: demoted, error: demErr } = await admin
        .from('atlas_canonical_reports')
        .select('id, verified_at, verified_by, status, function_name')
        .not('verified_at', 'is', null)
        .neq('status', 'verified')
        .order('id')
      if (demErr) {
        failures.push({
          reportId: null,
          stage: 'demotion_scan',
          message: demErr.message,
        })
      } else {
        for (const row of (demoted ?? []) as Array<{
          id: string
          verified_at: string | null
          verified_by: string | null
          status: string
          function_name: string
        }>) {
          demotionCount += 1
          await fileDemotionAction({ admin, row, failures })
        }
      }
    }

    for (const reportId of reportIds) {
      // Time-budget guard. Skip — but DO NOT count skipped reports as drift
      // (R2 HIGH). Skips inflate the alarm signal and would page Greg on a
      // slow-cron tick when nothing actually drifted.
      const elapsed = Date.now() - startMs
      if (elapsed + PER_REPORT_HEADROOM_MS > ROUTE_BUDGET_MS) {
        summaries.push({
          id: reportId,
          passed: false,
          rowCount: 0,
          expectedRowCount: null,
          driftReasons: ['skipped: route time budget would be exceeded'],
          error: null,
          skipped: 'time_budget',
        })
        skippedCount += 1
        continue
      }

      const { data: runData, error: runErr } = await admin.rpc(
        'atlas_canonical_drift_run',
        { p_report_id: reportId },
      )
      if (runErr) {
        summaries.push({
          id: reportId,
          passed: false,
          rowCount: 0,
          expectedRowCount: null,
          driftReasons: [`rpc_error: ${runErr.message}`],
          error: runErr.message,
        })
        driftCount += 1
        continue
      }

      const run = runData as unknown as DriftRunResult
      const detection = evaluateDrift(run)

      // Persist via SECURITY DEFINER RPC (R1 MED-1) — keeps direct PostgREST
      // writes off the catalog and preserves updated_at as "last admin edit".
      const { error: recErr } = await admin.rpc(
        'atlas_canonical_record_drift_check',
        { p_report_id: reportId, p_passed: detection.passed },
      )
      if (recErr) {
        failures.push({
          reportId,
          stage: 'record_drift_check',
          message: recErr.message,
        })
      }

      const { error: logErr } = await admin
        .from('atlas_canonical_run_log')
        .insert({
          user_email: 'cron@drift-check',
          user_role: 'cron',
          question: '[drift-check]',
          report_id: reportId,
          params: run.verified_params ?? {},
          row_count: detection.rowCount,
          drift_detected: !detection.passed,
          page_path: '/api/cron/atlas-canonical-drift-check',
          duration_ms: run.duration_ms ?? null,
          error: detection.error,
        })
      if (logErr) {
        failures.push({ reportId, stage: 'run_log_insert', message: logErr.message })
      }

      if (!detection.passed) {
        await fileDriftAction({
          admin,
          reportId,
          run,
          detection,
          failures,
        })
      }

      summaries.push({
        id: reportId,
        passed: detection.passed,
        rowCount: detection.rowCount,
        expectedRowCount: detection.expectedRowCount,
        driftReasons: detection.driftReasons,
        error: detection.error,
      })
      if (!detection.passed) driftCount += 1
    }

    if (driftCount > 0 || demotionCount > 0 || skippedCount > 0 || failures.length > 0) {
      fleetStatus = 'error'
      const parts: string[] = []
      if (driftCount > 0) parts.push(`${driftCount} drifted`)
      if (skippedCount > 0) parts.push(`${skippedCount} skipped (time budget)`)
      if (demotionCount > 0) parts.push(`${demotionCount} demoted`)
      if (failures.length > 0) parts.push(`${failures.length} silent failures`)
      fleetError = parts.join('; ')
    }

    const driftedReportIds = summaries
      .filter((s) => !s.passed && s.skipped !== 'time_budget')
      .map((s) => s.id)

    await reportFleetRun({
      slug: FLEET_SLUG,
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      itemsProcessed: reportIds.length,
      outputSummary:
        fleetStatus === 'success'
          ? `${reportIds.length} reports checked, all passed`
          : [
              driftCount > 0
                ? `${driftCount}/${reportIds.length} drifted: ${driftedReportIds.join(', ') || 'none'}`
                : null,
              skippedCount > 0 ? `skipped: ${skippedCount}` : null,
              demotionCount > 0 ? `demoted: ${demotionCount}` : null,
              failures.length > 0 ? `silent_failures: ${failures.length}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
      errorMessage: fleetError,
      metadata: {
        reports_checked: reportIds.length,
        reports_drifted: driftCount,
        reports_skipped: skippedCount,
        demotion_count: demotionCount,
        silent_failures: failures,
        results: summaries,
      },
    })

    return NextResponse.json({
      ok: fleetStatus === 'success',
      reports_checked: reportIds.length,
      reports_drifted: driftCount,
      reports_skipped: skippedCount,
      demotion_count: demotionCount,
      silent_failures: failures,
      results: summaries,
    })
  } catch (err) {
    fleetStatus = 'error'
    fleetError = (err as Error).message
    await reportFleetRun({
      slug: FLEET_SLUG,
      status: fleetStatus,
      startedAt: fleetStartedAt,
      finishedAt: new Date(),
      errorMessage: fleetError,
    })
    return NextResponse.json({ error: fleetError }, { status: 500 })
  }
}

async function fileDriftAction(args: {
  admin: ReturnType<typeof createClient<any, any, any>>
  reportId: string
  run: DriftRunResult
  detection: { driftReasons: string[]; rowCount: number; expectedRowCount: number | null }
  failures: SilentFailure[]
}): Promise<void> {
  const { admin, reportId, run, detection, failures } = args
  const sourceSession = `${SOURCE_SESSION_PREFIX}:${reportId}`

  const { data: existingOpen, error: existingErr } = await admin
    .from('greg_actions')
    .select('id')
    .eq('source_session', sourceSession)
    .eq('status', 'open')
    .limit(1)
  if (existingErr) {
    failures.push({ reportId, stage: 'dedup_query', message: existingErr.message })
    return
  }
  if ((existingOpen ?? []).length > 0) return

  const safeReasons = detection.driftReasons.map(escapeBackticks)
  const reasonsLine = safeReasons.join('; ')
  const title = `Atlas drift: ${reportId} — ${reasonsLine.slice(0, 140)}`
  const paramsLine = JSON.stringify(run.verified_params ?? {}).slice(0, 500)
  let body = [
    `## Canonical report drift detected: \`${reportId}\``,
    '',
    `**Verified at:** ${run.verified_at ?? 'unknown'}`,
    `**Verified by:** ${run.verified_by ?? 'unknown'}`,
    `**Drift tolerance:** ${run.drift_tolerance_pct ?? 0}%`,
    '',
    '## Drift reasons',
    '',
    safeReasons.map((r) => `- ${r}`).join('\n'),
    '',
    '## Snapshot vs current',
    '',
    `- Expected row count: ${run.expected_row_count ?? 'null'}`,
    `- Actual row count: ${detection.rowCount}`,
    `- Verified params: ${escapeBackticks(paramsLine)}`,
    '',
    '## What to check',
    '',
    '1. Did the underlying data legitimately change (new sales booked, refund batch, late dispositions)? If yes, re-verify the report and update the snapshot via `atlas_canonical_verify`.',
    '2. Did a recent migration alter the source tables (column rename, type change, RLS policy edit)? Audit the report function.',
    "3. Was a row deleted that shouldn't have been? Cross-reference `verified_sample_ids` against `atlas_canonical_run_log`.",
    '',
    '## How to close',
    '',
    'Either re-verify the report (data legitimately changed) or fix the underlying issue. The cron re-checks daily; this row will not auto-close.',
  ].join('\n')

  if (body.length > BODY_MD_MAX) {
    body = body.slice(0, BODY_MD_MAX - 50) + '\n\n…(truncated)'
  }

  const { error: insErr } = await admin.from('greg_actions').insert({
    priority: 'P1',
    owner: 'greg',
    title: title.slice(0, 200),
    body_md: body,
    source_session: sourceSession,
    effort_estimate: 'S',
    status: 'open',
  })
  if (insErr) {
    failures.push({ reportId, stage: 'greg_actions_insert', message: insErr.message })
  }
}

async function fileDemotionAction(args: {
  admin: ReturnType<typeof createClient<any, any, any>>
  row: { id: string; verified_at: string | null; verified_by: string | null; status: string; function_name: string }
  failures: SilentFailure[]
}): Promise<void> {
  const { admin, row, failures } = args
  const sourceSession = `${SOURCE_SESSION_PREFIX}:demotion:${row.id}`

  const { data: existingOpen, error: existingErr } = await admin
    .from('greg_actions')
    .select('id')
    .eq('source_session', sourceSession)
    .eq('status', 'open')
    .limit(1)
  if (existingErr) {
    failures.push({ reportId: row.id, stage: 'demotion_dedup', message: existingErr.message })
    return
  }
  if ((existingOpen ?? []).length > 0) return

  const isDeprecated = row.status === 'deprecated'
  const title = isDeprecated
    ? `Atlas drift: ${row.id} deprecated — confirm intentional`
    : `Atlas drift: ${row.id} demoted from verified to ${row.status} — drift detection bypassed`

  const body = isDeprecated
    ? [
        `## Verified canonical report deprecated: \`${row.id}\``,
        '',
        `**Current status:** deprecated`,
        `**Originally verified at:** ${row.verified_at ?? 'unknown'}`,
        `**Originally verified by:** ${row.verified_by ?? 'unknown'}`,
        `**Function:** \`${row.function_name}\``,
        '',
        '## Informational',
        '',
        'A canonical report that was previously verified has been deprecated. Drift monitoring on it is now off (intentional for deprecated reports).',
        '',
        '## How to close',
        '',
        '1. If the deprecation was intentional: close this action; the cron will not re-file unless the report is re-verified and re-deprecated.',
        '2. If unintentional: re-verify via `atlas_canonical_verify`.',
      ].join('\n')
    : [
        `## Verified canonical report demoted: \`${row.id}\``,
        '',
        `**Current status:** ${row.status}`,
        `**Originally verified at:** ${row.verified_at ?? 'unknown'}`,
        `**Originally verified by:** ${row.verified_by ?? 'unknown'}`,
        `**Function:** \`${row.function_name}\``,
        '',
        '## Why this matters',
        '',
        'A previously-verified report has been demoted back to draft (likely via `atlas_canonical_save_draft` overwriting an existing row). The drift cron only checks `status=verified` rows, so this report has silently dropped out of trust monitoring.',
        '',
        'This may be legitimate (admin is staging a re-verification) or unintended (function_name mutated, snapshot poisoned). Either way Greg should know.',
        '',
        '## How to close',
        '',
        "1. If intentional: re-run `atlas_canonical_verify` once the new draft is ready, then close this action.",
        '2. If not intentional: investigate who called `atlas_canonical_save_draft` against this id and roll back as needed.',
        '',
        'A future migration should add a guard to `atlas_canonical_save_draft` rejecting in-place mutation of `function_name` on rows that have ever been verified (R1 HIGH-1 follow-up — see action #598).',
      ].join('\n')

  const { error: insErr } = await admin.from('greg_actions').insert({
    priority: 'P1',
    owner: 'greg',
    title: title.slice(0, 200),
    body_md: body,
    source_session: sourceSession,
    effort_estimate: 'S',
    status: 'open',
  })
  if (insErr) {
    failures.push({ reportId: row.id, stage: 'demotion_insert', message: insErr.message })
  }
}
