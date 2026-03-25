'use client'

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Nav } from '@/components/Nav'
import { daysAgo, fmt$, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { useSupabaseQuery, useServerFilter, clearQueryCache } from '@/lib/hooks'
import { createClient } from '@/lib/supabase/client'
import { updateProject } from '@/lib/api/projects'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { BulkActionBar, useBulkSelect, SelectCheckbox } from '@/components/BulkActionBar'
import { ArrowRight, Loader2 } from 'lucide-react'
import type { Project } from '@/types/database'

const PROJECT_COLUMNS = 'id, name, city, address, pm, pm_id, stage, stage_date, sale_date, contract, blocker, systemkw, financier, ahj, utility, disposition'

const SEARCH_FIELDS = ['name', 'id', 'city', 'address']

const DROPDOWN_CONFIG = {
  pm: 'pm_id|pm',
  financier: 'financier',
  ahj: 'ahj',
  utility: 'utility',
}

function getSLA(p: Project) {
  const t = SLA_THRESHOLDS[p.stage] ?? { target: 3, risk: 5, crit: 7 }
  const days = daysAgo(p.stage_date)
  let status: 'ok' | 'warn' | 'risk' | 'crit' = 'ok'
  if (days >= t.crit) status = 'crit'
  else if (days >= t.risk) status = 'risk'
  else if (days >= t.target) status = 'warn'
  return { days, status, pct: Math.min(100, Math.round(days / t.crit * 100)) }
}

const AGE_COLOR: Record<string, string> = {
  crit: '#ef4444',
  risk: '#f59e0b',
  warn: '#eab308',
  ok:   '#22c55e',
}


/** Multi-select dropdown for AHJ/Utility filters */
function MultiSelect({ label, options, selected, onChange }: {
  label: string
  options: { value: string; label: string }[]
  selected: string  // comma-separated
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selectedSet = useMemo(() => new Set(selected ? selected.split(',') : []), [selected])
  const count = selectedSet.size

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function toggle(value: string) {
    const next = new Set(selectedSet)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(Array.from(next).join(','))
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5 hover:border-gray-600 transition-colors"
      >
        {count ? `${label} (${count})` : `All ${label}s`}
        <span className="ml-1 text-gray-500">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto min-w-[200px]">
          {count > 0 && (
            <button
              onClick={() => onChange('')}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-700 border-b border-gray-700"
            >
              Clear all
            </button>
          )}
          {options.map(o => (
            <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedSet.has(o.value)}
                onChange={() => toggle(o.value)}
                className="rounded border-gray-600 bg-gray-900 text-green-500 focus:ring-green-500 focus:ring-offset-0"
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PipelinePage() {
  const [selected, setSelected] = useState<Project | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [sort, setSort] = useState<'name' | 'sla' | 'contract' | 'cycle'>('sla')

  const { user: currentUser } = useCurrentUser()

  // Advance stage progress (Pipeline-specific)
  const [advanceProgress, setAdvanceProgress] = useState<{ current: number; total: number } | null>(null)
  const [advanceConfirm, setAdvanceConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)

  // Search + filter state (client-side)
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const setFilter = useCallback((name: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [name]: value }))
  }, [])

  // Load all projects once (server-side disposition filter only)
  const {
    data: allProjects, loading, refresh,
  } = useSupabaseQuery('projects', {
    select: PROJECT_COLUMNS,
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled'] as (string | number)[] } },
    limit: 5000,
  })

  // Extract dropdown options from loaded data
  const { dropdowns: extractedDropdowns } = useServerFilter(
    allProjects as unknown as Record<string, unknown>[],
    { extractDropdowns: DROPDOWN_CONFIG }
  )

  // Client-side filtering (search + dropdowns) — no server re-fetch
  const projects = useMemo(() => {
    let result = allProjects as unknown as Project[]
    if (!result) return []

    // Search filter
    const q = search.trim().toLowerCase()
    if (q) {
      result = result.filter(p => {
        const fields = [p.name, p.id, p.city, p.address, p.financier, p.ahj].map(f => (f ?? '').toLowerCase())
        return fields.some(f => f.includes(q))
      })
    }

    // Dropdown filters
    if (filterValues.pm) result = result.filter(p => p.pm_id === filterValues.pm)
    if (filterValues.financier) result = result.filter(p => p.financier === filterValues.financier)
    // Multi-select: AHJ and Utility (comma-separated values)
    if (filterValues.ahj) {
      const selected = new Set(filterValues.ahj.split(','))
      result = result.filter(p => selected.has(p.ahj ?? ''))
    }
    if (filterValues.utility) {
      const selected = new Set(filterValues.utility.split(','))
      result = result.filter(p => selected.has(p.utility ?? ''))
    }

    return result
  }, [allProjects, search, filterValues])

  // Use extracted dropdowns (from data) for the select options
  const pms = extractedDropdowns.pm ?? []
  const financiers = extractedDropdowns.financier ?? []
  const ahjs = extractedDropdowns.ahj ?? []
  const utilities = extractedDropdowns.utility ?? []

  // Auto-open project from URL params (e.g., /pipeline?open=PROJ-28517&tab=notes)
  const [initialTab, setInitialTab] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const openId = params.get('open')
    const searchQ = params.get('search')
    const tab = params.get('tab')
    if (openId && projects.length > 0) {
      const proj = (projects as unknown as Project[]).find(p => p.id === openId)
      if (proj) { setSelected(proj); if (tab) setInitialTab(tab) }
    }
    if (searchQ && !search) setSearch(searchQ)
  }, [projects])

  // Sort within each column — memoized per stage
  const sortedByStage = useMemo(() => {
    const map: Record<string, Project[]> = {}
    for (const stageId of STAGE_ORDER) {
      const cards = projects.filter(p => p.stage === stageId)
      map[stageId] = [...cards].sort((a, b) => {
        if (sort === 'sla') return getSLA(b).days - getSLA(a).days
        if (sort === 'contract') return (Number(b.contract) || 0) - (Number(a.contract) || 0)
        if (sort === 'cycle') return (daysAgo(b.sale_date) || 0) - (daysAgo(a.sale_date) || 0)
        return (a.name ?? '').localeCompare(b.name ?? '')
      })
    }
    return map
  }, [projects, sort])

  const totalContract = useMemo(() => projects.reduce((s, p) => s + (Number(p.contract) || 0), 0), [projects])

  // ── Bulk selection (shared hook) ────────────────────────────────────────
  const {
    selectMode, setSelectMode, selectedIds, selectedProjects,
    toggleSelect, selectAll, deselectAll, exitSelectMode,
  } = useBulkSelect(projects)

  const handleBulkComplete = useCallback(() => {
    exitSelectMode()
    refresh()
  }, [exitSelectMode, refresh])

  // ── Bulk Advance Stage (Pipeline-specific) ────────────────────────────
  const allSameStage = useMemo(() => {
    if (selectedProjects.length === 0) return false
    const stages = new Set(selectedProjects.map(p => p.stage))
    return stages.size === 1
  }, [selectedProjects])

  const canAdvance = useMemo(() => {
    if (!allSameStage || selectedProjects.length === 0) return false
    const stage = selectedProjects[0].stage
    const idx = STAGE_ORDER.indexOf(stage)
    return idx >= 0 && idx < STAGE_ORDER.length - 1
  }, [allSameStage, selectedProjects])

  const executeBulkAdvance = useCallback(async () => {
    if (!canAdvance || selectedProjects.length === 0) return

    const currentStage = selectedProjects[0].stage
    const nextStageIdx = STAGE_ORDER.indexOf(currentStage) + 1
    const nextStage = STAGE_ORDER[nextStageIdx]
    const today = new Date().toISOString().split('T')[0]

    setAdvanceProgress({ current: 0, total: selectedProjects.length })

    const supabase = createClient()

    const failures: string[] = []

    for (let i = 0; i < selectedProjects.length; i++) {
      const proj = selectedProjects[i]
      setAdvanceProgress({ current: i + 1, total: selectedProjects.length })

      try {
        await updateProject(proj.id, { stage: nextStage, stage_date: today })
        await (supabase as any).from('audit_log').insert({
          project_id: proj.id, field: 'stage',
          old_value: proj.stage, new_value: nextStage,
          changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
        })
        await (supabase as any).from('stage_history').insert({
          project_id: proj.id, stage: nextStage, entered: today,
        })
      } catch (err) {
        console.error(`Bulk advance failed for ${proj.id}:`, err)
        failures.push(proj.id)
      }
    }

    setAdvanceProgress(null)
    if (failures.length > 0) {
      alert(`Stage advance failed for ${failures.length} project(s): ${failures.join(', ')}`)
    }
    clearQueryCache()
    handleBulkComplete()
  }, [canAdvance, selectedProjects, currentUser, handleBulkComplete])

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading pipeline...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Pipeline" onNewProject={() => setShowNewProject(true)} right={<>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-40 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          <span className="text-xs text-gray-500">
            {projects.length} projects · {fmt$(totalContract)}
          </span>
        </>} />

      {/* Filter bar */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 flex-shrink-0 flex-wrap">
        <select value={filterValues.pm ?? 'all'} onChange={e => setFilter('pm', e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All PMs</option>
          {pms.map(pm => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
        </select>
        <select value={filterValues.financier ?? 'all'} onChange={e => setFilter('financier', e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Financiers</option>
          {financiers.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <MultiSelect
          label="AHJ"
          options={ahjs}
          selected={filterValues.ahj ?? ''}
          onChange={v => setFilter('ahj', v)}
        />
        <MultiSelect
          label="Utility"
          options={utilities}
          selected={filterValues.utility ?? ''}
          onChange={v => setFilter('utility', v)}
        />

        {/* Select mode toggle */}
        <button
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${
            selectMode
              ? 'bg-green-700 text-white hover:bg-green-600'
              : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
          }`}
        >
          {selectMode ? 'Exit Select' : 'Select'}
        </button>

        {/* Select all / deselect all (visible in select mode) */}
        {selectMode && (
          <>
            <button onClick={() => selectAll(projects.map(p => p.id))}
              className="text-xs px-2 py-1.5 rounded-md text-gray-400 hover:text-white bg-gray-800 border border-gray-700">
              Select All
            </button>
            <button onClick={deselectAll}
              className="text-xs px-2 py-1.5 rounded-md text-gray-400 hover:text-white bg-gray-800 border border-gray-700">
              Deselect All
            </button>
            {selectedIds.size > 0 && (
              <span className="text-xs text-green-400 font-medium">{selectedIds.size} selected</span>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">Sort:</span>
          {(['sla','name','contract','cycle'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${sort === s ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>
              {s === 'sla' ? 'Days' : s === 'contract' ? '$' : s === 'cycle' ? 'Cycle' : 'Name'}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      <div className={`flex-1 overflow-x-auto ${selectedIds.size > 0 ? 'pb-20' : ''}`}>
        <div className="flex gap-0 h-full w-full">
          {STAGE_ORDER.map(stageId => {
            const cards = sortedByStage[stageId] ?? []
            const colContract = cards.reduce((s, p) => s + (Number(p.contract) || 0), 0)
            const blocked = cards.filter(p => p.blocker).length
            const crit = cards.filter(p => !p.blocker && getSLA(p).status === 'crit').length

            return (
              <div key={stageId} className="flex flex-col border-r border-gray-800 flex-1 min-w-[180px]">
                {/* Column header */}
                <div className="bg-gray-950 border-b border-gray-800 px-3 py-2.5 sticky top-0 flex-shrink-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{STAGE_LABELS[stageId]}</span>
                    <span className="text-xs text-gray-400 font-mono">{cards.length}</span>
                  </div>
                  <div className="text-xs text-gray-500">{fmt$(colContract)}</div>
                  {(blocked > 0 || crit > 0) && (
                    <div className="flex gap-1 mt-1">
                      {blocked > 0 && <span className="text-xs bg-red-950 text-red-400 px-1.5 rounded">{blocked} blocked</span>}
                      {crit > 0 && <span className="text-xs bg-red-950 text-red-400 px-1.5 rounded">{crit} critical</span>}
                    </div>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {cards.map(p => {
                    const sla = getSLA(p)
                    const isSelected = selectedIds.has(p.id)
                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          if (selectMode) {
                            toggleSelect(p.id)
                          } else {
                            setSelected(p)
                          }
                        }}
                        className={`bg-gray-800 rounded-lg p-2.5 cursor-pointer hover:bg-gray-700 border transition-colors relative ${
                          isSelected ? 'border-green-500 ring-1 ring-green-500/30' :
                          p.blocker ? 'border-l-2 border-l-red-500 border-gray-700' :
                          sla.status === 'crit' ? 'border-l-2 border-l-red-500 border-gray-700' :
                          sla.status === 'risk' ? 'border-l-2 border-l-amber-500 border-gray-700' :
                          selected?.id === p.id ? 'border-green-600' : 'border-gray-700'
                        }`}
                      >
                        {/* Checkbox overlay in select mode */}
                        {selectMode && <SelectCheckbox selected={isSelected} />}
                        {/* Name */}
                        <div className={`text-xs font-medium text-white truncate mb-0.5 ${selectMode ? 'pr-5' : ''}`}>{p.name}</div>
                        {/* ID */}
                        <div className="text-xs text-gray-500 mb-1">{p.id}</div>
                        {/* kW + contract */}
                        <div className="text-xs text-gray-400 mb-1.5">
                          {p.systemkw && <span>{p.systemkw} kW · </span>}
                          <span>{fmt$(p.contract)}</span>
                        </div>
                        {/* Financier */}
                        {p.financier && <div className="text-xs text-gray-500 truncate mb-1.5">{p.financier}</div>}
                        {/* Footer */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">{p.pm}</span>
                          <span className={`text-xs font-mono font-bold ${
                            p.blocker ? 'text-red-400' :
                            sla.status === 'crit' ? 'text-red-400' :
                            sla.status === 'risk' ? 'text-amber-400' :
                            sla.status === 'warn' ? 'text-yellow-400' : 'text-gray-400'
                          }`}>{sla.days}d</span>
                        </div>
                        {/* SLA progress bar */}
                        <div className="mt-1.5 h-0.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${sla.pct}%`, backgroundColor: AGE_COLOR[sla.status] }}
                          />
                        </div>
                        {/* Blocker */}
                        {p.blocker && (
                          <div className="mt-1.5 text-xs text-red-400 truncate">&#x1F6AB; {p.blocker}</div>
                        )}
                      </div>
                    )
                  })}
                  {cards.length === 0 && (
                    <div className="text-xs text-gray-700 text-center py-4">Empty</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Shared Bulk Action Bar ─────────────────────────────────── */}
      {selectMode && selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          selectedProjects={selectedProjects}
          currentUser={currentUser}
          onComplete={handleBulkComplete}
          onExit={exitSelectMode}
          actions={['reassign', 'blocker', 'disposition']}
          customActions={
            <div className="relative">
              <button
                onClick={() => {
                  if (!canAdvance) return
                  const stage = selectedProjects[0].stage
                  const nextIdx = STAGE_ORDER.indexOf(stage) + 1
                  const nextStage = STAGE_LABELS[STAGE_ORDER[nextIdx]] ?? STAGE_ORDER[nextIdx]
                  setAdvanceConfirm({
                    message: `Advance ${selectedIds.size} project${selectedIds.size !== 1 ? 's' : ''} from ${STAGE_LABELS[stage] ?? stage} to ${nextStage}?`,
                    onConfirm: executeBulkAdvance,
                  })
                }}
                disabled={!canAdvance}
                title={!allSameStage ? 'All selected projects must be in the same stage' : !canAdvance ? 'Cannot advance past Complete' : undefined}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-md transition-colors ${
                  canAdvance
                    ? 'bg-gray-800 text-gray-300 hover:text-white border border-gray-700'
                    : 'bg-gray-800/50 text-gray-600 border border-gray-800 cursor-not-allowed'
                }`}
              >
                <ArrowRight className="w-3.5 h-3.5" /> Advance Stage
              </button>
            </div>
          }
        />
      )}

      {/* ── Advance Stage Progress Overlay ────────────────────────────── */}
      {advanceProgress && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl text-center min-w-[300px]">
            <Loader2 className="w-8 h-8 text-green-400 animate-spin mx-auto mb-3" />
            <div className="text-sm text-white font-medium mb-1">Advancing stage</div>
            <div className="text-xs text-gray-400">
              Updating {advanceProgress.current} of {advanceProgress.total}...
            </div>
            <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${Math.round((advanceProgress.current / advanceProgress.total) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Advance Stage Confirmation ────────────────────────────────── */}
      {advanceConfirm && (
        <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl max-w-sm">
            <div className="text-sm text-white mb-4">{advanceConfirm.message}</div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAdvanceConfirm(null)}
                className="text-xs px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:text-white border border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  advanceConfirm.onConfirm()
                  setAdvanceConfirm(null)
                }}
                className="text-xs px-4 py-2 rounded-md bg-green-700 text-white hover:bg-green-600 font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Panel */}
      {selected && !selectMode && (
        <ProjectPanel
          project={selected}
          onClose={() => { setSelected(null); setInitialTab(null) }}
          onProjectUpdated={refresh}
          initialTab={initialTab as any}
        />
      )}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={() => { setShowNewProject(false); refresh() }}
          existingIds={projects.map(p => p.id)}
          pms={pms.map(pm => ({ id: pm.value, name: pm.label }))}
        />
      )}
    </div>
  )
}
