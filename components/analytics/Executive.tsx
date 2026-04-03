'use client'

import { useMemo } from 'react'
import { fmt$, daysAgo, STAGE_LABELS } from '@/lib/utils'
import { MetricCard, inRange, STAGE_DAYS_REMAINING, type AnalyticsData } from './shared'

export function Executive({ data }: { data: AnalyticsData }) {
  const { projects, active, complete, funding, period } = data

  // Period metrics
  const metrics = useMemo(() => {
    const sales = projects.filter(p => inRange(p.sale_date, period))
    const installs = projects.filter(p => inRange(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null), period))
    const m2Funded = projects.filter(p => { const f = funding[p.id]; return f && inRange(f.m2_funded_date, period) })
    const m3Funded = projects.filter(p => { const f = funding[p.id]; return f && inRange(f.m3_funded_date, period) })

    const totalPortfolio = active.reduce((s, p) => s + (Number(p.contract) || 0), 0)
    const m2Val = m2Funded.reduce((s, p) => { const f = funding[p.id]; return s + (Number(f?.m2_amount) || 0) }, 0)
    const m3Val = m3Funded.reduce((s, p) => { const f = funding[p.id]; return s + (Number(f?.m3_amount) || 0) }, 0)

    // Cash collectable now
    let m1Collectable = 0, m2Collectable = 0, m3Collectable = 0
    let m1Count = 0, m2Count = 0, m3Count = 0
    for (const p of projects) {
      const f = funding[p.id]
      if (p.sale_date && (!f || f.m1_status !== 'Funded') && f?.m1_status !== 'Submitted') { m1Collectable += Number(f?.m1_amount ?? 0); m1Count++ }
      if (p.install_complete_date && f && f.m2_status !== 'Funded' && f.m2_status !== 'Submitted') { m2Collectable += Number(f.m2_amount ?? 0); m2Count++ }
      if (p.pto_date && f && f.m3_status !== 'Funded' && f.m3_status !== 'Submitted') { m3Collectable += Number(f.m3_amount ?? 0); m3Count++ }
    }

    // Revenue collected this period
    const revenueCollected = m2Val + m3Val

    // Avg cycle time (sale to install for completed installs)
    const withInstall = projects.filter(p => p.sale_date && p.install_complete_date)
    const avgCycle = withInstall.length > 0
      ? Math.round(withInstall.reduce((s, p) => {
          const sale = new Date(p.sale_date! + 'T00:00:00').getTime()
          const inst = new Date(p.install_complete_date! + 'T00:00:00').getTime()
          return s + (inst - sale) / 86400000
        }, 0) / withInstall.length)
      : 0

    // Blocked projects + value at risk
    const blocked = active.filter(p => p.blocker)
    const atRisk = blocked.reduce((s, p) => s + (Number(p.contract) || 0), 0)

    // Forecast
    const next30 = active.filter(p => (STAGE_DAYS_REMAINING[p.stage] ?? 60) <= 30)
    const next30Value = next30.reduce((s, p) => s + (Number(p.contract) || 0), 0)
    const next90 = active.filter(p => (STAGE_DAYS_REMAINING[p.stage] ?? 60) <= 90)
    const next90Value = next90.reduce((s, p) => s + (Number(p.contract) || 0), 0)

    // Pipeline by stage
    const stageBreakdown = ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete'].map(stage => {
      const ps = projects.filter(p => p.stage === stage)
      return {
        stage,
        label: STAGE_LABELS[stage] ?? stage,
        count: ps.length,
        value: ps.reduce((s, p) => s + (Number(p.contract) || 0), 0),
        blockedCount: ps.filter(p => p.blocker).length,
        avgDays: ps.length > 0 ? Math.round(ps.reduce((s, p) => s + daysAgo(p.stage_date), 0) / ps.length) : 0,
      }
    }).filter(s => s.count > 0)
    const maxStageCount = Math.max(...stageBreakdown.map(s => s.count), 1)

    return {
      sales, installs, totalPortfolio,
      revenueCollected, m2Val, m3Val,
      cashCollectable: m1Collectable + m2Collectable + m3Collectable,
      m1Collectable, m2Collectable, m3Collectable,
      m1Count, m2Count, m3Count,
      avgCycle, blocked, atRisk,
      next30, next30Value, next90, next90Value,
      stageBreakdown, maxStageCount,
    }
  }, [projects, active, funding, period])

  const STAGE_COLORS: Record<string, string> = {
    evaluation: '#3b82f6', survey: '#8b5cf6', design: '#ec4899',
    permit: '#f59e0b', install: '#f97316', inspection: '#06b6d4', complete: '#22c55e',
  }

  return (
    <div className="max-w-6xl space-y-8">

      {/* Hero: 5 headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Portfolio" value={fmt$(metrics.totalPortfolio)} sub={`${active.length} active projects`}
          formula="SUM of contract values for all active projects (non-cancelled, non-in-service, non-loyalty). Excludes completed projects." />
        <MetricCard label="Cash Collectable" value={fmt$(metrics.cashCollectable)} sub={`${metrics.m1Count + metrics.m2Count + metrics.m3Count} milestones`} color="text-green-400"
          formula={`M1: Projects with sale_date, M1 not yet funded or submitted (${metrics.m1Count} × ${fmt$(metrics.m1Collectable)})\nM2: Projects with install complete, M2 not funded/submitted (${metrics.m2Count} × ${fmt$(metrics.m2Collectable)})\nM3: Projects with PTO date, M3 not funded/submitted (${metrics.m3Count} × ${fmt$(metrics.m3Collectable)})`} />
        <MetricCard label="Revenue Collected" value={fmt$(metrics.revenueCollected)} sub="M2 + M3 this period" color="text-blue-400"
          formula={`SUM of M2 amounts where m2_funded_date falls in selected period (${fmt$(metrics.m2Val)})\n+ SUM of M3 amounts where m3_funded_date falls in selected period (${fmt$(metrics.m3Val)})\n\nOnly counts milestones actually marked as funded with a date in the period.`} />
        <MetricCard label="Avg Cycle Time" value={`${metrics.avgCycle}d`} sub="Sale → Install" color={metrics.avgCycle > 60 ? 'text-amber-400' : 'text-green-400'}
          formula="Average days between sale_date and install_complete_date for all projects that have both dates. Projects still in progress are excluded. Target: <45 days." />
        <MetricCard label="90-Day Forecast" value={fmt$(metrics.next90Value)} sub={`${metrics.next90.length} projects`} color="text-purple-400"
          formula={`Projects where estimated days-to-completion ≤ 90 based on stage:\n• Evaluation: 56 days remaining\n• Survey: 50 days\n• Design: 44 days\n• Permit: 31 days\n• Install: 10 days\n• Inspection: 17 days\n\nSUM of contract values for qualifying projects.`} />
      </div>

      {/* Cash collectable breakdown */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Cash Collectable Now</div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-1">M1 — Contract Signed</div>
            <div className="text-2xl font-bold text-blue-400 font-mono">{fmt$(metrics.m1Collectable)}</div>
            <div className="text-xs text-gray-600">{metrics.m1Count} projects</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-1">M2 — Install Complete</div>
            <div className="text-2xl font-bold text-amber-400 font-mono">{fmt$(metrics.m2Collectable)}</div>
            <div className="text-xs text-gray-600">{metrics.m2Count} projects</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-gray-500 mb-1">M3 — PTO Received</div>
            <div className="text-2xl font-bold text-purple-400 font-mono">{fmt$(metrics.m3Collectable)}</div>
            <div className="text-xs text-gray-600">{metrics.m3Count} projects</div>
          </div>
        </div>
      </div>

      {/* Risk + bottleneck */}
      {metrics.blocked.length > 0 && (
        <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-red-400 font-semibold uppercase tracking-wider">Revenue at Risk</div>
            <div className="text-2xl font-bold text-red-400 font-mono">{fmt$(metrics.atRisk)}</div>
          </div>
          <div className="text-sm text-gray-300">{metrics.blocked.length} projects blocked — {fmt$(metrics.atRisk)} in contract value waiting on resolution</div>
        </div>
      )}

      {/* Pipeline funnel */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Pipeline by Stage</div>
        <div className="space-y-2">
          {metrics.stageBreakdown.map(s => (
            <div key={s.stage} className="flex items-center gap-3">
              <div className="w-24 text-right flex-shrink-0">
                <div className="text-xs font-medium" style={{ color: STAGE_COLORS[s.stage] }}>{s.label}</div>
              </div>
              <div className="flex-1">
                <div className="h-8 rounded-lg bg-gray-700/50 overflow-hidden">
                  <div className="h-full rounded-lg flex items-center justify-between px-3"
                    style={{ width: `${Math.max((s.count / metrics.maxStageCount) * 100, 12)}%`, backgroundColor: `${STAGE_COLORS[s.stage]}15`, borderLeft: `3px solid ${STAGE_COLORS[s.stage]}` }}>
                    <span className="text-xs font-bold text-white">{s.count}</span>
                    <span className="text-xs text-gray-400 font-mono hidden sm:inline">{fmt$(s.value)}</span>
                  </div>
                </div>
              </div>
              <div className="w-20 text-right flex-shrink-0">
                <div className="text-xs text-gray-500">avg {s.avgDays}d</div>
                {s.blockedCount > 0 && <div className="text-[10px] text-red-400">{s.blockedCount} blocked</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
