'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { daysAgo, fmt$, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import { ALL_TASKS_MAP } from '@/lib/tasks'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { useSupabaseQuery, useServerFilter, clearQueryCache } from '@/lib/hooks'
import { db } from '@/lib/db'
import { updateProject } from '@/lib/api/projects'
import { insertAuditLog, insertStageHistory } from '@/lib/api/tasks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { handleApiError } from '@/lib/errors'
import { useErrorToast } from '@/components/ErrorToastProvider'
import { BulkActionBar, useBulkSelect } from '@/components/BulkActionBar'
import { buildTaskMap } from '@/lib/queue-task-map'
import type { TaskStateRow } from '@/lib/queue-task-map'
import { ArrowRight, Loader2, ChevronLeft, ChevronRight, Layers, List } from 'lucide-react'
import type { Project } from '@/types/database'
import { MultiSelect } from './components/FilterPanel'
import { PipelineCard } from './components/PipelineCard'
import { getSLA, getStuckTasks, matchesDaysRange } from './components/helpers'
import type { FundingRecord, DaysRange } from './components/types'

// ── Constants ────────────────────────────────────────────────────────────────

const PROJECT_COLUMNS = 'id, name, city, address, pm, pm_id, stage, stage_date, sale_date, contract, blocker, systemkw, financier, ahj, utility, disposition, consultant, advisor, follow_up_date'

const SEARCH_FIELDS = ['name', 'id', 'city', 'address']

