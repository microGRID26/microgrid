'use client'

import { useMemo, useState } from 'react'
import { fmt$, daysAgo, SLA_THRESHOLDS, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import {
  MetricCard, PeriodBar, ExportButton, downloadCSV, SortHeader, useSortable, ProjectListModal,
  inRange, PERIOD_LABELS, type AnalyticsData, type Period,
} from './shared'
import type { Project } from '@/types/database'

// ── Types ────────────────────────────────────────────────────────────────────

interface PMRow {
  pm: string
  pmId: string
  active: number
  blocked: number
  portfolioValue: number
  installs: number
  avgCycleDays: number
  slaPct: number
  revenue: number
  throughput: number
}

// ── Sub-components for new dense sections ───────────────────────────────────

type PMDrillFn = (pmId: string, pm: string, filter?: (p: Project) => boolean, label?: string) => void

function PMStageBreakdown({ projects, sorted, onDrill }: { projects: Project[]; sorted: PMRow[]; onDrill: PMDrillFn }) {
  const stages = STAGE_ORDER.filter(s => s !== 'complete')
  const STAGE_CELL_COLORS: Record<number, string> = {
    0: '', 1: 'bg-blue-950/30', 5: 'bg-blue-900/30', 10: 'bg-blue-800/40', 20: 'bg-blue-700/50',
  }
  const getCellBg = (count: number) => {
    if (count >= 20) return STAGE_CELL_COLORS[20]
    if (count >= 10) return STAGE_CELL_COLORS[10]
    if (count >= 5) return STAGE_CELL_COLORS[5]
    if (count >= 1) return STAGE_CELL_COLORS[1]
    return ''
  }

  const data = useMemo(() => {
    return sorted.map(pm => {
      const ps = projects.filter(p => p.pm_id === pm.pmId && p.stage !== 'complete' && p.disposition !== 'Cancelled' && p.disposition !== 'In Service')
      const stageCounts: Record<string, number> = {}
      stages.forEach(s => { stageCounts[s] = 0 })
      ps.forEach(p => { stageCounts[p.stage] = (stageCounts[p.stage] ?? 0) + 1 })
      return { pm: pm.pm, pmId: pm.pmId, total: ps.length, stageCounts }
    })
  }, [sorted, projects])

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">PM by Stage Breakdown</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 font-medium px-2 py-1.5">PM</th>
              {stages.map(s => (
                <th key={s} className="text-center text-gray-500 font-medium px-2 py-1.5">{(STAGE_LABELS[s] ?? s).slice(0, 5)}</th>
              ))}
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr
                key={row.pmId}
                className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                onClick={() => onDrill(row.pmId, row.pm, p => p.stage !== 'complete', 'Active Projects')}
              >
                <td className="px-2 py-1.5 text-white font-medium">{row.pm}</td>
                {stages.map(s => (
                  <td key={s} className={`px-2 py-1.5 text-center font-mono ${getCellBg(row.stageCounts[s])} ${row.stageCounts[s] > 0 ? 'text-white' : 'text-gray-600'}`}>
                    {row.stageCounts[s] || '\u2014'}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-green-400 font-mono font-bold">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PMActivity({ projects, sorted, period, onDrill }: { projects: Project[]; sorted: PMRow[]; period: Period; onDrill: PMDrillFn }) {
  const data = useMemo(() => {
    const now = new Date()
    return sorted.map(pm => {
      const ps = projects.filter(p => p.pm_id === pm.pmId)
      // Tasks advanced: projects that changed stage in period (use stage_date as proxy)
      const tasksAdvanced = ps.filter(p => inRange(p.stage_date, period)).length
      // Follow-ups completed: projects with follow_up_date in the past
      const followUps = ps.filter(p => {
        const fud = p.follow_up_date
        if (!fud) return false
        const d = new Date(fud + 'T00:00:00')
        return d <= now && inRange(fud, period)
      }).length
      // Blockers cleared: projects that had blocker cleared recently (proxy: non-blocked in active pipeline)
      const activePs = ps.filter(p => p.stage !== 'complete' && p.disposition !== 'Cancelled')
      const blockersClear = activePs.filter(p => !p.blocker).length
      // Estimate notes added (proxy: tasks advanced is our best signal)
      const notesEstimate = tasksAdvanced * 2 // approximate: 2 notes per task advancement
      return { pm: pm.pm, pmId: pm.pmId, tasksAdvanced, followUps, blockersClear, notesEstimate, active: activePs.length }
    })
  }, [sorted, projects, period])

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">PM Activity This Period</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 font-medium px-2 py-1.5">PM</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">Tasks Advanced</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">Follow-ups Done</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">Clear of Blockers</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">Est. Notes</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">Activity Score</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => {
              const score = row.tasksAdvanced * 3 + row.followUps * 2 + row.notesEstimate
              const maxScore = Math.max(...data.map(d => d.tasksAdvanced * 3 + d.followUps * 2 + d.notesEstimate), 1)
              const scorePct = Math.round((score / maxScore) * 100)
              return (
                <tr
                  key={row.pmId}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                  onClick={() => onDrill(row.pmId, row.pm, undefined, 'All Projects')}
                >
                  <td className="px-2 py-1.5 text-white font-medium">{row.pm}</td>
                  <td className="px-2 py-1.5 text-green-400 font-mono text-right font-bold">{row.tasksAdvanced}</td>
                  <td className="px-2 py-1.5 text-blue-400 font-mono text-right">{row.followUps}</td>
                  <td className="px-2 py-1.5 text-gray-300 font-mono text-right">{row.blockersClear}/{row.active}</td>
                  <td className="px-2 py-1.5 text-gray-400 font-mono text-right">{row.notesEstimate}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <div className="w-16 bg-gray-700 rounded-full h-2 overflow-hidden">
                        <div className={`h-full rounded-full ${scorePct >= 70 ? 'bg-green-500' : scorePct >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.max(scorePct, 3)}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono w-6">{score}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PMRevenuePipeline({ projects, sorted, onDrill }: { projects: Project[]; sorted: PMRow[]; onDrill: PMDrillFn }) {
  const STAGE_DAYS: Record<string, number> = {
    evaluation: 90, survey: 75, design: 60, permit: 45, install: 14, inspection: 7,
  }
  const data = useMemo(() => {
    return sorted.map(pm => {
      const ps = projects.filter(p => p.pm_id === pm.pmId && p.stage !== 'complete' && p.disposition !== 'Cancelled' && p.disposition !== 'In Service')
      let f30 = 0, f60 = 0, f90 = 0
      ps.forEach(p => {
        const daysRemaining = STAGE_DAYS[p.stage] ?? 60
        const contract = Number(p.contract) || 0
        if (daysRemaining <= 30) f30 += contract
        if (daysRemaining <= 60) f60 += contract
        if (daysRemaining <= 90) f90 += contract
      })
      return { pm: pm.pm, pmId: pm.pmId, f30, f60, f90, total: ps.length }
    })
  }, [sorted, projects])

  const maxF90 = Math.max(...data.map(d => d.f90), 1)

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">PM Revenue Pipeline — Forecast</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left text-gray-500 font-medium px-2 py-1.5">PM</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">30-Day</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">60-Day</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">90-Day</th>
              <th className="text-right text-gray-500 font-medium px-2 py-1.5">Active</th>
              <th className="text-left text-gray-500 font-medium px-2 py-1.5 w-28">Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr
                key={row.pmId}
                className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
                onClick={() => onDrill(row.pmId, row.pm, p => p.stage !== 'complete', 'Pipeline')}
              >
                <td className="px-2 py-1.5 text-white font-medium">{row.pm}</td>
                <td className="px-2 py-1.5 text-green-400 font-mono text-right">{fmt$(row.f30)}</td>
                <td className="px-2 py-1.5 text-blue-400 font-mono text-right">{fmt$(row.f60)}</td>
                <td className="px-2 py-1.5 text-purple-400 font-mono text-right">{fmt$(row.f90)}</td>
                <td className="px-2 py-1.5 text-gray-300 font-mono text-right">{row.total}</td>
                <td className="px-2 py-1.5">
                  <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.max((row.f90 / maxF90) * 100, 3)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> 30-day (install/inspection stage)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> 60-day (+ permit stage)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400" /> 90-day (+ design/survey)</span>
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function ByPM({ data }: { data: AnalyticsData }) {
  const { projects, period } = data
  const [drillDown, setDrillDown] = useState<{ title: string; projects: Project[] } | null>(null)

  // ── PM Row Computation ───────────────────────────────────────────────────
  const pmRows = useMemo(() => {
    const now = new Date()
    const d28 = new Date(now); d28.setDate(d28.getDate() - 28)

    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })

    const rows: PMRow[] = [...pmMap.entries()].map(([pmId, pm]) => {
      const ps = projects.filter(p => p.pm_id === pmId)
      const activePs = ps.filter(p => p.stage !== 'complete' && p.disposition !== 'Cancelled' && p.disposition !== 'In Service')
      const portfolioValue = activePs.reduce((s, p) => s + (Number(p.contract) || 0), 0)
      const blocked = activePs.filter(p => p.blocker).length

      // Installs in period
      const installs = ps.filter(p => inRange(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null), period)).length

      // Avg cycle days (sale to install for completed)
      const withInstall = ps.filter(p => p.sale_date && p.install_complete_date)
      const avgCycleDays = withInstall.length > 0
        ? Math.round(withInstall.reduce((s, p) => {
            const sale = new Date(p.sale_date! + 'T00:00:00').getTime()
            const inst = new Date(p.install_complete_date! + 'T00:00:00').getTime()
            return s + (inst - sale) / 86400000
          }, 0) / withInstall.length)
        : 0

      // SLA compliance
      const onTrack = activePs.filter(p => {
        const t = SLA_THRESHOLDS[p.stage] ?? { target: 5, risk: 10, crit: 15 }
        return daysAgo(p.stage_date) <= t.target
      }).length
      const slaPct = activePs.length > 0 ? Math.round((onTrack / activePs.length) * 100) : 100

      // Revenue: SUM(contract) for projects where install_complete_date falls in period
      const periodCompleted = ps.filter(p => inRange(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null), period))
      const revenue = periodCompleted.reduce((s, p) => s + (Number(p.contract) || 0), 0)

      // Throughput: installs in last 28 days / 4
      const last28Installs = ps.filter(p => {
        const icd = p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null)
        if (!icd) return false
        const d = new Date(icd + 'T00:00:00')
        return d >= d28 && d <= now
      })
      const throughput = Math.round((last28Installs.length / 4) * 10) / 10

      return { pm, pmId, active: activePs.length, blocked, portfolioValue, installs, avgCycleDays, slaPct, revenue, throughput }
    }).sort((a, b) => a.pm.localeCompare(b.pm))

    return rows
  }, [projects, period])

  const { sorted, sortKey, sortDir, toggleSort } = useSortable<PMRow>(pmRows, 'active')

  // ── Headline Metrics ─────────────────────────────────────────────────────
  const headline = useMemo(() => {
    const totalActive = sorted.reduce((s, pm) => s + pm.active, 0)
    const totalRevenue = sorted.reduce((s, pm) => s + pm.revenue, 0)

    // Avg throughput: total installs in last 28 days / 4
    const totalThroughput = sorted.reduce((s, pm) => s + pm.throughput, 0)
    const avgThroughput = sorted.length > 0 ? Math.round((totalThroughput / sorted.length) * 10) / 10 : 0

    // Workload balance: std dev of active projects per PM
    const mean = sorted.length > 0 ? totalActive / sorted.length : 0
    const variance = sorted.length > 0
      ? sorted.reduce((s, pm) => s + Math.pow(pm.active - mean, 2), 0) / sorted.length
      : 0
    const stdDev = Math.round(Math.sqrt(variance) * 10) / 10
    const balanced = stdDev < 5

    // SLA compliance (weighted average)
    const totalActiveForSla = sorted.reduce((s, pm) => s + pm.active, 0)
    const weightedSla = totalActiveForSla > 0
      ? Math.round(sorted.reduce((s, pm) => s + (pm.slaPct * pm.active), 0) / totalActiveForSla)
      : 100

    return { totalActive, totalRevenue, avgThroughput, totalThroughput, stdDev, balanced, weightedSla }
  }, [sorted])

  // ── PM Comparison Bars (normalized 0-100) ────────────────────────────────
  const comparisonBars = useMemo(() => {
    const maxPortfolio = Math.max(...sorted.map(pm => pm.active), 1)
    const maxCycle = Math.max(...sorted.map(pm => pm.avgCycleDays), 1)
    const maxThroughput = Math.max(...sorted.map(pm => pm.throughput), 0.1)
    const maxBlockerRate = Math.max(...sorted.map(pm => pm.active > 0 ? (pm.blocked / pm.active) * 100 : 0), 1)

    return sorted.map(pm => {
      const portfolioNorm = Math.round((pm.active / maxPortfolio) * 100)
      const cycleEfficiency = pm.avgCycleDays > 0 ? Math.round((1 - pm.avgCycleDays / maxCycle) * 100) : 100
      const sla = pm.slaPct
      const throughputNorm = Math.round((pm.throughput / maxThroughput) * 100)
      const blockerRate = pm.active > 0 ? (pm.blocked / pm.active) * 100 : 0
      const blockerNorm = Math.round((1 - blockerRate / maxBlockerRate) * 100)
      return { pm: pm.pm, portfolioNorm, cycleEfficiency, sla, throughputNorm, blockerNorm }
    })
  }, [sorted])

  // ── Workload Distribution (stacked bars by stage) ────────────────────────
  const workloadData = useMemo(() => {
    const stages = STAGE_ORDER.filter(s => s !== 'complete')
    return sorted.map(pm => {
      const ps = projects.filter(p => p.pm_id === pm.pmId && p.stage !== 'complete' && p.disposition !== 'Cancelled' && p.disposition !== 'In Service')
      const stageMap: Record<string, number> = {}
      stages.forEach(s => { stageMap[s] = 0 })
      ps.forEach(p => { stageMap[p.stage] = (stageMap[p.stage] ?? 0) + 1 })
      return { pm: pm.pm, pmId: pm.pmId, total: ps.length, stages: stageMap }
    })
  }, [sorted, projects])
  const maxWorkload = Math.max(...workloadData.map(w => w.total), 1)

  const STAGE_COLORS: Record<string, string> = {
    evaluation: '#3b82f6', survey: '#8b5cf6', design: '#ec4899',
    permit: '#f59e0b', install: '#f97316', inspection: '#06b6d4',
  }

  // ── PM Trend (this month vs last month) ──────────────────────────────────
  const pmTrend = useMemo(() => {
    const now = new Date()
    const thisMonth = now.getMonth()
    const thisYear = now.getFullYear()
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1
    const lastYear = thisMonth === 0 ? thisYear - 1 : thisYear

    return sorted.map(pm => {
      const ps = projects.filter(p => p.pm_id === pm.pmId)
      const thisMonthInstalls = ps.filter(p => {
        const icd = p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null)
        if (!icd) return false
        const d = new Date(icd + 'T00:00:00')
        return d.getMonth() === thisMonth && d.getFullYear() === thisYear
      }).length
      const lastMonthInstalls = ps.filter(p => {
        const icd = p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null)
        if (!icd) return false
        const d = new Date(icd + 'T00:00:00')
        return d.getMonth() === lastMonth && d.getFullYear() === lastYear
      }).length
      const delta = thisMonthInstalls - lastMonthInstalls
      return { pm: pm.pm, thisMonth: thisMonthInstalls, lastMonth: lastMonthInstalls, delta }
    })
  }, [sorted, projects])

  // ── Export ───────────────────────────────────────────────────────────────
  const handleExport = () => {
    const headers = ['PM', 'Active', 'Blocked', 'Portfolio Value', `Installs (${PERIOD_LABELS[period]})`, 'Avg Cycle Days', 'SLA %', 'Revenue', 'Throughput/wk']
    const rows = sorted.map(pm => [pm.pm, pm.active, pm.blocked, pm.portfolioValue, pm.installs, pm.avgCycleDays, pm.slaPct + '%', pm.revenue, pm.throughput])
    downloadCSV(`pm-performance-${period}.csv`, headers, rows)
  }

  // ── Drill-down helpers ───────────────────────────────────────────────────
  const drillPm = (pmId: string, pm: string, filter?: (p: Project) => boolean, label?: string) => {
    let ps = projects.filter(p => p.pm_id === pmId)
    if (filter) ps = ps.filter(filter)
    setDrillDown({ title: `${pm} — ${label || 'Projects'}`, projects: ps })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        {data.onPeriodChange && <PeriodBar period={data.period} onPeriodChange={data.onPeriodChange} />}
        <ExportButton onClick={handleExport} />
      </div>

      {/* ── 5 Headline MetricCards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          label="Total Active"
          value={String(headline.totalActive)}
          sub={`${sorted.length} PMs`}
          formula="Count of all active projects (non-complete, non-cancelled, non-in-service) across all PMs."
        />
        <MetricCard
          label="Revenue This Period"
          value={fmt$(headline.totalRevenue)}
          sub={PERIOD_LABELS[period]}
          color="text-green-400"
          formula={`SUM of contract values for projects where install_complete_date falls within the selected period (${PERIOD_LABELS[period]}). Measures revenue generated by completed installations.`}
        />
        <MetricCard
          label="Avg Throughput"
          value={`${headline.avgThroughput}/wk`}
          sub={`${headline.totalThroughput.toFixed(1)} total/wk`}
          color="text-blue-400"
          formula="Average installs per week per PM over trailing 28 days. Total throughput is the sum across all PMs."
        />
        <MetricCard
          label="Workload Balance"
          value={headline.balanced ? 'Balanced' : 'Imbalanced'}
          sub={`Spread: ${headline.stdDev}`}
          color={headline.balanced ? 'text-green-400' : headline.stdDev < 10 ? 'text-amber-400' : 'text-red-400'}
          formula={`Standard deviation of active project counts across PMs. Green (Balanced) if std dev < 5, amber if < 10, red otherwise. Current spread: ${headline.stdDev} projects.`}
        />
        <MetricCard
          label="SLA Compliance"
          value={`${headline.weightedSla}%`}
          sub="Weighted by portfolio"
          color={headline.weightedSla >= 80 ? 'text-green-400' : headline.weightedSla >= 50 ? 'text-amber-400' : 'text-red-400'}
          formula="Weighted average of SLA compliance across PMs. Each PM's compliance is weighted by their active project count. A project is 'on track' if days-in-stage is within the SLA target for that stage."
        />
      </div>

      {/* ── PM Scorecard Table ─────────────────────────────────────────────── */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">PM Scorecard</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[850px]">
            <thead>
              <tr className="border-b border-gray-700">
                <SortHeader label="PM Name" field={'pm' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Active" field={'active' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Blocked" field={'blocked' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Portfolio Value" field={'portfolioValue' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label={`Installs`} field={'installs' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Avg Cycle" field={'avgCycleDays' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="SLA %" field={'slaPct' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Revenue" field={'revenue' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <SortHeader label="Throughput" field={'throughput' as keyof PMRow} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(pm => (
                <tr
                  key={pm.pmId}
                  className="border-b border-gray-800 hover:bg-gray-700/30 cursor-pointer"
                  onClick={() => drillPm(pm.pmId, pm.pm, p => p.stage !== 'complete', 'Active Projects')}
                >
                  <td className="px-3 py-2 font-medium text-white">{pm.pm}</td>
                  <td className="px-3 py-2 text-gray-300 font-mono">{pm.active}</td>
                  <td className="px-3 py-2">
                    <span className={pm.blocked > 3 ? 'text-red-400 font-bold' : pm.blocked > 0 ? 'text-red-400' : 'text-gray-600'}>
                      {pm.blocked > 0 ? pm.blocked : '\u2014'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(pm.portfolioValue)}</td>
                  <td className="px-3 py-2 text-green-400 font-mono">{pm.installs}</td>
                  <td className="px-3 py-2 font-mono">
                    <span className={pm.avgCycleDays > 0 ? (pm.avgCycleDays < 45 ? 'text-green-400' : pm.avgCycleDays < 60 ? 'text-amber-400' : 'text-red-400') : 'text-gray-600'}>
                      {pm.avgCycleDays > 0 ? `${pm.avgCycleDays}d` : '\u2014'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono">
                    <span className={pm.slaPct >= 80 ? 'text-green-400' : pm.slaPct >= 50 ? 'text-amber-400' : 'text-red-400'}>
                      {pm.slaPct}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(pm.revenue)}</td>
                  <td className="px-3 py-2 text-blue-400 font-mono">{pm.throughput}/wk</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── PM Comparison Bars ─────────────────────────────────────────────── */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">PM Comparison — Normalized (0-100)</div>
        <div className="space-y-4">
          {comparisonBars.map(cb => (
            <div key={cb.pm}>
              <div className="text-xs text-white font-medium mb-1.5">{cb.pm}</div>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: 'Portfolio', value: cb.portfolioNorm, color: 'bg-blue-600' },
                  { label: 'Cycle Eff.', value: cb.cycleEfficiency, color: 'bg-green-600' },
                  { label: 'SLA', value: cb.sla, color: 'bg-purple-600' },
                  { label: 'Throughput', value: cb.throughputNorm, color: 'bg-amber-600' },
                  { label: 'Low Blockers', value: cb.blockerNorm, color: 'bg-cyan-600' },
                ].map(bar => (
                  <div key={bar.label} className="flex flex-col items-center">
                    <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                      <div
                        className={`h-full ${bar.color} rounded-full transition-all`}
                        style={{ width: `${Math.max(bar.value, 3)}%` }}
                      />
                    </div>
                    <div className="text-[9px] text-gray-500 mt-0.5">{bar.label}</div>
                    <div className="text-[9px] text-gray-400 font-mono">{bar.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4 text-[10px] text-gray-500 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600" /> Portfolio Size</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-600" /> Cycle Efficiency</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-600" /> SLA Compliance</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-600" /> Throughput</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-600" /> Low Blockers</span>
        </div>
      </div>

      {/* ── Workload Distribution (stacked bars by stage) ──────────────────── */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Workload Distribution by Stage</div>
        <div className="space-y-2">
          {workloadData.map(w => (
            <div
              key={w.pm}
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => drillPm(w.pmId, w.pm, p => p.stage !== 'complete', 'Active Projects')}
            >
              <div className="text-xs text-gray-400 w-28 flex-shrink-0 truncate">{w.pm.split(' ')[0]}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-6 overflow-hidden flex">
                {STAGE_ORDER.filter(s => s !== 'complete').map(stage => {
                  const count = w.stages[stage] ?? 0
                  if (count === 0) return null
                  const pct = (count / maxWorkload) * 100
                  return (
                    <div
                      key={stage}
                      className="h-full flex items-center justify-center group-hover:opacity-80 transition-opacity"
                      style={{ width: `${pct}%`, backgroundColor: STAGE_COLORS[stage] ?? '#6b7280' }}
                      title={`${STAGE_LABELS[stage] ?? stage}: ${count}`}
                    >
                      {pct > 6 && <span className="text-[9px] text-white font-bold">{count}</span>}
                    </div>
                  )
                })}
              </div>
              <div className="text-xs text-gray-300 font-mono w-8 text-right">{w.total}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500 flex-wrap">
          {STAGE_ORDER.filter(s => s !== 'complete').map(s => (
            <span key={s} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STAGE_COLORS[s] }} />
              {(STAGE_LABELS[s] ?? s).slice(0, 6)}
            </span>
          ))}
        </div>
      </div>

      {/* ── PM Trend (this month vs last month) ────────────────────────────── */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">PM Trend — Installs This Month vs Last Month</div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {pmTrend.map(t => {
            const arrow = t.delta > 0 ? '\u2191' : t.delta < 0 ? '\u2193' : '\u2014'
            const arrowColor = t.delta > 0 ? 'text-green-400' : t.delta < 0 ? 'text-red-400' : 'text-gray-500'
            return (
              <div key={t.pm} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                <div className="text-xs text-gray-400 truncate mb-1">{t.pm}</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-white font-mono">{t.thisMonth}</span>
                  <span className={`text-sm font-bold ${arrowColor}`}>{arrow}</span>
                  <span className="text-xs text-gray-500 font-mono">vs {t.lastMonth}</span>
                </div>
                {t.delta !== 0 && (
                  <div className={`text-[10px] font-mono mt-0.5 ${arrowColor}`}>
                    {t.delta > 0 ? '+' : ''}{t.delta} from last month
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── PM by Stage Breakdown Table ────────────────────────────────────── */}
      <PMStageBreakdown projects={projects} sorted={sorted} onDrill={drillPm} />

      {/* ── PM Activity This Period ────────────────────────────────────────── */}
      <PMActivity projects={projects} sorted={sorted} period={period} onDrill={drillPm} />

      {/* ── PM Revenue Pipeline ────────────────────────────────────────────── */}
      <PMRevenuePipeline projects={projects} sorted={sorted} onDrill={drillPm} />

      {/* Drill-down modal */}
      {drillDown && <ProjectListModal title={drillDown.title} projects={drillDown.projects} onClose={() => setDrillDown(null)} />}
    </div>
  )
}
