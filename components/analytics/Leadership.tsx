'use client'

import { useMemo, useState } from 'react'
import { fmt$ } from '@/lib/utils'
import {
  MetricCard, MiniBar, ProjectListModal, ExportButton, downloadCSV,
  inRange, STAGE_DAYS_REMAINING, PERIOD_LABELS,
  type AnalyticsData,
} from './shared'

export function Leadership({ data }: { data: AnalyticsData }) {
  const { projects, active, complete, funding, period } = data
  const [drillDown, setDrillDown] = useState<{ title: string; projects: typeof projects } | null>(null)

  // Period metrics
  const { installs, sales, m2Funded, m3Funded, installVal, m2Val, m3Val, salesVal } = useMemo(() => {
    const installs = projects.filter(p => inRange(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null), period))
    const m2Funded = projects.filter(p => { const f = funding[p.id]; return f && inRange(f.m2_funded_date, period) })
    const m3Funded = projects.filter(p => { const f = funding[p.id]; return f && inRange(f.m3_funded_date, period) })
    const sales = projects.filter(p => inRange(p.sale_date, period))
    return {
      installs, m2Funded, m3Funded, sales,
      installVal: installs.reduce((s, p) => s + (Number(p.contract) || 0), 0),
      m2Val: m2Funded.reduce((s, p) => { const f = funding[p.id]; return s + (Number(f?.m2_amount) || 0) }, 0),
      m3Val: m3Funded.reduce((s, p) => { const f = funding[p.id]; return s + (Number(f?.m3_amount) || 0) }, 0),
      salesVal: sales.reduce((s, p) => s + (Number(p.contract) || 0), 0),
    }
  }, [projects, funding, period])

  // Forecast buckets
  const next30 = useMemo(() => active.filter(p => (STAGE_DAYS_REMAINING[p.stage] ?? 60) <= 30), [active])
  const next60 = useMemo(() => active.filter(p => { const d = STAGE_DAYS_REMAINING[p.stage] ?? 60; return d > 30 && d <= 60 }), [active])

  const totalPortfolio = useMemo(() => active.reduce((s, p) => s + (Number(p.contract) || 0), 0), [active])

  // Last 6 months completions
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - (5 - i))
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    const mps = projects.filter(p => {
      const cd = p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null)
      if (!cd) return false
      const dt = new Date(cd + 'T00:00:00')
      return !isNaN(dt.getTime()) && dt >= start && dt <= end
    })
    return {
      label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      count: mps.length,
      value: mps.reduce((s, p) => s + (Number(p.contract) || 0), 0),
    }
  }), [projects])
  const maxMonthCount = useMemo(() => Math.max(...months.map(m => m.count), 1), [months])

  // Financier breakdown
  const finStats = useMemo(() => {
    const financiers = [...new Set(projects.map(p => p.financier).filter(Boolean))] as string[]
    return financiers.map(f => {
      const ps = active.filter(p => p.financier === f)
      return { financier: f, count: ps.length, value: ps.reduce((s, p) => s + (Number(p.contract) || 0), 0) }
    }).sort((a, b) => b.count - a.count)
  }, [projects, active])
  const maxFinCount = useMemo(() => Math.max(...finStats.map(f => f.count), 1), [finStats])

  const handleExport = () => {
    const headers = ['Metric', 'Count', 'Value']
    const rows = [
      ['Sales', sales.length, salesVal],
      ['Installs', installs.length, installVal],
      ['M2 Funded', m2Funded.length, m2Val],
      ['M3 Funded', m3Funded.length, m3Val],
      ['Active Projects', active.length, totalPortfolio],
      ['Complete', complete.length, ''],
      ['Forecast 30d', next30.length, next30.reduce((s, p) => s + (Number(p.contract) || 0), 0)],
      ['Forecast 60d', next60.length, next60.reduce((s, p) => s + (Number(p.contract) || 0), 0)],
      ...finStats.map(f => [f.financier, f.count, f.value]),
    ] as (string | number | null)[][]
    downloadCSV(`leadership-${period}.csv`, headers, rows)
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex justify-end"><ExportButton onClick={handleExport} /></div>

      {/* Period metrics */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">{PERIOD_LABELS[period]}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Sales" value={String(sales.length)} sub={fmt$(salesVal)} color="text-green-400"
            onClick={() => setDrillDown({ title: `Sales (${PERIOD_LABELS[period]})`, projects: sales })} />
          <MetricCard label="Installs" value={String(installs.length)} sub={fmt$(installVal)} color="text-blue-400"
            onClick={() => setDrillDown({ title: `Installs (${PERIOD_LABELS[period]})`, projects: installs })} />
          <MetricCard label="M2 Funded" value={String(m2Funded.length)} sub={fmt$(m2Val)} color="text-amber-400"
            onClick={() => setDrillDown({ title: `M2 Funded (${PERIOD_LABELS[period]})`, projects: m2Funded })} />
          <MetricCard label="M3 Funded" value={String(m3Funded.length)} sub={fmt$(m3Val)} color="text-amber-400"
            onClick={() => setDrillDown({ title: `M3 Funded (${PERIOD_LABELS[period]})`, projects: m3Funded })} />
        </div>
      </div>

      {/* Portfolio overview */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Portfolio Overview</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Active Projects" value={String(active.length)} sub={fmt$(totalPortfolio)}
            onClick={() => setDrillDown({ title: 'Active Projects', projects: active })} />
          <MetricCard label="Complete" value={String(complete.length)}
            onClick={() => setDrillDown({ title: 'Complete Projects', projects: complete })} />
          <MetricCard label="Forecast 30d" value={String(next30.length)} sub={fmt$(next30.reduce((s, p) => s + (Number(p.contract) || 0), 0))} color="text-green-400"
            onClick={() => setDrillDown({ title: 'Forecast: Next 30 Days', projects: next30 })} />
          <MetricCard label="Forecast 60d" value={String(next60.length)} sub={fmt$(next60.reduce((s, p) => s + (Number(p.contract) || 0), 0))}
            onClick={() => setDrillDown({ title: 'Forecast: 31-60 Days', projects: next60 })} />
        </div>
      </div>

      {/* Monthly trend */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Monthly Installs — Last 6 Months</div>
        <div className="space-y-2">
          {months.map(m => (
            <div key={m.label} className="flex items-center gap-3">
              <div className="text-xs text-gray-400 w-16 flex-shrink-0">{m.label}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-4 relative">
                <div className="bg-green-600 h-4 rounded-full transition-all flex items-center justify-end pr-2"
                  style={{ width: `${Math.max(m.count / maxMonthCount * 100, m.count > 0 ? 5 : 0)}%` }}>
                  {m.count > 0 && <span className="text-xs text-white font-bold">{m.count}</span>}
                </div>
              </div>
              <div className="text-xs text-gray-400 font-mono w-24 text-right">{fmt$(m.value)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Financier breakdown */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Active by Financier</div>
        {finStats.map(f => (
          <MiniBar key={f.financier} label={f.financier} count={f.count} value={f.value} max={maxFinCount} />
        ))}
      </div>

      {drillDown && <ProjectListModal title={drillDown.title} projects={drillDown.projects} onClose={() => setDrillDown(null)} />}
    </div>
  )
}
