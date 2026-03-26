'use client'

import { useMemo, useState } from 'react'
import { fmt$ } from '@/lib/utils'
import {
  MetricCard, ProjectListModal, ExportButton, downloadCSV,
  type AnalyticsData,
} from './shared'
import type { Project } from '@/types/database'

export function FundingTab({ data }: { data: AnalyticsData }) {
  const { projects, funding } = data
  const [drillDown, setDrillDown] = useState<{ title: string; projects: Project[] } | null>(null)

  const analytics = useMemo(() => {
    const allFunding = Object.values(funding)
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

    // M2 funded project IDs for drill-down
    const m2FundedIds = new Set(allFunding.filter(f => f.m2_funded_date).map(f => f.project_id))
    const m3FundedIds = new Set(allFunding.filter(f => f.m3_funded_date).map(f => f.project_id))
    const m2UnfundedIds = new Set(allFunding.filter(f => !f.m2_funded_date).map(f => f.project_id))
    const m3UnfundedIds = new Set(allFunding.filter(f => !f.m3_funded_date).map(f => f.project_id))

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

    return {
      totalOutstanding, m2FundedCount, m2UnfundedCount, m2Pct, m3FundedCount, m3UnfundedCount, m3Pct,
      avgM2Days, avgM3Days, finFundingArr, maxFinFunding, nfCodesArr,
      m2FundedIds, m3FundedIds, m2UnfundedIds, m3UnfundedIds,
    }
  }, [projects, funding])

  const handleExport = () => {
    const headers = ['Metric', 'Value']
    const rows: (string | number | null)[][] = [
      ['Total Outstanding', analytics.totalOutstanding],
      ['M2 Funded Count', analytics.m2FundedCount],
      ['M2 Funded %', analytics.m2Pct],
      ['M3 Funded Count', analytics.m3FundedCount],
      ['M3 Funded %', analytics.m3Pct],
      ['Avg Install to M2 (days)', analytics.avgM2Days],
      ['Avg PTO to M3 (days)', analytics.avgM3Days],
      ...analytics.finFundingArr.map(f => [f.financier, f.amount] as [string, number]),
      ...analytics.nfCodesArr.map(nf => [`NF: ${nf.code}`, nf.count] as [string, number]),
    ]
    downloadCSV('funding-analytics.csv', headers, rows)
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div className="flex justify-end"><ExportButton onClick={handleExport} /></div>

      {/* Key metrics */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Funding Overview</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Total Outstanding" value={fmt$(analytics.totalOutstanding)} color="text-amber-400" />
          <MetricCard label="M2 Funded" value={`${analytics.m2FundedCount}`}
            sub={`${analytics.m2Pct}% · ${analytics.m2UnfundedCount} unfunded`} color="text-green-400"
            onClick={() => setDrillDown({ title: 'M2 Funded Projects', projects: projects.filter(p => analytics.m2FundedIds.has(p.id)) })} />
          <MetricCard label="M3 Funded" value={`${analytics.m3FundedCount}`}
            sub={`${analytics.m3Pct}% · ${analytics.m3UnfundedCount} unfunded`} color="text-green-400"
            onClick={() => setDrillDown({ title: 'M3 Funded Projects', projects: projects.filter(p => analytics.m3FundedIds.has(p.id)) })} />
          <MetricCard label="Avg Install->M2" value={analytics.avgM2Days !== null ? `${analytics.avgM2Days}d` : '—'} sub="days to fund" color="text-blue-400" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MetricCard label="Avg PTO->M3" value={analytics.avgM3Days !== null ? `${analytics.avgM3Days}d` : '—'} sub="days to fund" color="text-blue-400" />
      </div>

      {/* Funding by financier */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Funded Amount by Financier</div>
        {analytics.finFundingArr.length === 0 && <div className="text-xs text-gray-500">No funding data</div>}
        {analytics.finFundingArr.map(f => (
          <div key={f.financier} className="flex items-center gap-3 py-1.5">
            <div className="text-xs text-gray-400 w-32 flex-shrink-0 truncate">{f.financier}</div>
            <div className="flex-1 bg-gray-700 rounded-full h-2">
              <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(f.amount / analytics.maxFinFunding * 100)}%` }} />
            </div>
            <div className="text-xs text-gray-300 font-mono w-24 text-right">{fmt$(f.amount)}</div>
          </div>
        ))}
      </div>

      {/* NF codes */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Nonfunded Code Frequency</div>
        {analytics.nfCodesArr.length === 0 && <div className="text-xs text-gray-500">No nonfunded codes</div>}
        <div className="space-y-1">
          {analytics.nfCodesArr.slice(0, 15).map(nf => (
            <div key={nf.code} className="flex items-center gap-3 py-1">
              <div className="text-xs text-gray-400 w-40 flex-shrink-0 truncate font-mono">{nf.code}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div className="bg-red-500/70 h-2 rounded-full transition-all" style={{ width: `${Math.round(nf.count / (analytics.nfCodesArr[0]?.count || 1) * 100)}%` }} />
              </div>
              <div className="text-xs text-gray-300 font-mono w-8 text-right">{nf.count}</div>
            </div>
          ))}
        </div>
      </div>

      {drillDown && <ProjectListModal title={drillDown.title} projects={drillDown.projects} onClose={() => setDrillDown(null)} />}
    </div>
  )
}
