'use client'

import { useMemo } from 'react'
import {
  ClipboardCheck, CheckCircle2, ChevronDown, ChevronRight,
  Columns2, RotateCcw,
} from 'lucide-react'
import type { TestPlan, TestCase, TestResult } from '../types'
import { STATUS_META, PRIORITY_META } from '../types'

interface TestCardProps {
  plan: TestPlan
  planCases: TestCase[]
  resultMap: Map<string, TestResult>
  isExpanded: boolean
  onToggle: () => void
  selectedCaseId: string | null
  onSelectCase: (tc: TestCase) => void
  viewMode: 'my' | 'all'
  assignments: Set<string>
  celebrating: boolean
}

export function TestCard({
  plan, planCases, resultMap, isExpanded, onToggle,
  selectedCaseId, onSelectCase, viewMode, assignments, celebrating,
}: TestCardProps) {
  const visibleCases = useMemo(() =>
    planCases.filter(c => viewMode === 'all' || assignments.has(c.id)),
    [planCases, viewMode, assignments]
  )

  const stats = useMemo(() => {
    const total = visibleCases.length
    let completed = 0
    visibleCases.forEach(c => {
      const r = resultMap.get(c.id)
      if (r && r.status !== 'pending') completed++
    })
    const status = total === 0 ? 'not_started' : completed === 0 ? 'not_started' : completed >= total ? 'complete' : 'in_progress'
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, status, pct }
  }, [visibleCases, resultMap])

  if (visibleCases.length === 0) return null

  const statusBadge = stats.status === 'complete'
    ? { label: 'Complete', cls: 'bg-emerald-500/10 text-emerald-500' }
    : stats.status === 'in_progress'
    ? { label: 'In Progress', cls: 'bg-green-500/10 text-green-400' }
    : { label: 'Not Started', cls: 'bg-gray-700 text-gray-500' }

  return (
    <div className={`bg-gray-800 rounded-xl border transition-all ${
      isExpanded ? 'border-green-500/30 lg:col-span-2' : 'border-gray-700 hover:border-green-500/20'
    } ${celebrating ? 'ring-2 ring-emerald-500/40' : ''}`}>
      {/* Plan header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
          stats.status === 'complete' ? 'bg-emerald-500/10' : 'bg-green-500/10'
        }`}>
          {stats.status === 'complete'
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            : <ClipboardCheck className="w-4 h-4 text-green-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-white truncate">{plan.name}</h3>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          </div>
          {plan.description && (
            <p className="text-xs text-gray-500 truncate">{plan.description}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  stats.status === 'complete' ? 'bg-emerald-500' : 'bg-green-500'
                }`}
                style={{ width: `${stats.pct}%` }}
              />
            </div>
            <span className="text-[11px] text-gray-500 font-medium tabular-nums">
              {stats.completed}/{stats.total}
            </span>
          </div>
        </div>
        {isExpanded
          ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />}
      </button>

      {/* Expanded case list */}
      {isExpanded && (
        <div className="border-t border-gray-700">
          {visibleCases
            .sort((a, b) => {
              const aRetest = resultMap.get(a.id)?.needs_retest ? 1 : 0
              const bRetest = resultMap.get(b.id)?.needs_retest ? 1 : 0
              return bRetest - aRetest
            })
            .map(tc => {
              const result = resultMap.get(tc.id)
              const s = result?.status ?? 'pending'
              const meta = STATUS_META[s]
              const Icon = meta.icon
              const prioMeta = PRIORITY_META[tc.priority] ?? PRIORITY_META.medium
              const isSelected = selectedCaseId === tc.id
              const needsRetest = result?.needs_retest === true

              return (
                <button
                  key={tc.id}
                  onClick={() => onSelectCase(tc)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left border-b border-gray-700/50 last:border-b-0 transition-colors ${
                    isSelected ? 'bg-green-500/5' : 'hover:bg-gray-750'
                  } ${needsRetest ? 'bg-orange-500/5' : ''}`}
                >
                  {needsRetest ? (
                    <span className="relative flex-shrink-0">
                      <RotateCcw className="w-4 h-4 text-orange-500" />
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                    </span>
                  ) : (
                    <Icon className={`w-4 h-4 flex-shrink-0 ${meta.color}`} />
                  )}
                  <span className="flex-1 text-sm text-white truncate">{tc.title}</span>
                  {needsRetest && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 border border-orange-500/20 flex-shrink-0">
                      Re-test needed
                    </span>
                  )}
                  {tc.page_url && (
                    <Columns2 className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  )}
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${prioMeta.cls}`}>
                    {prioMeta.label}
                  </span>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}
