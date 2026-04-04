import React from 'react'
import { fmt$, cn } from '@/lib/utils'
import { READINESS_WEIGHTS } from '@/lib/api/ramp-planner'
import { Check, X } from 'lucide-react'
import type { RampProject, Tier } from './types'
import { TIER_COLORS, TIER_BG, TIER_TEXT } from './types'

interface ReadinessQueueTabProps {
  unscheduled: RampProject[]
  tierCounts: Record<Tier, { count: number; value: number }>
  tierFilter: Set<Tier>
  setTierFilter: React.Dispatch<React.SetStateAction<Set<Tier>>>
  queueSearch: string
  setQueueSearch: React.Dispatch<React.SetStateAction<string>>
  stageFilter: string
  setStageFilter: React.Dispatch<React.SetStateAction<string>>
  financierFilter: string
  setFinancierFilter: React.Dispatch<React.SetStateAction<string>>
  projects: RampProject[]
  handleReadinessToggle: (projectId: string, field: string, current: boolean) => Promise<void>
  openProject: (id: string) => Promise<void>
}

export function ReadinessQueueTab({
  unscheduled, tierCounts, tierFilter, setTierFilter,
  queueSearch, setQueueSearch, stageFilter, setStageFilter,
  financierFilter, setFinancierFilter, projects,
  handleReadinessToggle, openProject,
}: ReadinessQueueTabProps) {
  const filterProject = (p: RampProject) => {
    if (tierFilter.size > 0 && !tierFilter.has(p.tier)) return false
    if (stageFilter && p.stage !== stageFilter) return false
    if (financierFilter && p.financier !== financierFilter) return false
    if (queueSearch) {
      const q = queueSearch.toLowerCase()
      if (!p.name.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q) && !(p.city ?? '').toLowerCase().includes(q)) return false
    }
    return true
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <input value={queueSearch} onChange={e => setQueueSearch(e.target.value)}
            placeholder="Search name, city, project ID..."
            className="w-full pl-3 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-white placeholder-gray-500 focus:outline-none focus:border-green-500" />
        </div>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-[10px] text-white">
          <option value="">All Stages</option>
          {['evaluation', 'survey', 'design', 'permit', 'install', 'inspection'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select value={financierFilter} onChange={e => setFinancierFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-[10px] text-white">
          <option value="">All Financiers</option>
          {[...new Set(projects.map(p => p.financier).filter(Boolean))].sort().map(f => (
            <option key={f} value={f!}>{f}</option>
          ))}
        </select>
        <div className="flex gap-1">
          {([1, 2, 3, 4] as Tier[]).map(t => (
            <button key={t} onClick={() => setTierFilter(prev => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next })}
              className={cn('text-[10px] px-2 py-1 rounded border', tierFilter.has(t) ? `${TIER_BG[t]} ${TIER_TEXT[t]} ${TIER_COLORS[t]}` : 'border-gray-700 text-gray-500')}>
              T{t} ({tierCounts[t].count})
            </button>
          ))}
          {(tierFilter.size > 0 || stageFilter || financierFilter) && <button onClick={() => { setTierFilter(new Set()); setStageFilter(''); setFinancierFilter('') }} className="text-[10px] text-gray-400 ml-1">Clear</button>}
        </div>
        <span className="text-[10px] text-gray-500 ml-auto">
          {unscheduled.filter(filterProject).length} projects
        </span>
      </div>
      {unscheduled.filter(filterProject).map(p => (
        <div key={p.id} className="bg-gray-800 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <button onClick={() => openProject(p.id)} className="text-sm font-medium text-white hover:text-green-400">{p.name}</button>
              <span className="text-[10px] text-green-400 font-mono ml-2">{p.id}</span>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-green-400">{p.priorityScore}</div>
              <div className="text-[9px] text-gray-500">priority score</div>
            </div>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">
            <span className="capitalize text-gray-300">{p.stage}</span> · {p.city} · {p.distanceMiles}mi · {p.systemkw}kW · {fmt$(Number(p.contract) || 0)} · {p.financier ?? '—'} · AHJ: {p.ahj}
          </div>
          {/* Readiness checklist */}
          <div className="flex flex-wrap gap-2 mt-2">
            {READINESS_WEIGHTS.map(item => {
              const checked = p.readiness ? (p.readiness as unknown as Record<string, boolean | undefined>)[item.field] === true : false
              return (
                <button key={item.field} onClick={(e) => { e.stopPropagation(); handleReadinessToggle(p.id, item.field, checked) }}
                  className={cn('text-[10px] px-2 py-0.5 rounded border transition-colors',
                    checked ? 'bg-green-900/40 border-green-700 text-green-400' : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300')}>
                  {checked ? <Check className="w-2.5 h-2.5 inline mr-0.5" /> : <X className="w-2.5 h-2.5 inline mr-0.5 opacity-30" />}
                  {item.label} <span className="text-[8px] opacity-60">({item.weight}pt)</span>
                </button>
              )
            })}
            {/* Readiness bar */}
            <div className="ml-auto flex items-center gap-2">
              <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${p.readinessScore}%`, backgroundColor: p.readinessScore >= 80 ? '#22c55e' : p.readinessScore >= 50 ? '#f59e0b' : '#ef4444' }} />
              </div>
              <span className={cn('text-[10px] font-bold', p.readinessScore >= 80 ? 'text-green-400' : p.readinessScore >= 50 ? 'text-amber-400' : 'text-red-400')}>{p.readinessScore}/100</span>
            </div>
          </div>
        </div>
      ))}
      {unscheduled.filter(p => p.tier === 1).length === 0 && (
        <div className="text-center py-12 text-gray-500 text-sm">All Tier 1 projects are scheduled.</div>
      )}
    </div>
  )
}
