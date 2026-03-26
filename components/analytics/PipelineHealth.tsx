'use client'

import { useMemo, useState } from 'react'
import { fmt$, daysAgo, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS } from '@/lib/utils'
import {
  MetricCard, MiniBar, ProjectListModal, ExportButton, downloadCSV,
  STAGE_DAYS_REMAINING, type AnalyticsData,
} from './shared'

export function PipelineHealth({ data }: { data: AnalyticsData }) {
  const { projects, active } = data
  const [drillDown, setDrillDown] = useState<{ title: string; projects: typeof projects } | null>(null)

  // Stage distribution
  const stageDist = useMemo(() => STAGE_ORDER.filter(s => s !== 'complete').map(s => ({
    stage: s,
    label: STAGE_LABELS[s],
    count: active.filter(p => p.stage === s).length,
    value: active.filter(p => p.stage === s).reduce((sum, p) => sum + (Number(p.contract) || 0), 0),
  })), [active])
  const maxStageCount = useMemo(() => Math.max(...stageDist.map(s => s.count), 1), [stageDist])

  // Forecast buckets
  const next30 = useMemo(() => active.filter(p => (STAGE_DAYS_REMAINING[p.stage] ?? 60) <= 30), [active])
  const next60 = useMemo(() => active.filter(p => { const d = STAGE_DAYS_REMAINING[p.stage] ?? 60; return d > 30 && d <= 60 }), [active])
  const next90 = useMemo(() => active.filter(p => { const d = STAGE_DAYS_REMAINING[p.stage] ?? 60; return d > 60 && d <= 90 }), [active])

  // SLA buckets
  const slaGroups = useMemo(() => {
    const crit = active.filter(p => {
      const t = SLA_THRESHOLDS[p.stage] ?? { crit: 7, risk: 5 }
      return daysAgo(p.stage_date) >= t.crit
    })
    const risk = active.filter(p => {
      const t = SLA_THRESHOLDS[p.stage] ?? { crit: 7, risk: 5 }
      const d = daysAgo(p.stage_date)
      return d >= t.risk && d < t.crit
    })
    const ok = active.filter(p => {
      const t = SLA_THRESHOLDS[p.stage] ?? { crit: 7, risk: 5 }
      return daysAgo(p.stage_date) < t.risk
    })
    return { crit, risk, ok }
  }, [active])

  const blocked = useMemo(() => active.filter(p => p.blocker), [active])
  const aging90 = useMemo(() => projects.filter(p => p.stage !== 'complete' && (daysAgo(p.sale_date) || 0) >= 90), [projects])
  const aging120 = useMemo(() => projects.filter(p => p.stage !== 'complete' && (daysAgo(p.sale_date) || 0) >= 120), [projects])

  const handleExport = () => {
    const headers = ['Stage', 'Count', 'Value']
    const rows = [
      ...stageDist.map(s => [s.label, s.count, s.value]),
      ['Forecast 30d', next30.length, next30.reduce((s, p) => s + (Number(p.contract) || 0), 0)],
      ['Forecast 31-60d', next60.length, next60.reduce((s, p) => s + (Number(p.contract) || 0), 0)],
      ['Forecast 61-90d', next90.length, next90.reduce((s, p) => s + (Number(p.contract) || 0), 0)],
      ['Critical SLA', slaGroups.crit.length, ''],
      ['At Risk SLA', slaGroups.risk.length, ''],
      ['On Track SLA', slaGroups.ok.length, ''],
      ['Blocked', blocked.length, ''],
      ['90+ day cycle', aging90.length, ''],
      ['120+ day cycle', aging120.length, ''],
    ] as (string | number | null)[][]
    downloadCSV('pipeline-health.csv', headers, rows)
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex justify-end"><ExportButton onClick={handleExport} /></div>

      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-4">Stage Distribution</div>
        {stageDist.map(s => (
          <MiniBar key={s.stage} label={s.label} count={s.count} value={s.value} max={maxStageCount} />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-3">90-Day Forecast</div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: 'Forecast: Next 30 Days', projects: next30 })}>
              <span className="text-gray-400">Next 30 days</span>
              <span className="text-green-400 font-mono">{next30.length} · {fmt$(next30.reduce((s, p) => s + (Number(p.contract) || 0), 0))}</span>
            </div>
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: 'Forecast: 31-60 Days', projects: next60 })}>
              <span className="text-gray-400">31-60 days</span>
              <span className="text-gray-300 font-mono">{next60.length} · {fmt$(next60.reduce((s, p) => s + (Number(p.contract) || 0), 0))}</span>
            </div>
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: 'Forecast: 61-90 Days', projects: next90 })}>
              <span className="text-gray-400">61-90 days</span>
              <span className="text-gray-500 font-mono">{next90.length} · {fmt$(next90.reduce((s, p) => s + (Number(p.contract) || 0), 0))}</span>
            </div>
          </div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-3">SLA Health</div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: 'SLA Critical', projects: slaGroups.crit })}>
              <span className="text-red-400">Critical</span>
              <span className="text-gray-300 font-mono">{slaGroups.crit.length}</span>
            </div>
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: 'SLA At Risk', projects: slaGroups.risk })}>
              <span className="text-amber-400">At Risk</span>
              <span className="text-gray-300 font-mono">{slaGroups.risk.length}</span>
            </div>
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: 'SLA On Track', projects: slaGroups.ok })}>
              <span className="text-green-400">On Track</span>
              <span className="text-gray-300 font-mono">{slaGroups.ok.length}</span>
            </div>
          </div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="text-xs text-gray-400 mb-3">Blocked / Aging</div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: 'Blocked Projects', projects: blocked })}>
              <span className="text-red-400">Blocked</span>
              <span className="text-gray-300 font-mono">{blocked.length}</span>
            </div>
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: '90+ Day Cycle', projects: aging90 })}>
              <span className="text-amber-400">90+ day cycle</span>
              <span className="text-gray-300 font-mono">{aging90.length}</span>
            </div>
            <div className="flex justify-between text-xs cursor-pointer hover:bg-gray-700/30 rounded px-1 -mx-1"
              onClick={() => setDrillDown({ title: '120+ Day Cycle', projects: aging120 })}>
              <span className="text-amber-400">120+ day cycle</span>
              <span className="text-gray-300 font-mono">{aging120.length}</span>
            </div>
          </div>
        </div>
      </div>

      {drillDown && <ProjectListModal title={drillDown.title} projects={drillDown.projects} onClose={() => setDrillDown(null)} />}
    </div>
  )
}