const DROPDOWN_CONFIG = {
  pm: 'pm_id|pm',
  financier: 'financier',
  ahj: 'ahj',
  utility: 'utility',
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// No component-level ErrorBoundary needed — app/error.tsx catches page-level errors
// ══════════════════════════════════════════════════════════════════════════════

export default function PipelinePage() {
  const [selected, setSelected] = useState<Project | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [sort, setSort] = useState<'name' | 'sla' | 'contract' | 'cycle'>('sla')

  const { user: currentUser, loading: userLoading } = useCurrentUser()

  // View mode: compact vs detailed
  const [viewMode, setViewMode] = useState<'compact' | 'detailed'>(() => {
    if (typeof window !== 'undefined') return (localStorage.getItem('mg_pipeline_view') as 'compact' | 'detailed') ?? 'detailed'
    return 'detailed'
  })
  useEffect(() => { localStorage.setItem('mg_pipeline_view', viewMode) }, [viewMode])

  // Column collapse state
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem('mg_pipeline_collapsed') ?? '{}') } catch { return {} }
    }
    return {}
  })
  useEffect(() => { localStorage.setItem('mg_pipeline_collapsed', JSON.stringify(collapsedCols)) }, [collapsedCols])
  const toggleColCollapse = (stageId: string) => setCollapsedCols(prev => ({ ...prev, [stageId]: !prev[stageId] }))

  // Column filters (blocked/stuck per stage) — intentionally not persisted; these are temporary, session-contextual filters
  const [colFilter, setColFilter] = useState<Record<string, 'blocked' | 'stuck' | null>>({})
  const toggleColFilter = (stageId: string, filter: 'blocked' | 'stuck') => {
    setColFilter(prev => ({ ...prev, [stageId]: prev[stageId] === filter ? null : filter }))
  }

  // Mobile collapsed sections
  const [mobileCollapsed, setMobileCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    STAGE_ORDER.forEach(s => { init[s] = true })
    return init
  })
  // CSS transitions handle rapid clicks gracefully; no debounce needed
  const toggleMobileSection = (stageId: string) => {
    setMobileCollapsed(prev => {
      // Only one section open at a time on mobile
      const next: Record<string, boolean> = {}
      STAGE_ORDER.forEach(s => { next[s] = s === stageId ? !prev[s] : true })
      return next
    })
  }

  // Advance stage progress (Pipeline-specific)
  const [advanceProgress, setAdvanceProgress] = useState<{ current: number; total: number } | null>(null)
  const [advanceConfirm, setAdvanceConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const { showError } = useErrorToast()

  // Smart filters (URL-persistent)
  const [search, setSearch] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [daysRange, setDaysRange] = useState<DaysRange>('')

  const setFilter = useCallback((name: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [name]: value }))
  }, [])

  // URL params: read on mount, write on change
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('pm')) setFilterValues(prev => ({ ...prev, pm: params.get('pm')! }))
    if (params.get('financier')) setFilterValues(prev => ({ ...prev, financier: params.get('financier')! }))
    if (params.get('ahj')) setFilterValues(prev => ({ ...prev, ahj: params.get('ahj')! }))
    if (params.get('utility')) setFilterValues(prev => ({ ...prev, utility: params.get('utility')! }))
    if (params.get('blocked') === '1') setBlockedOnly(true)
    if (params.get('days')) setDaysRange(params.get('days') as DaysRange)
    if (params.get('search')) setSearch(params.get('search')!)
  }, [])

  // Update URL params when filters change
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    // Preserve open/tab params
    const openId = params.get('open')
    const tab = params.get('tab')
    const next = new URLSearchParams()
    if (openId) next.set('open', openId)
    if (tab) next.set('tab', tab)
    if (filterValues.pm) next.set('pm', filterValues.pm)
    if (filterValues.financier) next.set('financier', filterValues.financier)
    if (filterValues.ahj) next.set('ahj', filterValues.ahj)
    if (filterValues.utility) next.set('utility', filterValues.utility)
    if (blockedOnly) next.set('blocked', '1')
    if (daysRange) next.set('days', daysRange)
    if (search.trim()) next.set('search', search.trim())
    const str = next.toString()
    const newUrl = str ? `${window.location.pathname}?${str}` : window.location.pathname
    window.history.replaceState(null, '', newUrl)
  }, [filterValues, blockedOnly, daysRange, search])

  const hasActiveFilters = useMemo(() =>
    !!filterValues.pm || !!filterValues.financier || !!filterValues.ahj || !!filterValues.utility || blockedOnly || !!daysRange || !!search.trim(),
    [filterValues, blockedOnly, daysRange, search]
  )

  const clearAllFilters = useCallback(() => {
    setFilterValues({})
    setBlockedOnly(false)
    setDaysRange('')
    setSearch('')
  }, [])

  // ── Data Loading ─────────────────────────────────────────────────────────

  const {
    data: allProjects, loading: projectsLoading, refresh,
  } = useSupabaseQuery('projects', {
    select: PROJECT_COLUMNS,
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled', 'Legal', 'On Hold'] } },
    limit: 5000,
    subscribe: true,
  })

  // Task states for all active projects (needed for next-task and stuck-task display)
  // ~938 active projects × ~20 tasks = ~19K rows; 25K limit gives headroom to 1,250 projects
  const {
    data: taskDataRaw, loading: tasksLoading,
  } = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, status, reason, follow_up_date',
    limit: 25000,
    subscribe: true,
  })

  // Funding data
  const {
    data: fundingRaw,
  } = useSupabaseQuery('project_funding', {
    select: 'project_id, m1_status, m2_status, m3_status',
    limit: 5000,
    subscribe: true,
  })

  const loading = projectsLoading || tasksLoading

  // Build task map
  // Cast: useSupabaseQuery returns generic Row type; cast to TaskStateRow[] is safe because select matches the shape
  const taskMap = useMemo(() => buildTaskMap(taskDataRaw as unknown as TaskStateRow[]), [taskDataRaw])

  // Build funding map
  const fundingMap = useMemo(() => {
    const map: Record<string, FundingRecord> = {}
    if (fundingRaw) {
      // Cast: useSupabaseQuery returns generic Row type; cast to FundingRecord[] is safe because select matches the shape
      for (const f of fundingRaw as unknown as FundingRecord[]) {
        map[f.project_id] = f
      }
    }
    return map
  }, [fundingRaw])

  // Build follow-up map: project_id -> { date, taskName }
  // Includes both task-level follow_up_date (from task_state) and project-level follow_up_date.
  // Uses the earliest date between task-level and project-level.
  const followUpMap = useMemo(() => {
    const map: Record<string, { date: string; taskName: string }> = {}
    if (!taskDataRaw) return map
    for (const t of taskDataRaw as unknown as TaskStateRow[]) {
      if (t.follow_up_date) {
        const existing = map[t.project_id]
        if (!existing || t.follow_up_date < existing.date) {
          map[t.project_id] = { date: t.follow_up_date, taskName: ALL_TASKS_MAP[t.task_id] ?? t.task_id }
        }
      }
    }
    // Also check project-level follow_up_date and use earliest
    if (allProjects) {
      for (const p of allProjects as unknown as Project[]) {
        if (p.follow_up_date) {
          const existing = map[p.id]
          if (!existing || p.follow_up_date < existing.date) {
            map[p.id] = { date: p.follow_up_date, taskName: 'Project' }
          }
        }
      }
    }
    return map
  }, [taskDataRaw, allProjects])

  // Extract dropdown options
  // Cast: useServerFilter expects Record<string, unknown>[]; safe because we only extract dropdown values
  const { dropdowns: extractedDropdowns } = useServerFilter(
    allProjects as unknown as Record<string, unknown>[],
    { extractDropdowns: DROPDOWN_CONFIG }
  )

  // Client-side filtering
  const projects = useMemo(() => {
    // Cast: useSupabaseQuery returns generic Row type; cast to Project[] is safe because the projects table matches
    let result = allProjects as unknown as Project[]
    if (!result) return []

    // Sales role: only show projects where consultant or advisor matches user name
    if (currentUser?.isSales && currentUser.name) {
      const salesName = currentUser.name.toLowerCase()
      result = result.filter(p =>
        p.consultant?.toLowerCase() === salesName ||
        p.advisor?.toLowerCase() === salesName
      )
    }

    // Search filter — client-side .includes() on in-memory data, so escapeIlike is not needed
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
    if (filterValues.ahj) {
      const sel = new Set(filterValues.ahj.split(','))
      result = result.filter(p => sel.has(p.ahj ?? ''))
    }
    if (filterValues.utility) {
      const sel = new Set(filterValues.utility.split(','))
      result = result.filter(p => sel.has(p.utility ?? ''))
    }

    // Blocked only
    if (blockedOnly) result = result.filter(p => !!p.blocker)

    // Days range
    if (daysRange) result = result.filter(p => matchesDaysRange(p, daysRange))

    return result
  }, [allProjects, search, filterValues, currentUser, blockedOnly, daysRange])

  const pms = extractedDropdowns.pm ?? []

  // Load display_name maps from reference tables for short labels in dropdowns
  const [knownFinanciers, setKnownFinanciers] = useState<Set<string>>(new Set())
  const [financierDisplayNames, setFinancierDisplayNames] = useState<Map<string, string>>(new Map())
  const [ahjDisplayNames, setAhjDisplayNames] = useState<Map<string, string>>(new Map())
  const [utilityDisplayNames, setUtilityDisplayNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    Promise.all([
      db().from('financiers').select('name, display_name').order('name').limit(500),
      db().from('ahjs').select('name, display_name').order('name').limit(2000),
      db().from('utilities').select('name, display_name').order('name').limit(500),
    ]).then(([finRes, ahjRes, utilRes]) => {
      type NameDisplay = { name: string; display_name: string | null }
      const finData = (finRes.data ?? []) as NameDisplay[]
      setKnownFinanciers(new Set(finData.map(f => f.name)))
      setFinancierDisplayNames(new Map(finData.map(f => [f.name, f.display_name || f.name])))
      const ahjMap = new Map<string, string>()
      for (const a of (ahjRes.data ?? []) as NameDisplay[]) { if (a.display_name) ahjMap.set(a.name, a.display_name) }
      setAhjDisplayNames(ahjMap)
      const utilMap = new Map<string, string>()
      for (const u of (utilRes.data ?? []) as NameDisplay[]) { if (u.display_name) utilMap.set(u.name, u.display_name) }
      setUtilityDisplayNames(utilMap)
    }).catch(err => handleApiError(err, '[pipeline] display_name load'))
  }, [])
  const financiers = useMemo(() => {
    const raw = extractedDropdowns.financier ?? []
    if (knownFinanciers.size === 0) return raw
    return raw.filter(f => knownFinanciers.has(f.label)).map(f => ({
      ...f,
      label: financierDisplayNames.get(f.label) ?? f.label,
    }))
  }, [extractedDropdowns.financier, knownFinanciers, financierDisplayNames])
  const ahjs = useMemo(() => {
    const raw = extractedDropdowns.ahj ?? []
    if (ahjDisplayNames.size === 0) return raw
    return raw.map(a => ({ ...a, label: ahjDisplayNames.get(a.label) ?? a.label }))
  }, [extractedDropdowns.ahj, ahjDisplayNames])
  const utilities = useMemo(() => {
    const raw = extractedDropdowns.utility ?? []
    if (utilityDisplayNames.size === 0) return raw
    return raw.map(u => ({ ...u, label: utilityDisplayNames.get(u.label) ?? u.label }))
  }, [extractedDropdowns.utility, utilityDisplayNames])

  // Auto-open project from URL params
  const [initialTab, setInitialTab] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const openId = params.get('open')
    const searchQ = params.get('search')
    const tab = params.get('tab')
    if (openId && projects.length > 0) {
      const proj = projects.find(p => p.id === openId)
      if (proj) {
        setSelected(proj)
        if (tab) setInitialTab(tab)
      } else {
        // Deep-link to a project outside the active filter (e.g. Cancelled from
        // GlobalSearch). Fetch directly so the modal can open regardless of disposition.
        db().from('projects').select(PROJECT_COLUMNS).eq('id', openId).maybeSingle()
          .then((res: { data: unknown }) => {
            if (res.data) {
              setSelected(res.data as Project)
              if (tab) setInitialTab(tab)
            }
          })
      }
    }
    if (searchQ && !search) setSearch(searchQ)
  }, [projects])

  // Sort within each column
  const sortedByStage = useMemo(() => {
    const map: Record<string, Project[]> = {}
    for (const stageId of STAGE_ORDER) {
      let cards = projects.filter(p => p.stage === stageId)

      // Apply per-column filter
      const cf = colFilter[stageId]
      if (cf === 'blocked') cards = cards.filter(p => !!p.blocker)
      if (cf === 'stuck') cards = cards.filter(p => getStuckTasks(p, taskMap[p.id] ?? {}).length > 0)

      map[stageId] = [...cards].sort((a, b) => {
        if (sort === 'sla') return getSLA(b).days - getSLA(a).days
        if (sort === 'contract') return (Number(b.contract) || 0) - (Number(a.contract) || 0)
        // daysAgo always returns a number (0 for null), so || 0 is defensive but harmless
        if (sort === 'cycle') return (daysAgo(b.sale_date) || 0) - (daysAgo(a.sale_date) || 0)
        return (a.name ?? '').localeCompare(b.name ?? '')
      })
    }
    return map
  }, [projects, sort, colFilter, taskMap])

  const totalContract = useMemo(() => projects.reduce((s, p) => s + (Number(p.contract) || 0), 0), [projects])

  // ── Stage stats ──────────────────────────────────────────────────────────

  const stageStats = useMemo(() => {
    const stats: Record<string, { count: number; value: number; blocked: number; stuck: number; avgDays: number }> = {}
    for (const stageId of STAGE_ORDER) {
      const stageProjects = projects.filter(p => p.stage === stageId)
      const blocked = stageProjects.filter(p => !!p.blocker).length
      const stuck = stageProjects.filter(p => getStuckTasks(p, taskMap[p.id] ?? {}).length > 0).length
      const totalDays = stageProjects.reduce((s, p) => s + daysAgo(p.stage_date), 0)
      stats[stageId] = {
        count: stageProjects.length,
        value: stageProjects.reduce((s, p) => s + (Number(p.contract) || 0), 0),
        blocked,
        stuck,
        avgDays: stageProjects.length > 0 ? Math.round(totalDays / stageProjects.length) : 0,
      }
    }
    return stats
  }, [projects, taskMap])

  // ── Bulk selection ───────────────────────────────────────────────────────

  const {
    selectMode, setSelectMode, selectedIds, selectedProjects,
    toggleSelect, selectAll, deselectAll, exitSelectMode,
  } = useBulkSelect(projects)

  const handleBulkComplete = useCallback(() => {
    exitSelectMode()
    refresh()
  }, [exitSelectMode, refresh])

  // ── Bulk Advance Stage ───────────────────────────────────────────────────

  const allSameStage = useMemo(() => {
    if (selectedProjects.length === 0) return false
    return new Set(selectedProjects.map(p => p.stage)).size === 1
  }, [selectedProjects])

  const canAdvance = useMemo(() => {
    if (!allSameStage || selectedProjects.length === 0) return false
    const idx = STAGE_ORDER.indexOf(selectedProjects[0].stage)
    return idx >= 0 && idx < STAGE_ORDER.length - 1
  }, [allSameStage, selectedProjects])

  const executeBulkAdvance = useCallback(async () => {
    if (!canAdvance || selectedProjects.length === 0) return
    const currentStage = selectedProjects[0].stage
    const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(currentStage) + 1]
    const today = new Date().toISOString().split('T')[0]
    setAdvanceProgress({ current: 0, total: selectedProjects.length })
    const failures: string[] = []
    for (let i = 0; i < selectedProjects.length; i++) {
      const proj = selectedProjects[i]
      setAdvanceProgress({ current: i + 1, total: selectedProjects.length })
      try {
        await updateProject(proj.id, { stage: nextStage, stage_date: today })
        await insertAuditLog({
          project_id: proj.id, field: 'stage',
          old_value: proj.stage, new_value: nextStage,
          changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
        })
        await insertStageHistory({
          project_id: proj.id, from_stage: proj.stage, to_stage: nextStage,
          changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
        })
      } catch (err) {
        handleApiError(err, `[pipeline] bulk advance ${proj.id}`)
        failures.push(`${proj.id} (${err instanceof Error ? err.message : 'unknown error'})`)
      }
    }
    setAdvanceProgress(null)
    if (failures.length > 0) {
      showError(`Stage advance failed for ${failures.length} project(s)`)
    }
    clearQueryCache()
    handleBulkComplete()
  }, [canAdvance, selectedProjects, currentUser, handleBulkComplete])

  // ── Today string for follow-up comparison ────────────────────────────────
  // ISO date string comparison (< > ===) is safe for YYYY-MM-DD format — lexicographic order matches chronological order
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])

  // ── Loading state ────────────────────────────────────────────────────────

  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">You don&apos;t have permission to view this page.</div>
      </div>
    )
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading pipeline...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Pipeline" onNewProject={() => setShowNewProject(true)} />

      {/* ── Smart Filters Toolbar ──────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search projects..."
            aria-label="Search projects"
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-44 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          {/* PM */}
          <select value={filterValues.pm ?? 'all'} onChange={e => setFilter('pm', e.target.value === 'all' ? '' : e.target.value)}
            aria-label="Filter by PM"
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All PMs</option>
            {pms.map(pm => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
          </select>
          {/* Financier */}
          <select value={filterValues.financier ?? 'all'} onChange={e => setFilter('financier', e.target.value === 'all' ? '' : e.target.value)}
            aria-label="Filter by financier"
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All Financiers</option>
            {financiers.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {/* AHJ multi-select */}
          <MultiSelect label="AHJ" options={ahjs} selected={filterValues.ahj ?? ''} onChange={v => setFilter('ahj', v)} />
          {/* Utility multi-select */}
          <MultiSelect label="Utilities" options={utilities} selected={filterValues.utility ?? ''} onChange={v => setFilter('utility', v)} />
          {/* Blocked toggle */}
          <button
            onClick={() => setBlockedOnly(prev => !prev)}
            className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors font-medium ${
              blockedOnly ? 'bg-red-900/60 border-red-600 text-red-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
            }`}
          >
            Blocked
          </button>
          {/* Days range chips */}
          <div className="h-4 w-px bg-gray-700" />
          {(['<7', '7-30', '30-90', '90+'] as const).map(range => (
            <button
              key={range}
              onClick={() => setDaysRange(prev => prev === range ? '' : range)}
              className={`text-[11px] px-2 py-1 rounded-md border transition-colors font-medium ${
                daysRange === range ? 'bg-blue-900/60 border-blue-600 text-blue-300' : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
            >
              {range === '<7' ? '<7d' : range === '7-30' ? '7-30d' : range === '30-90' ? '30-90d' : '90+d'}
            </button>
          ))}

          {hasActiveFilters && (
            <button onClick={clearAllFilters} className="text-[11px] px-2 py-1 rounded-md border border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
              Clear All
            </button>
          )}

          {/* Right side: stats, view toggle, select, sort */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-500">
              {projects.length} projects {'\u00B7'} {fmt$(totalContract)}
            </span>
            <div className="h-4 w-px bg-gray-700" />
            {/* Compact / Detailed toggle */}
            <div className="flex items-center bg-gray-800 border border-gray-700 rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode('compact')}
                className={`px-2 py-1.5 text-xs transition-colors ${viewMode === 'compact' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}
                title="Compact view"
                aria-label="Switch to compact view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('detailed')}
                className={`px-2 py-1.5 text-xs transition-colors ${viewMode === 'detailed' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}
                title="Detailed view"
                aria-label="Switch to detailed view"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Select mode toggle */}
            {!currentUser?.isSales && (
              <>
                <button
                  onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
                  className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium ${
                    selectMode ? 'bg-green-700 text-white hover:bg-green-600' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'
                  }`}
                  aria-label={selectMode ? 'Exit selection mode' : 'Enter selection mode'}
                >
                  {selectMode ? 'Exit Select' : 'Select'}
                </button>
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
              </>
            )}

            <div className="h-4 w-px bg-gray-700" />
            <span className="text-xs text-gray-500">Sort:</span>
            {(['sla', 'name', 'contract', 'cycle'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)}
                aria-label={`Sort by ${s === 'sla' ? 'days in stage' : s === 'contract' ? 'contract value' : s === 'cycle' ? 'cycle time' : 'name'}`}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${sort === s ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>
                {s === 'sla' ? 'Days' : s === 'contract' ? '$' : s === 'cycle' ? 'Cycle' : 'Name'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Desktop Kanban Board (md+) ─────────────────────────────────────── */}
      <div className={`hidden md:block flex-1 overflow-x-auto ${selectedIds.size > 0 ? 'pb-20' : ''}`}>
        <div className="flex gap-0 h-full w-full">
          {STAGE_ORDER.map(stageId => {
            const cards = sortedByStage[stageId] ?? []
            const stats = stageStats[stageId]
            const isCollapsed = !!collapsedCols[stageId]

            if (isCollapsed) {
              return (
                <div key={stageId} className="flex flex-col border-r border-gray-800 w-10 flex-shrink-0 bg-gray-900">
                  <button
                    onClick={() => toggleColCollapse(stageId)}
                    className="flex flex-col items-center py-3 px-1 gap-2 hover:bg-gray-900 transition-colors h-full"
                    title={`Expand ${STAGE_LABELS[stageId]}`}
                    aria-label={`Expand ${STAGE_LABELS[stageId]} column`}
                  >
                    <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-[10px] text-gray-500 font-medium [writing-mode:vertical-lr] rotate-180">
                      {STAGE_LABELS[stageId]}
                    </span>
                    <span className="text-[10px] text-gray-600 font-mono">{stats.count}</span>
                  </button>
                </div>
              )
            }

            return (
              <div key={stageId} className="flex flex-col border-r border-gray-800 flex-1 min-w-[200px]">
                {/* Column header with stats */}
                <div className="bg-gray-900 border-b border-gray-800 px-3 py-2.5 sticky top-0 flex-shrink-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => toggleColCollapse(stageId)}
                        className="text-gray-500 hover:text-white transition-colors"
                        title={`Collapse ${STAGE_LABELS[stageId]}`}
                        aria-label={`Collapse ${STAGE_LABELS[stageId]} column`}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-semibold text-white">{STAGE_LABELS[stageId]}</span>
                    </div>
                    <span className="text-xs text-gray-400 font-mono">{cards.length}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mb-1">{fmt$(stats.value)}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {stats.blocked > 0 && (
                      <button
                        onClick={() => toggleColFilter(stageId, 'blocked')}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                          colFilter[stageId] === 'blocked' ? 'bg-red-600 text-white' : 'bg-red-950 text-red-400 hover:bg-red-900'
                        }`}
                      >
                        {stats.blocked} blocked
                      </button>
                    )}
                    {stats.stuck > 0 && (
                      <button
                        onClick={() => toggleColFilter(stageId, 'stuck')}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                          colFilter[stageId] === 'stuck' ? 'bg-amber-600 text-white' : 'bg-amber-950 text-amber-400 hover:bg-amber-900'
                        }`}
                      >
                        {stats.stuck} stuck
                      </button>
                    )}
                    <span className="text-[10px] text-gray-600 ml-auto">{'\u00D8'} {stats.avgDays}d</span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {cards.map(p => (
                    <PipelineCard
                      key={p.id}
                      p={p}
                      viewMode={viewMode}
                      taskMap={taskMap[p.id] ?? {}}
                      funding={fundingMap[p.id]}
                      followUp={followUpMap[p.id]}
                      todayStr={todayStr}
                      selectMode={selectMode}
                      isSelected={selectedIds.has(p.id)}
                      isActive={selected?.id === p.id}
                      onToggleSelect={toggleSelect}
                      onOpen={(proj) => { setSelected(proj) }}
                    />
                  ))}
                  {cards.length === 0 && (
                    <div className="text-xs text-gray-700 text-center py-4">
                      {colFilter[stageId] ? 'No matching projects' : 'Empty'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Mobile Layout (below md) ───────────────────────────────────────── */}
      <div className={`md:hidden flex-1 overflow-y-auto px-3 py-3 ${selectedIds.size > 0 ? 'pb-20' : ''}`}>
        {STAGE_ORDER.map(stageId => {
          const cards = sortedByStage[stageId] ?? []
          const stats = stageStats[stageId]
          const isCollapsed = mobileCollapsed[stageId] !== false

          return (
            <div key={stageId} className="mb-3">
              <button
                onClick={() => toggleMobileSection(stageId)}
                className="w-full bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-gray-500">{isCollapsed ? '\u25B8' : '\u25BE'}</span>
                  <span className="text-sm font-semibold text-white">{STAGE_LABELS[stageId]}</span>
                  <span className="text-xs text-gray-400 font-mono">{stats.count}</span>
                </div>
                <div className="flex items-center gap-2">
                  {stats.blocked > 0 && (
                    <span className="text-[10px] bg-red-950 text-red-400 px-1.5 py-0.5 rounded">{stats.blocked} blocked</span>
                  )}
                  <span className="text-[10px] text-gray-500">{fmt$(stats.value)}</span>
                </div>
              </button>
              {!isCollapsed && (
                <div className="mt-2 space-y-2">
                  {cards.map(p => (
                    <PipelineCard
                      key={p.id}
                      p={p}
                      viewMode={viewMode}
                      taskMap={taskMap[p.id] ?? {}}
                      funding={fundingMap[p.id]}
                      followUp={followUpMap[p.id]}
                      todayStr={todayStr}
                      selectMode={selectMode}
                      isSelected={selectedIds.has(p.id)}
                      isActive={selected?.id === p.id}
                      onToggleSelect={toggleSelect}
                      onOpen={(proj) => { setSelected(proj) }}
                    />
                  ))}
                  {cards.length === 0 && (
                    <div className="text-xs text-gray-700 text-center py-4">No projects</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Shared Bulk Action Bar ─────────────────────────────────────────── */}
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

      {/* ── Advance Stage Progress Overlay ──────────────────────────────────── */}
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

      {/* ── Advance Stage Confirmation ──────────────────────────────────────── */}
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
                onClick={() => { advanceConfirm.onConfirm(); setAdvanceConfirm(null) }}
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
          initialTab={(initialTab as 'tasks' | 'notes' | 'info' | 'bom' | 'files') ?? undefined}
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

      {/* Error toasts rendered by global ErrorToastProvider */}
    </div>
  )
}

