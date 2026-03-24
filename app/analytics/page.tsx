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
  const [tab, setTab] = useState<'leadership'|'pipeline'|'pm'|'funding_analytics'|'cycle'|'dealers'>('leadership')
  const [loading, setLoading] = useState(true)



  const loadData = useCallback(async () => {
    const [projRes, fundRes] = await Promise.all([
      supabase.from('projects').select('id, name, stage, contract, install_complete_date, stage_date, sale_date, pm, pm_id, blocker, financier, disposition, pto_date, dealer, consultant, advisor, systemkw').not('disposition', 'in', '("In Service","Loyalty","Cancelled")').limit(2000),
      supabase.from('project_funding').select('project_id, m2_funded_date, m3_funded_date, m2_amount, m3_amount, m2_status, m3_status, m1_amount, m1_status, nonfunded_code_1, nonfunded_code_2, nonfunded_code_3').limit(2000),
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

  // ── Funding Analytics Tab data ──
  const fundingAnalytics = useMemo(() => {
    const allFunding = Object.values(funding) as ProjectFunding[]
    const readyOrSubmitted = allFunding.filter(f => f.m2_status === 'Ready to Submit' || f.m2_status === 'Submitted' || f.m3_status === 'Ready to Submit' || f.m3_status === 'Submitted')
    const totalOutstanding = readyOrSubmitted.reduce((s, f) => s + (Number(f.m2_amount) || 0) + (Number(f.m3_amount) || 0), 0)

    const m2Total = allFunding.length
    const m2FundedCount = allFunding.filter(f => f.m2_funded_date).length
    const m2UnfundedCount = m2Total - m2FundedCount
    const m2Pct = m2Total > 0 ? Math.round(m2FundedCount / m2Total * 100) : 0

    const m3Total = allFunding.length
    const m3FundedCount = allFunding.filter(f => f.m3_funded_date).length
    const m3UnfundedCount = m3Total - m3FundedCount
    const m3Pct = m3Total > 0 ? Math.round(m3FundedCount / m3Total * 100) : 0

    // Avg days install complete -> M2 funded
    const m2Days: number[] = []
    allFunding.forEach(f => {
      if (!f.m2_funded_date) return
      const proj = projects.find(p => p.id === f.project_id)
      if (!proj?.install_complete_date) return
      const d1 = new Date(proj.install_complete_date + 'T00:00:00')
      const d2 = new Date(f.m2_funded_date + 'T00:00:00')
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000)
        if (diff >= 0) m2Days.push(diff)
      }
    })
    const avgM2Days = m2Days.length > 0 ? Math.round(m2Days.reduce((a, b) => a + b, 0) / m2Days.length) : null

    // Avg days PTO -> M3 funded
    const m3Days: number[] = []
    allFunding.forEach(f => {
      if (!f.m3_funded_date) return
      const proj = projects.find(p => p.id === f.project_id)
      if (!proj?.pto_date) return
      const d1 = new Date(proj.pto_date + 'T00:00:00')
      const d2 = new Date(f.m3_funded_date + 'T00:00:00')
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000)
        if (diff >= 0) m3Days.push(diff)
      }
    })
    const avgM3Days = m3Days.length > 0 ? Math.round(m3Days.reduce((a, b) => a + b, 0) / m3Days.length) : null

    // Funding by financier
    const finFunding = new Map<string, number>()
    allFunding.forEach(f => {
      const proj = projects.find(p => p.id === f.project_id)
      const fin = proj?.financier || 'Unknown'
      const amt = (Number(f.m2_amount) || 0) + (Number(f.m3_amount) || 0)
      finFunding.set(fin, (finFunding.get(fin) || 0) + amt)
    })
    const finFundingArr = [...finFunding.entries()].map(([financier, amount]) => ({ financier, amount })).sort((a, b) => b.amount - a.amount)
    const maxFinFunding = Math.max(...finFundingArr.map(f => f.amount), 1)

    // NF code frequency
    const nfCodes = new Map<string, number>()
    allFunding.forEach(f => {
      ;[f.nonfunded_code_1, f.nonfunded_code_2, f.nonfunded_code_3].forEach(c => {
        if (c) nfCodes.set(c, (nfCodes.get(c) || 0) + 1)
      })
    })
    const nfCodesArr = [...nfCodes.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)

    return { totalOutstanding, m2FundedCount, m2UnfundedCount, m2Pct, m3FundedCount, m3UnfundedCount, m3Pct, avgM2Days, avgM3Days, finFundingArr, maxFinFunding, nfCodesArr }
  }, [projects, funding])

  // ── Cycle Times Tab data ──
  const cycleAnalytics = useMemo(() => {
    // Average days per stage
    const stageAvgs = STAGE_ORDER.filter(s => s !== 'complete').map(s => {
      const stageProjects = active.filter(p => p.stage === s)
      const days = stageProjects.map(p => daysAgo(p.stage_date)).filter(d => d > 0)
      const avg = days.length > 0 ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0
      return { stage: s, label: STAGE_LABELS[s], avg, count: stageProjects.length }
    })
    const maxStageAvg = Math.max(...stageAvgs.map(s => s.avg), 1)

    // Median helper
    const median = (arr: number[]) => {
      if (arr.length === 0) return null
      const sorted = [...arr].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    }

    // Sale to install cycle days (completed installs)
    const saleToInstall: number[] = []
    projects.forEach(p => {
      if (!p.sale_date || !p.install_complete_date) return
      const d1 = new Date(p.sale_date + 'T00:00:00')
      const d2 = new Date(p.install_complete_date + 'T00:00:00')
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000)
        if (diff >= 0) saleToInstall.push(diff)
      }
    })
    const medianSaleToInstall = median(saleToInstall)

    // Sale to PTO cycle days
    const saleToPTO: number[] = []
    projects.forEach(p => {
      if (!p.sale_date || !p.pto_date) return
      const d1 = new Date(p.sale_date + 'T00:00:00')
      const d2 = new Date(p.pto_date + 'T00:00:00')
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000)
        if (diff >= 0) saleToPTO.push(diff)
      }
    })
    const medianSaleToPTO = median(saleToPTO)

    // Cycle time buckets (active projects by sale_date age)
    const buckets = [
      { label: '0–60 days', min: 0, max: 60, count: 0 },
      { label: '61–90 days', min: 61, max: 90, count: 0 },
      { label: '91–120 days', min: 91, max: 120, count: 0 },
      { label: '120+ days', min: 121, max: Infinity, count: 0 },
    ]
    active.forEach(p => {
      const d = daysAgo(p.sale_date) || daysAgo(p.stage_date)
      for (const b of buckets) {
        if (d >= b.min && d <= b.max) { b.count++; break }
      }
    })
    const maxBucket = Math.max(...buckets.map(b => b.count), 1)

    // Longest active projects (top 10)
    const longest = [...active]
      .map(p => ({ id: p.id, name: p.name ?? p.id, stage: STAGE_LABELS[p.stage], days: daysAgo(p.sale_date) || daysAgo(p.stage_date), pm: p.pm ?? '—' }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 10)

    // Where projects get stuck (blocked count by stage)
    const stuckByStage = STAGE_ORDER.filter(s => s !== 'complete').map(s => {
      const stageProjects = active.filter(p => p.stage === s)
      const blocked = stageProjects.filter(p => p.blocker).length
      return { stage: s, label: STAGE_LABELS[s], blocked, total: stageProjects.length }
    }).filter(s => s.blocked > 0).sort((a, b) => b.blocked - a.blocked)
    const maxStuck = Math.max(...stuckByStage.map(s => s.blocked), 1)

    return { stageAvgs, maxStageAvg, medianSaleToInstall, medianSaleToPTO, buckets, maxBucket, longest, stuckByStage, maxStuck }
  }, [projects, active])

  // ── Dealers Tab data ──
  const dealerAnalytics = useMemo(() => {
    // Projects by dealer
    const dealerMap = new Map<string, { count: number; value: number; kwTotal: number }>()
    projects.forEach(p => {
      const d = p.dealer || 'Unknown'
      const cur = dealerMap.get(d) || { count: 0, value: 0, kwTotal: 0 }
      cur.count++
      cur.value += Number(p.contract) || 0
      cur.kwTotal += Number(p.systemkw) || 0
      dealerMap.set(d, cur)
    })
    const dealers = [...dealerMap.entries()].map(([dealer, stats]) => ({
      dealer,
      count: stats.count,
      value: stats.value,
      avgKw: stats.count > 0 ? Math.round((stats.kwTotal / stats.count) * 100) / 100 : 0,
    })).sort((a, b) => b.count - a.count)
    const maxDealerCount = Math.max(...dealers.map(d => d.count), 1)

    // Projects by consultant
    const consultantMap = new Map<string, number>()
    projects.forEach(p => {
      const c = p.consultant
      if (c) consultantMap.set(c, (consultantMap.get(c) || 0) + 1)
    })
    const consultants = [...consultantMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    const maxConsultant = Math.max(...consultants.map(c => c.count), 1)

    // Projects by advisor
    const advisorMap = new Map<string, number>()
    projects.forEach(p => {
      const a = p.advisor
      if (a) advisorMap.set(a, (advisorMap.get(a) || 0) + 1)
    })
    const advisors = [...advisorMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    const maxAdvisor = Math.max(...advisors.map(a => a.count), 1)

    return { dealers, maxDealerCount, consultants, maxConsultant, advisors, maxAdvisor }
  }, [projects])

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
        {(['leadership','pipeline','pm','funding_analytics','cycle','dealers'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-4 py-3 font-medium transition-colors border-b-2 ${tab === t ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {{ leadership: 'Leadership', pipeline: 'Pipeline Health', pm: 'By PM', funding_analytics: 'Funding', cycle: 'Cycle Times', dealers: 'Dealers' }[t]}
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

        {/* ── FUNDING ANALYTICS TAB ── */}
        {tab === 'funding_analytics' && (
          <div className="max-w-6xl space-y-8">
            {/* Key metrics */}
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Funding Overview</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Total Outstanding" value={fmt$(fundingAnalytics.totalOutstanding)} color="text-amber-400" />
                <MetricCard label="M2 Funded" value={`${fundingAnalytics.m2FundedCount}`} sub={`${fundingAnalytics.m2Pct}% · ${fundingAnalytics.m2UnfundedCount} unfunded`} color="text-green-400" />
                <MetricCard label="M3 Funded" value={`${fundingAnalytics.m3FundedCount}`} sub={`${fundingAnalytics.m3Pct}% · ${fundingAnalytics.m3UnfundedCount} unfunded`} color="text-green-400" />
                <MetricCard label="Avg Install→M2" value={fundingAnalytics.avgM2Days !== null ? `${fundingAnalytics.avgM2Days}d` : '—'} sub="days to fund" color="text-blue-400" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <MetricCard label="Avg PTO→M3" value={fundingAnalytics.avgM3Days !== null ? `${fundingAnalytics.avgM3Days}d` : '—'} sub="days to fund" color="text-blue-400" />
            </div>

            {/* Funding by financier */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Funded Amount by Financier</div>
              {fundingAnalytics.finFundingArr.length === 0 && <div className="text-xs text-gray-500">No funding data</div>}
              {fundingAnalytics.finFundingArr.map(f => (
                <div key={f.financier} className="flex items-center gap-3 py-1.5">
                  <div className="text-xs text-gray-400 w-32 flex-shrink-0 truncate">{f.financier}</div>
                  <div className="flex-1 bg-gray-700 rounded-full h-2">
                    <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(f.amount / fundingAnalytics.maxFinFunding * 100)}%` }} />
                  </div>
                  <div className="text-xs text-gray-300 font-mono w-24 text-right">{fmt$(f.amount)}</div>
                </div>
              ))}
            </div>

            {/* NF codes */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Nonfunded Code Frequency</div>
              {fundingAnalytics.nfCodesArr.length === 0 && <div className="text-xs text-gray-500">No nonfunded codes</div>}
              <div className="space-y-1">
                {fundingAnalytics.nfCodesArr.slice(0, 15).map(nf => (
                  <div key={nf.code} className="flex items-center gap-3 py-1">
                    <div className="text-xs text-gray-400 w-40 flex-shrink-0 truncate font-mono">{nf.code}</div>
                    <div className="flex-1 bg-gray-700 rounded-full h-2">
                      <div className="bg-red-500/70 h-2 rounded-full transition-all" style={{ width: `${Math.round(nf.count / (fundingAnalytics.nfCodesArr[0]?.count || 1) * 100)}%` }} />
                    </div>
                    <div className="text-xs text-gray-300 font-mono w-8 text-right">{nf.count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CYCLE TIMES TAB ── */}
        {tab === 'cycle' && (
          <div className="max-w-6xl space-y-8">
            {/* Median cycle times */}
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Median Cycle Times</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <MetricCard label="Sale → Install" value={cycleAnalytics.medianSaleToInstall !== null ? `${cycleAnalytics.medianSaleToInstall}d` : '—'} sub="median days" color="text-blue-400" />
                <MetricCard label="Sale → PTO" value={cycleAnalytics.medianSaleToPTO !== null ? `${cycleAnalytics.medianSaleToPTO}d` : '—'} sub="median days" color="text-blue-400" />
              </div>
            </div>

            {/* Avg days per stage */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Average Days in Stage (Active Projects)</div>
              {cycleAnalytics.stageAvgs.map(s => (
                <div key={s.stage} className="flex items-center gap-3 py-1.5">
                  <div className="text-xs text-gray-400 w-24 flex-shrink-0">{s.label}</div>
                  <div className="flex-1 bg-gray-700 rounded-full h-4 relative">
                    <div className={`h-4 rounded-full transition-all flex items-center justify-end pr-2 ${s.avg >= (SLA_THRESHOLDS[s.stage]?.crit ?? 999) ? 'bg-red-600' : s.avg >= (SLA_THRESHOLDS[s.stage]?.risk ?? 999) ? 'bg-amber-600' : 'bg-green-600'}`}
                      style={{ width: `${Math.max(s.avg / cycleAnalytics.maxStageAvg * 100, s.avg > 0 ? 5 : 0)}%` }}>
                      {s.avg > 0 && <span className="text-xs text-white font-bold">{s.avg}d</span>}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 font-mono w-16 text-right">{s.count} proj</div>
                </div>
              ))}
            </div>

            {/* Cycle time buckets */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Active Projects by Cycle Time</div>
                {cycleAnalytics.buckets.map(b => (
                  <div key={b.label} className="flex items-center gap-3 py-1.5">
                    <div className="text-xs text-gray-400 w-24 flex-shrink-0">{b.label}</div>
                    <div className="flex-1 bg-gray-700 rounded-full h-2">
                      <div className={`h-2 rounded-full transition-all ${b.min > 90 ? 'bg-red-500' : b.min > 60 ? 'bg-amber-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.round(b.count / cycleAnalytics.maxBucket * 100)}%` }} />
                    </div>
                    <div className="text-xs text-gray-300 font-mono w-8 text-right">{b.count}</div>
                  </div>
                ))}
              </div>

              {/* Where projects get stuck */}
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Where Projects Get Stuck</div>
                {cycleAnalytics.stuckByStage.length === 0 && <div className="text-xs text-gray-500">No blocked projects</div>}
                {cycleAnalytics.stuckByStage.map(s => (
                  <div key={s.stage} className="flex items-center gap-3 py-1.5">
                    <div className="text-xs text-gray-400 w-24 flex-shrink-0">{s.label}</div>
                    <div className="flex-1 bg-gray-700 rounded-full h-2">
                      <div className="bg-red-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(s.blocked / cycleAnalytics.maxStuck * 100)}%` }} />
                    </div>
                    <div className="text-xs text-red-400 font-mono w-8 text-right">{s.blocked}</div>
                    <div className="text-xs text-gray-500 font-mono w-16 text-right">/ {s.total}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Longest active projects */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Longest Active Projects</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    {['Project','Stage','PM','Cycle Days'].map(h => (
                      <th key={h} className="text-left text-gray-400 font-medium px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cycleAnalytics.longest.map(p => (
                    <tr key={p.id} className="border-b border-gray-800">
                      <td className="px-3 py-2 text-white font-medium">{p.name}</td>
                      <td className="px-3 py-2 text-gray-300">{p.stage}</td>
                      <td className="px-3 py-2 text-gray-400">{p.pm}</td>
                      <td className="px-3 py-2">
                        <span className={`font-mono ${p.days >= 120 ? 'text-red-400' : p.days >= 90 ? 'text-amber-400' : 'text-gray-300'}`}>{p.days}d</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DEALERS TAB ── */}
        {tab === 'dealers' && (
          <div className="max-w-6xl space-y-8">
            {/* Projects by dealer */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Projects by Dealer</div>
              {dealerAnalytics.dealers.slice(0, 20).map(d => (
                <div key={d.dealer} className="flex items-center gap-3 py-1.5">
                  <div className="text-xs text-gray-400 w-36 flex-shrink-0 truncate">{d.dealer}</div>
                  <div className="flex-1 bg-gray-700 rounded-full h-2">
                    <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(d.count / dealerAnalytics.maxDealerCount * 100)}%` }} />
                  </div>
                  <div className="text-xs text-gray-300 font-mono w-8 text-right">{d.count}</div>
                  <div className="text-xs text-gray-500 font-mono w-24 text-right">{fmt$(d.value)}</div>
                </div>
              ))}
            </div>

            {/* Dealer table with avg system size */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Dealer Details</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    {['Dealer','Projects','Contract Value','Avg System (kW)'].map(h => (
                      <th key={h} className="text-left text-gray-400 font-medium px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dealerAnalytics.dealers.slice(0, 20).map(d => (
                    <tr key={d.dealer} className="border-b border-gray-800 hover:bg-gray-700/30">
                      <td className="px-3 py-2 text-white font-medium truncate max-w-[200px]">{d.dealer}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{d.count}</td>
                      <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(d.value)}</td>
                      <td className="px-3 py-2 text-blue-400 font-mono">{d.avgKw > 0 ? `${d.avgKw} kW` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Consultants and Advisors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Projects by Consultant</div>
                {dealerAnalytics.consultants.length === 0 && <div className="text-xs text-gray-500">No consultant data</div>}
                {dealerAnalytics.consultants.slice(0, 15).map(c => (
                  <div key={c.name} className="flex items-center gap-3 py-1.5">
                    <div className="text-xs text-gray-400 w-32 flex-shrink-0 truncate">{c.name}</div>
                    <div className="flex-1 bg-gray-700 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(c.count / dealerAnalytics.maxConsultant * 100)}%` }} />
                    </div>
                    <div className="text-xs text-gray-300 font-mono w-8 text-right">{c.count}</div>
                  </div>
                ))}
              </div>

              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Projects by Advisor</div>
                {dealerAnalytics.advisors.length === 0 && <div className="text-xs text-gray-500">No advisor data</div>}
                {dealerAnalytics.advisors.slice(0, 15).map(a => (
                  <div key={a.name} className="flex items-center gap-3 py-1.5">
                    <div className="text-xs text-gray-400 w-32 flex-shrink-0 truncate">{a.name}</div>
                    <div className="flex-1 bg-gray-700 rounded-full h-2">
                      <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(a.count / dealerAnalytics.maxAdvisor * 100)}%` }} />
                    </div>
                    <div className="text-xs text-gray-300 font-mono w-8 text-right">{a.count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
