'use client'

import { useMemo, useState } from 'react'
import { daysAgo, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS } from '@/lib/utils'
import {
  MetricCard, ProjectListModal, ExportButton, downloadCSV,
  type AnalyticsData,
} from './shared'
import type { Project } from '@/types/database'

export function CycleTimes({ data }: { data: AnalyticsData }) {
  const { projects, active } = data
  const [drillDown, setDrillDown] = useState<{ title: string; projects: Project[] } | null>(null)

  const analytics = useMemo(() => {
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

    // Sale to install cycle days
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

    // Cycle time buckets
    const buckets = [
      { label: '0-60 days', min: 0, max: 60, count: 0, projects: [] as Project[] },
      { label: '61-90 days', min: 61, max: 90, count: 0, projects: [] as Project[] },
      { label: '91-120 days', min: 91, max: 120, count: 0, projects: [] as Project[] },
      { label: '120+ days', min: 121, max: Infinity, count: 0, projects: [] as Project[] },
    ]
    active.forEach(p => {
      const d = daysAgo(p.sale_date) || daysAgo(p.stage_date)
      for (const b of buckets) {
        if (d >= b.min && d <= b.max) { b.count++; b.projects.push(p); break }
      }
    })
    const maxBucket = Math.max(...buckets.map(b => b.count), 1)

    // Longest active projects (top 10)
    const longest = [...active]
      .map(p => ({ id: p.id, name: p.name ?? p.id, stage: STAGE_LABELS[p.stage], days: daysAgo(p.sale_date) || daysAgo(p.stage_date), pm: p.pm ?? '—' }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 10)

    // Where projects get stuck
    const stuckByStage = STAGE_ORDER.filter(s => s !== 'complete').map(s => {
      const stageProjects = active.filter(p => p.stage === s)
      const blockedProjects = stageProjects.filter(p => p.blocker)
      return { stage: s, label: STAGE_LABELS[s], blocked: blockedProjects.length, total: stageProjects.length, projects: blockedProjects }
    }).filter(s => s.blocked > 0).sort((a, b) => b.blocked - a.blocked)
    const maxStuck = Math.max(...stuckByStage.map(s => s.blocked), 1)

    return { stageAvgs, maxStageAvg, medianSaleToInstall, medianSaleToPTO, buckets, maxBucket, longest, stuckByStage, maxStuck }
  }, [projects, active])

  const handleExport = () => {
    const headers = ['Metric', 'Value']
    const rows: (string | number | null)[][] = [
      ['Median Sale to Install (days)', analytics.medianSaleToInstall],
      ['Median Sale to PTO (days)', analytics.medianSaleToPTO],
      ...analytics.stageAvgs.map(s => [`Avg days in ${s.label}`, s.avg] as [string, number]),
      ...analytics.buckets.map(b => [b.label, b.count] as [string, number]),
      ...analytics.longest.map(p => [p.name, p.days] as [string, number]),
    ]
    downloadCSV('cycle-times.csv', headers, rows)
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end"><ExportButton onClick={handleExport} /></div>

      {/* Median cycle times */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Median Cycle Times</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <MetricCard label="Sale -> Install" value={analytics.medianSaleToInstall !== null ? `${analytics.medianSaleToInstall}d` : '—'} sub="median days" color="text-blue-400" />
          <MetricCard label="Sale -> PTO" value={analytics.medianSaleToPTO !== null ? `${analytics.medianSaleToPTO}d` : '—'} sub="median days" color="text-blue-400" />
        </div>
      </div>

      {/* Avg days per stage */}
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Average Days in Stage (Active Projects)</div>
        {analytics.stageAvgs.map(s => (
          <div key={s.stage} className="flex items-center gap-3 py-1.5">
            <div className="text-xs text-gray-400 w-24 flex-shrink-0">{s.label}</div>
            <div className="flex-1 bg-gray-700 rounded-full h-4 relative">
              <div className={`h-4 rounded-full transition-all flex items-center justify-end pr-2 ${s.avg >= (SLA_THRESHOLDS[s.stage]?.crit ?? 999) ? 'bg-red-600' : s.avg >= (SLA_THRESHOLDS[s.stage]?.risk ?? 999) ? 'bg-amber-600' : 'bg-green-600'}`}
                style={{ width: `${Math.max(s.avg / analytics.maxStageAvg * 100, s.avg > 0 ? 5 : 0)}%` }}>
                {s.avg > 0 && <span className="text-xs text-white font-bold">{s.avg}d</span>}
              </div>
            </div>
            <div className="text-xs text-gray-500 font-mono w-16 text-right">{s.count} proj</div>
          </div>
        ))}
      </div>

      {/* Cycle time buckets + stuck */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Active Projects by Cycle Time</div>
          {analytics.buckets.map(b => (
            <div key={b.label} className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-gray-700/30 rounded"
              onClick={() => b.projects.length > 0 && setDrillDown({ title: `Cycle Time: ${b.label}`, projects: b.projects })}>
              <div className="text-xs text-gray-400 w-24 flex-shrink-0">{b.label}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div className={`h-2 rounded-full transition-all ${b.min > 90 ? 'bg-red-500' : b.min > 60 ? 'bg-amber-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.round(b.count / analytics.maxBucket * 100)}%` }} />
              </div>
              <div className="text-xs text-gray-300 font-mono w-8 text-right">{b.count}</div>
            </div>
          ))}
        </div>

        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Where Projects Get Stuck</div>
          {analytics.stuckByStage.length === 0 && <div className="text-xs text-gray-500">No blocked projects</div>}
          {analytics.stuckByStage.map(s => (
            <div key={s.stage} className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-gray-700/30 rounded"
              onClick={() => setDrillDown({ title: `Blocked in ${s.label}`, projects: s.projects })}>
              <div className="text-xs text-gray-400 w-24 flex-shrink-0">{s.label}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-2">
                <div className="bg-red-500 h-2 rounded-full transition-all" style={{ width: `${Math.round(s.blocked / analytics.maxStuck * 100)}%` }} />
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
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[400px]">
            <thead>
              <tr className="border-b border-gray-700">
                {['Project', 'Stage', 'PM', 'Cycle Days'].map(h => (
                  <th key={h} className="text-left text-gray-400 font-medium px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analytics.longest.map(p => (
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

      {drillDown && <ProjectListModal title={drillDown.title} projects={drillDown.projects} onClose={() => setDrillDown(null)} />}
    </div>
  )
}
