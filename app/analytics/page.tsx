'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/Nav'
import { fmt$, fmtDate, daysAgo, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS } from '@/lib/utils'
import type { Project, ProjectFunding } from '@/types/database'

type Period = 'wtd'|'mtd'|'qtd'|'ytd'|'last7'|'last30'|'last90'

const PERIOD_LABELS: Record<Period, string> = {
  wtd: 'Week to Date', mtd: 'This Month', qtd: 'This Quarter',
  ytd: 'This Year', last7: 'Last 7 Days', last30: 'Last 30 Days', last90: 'Last 90 Days',
}

const STAGE_DAYS_REMAINING: Record<string, number> = {
  evaluation: 56, survey: 50, design: 44, permit: 31, install: 10, inspection: 17, complete: 0,
}

function rangeStart(period: Period): Date {
  const d = new Date()
  switch (period) {
    case 'wtd':   d.setDate(d.getDate() - d.getDay()); break
    case 'mtd':   d.setDate(1); break
    case 'qtd':   { const qm = Math.floor(d.getMonth() / 3) * 3; d.setMonth(qm, 1); break }
    case 'ytd':   d.setMonth(0, 1); break
    case 'last7':  d.setDate(d.getDate() - 7); break
    case 'last30': d.setDate(d.getDate() - 30); break
    case 'last90': d.setDate(d.getDate() - 90); break
  }
  d.setHours(0, 0, 0, 0)
  return d
}

function inRange(dateStr: string | null | undefined, period: Period): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  return d >= rangeStart(period) && d <= new Date()
}

function MetricCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

function MiniBar({ label, count, value, max }: { label: string; count: number; value: number; max: number }) {
  const pct = max > 0 ? Math.round(count / max * 100) : 0
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="text-xs text-gray-400 w-24 flex-shrink-0">{label}</div>
      <div className="flex-1 bg-gray-800 rounded-full h-2">
        <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-gray-300 font-mono w-8 text-right">{count}</div>
      <div className="text-xs text-gray-500 font-mono w-20 text-right">{fmt$(value)}</div>
    </div>
  )
}

export default function AnalyticsPage() {
  const supabase = createClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [funding, setFunding] = useState<Record<string, ProjectFunding>>({})
  const [period, setPeriod] = useState<Period>('mtd')
  const [tab, setTab] = useState<'leadership'|'pipeline'|'pm'>('leadership')
  const [loading, setLoading] = useState(true)



  const loadData = useCallback(async () => {
    const [projRes, fundRes] = await Promise.all([
      supabase.from('projects').select('id, name, stage, contract, install_complete_date, stage_date, sale_date, pm, pm_id, blocker, financier, disposition').not('disposition', 'in', '("In Service","Loyalty","Cancelled")').limit(2000),
      (supabase as any).from('project_funding').select('project_id, m2_funded_date, m3_funded_date, m2_amount, m3_amount').limit(2000),
    ])
    if (projRes.error) console.error('projects load failed:', projRes.error)
    if (fundRes.error) console.error('funding load failed:', fundRes.error)
    if (projRes.data) setProjects(projRes.data as Project[])
    if (fundRes.data) {
      const map: Record<string, ProjectFunding> = {}
      fundRes.data.forEach((f: any) => { map[f.project_id] = f })
      setFunding(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const active = useMemo(() => projects.filter(p => p.stage !== 'complete'), [projects])
  const complete = useMemo(() => projects.filter(p => p.stage === 'complete'), [projects])

  // Period metrics
  const { installs, completions, m2Funded, m3Funded, sales, installVal, completionVal, m2Val, m3Val, salesVal } = useMemo(() => {
    const installs = projects.filter(p => inRange(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null), period))
    const completions = projects.filter(p => p.stage === 'complete' && inRange(p.stage_date, period))
    const m2Funded = projects.filter(p => { const f = funding[p.id]; return f && inRange(f.m2_funded_date, period) })
    const m3Funded = projects.filter(p => { const f = funding[p.id]; return f && inRange(f.m3_funded_date, period) })
    const sales = projects.filter(p => inRange(p.sale_date, period))
    return {
      installs, completions, m2Funded, m3Funded, sales,
      installVal: installs.reduce((s, p) => s + (Number(p.contract) || 0), 0),
      completionVal: completions.reduce((s, p) => s + (Number(p.contract) || 0), 0),
      m2Val: m2Funded.reduce((s, p) => { const f = funding[p.id]; return s + (Number(f?.m2_amount) || 0) }, 0),
      m3Val: m3Funded.reduce((s, p) => { const f = funding[p.id]; return s + (Number(f?.m3_amount) || 0) }, 0),
      salesVal: sales.reduce((s, p) => s + (Number(p.contract) || 0), 0),
    }
  }, [projects, funding, period])

  // Forecast buckets
  const next30 = useMemo(() => active.filter(p => (STAGE_DAYS_REMAINING[p.stage] ?? 60) <= 30), [active])
  const next60 = useMemo(() => active.filter(p => { const d = STAGE_DAYS_REMAINING[p.stage] ?? 60; return d > 30 && d <= 60 }), [active])
  const next90 = useMemo(() => active.filter(p => { const d = STAGE_DAYS_REMAINING[p.stage] ?? 60; return d > 60 && d <= 90 }), [active])

  // Stage distribution
  const stageDist = useMemo(() => STAGE_ORDER.filter(s => s !== 'complete').map(s => ({
    stage: s,
    label: STAGE_LABELS[s],
    count: active.filter(p => p.stage === s).length,
    value: active.filter(p => p.stage === s).reduce((sum, p) => sum + (Number(p.contract) || 0), 0),
  })), [active])
  const maxStageCount = useMemo(() => Math.max(...stageDist.map(s => s.count), 1), [stageDist])

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

  // PM breakdown
  const pmStats = useMemo(() => {
    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
    const pmPairs = [...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    return pmPairs.map(({ id: pmId, name: pm }) => {
      const ps = projects.filter(p => p.pm_id === pmId)
      const activePs = ps.filter(p => p.stage !== 'complete')
      return {
        pm,
        total: ps.length,
        active: activePs.length,
        blocked: activePs.filter(p => p.blocker).length,
        value: activePs.reduce((s, p) => s + (Number(p.contract) || 0), 0),
        installs: ps.filter(p => inRange(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null), period)).length,
      }
    }).sort((a, b) => b.active - a.active)
  }, [projects, period])

  // Financier breakdown
  const finStats = useMemo(() => {
    const financiers = [...new Set(projects.map(p => p.financier).filter(Boolean))] as string[]
    return financiers.map(f => {
      const ps = active.filter(p => p.financier === f)
      return {
        financier: f,
        count: ps.length,
        value: ps.reduce((s, p) => s + (Number(p.contract) || 0), 0),
      }
    }).sort((a, b) => b.count - a.count)
  }, [projects, active])
  const maxFinCount = useMemo(() => Math.max(...finStats.map(f => f.count), 1), [finStats])

  const totalPortfolio = useMemo(() => active.reduce((s, p) => s + (Number(p.contract) || 0), 0), [active])

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading analytics...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Analytics" right={
          <select value={period} onChange={e => setPeriod(e.target.value as Period)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        } />

      {/* Sub-tabs */}
      <div className="bg-gray-950 border-b border-gray-800 flex px-4 flex-shrink-0">
        {(['leadership','pipeline','pm'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-4 py-3 font-medium transition-colors border-b-2 ${tab === t ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {t === 'leadership' ? 'Leadership' : t === 'pipeline' ? 'Pipeline Health' : 'By PM'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {/* ── LEADERSHIP TAB ── */}
        {tab === 'leadership' && (
          <div className="max-w-6xl space-y-8">
            {/* Period metrics */}
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">{PERIOD_LABELS[period]}</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Sales" value={String(sales.length)} sub={fmt$(salesVal)} color="text-green-400" />
                <MetricCard label="Installs" value={String(installs.length)} sub={fmt$(installVal)} color="text-blue-400" />
                <MetricCard label="M2 Funded" value={String(m2Funded.length)} sub={fmt$(m2Val)} color="text-amber-400" />
                <MetricCard label="M3 Funded" value={String(m3Funded.length)} sub={fmt$(m3Val)} color="text-amber-400" />
              </div>
            </div>

            {/* Portfolio overview */}
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Portfolio Overview</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Active Projects" value={String(active.length)} sub={fmt$(totalPortfolio)} />
                <MetricCard label="Complete" value={String(complete.length)} />
                <MetricCard label="Forecast 30d" value={String(next30.length)} sub={fmt$(next30.reduce((s,p)=>s+(Number(p.contract)||0),0))} color="text-green-400" />
                <MetricCard label="Forecast 60d" value={String(next60.length)} sub={fmt$(next60.reduce((s,p)=>s+(Number(p.contract)||0),0))} />
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
          </div>
        )}

        {/* ── PIPELINE HEALTH TAB ── */}
        {tab === 'pipeline' && (
          <div className="max-w-4xl space-y-6">
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Stage Distribution</div>
              {stageDist.map(s => (
                <MiniBar key={s.stage} label={s.label} count={s.count} value={s.value} max={maxStageCount} />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="text-xs text-gray-400 mb-3">90-Day Forecast</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Next 30 days</span>
                    <span className="text-green-400 font-mono">{next30.length} · {fmt$(next30.reduce((s,p)=>s+(Number(p.contract)||0),0))}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">31–60 days</span>
                    <span className="text-gray-300 font-mono">{next60.length} · {fmt$(next60.reduce((s,p)=>s+(Number(p.contract)||0),0))}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">61–90 days</span>
                    <span className="text-gray-500 font-mono">{next90.length} · {fmt$(next90.reduce((s,p)=>s+(Number(p.contract)||0),0))}</span>
                  </div>
                </div>
              </div>
              <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="text-xs text-gray-400 mb-3">SLA Health</div>
                <div className="space-y-2">
                  {(['crit','risk','ok'] as const).map(status => {
                    const count = active.filter(p => {
                      const t = SLA_THRESHOLDS[p.stage] ?? {crit:7,risk:5}
                      const d = daysAgo(p.stage_date)
                      if (status === 'crit') return d >= t.crit
                      if (status === 'risk') return d >= t.risk && d < t.crit
                      return d < t.risk
                    }).length
                    return (
                      <div key={status} className="flex justify-between text-xs">
                        <span className={status === 'crit' ? 'text-red-400' : status === 'risk' ? 'text-amber-400' : 'text-green-400'}>
                          {status === 'crit' ? 'Critical' : status === 'risk' ? 'At Risk' : 'On Track'}
                        </span>
                        <span className="text-gray-300 font-mono">{count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="text-xs text-gray-400 mb-3">Blocked / Aging</div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-red-400">Blocked</span>
                    <span className="text-gray-300 font-mono">{active.filter(p=>p.blocker).length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-amber-400">90+ day cycle</span>
                    <span className="text-gray-300 font-mono">{projects.filter(p=>p.stage!=='complete'&&(daysAgo(p.sale_date)||0)>=90).length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-amber-400">120+ day cycle</span>
                    <span className="text-gray-300 font-mono">{projects.filter(p=>p.stage!=='complete'&&(daysAgo(p.sale_date)||0)>=120).length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PM TAB ── */}
        {tab === 'pm' && (
          <div className="max-w-4xl">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-700">
                  {['PM','Active','Blocked','Portfolio','Installs (period)'].map(h => (
                    <th key={h} className="text-left text-gray-400 font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pmStats.map(pm => (
                  <tr key={pm.pm} className="border-b border-gray-800 hover:bg-gray-800">
                    <td className="px-3 py-2 font-medium text-white">{pm.pm}</td>
                    <td className="px-3 py-2 text-gray-300 font-mono">{pm.active}</td>
                    <td className="px-3 py-2">
                      {pm.blocked > 0
                        ? <span className="text-red-400 font-mono">{pm.blocked}</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(pm.value)}</td>
                    <td className="px-3 py-2 text-green-400 font-mono">{pm.installs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
