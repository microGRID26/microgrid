'use client'

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react'
import { Nav } from '@/components/Nav'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'
import { ALL_TASKS_MAP } from '@/lib/tasks'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { usePreferences } from '@/lib/usePreferences'
import { useSupabaseQuery, usePmFilter } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useSearchParams } from 'next/navigation'
import { BulkActionBar, useBulkSelect, SelectCheckbox } from '@/components/BulkActionBar'
import { updateProject, addNote } from '@/lib/api'
import { db } from '@/lib/db'
import type { Project } from '@/types/database'
import { Calendar, X, MessageSquare, ArrowUpDown } from 'lucide-react'

/** Project with computed follow-up fields attached in the followUps memo */
interface ProjectWithFollowUp extends Project {
  _taskFollowUp: { date: string; taskName: string } | null
  _followUpDate: string | null
}

const CARD_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'city', label: 'City' },
  { key: 'address', label: 'Address' },
  { key: 'financier', label: 'Financier' },
  { key: 'contract', label: 'Contract' },
  { key: 'systemkw', label: 'System kW' },
  { key: 'ahj', label: 'AHJ' },
  { key: 'pm', label: 'PM' },
  { key: 'stage', label: 'Stage' },
  { key: 'sale_date', label: 'Sale Date' },
]

// ── Filter types ────────────────────────────────────────────────────────────
interface QueueFilters {
  stages: Set<string>
  financier: string
  ahj: string
  blockedOnly: boolean
  daysRange: '' | '<7' | '7-30' | '30-90' | '90+'
}

const EMPTY_FILTERS: QueueFilters = {
  stages: new Set<string>(),
  financier: '',
  ahj: '',
  blockedOnly: false,
  daysRange: '',
}

type SectionSortKey = 'days' | 'contract' | 'name'

// ── Funding status type ──────────────────────────────────────────────────────
interface FundingRecord {
  project_id: string
  m1_status: string | null
  m2_status: string | null
  m3_status: string | null
}

function getSLA(p: Project) {
  const t = SLA_THRESHOLDS[p.stage] ?? { target: 3, risk: 5, crit: 7 }
  const days = daysAgo(p.stage_date)
  let status: 'ok' | 'warn' | 'risk' | 'crit' = 'ok'
  if (days >= t.crit) status = 'crit'
  else if (days >= t.risk) status = 'risk'
  else if (days >= t.target) status = 'warn'
  return { days, status, ...t }
}

function priority(p: Project): number {
  if (p.blocker) return 0
  const s = getSLA(p).status
  if (s === 'crit') return 1
  if (s === 'risk') return 2
  if (s === 'warn') return 3
  return 4
}

import { buildTaskMap } from '@/lib/queue-task-map'
import type { TaskEntry, TaskStateRow } from '@/lib/queue-task-map'

function getNextTask(p: Project, taskMap: Record<string, TaskEntry>): string | null {
  const tasks = STAGE_TASKS[p.stage] ?? []
  for (const t of tasks) {
    const s = taskMap[t.id]?.status ?? 'Not Ready'
    if (s !== 'Complete') return t.name
  }
  return null
}

interface StuckTask { name: string; status: 'Pending Resolution' | 'Revision Required'; reason: string }

function getStuckTasks(p: Project, taskMap: Record<string, TaskEntry>): StuckTask[] {
  const tasks = STAGE_TASKS[p.stage] ?? []
  return tasks
    .filter(t => {
      const s = taskMap[t.id]?.status ?? 'Not Ready'
      return s === 'Pending Resolution' || s === 'Revision Required'
    })
    .map(t => ({
      name: t.name,
      status: (taskMap[t.id]?.status ?? '') as 'Pending Resolution' | 'Revision Required',
      reason: taskMap[t.id]?.reason ?? '',
    }))
}

const STATUS_COLOR: Record<string, string> = {
  crit: 'bg-red-500',
  risk: 'bg-amber-500',
  warn: 'bg-yellow-500',
  ok:   'bg-green-500',
}

// Stage filter chips (exclude 'complete')
const FILTER_STAGES = STAGE_ORDER.filter(s => s !== 'complete')

// Days range filter helpers
function getDaysInStage(p: Project): number {
  return daysAgo(p.stage_date)
}

function matchesDaysRange(p: Project, range: string): boolean {
  const d = getDaysInStage(p)
  switch (range) {
    case '<7': return d < 7
    case '7-30': return d >= 7 && d <= 30
    case '30-90': return d > 30 && d <= 90
    case '90+': return d > 90
    default: return true
  }
}

// Sort projects within a section
function sortProjects(projects: Project[], sortKey: SectionSortKey): Project[] {
  return [...projects].sort((a, b) => {
    switch (sortKey) {
      case 'days': return getDaysInStage(b) - getDaysInStage(a) // descending
      case 'contract': return (Number(b.contract) || 0) - (Number(a.contract) || 0) // descending
      case 'name': return (a.name ?? '').localeCompare(b.name ?? '') // ascending
      default: return 0
    }
  })
}

// ── Configurable queue sections ──────────────────────────────────────────
interface QueueSectionConfig { id: string; label: string; task_id: string; match_status: string; color: string; icon: string; sort_order: number }
const HARDCODED_SECTIONS: QueueSectionConfig[] = [
  { id: 'hc-1', label: 'City Permit Approval — Ready to Start', task_id: 'city_permit', match_status: 'Ready To Start', color: 'blue', icon: '📋', sort_order: 1 },
  { id: 'hc-2', label: 'City Permit — Submitted, Pending Approval', task_id: 'city_permit', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'indigo', icon: '📄', sort_order: 2 },
  { id: 'hc-3', label: 'Utility Permit — Submitted, Pending Approval', task_id: 'util_permit', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'purple', icon: '📄', sort_order: 3 },
  { id: 'hc-4', label: 'Utility Inspection — Ready to Start', task_id: 'util_insp', match_status: 'Ready To Start', color: 'teal', icon: '⚡', sort_order: 4 },
  { id: 'hc-5', label: 'Utility Inspection — Submitted, Pending Approval', task_id: 'util_insp', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'cyan', icon: '⚡', sort_order: 5 },
]

export default function QueuePageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-green-400 text-sm animate-pulse">Loading your queue...</div>
      </div>
    }>
      <QueuePage />
    </Suspense>
  )
}

function QueuePage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const searchParams = useSearchParams()
  // PM filter state managed by shared hook — value available immediately from localStorage
  const [pmUsersState, setPmUsersState] = useState<{ id: string; name: string }[]>([])
  const { pmFilter: userPm, setPmFilter: selectPm, pmOptions, isMyProjects: _isPmFiltered } = usePmFilter(pmUsersState, 'queue')
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [search, setSearch] = useState('')
  const [showCardConfig, setShowCardConfig] = useState(false)
  const { prefs, updatePref } = usePreferences()
  const cardFields = prefs.queue_card_fields

  // ── Smart Filters (read URL params for pre-applied filters) ────────────
  const [filters, setFilters] = useState<QueueFilters>(() => {
    const blockedParam = searchParams.get('blockedOnly')
    return {
      ...EMPTY_FILTERS,
      blockedOnly: blockedParam === 'true',
    }
  })

  const hasActiveFilters = useMemo(() =>
    filters.stages.size > 0 || filters.financier !== '' || filters.ahj !== '' || filters.blockedOnly || filters.daysRange !== '',
    [filters]
  )

  const toggleStage = useCallback((stage: string) => {
    setFilters(prev => {
      const next = new Set(prev.stages)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return { ...prev, stages: next }
    })
  }, [])

  const clearAllFilters = useCallback(() => setFilters(EMPTY_FILTERS), [])

  // ── Section sorts ───────────────────────────────────────────────────────
  const [sectionSorts, setSectionSorts] = useState<Record<string, SectionSortKey>>({})
  const getSectionSort = (key: string): SectionSortKey => sectionSorts[key] ?? 'days'
  const cycleSectionSort = useCallback((key: string) => {
    setSectionSorts(prev => {
      const current = prev[key] ?? 'days'
      const order: SectionSortKey[] = ['days', 'contract', 'name']
      const idx = order.indexOf(current)
      return { ...prev, [key]: order[(idx + 1) % order.length] }
    })
  }, [])

  // ── Queue sections from DB (with hardcoded fallback) ───────────────────
  const [queueSections, setQueueSections] = useState<QueueSectionConfig[]>(HARDCODED_SECTIONS)

  const { data: queueSectionsData } = useSupabaseQuery('queue_sections', {
    select: 'id, label, task_id, match_status, color, icon, sort_order',
    filters: { active: true },
    order: { column: 'sort_order', ascending: true },
    limit: 100,
  })

  useEffect(() => {
    if (queueSectionsData && queueSectionsData.length > 0) {
      setQueueSections(queueSectionsData as unknown as QueueSectionConfig[])
    }
  }, [queueSectionsData])

  // ── PM filter (server-side) via useServerFilter ────────────────────────
  const pmFilters = useMemo(() => {
    const f: Record<string, { eq: string }> = {}
    if (userPm) f.pm_id = { eq: userPm }
    return f
  }, [userPm])

  // ── Task IDs needed for queue sections ─────────────────────────────────
  const queueTaskIds = useMemo(() => {
    const sectionTaskIds = queueSections.map(s => s.task_id)
    return [...new Set(['city_permit', 'util_permit', 'util_insp', 'welcome', 'ia', 'ub', 'sched_survey', 'ntp', ...sectionTaskIds])]
  }, [queueSections])

  // ── Realtime scope filter: narrow subscription when PM filter is active ──
  const projectRealtimeFilter = useMemo(
    () => userPm ? `pm_id=eq.${userPm}` : undefined,
    [userPm]
  )

  // ── Query 1: Projects with PM filter ─────────────────────
  const {
    data: projectsRaw,
    loading: projectsLoading,
    refresh: refreshProjects,
  } = useSupabaseQuery('projects', {
    select: 'id, name, city, address, pm, pm_id, stage, stage_date, sale_date, contract, blocker, financier, disposition, follow_up_date, consultant, advisor, ahj, systemkw',
    filters: pmFilters,
    limit: 5000,
    subscribe: true,
    realtimeFilter: projectRealtimeFilter,
  })

  // Apply sales filtering (consultant/advisor match)
  const projects = useMemo(() => {
    const raw = projectsRaw as unknown as Project[]
    if (!currentUser?.isSales || !currentUser.name) return raw
    const salesName = currentUser.name.toLowerCase()
    return raw.filter(p =>
      p.consultant?.toLowerCase() === salesName ||
      p.advisor?.toLowerCase() === salesName
    )
  }, [projectsRaw, currentUser])

  // ── Query 2: Task states for queue-relevant tasks ──────────────────────
  const taskFilters = useMemo(() => ({
    task_id: { in: queueTaskIds },
  }), [queueTaskIds])

  const {
    data: taskDataRaw,
    loading: tasksLoading,
    refresh: refreshTasks,
  } = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, status, reason',
    filters: taskFilters,
    limit: 50000,
    subscribe: true,
  })

  // ── Query 3: Task states with follow-up dates ──────────────────────────
  const {
    data: followUpDataRaw,
    refresh: refreshFollowUps,
  } = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, follow_up_date',
    filters: { follow_up_date: { isNot: null } },
    limit: 5000,
    subscribe: true,
  })

  // ── Query 4: Project funding data ──────────────────────────────────────
  const {
    data: fundingRaw,
    error: fundingError,
  } = useSupabaseQuery('project_funding', {
    select: 'project_id, m1_status, m2_status, m3_status',
    limit: 5000,
  })

  const fundingMap = useMemo(() => {
    if (fundingError) {
      console.warn('Failed to load funding data:', fundingError)
      return {} as Record<string, FundingRecord>
    }
    const map: Record<string, FundingRecord> = {}
    for (const f of (fundingRaw as unknown as FundingRecord[])) {
      map[f.project_id] = f
    }
    return map
  }, [fundingRaw, fundingError])

  // ── Merge task data + follow-up data (filtered to PM-filtered projects) ──
  const projectIdSet = useMemo(() => new Set(projects.map(p => p.id)), [projects])

  const taskStates: TaskStateRow[] = useMemo(() => {
    const allTasks: TaskStateRow[] = [...(taskDataRaw as unknown as TaskStateRow[])]
    // Build a Map keyed on `${project_id}|${task_id}` for O(1) lookups instead of O(n) array.find()
    const taskIndex = new Map<string, TaskStateRow>()
    for (const t of allTasks) {
      taskIndex.set(`${t.project_id}|${t.task_id}`, t)
    }
    for (const fu of followUpDataRaw as unknown as TaskStateRow[]) {
      if (!projectIdSet.has(fu.project_id)) continue
      const key = `${fu.project_id}|${fu.task_id}`
      const existing = taskIndex.get(key)
      if (existing) {
        existing.follow_up_date = fu.follow_up_date
      } else {
        const newRow: TaskStateRow = { project_id: fu.project_id, task_id: fu.task_id, status: 'Not Ready', follow_up_date: fu.follow_up_date }
        allTasks.push(newRow)
        taskIndex.set(key, newRow)
      }
    }
    return allTasks
  }, [taskDataRaw, followUpDataRaw, projectIdSet])

  // ── Feed PM dropdown data into the shared hook ─────────────────────────
  const pmUsersFromProjects = useMemo(() => {
    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
    return [...pmMap.entries()].map(([id, name]) => ({ id, name }))
  }, [projects])
  useEffect(() => { setPmUsersState(pmUsersFromProjects) }, [pmUsersFromProjects])
  const availablePms = pmOptions

  // ── Extract unique financiers and AHJs for filter dropdowns ────────────
  const distinctFinanciers = useMemo(() => {
    const set = new Set<string>()
    projects.forEach(p => { if (p.financier) set.add(p.financier) })
    return [...set].sort()
  }, [projects])

  const distinctAHJs = useMemo(() => {
    const set = new Set<string>()
    projects.forEach(p => { if (p.ahj) set.add(p.ahj) })
    return [...set].sort()
  }, [projects])

  // ── Refresh all queries ────────────────────────────────────────────────
  const refreshAll = useCallback(() => {
    refreshProjects()
    refreshTasks()
    refreshFollowUps()
  }, [refreshProjects, refreshTasks, refreshFollowUps])

  // ── Bulk selection ────────────────────────────────────────────────────
  const {
    selectMode, setSelectMode, selectedIds, selectedProjects,
    toggleSelect, selectAll, exitSelectMode,
  } = useBulkSelect(projects)

  const handleBulkComplete = useCallback(() => {
    exitSelectMode()
    refreshAll()
  }, [exitSelectMode, refreshAll])

  const loading = projectsLoading || tasksLoading

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
    followups: searchParams.get('section') === 'followups' ? false : false,
    blocked: true, active: true, loyalty: true, complete: true,
  }))
  const toggleBucket = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // Build task map per project
  const taskMap = useMemo(() => buildTaskMap(taskStates), [taskStates])

  // In Service, Cancelled, and Loyalty projects excluded from main sections
  const live = useMemo(() => projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Cancelled' && p.disposition !== 'Loyalty'), [projects])
  const loyaltyProjects = useMemo(() => projects.filter(p => p.disposition === 'Loyalty'), [projects])

  // Apply search filter
  const searched = useMemo(() => search.trim()
    ? live.filter(p => {
        const q = search.toLowerCase()
        return p.name?.toLowerCase().includes(q) ||
          p.id?.toLowerCase().includes(q) ||
          p.city?.toLowerCase().includes(q) ||
          p.address?.toLowerCase().includes(q)
      })
    : live, [live, search])

  // Apply search filter to loyalty projects too
  const searchedLoyalty = useMemo(() => search.trim()
    ? loyaltyProjects.filter(p => {
        const q = search.toLowerCase()
        return p.name?.toLowerCase().includes(q) ||
          p.id?.toLowerCase().includes(q) ||
          p.city?.toLowerCase().includes(q) ||
          p.address?.toLowerCase().includes(q)
      })
    : loyaltyProjects, [loyaltyProjects, search])

  // ── Apply smart filters ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!hasActiveFilters) return searched
    return searched.filter(p => {
      if (filters.stages.size > 0 && !filters.stages.has(p.stage)) return false
      if (filters.financier && p.financier !== filters.financier) return false
      if (filters.ahj && p.ahj !== filters.ahj) return false
      if (filters.blockedOnly && !p.blocker) return false
      if (filters.daysRange && !matchesDaysRange(p, filters.daysRange)) return false
      return true
    })
  }, [searched, filters, hasActiveFilters])

  // Apply smart filters to loyalty too
  const filteredLoyalty = useMemo(() => {
    if (!hasActiveFilters) return searchedLoyalty
    return searchedLoyalty.filter(p => {
      if (filters.stages.size > 0 && !filters.stages.has(p.stage)) return false
      if (filters.financier && p.financier !== filters.financier) return false
      if (filters.ahj && p.ahj !== filters.ahj) return false
      if (filters.blockedOnly && !p.blocker) return false
      if (filters.daysRange && !matchesDaysRange(p, filters.daysRange)) return false
      return true
    })
  }, [searchedLoyalty, filters, hasActiveFilters])

  const sorted = useMemo(() => [...filtered].sort((a, b) => priority(a) - priority(b)), [filtered])
  const blocked = useMemo(() => sorted.filter(p => p.blocker), [sorted])
  const complete = useMemo(() => sorted.filter(p => p.stage === 'complete'), [sorted])

  // Today's date string, stable across renders
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])

  // Follow-ups: projects with task-level or project-level follow_up_date today or overdue
  const followUps = useMemo(() => {
    const today = todayStr
    const taskFollowUpMap: Record<string, { date: string; taskName: string }> = {}
    for (const t of taskStates) {
      if (t.follow_up_date && t.follow_up_date <= today) {
        const existing = taskFollowUpMap[t.project_id]
        if (!existing || t.follow_up_date < existing.date) {
          const taskName = ALL_TASKS_MAP[t.task_id] ?? t.task_id
          taskFollowUpMap[t.project_id] = { date: t.follow_up_date, taskName }
        }
      }
    }
    return sorted
      .filter(p => (p.follow_up_date && p.follow_up_date <= today) || taskFollowUpMap[p.id])
      .map((p): ProjectWithFollowUp => ({ ...p, _taskFollowUp: taskFollowUpMap[p.id] ?? null, _followUpDate: taskFollowUpMap[p.id]?.date ?? p.follow_up_date ?? null }))
      // localeCompare is safe for YYYY-MM-DD format — lexicographic order matches chronological order
      .sort((a, b) => (a._followUpDate ?? '').localeCompare(b._followUpDate ?? ''))
  }, [sorted, taskStates, todayStr])

  // ── Dynamic queue sections from config ────────────────────────────────
  const COLOR_MAP: Record<string, string> = {
    blue: 'text-blue-400', indigo: 'text-indigo-400', purple: 'text-purple-400',
    teal: 'text-teal-400', cyan: 'text-cyan-400', green: 'text-green-400',
    red: 'text-red-400', amber: 'text-amber-400', gray: 'text-gray-400',
    yellow: 'text-yellow-400', pink: 'text-pink-400', orange: 'text-orange-400',
  }
  const COLOR_HOVER: Record<string, string> = {
    blue: 'hover:text-blue-300', indigo: 'hover:text-indigo-300', purple: 'hover:text-purple-300',
    teal: 'hover:text-teal-300', cyan: 'hover:text-cyan-300', green: 'hover:text-green-300',
    red: 'hover:text-red-300', amber: 'hover:text-amber-300', gray: 'hover:text-gray-300',
    yellow: 'hover:text-yellow-300', pink: 'hover:text-pink-300', orange: 'hover:text-orange-300',
  }

  const dynamicSections = useMemo(() => {
    return queueSections.map(sec => {
      const statuses = new Set(sec.match_status.split(',').map(s => s.trim()))
      const items = sorted.filter(p => {
        if (p.stage === 'complete') return false
        const s = taskMap[p.id]?.[sec.task_id]?.status
        return s ? statuses.has(s) : false
      })
      return { ...sec, items }
    })
  }, [sorted, taskMap, queueSections])

  // Active = everything not in a special section
  const active = useMemo(() => {
    const specialPids = new Set<string>()
    for (const sec of dynamicSections) {
      for (const p of sec.items) specialPids.add(p.id)
    }
    for (const p of blocked) specialPids.add(p.id)
    for (const p of complete) specialPids.add(p.id)
    return sorted.filter(p => !specialPids.has(p.id) && p.stage !== 'complete')
  }, [sorted, dynamicSections, blocked, complete])

  // ── Stat card metrics ──────────────────────────────────────────────────
  const portfolioValue = useMemo(() => live.reduce((s, p) => s + (Number(p.contract) || 0), 0), [live])

  // Ref for scrolling to follow-ups section
  const followUpsRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to follow-ups when linked from Command (?section=followups)
  const scrolledToSection = useRef(false)
  useEffect(() => {
    if (scrolledToSection.current || loading) return
    if (searchParams.get('section') === 'followups' && followUpsRef.current) {
      scrolledToSection.current = true
      setCollapsed(prev => ({ ...prev, followups: false }))
      // Slight delay to ensure DOM is painted before scrolling
      setTimeout(() => {
        followUpsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }, [loading, searchParams])

  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">You don&apos;t have permission to view this page.</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-green-400 text-sm animate-pulse">Loading your queue...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Queue" onNewProject={() => setShowNewProject(true)} />

      {/* ── Smart Filters Toolbar ─────────────────────────────────────── */}
      <div className="bg-gray-950 border-b border-gray-800 px-4 py-2 space-y-2">
        {/* Search, PM, count + stage chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-40 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          <select
            value={userPm}
            onChange={e => selectPm(e.target.value)}
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1"
          >
            <option value="">All PMs</option>
            {availablePms.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
          </select>
          <span className="text-xs text-gray-500">{projects.length} projects</span>
          <div className="h-4 w-px bg-gray-700 mx-1" />
          {FILTER_STAGES.map(stage => (
            <button
              key={stage}
              onClick={() => toggleStage(stage)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${
                filters.stages.has(stage)
                  ? 'bg-green-900/60 border-green-600 text-green-300'
                  : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
            >
              {STAGE_LABELS[stage]}
            </button>
          ))}
          <div className="h-4 w-px bg-gray-700 mx-1" />
          {/* Financier dropdown */}
          <select
            value={filters.financier}
            onChange={e => setFilters(prev => ({ ...prev, financier: e.target.value }))}
            className="text-[11px] bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:border-green-500"
          >
            <option value="">Financier: All</option>
            {distinctFinanciers.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          {/* AHJ dropdown */}
          <select
            value={filters.ahj}
            onChange={e => setFilters(prev => ({ ...prev, ahj: e.target.value }))}
            className="text-[11px] bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:border-green-500"
          >
            <option value="">AHJ: All</option>
            {distinctAHJs.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {/* Blocked toggle */}
          <button
            onClick={() => setFilters(prev => ({ ...prev, blockedOnly: !prev.blockedOnly }))}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${
              filters.blockedOnly
                ? 'bg-red-900/60 border-red-600 text-red-300'
                : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
            }`}
          >
            Blocked Only
          </button>
        </div>
        {/* Days range chips + Clear All + Select/Gear */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['<7', '7-30', '30-90', '90+'] as const).map(range => (
            <button
              key={range}
              onClick={() => setFilters(prev => ({ ...prev, daysRange: prev.daysRange === range ? '' : range }))}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${
                filters.daysRange === range
                  ? 'bg-blue-900/60 border-blue-600 text-blue-300'
                  : 'bg-gray-800/60 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
            >
              {range === '<7' ? '<7d' : range === '7-30' ? '7-30d' : range === '30-90' ? '30-90d' : '90+d'}
            </button>
          ))}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="text-[11px] px-2.5 py-1 rounded-full border border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 transition-colors ml-2"
            >
              Clear All
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!currentUser?.isSales && (
              <>
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
                {selectMode && selectedIds.size > 0 && (
                  <span className="text-xs text-green-400 font-medium">{selectedIds.size} selected</span>
                )}
              </>
            )}
            <button onClick={() => setShowCardConfig(true)} className="text-gray-400 hover:text-white transition-colors p-1" title="Card fields">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Stat Cards ────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-800 px-3 sm:px-6 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Total */}
          <button
            onClick={clearAllFilters}
            className={`rounded-lg px-4 py-2.5 text-left transition-colors border ${
              !hasActiveFilters ? 'border-green-600 bg-green-950/30' : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total</div>
            <div className="text-xl font-bold text-white font-mono">{filtered.length}</div>
          </button>
          {/* Blocked */}
          <button
            onClick={() => setFilters(prev => ({ ...prev, blockedOnly: !prev.blockedOnly }))}
            className={`rounded-lg px-4 py-2.5 text-left transition-colors border ${
              filters.blockedOnly ? 'border-red-600 bg-red-950/30' : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
            }`}
          >
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Blocked</div>
            <div className={`text-xl font-bold font-mono ${blocked.length ? 'text-red-400' : 'text-white'}`}>{blocked.length}</div>
          </button>
          {/* Follow-ups Due */}
          <button
            onClick={() => {
              if (collapsed.followups) toggleBucket('followups')
              followUpsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className="rounded-lg px-4 py-2.5 text-left transition-colors border border-gray-700 bg-gray-800/50 hover:border-amber-600"
          >
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Follow-ups</div>
            <div className={`text-xl font-bold font-mono ${followUps.length ? 'text-amber-400' : 'text-white'}`}>{followUps.length}</div>
          </button>
          {/* Portfolio Value */}
          <div className="rounded-lg px-4 py-2.5 text-left border border-gray-700 bg-gray-800/50">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Portfolio</div>
            <div className="text-xl font-bold text-white font-mono">{fmt$(portfolioValue)}</div>
          </div>
        </div>
      </div>

      {/* Queue list */}
      <div className={`flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 py-4 ${selectMode && selectedIds.size > 0 ? 'pb-20' : ''}`}>

        {/* Follow-ups Today */}
        <div ref={followUpsRef} className="mb-6 bg-amber-950/30 border border-amber-900/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => toggleBucket('followups')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBucket('followups') } }} aria-expanded={!collapsed.followups} aria-controls="section-followups" className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-amber-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.followups ? '▸' : '▾'}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                Follow-ups Today ({followUps.length})
              </button>
              <SortToggle sectionKey="followups" current={getSectionSort('followups')} onCycle={cycleSectionSort} />
              {selectMode && followUps.length > 0 && (
                <button
                  onClick={() => selectAll(followUps.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.followups && followUps.length === 0 && (
              <div className="text-xs text-gray-600 italic pl-6">No follow-ups due today. Set follow-up dates on tasks in the project panel.</div>
            )}
            {!collapsed.followups && sortProjects(followUps as unknown as Project[], getSectionSort('followups')).map(proj => {
              const p = followUps.find(f => f.id === proj.id) ?? proj as unknown as ProjectWithFollowUp
              return (
              <div
                key={p.id}
                onClick={() => {
                  if (selectMode) {
                    toggleSelect(p.id)
                  } else {
                    setSelectedProject(p)
                  }
                }}
                className={`bg-gray-800/80 hover:bg-gray-700 border rounded-lg p-3 mb-2 cursor-pointer transition-colors flex items-center gap-3 relative ${
                  selectedIds.has(p.id) ? 'border-green-500 ring-1 ring-green-500/30' : 'border-gray-700'
                }`}
              >
                {selectMode && <SelectCheckbox selected={selectedIds.has(p.id)} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">{p.name}</span>
                    <span className="text-xs text-gray-500">{p.id}</span>
                    <span className="text-xs text-gray-500">·</span>
                    <span className="text-xs text-green-400">{STAGE_LABELS[p.stage]}</span>
                    <FundingBadge funding={fundingMap[p.id]} onUpdate={async (key, val) => {
                      await db().from('project_funding').update({ [key]: val }).eq('project_id', p.id)
                      refreshAll()
                    }} />
                  </div>
                  {p.city && <div className="text-xs text-gray-400 mt-0.5">{p.city}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  {(p as ProjectWithFollowUp)._taskFollowUp && (
                    <div className="text-[10px] text-gray-400 mb-0.5">{(p as ProjectWithFollowUp)._taskFollowUp!.taskName}</div>
                  )}
                  <div className={`text-xs font-medium ${
                    (p as ProjectWithFollowUp)._followUpDate === todayStr ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {!(p as ProjectWithFollowUp)._followUpDate
                      ? '—'
                      : (p as ProjectWithFollowUp)._followUpDate === todayStr
                        ? 'Today'
                        : `${daysAgo((p as ProjectWithFollowUp)._followUpDate)}d overdue`}
                  </div>
                </div>
              </div>
              )
            })}
          </div>

        {dynamicSections.map(sec => sec.items.length > 0 && (
          <div key={sec.id} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket(sec.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBucket(sec.id) } }} aria-expanded={!collapsed[sec.id]} aria-controls={`section-${sec.id}`} className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-left transition-colors flex-1 ${COLOR_MAP[sec.color] ?? 'text-gray-400'} ${COLOR_HOVER[sec.color] ?? 'hover:text-gray-300'}`}>
                <span className="text-[10px]">{collapsed[sec.id] ? '▸' : '▾'}</span>
                {sec.icon} {sec.label} ({sec.items.length})
              </button>
              <SortToggle sectionKey={sec.id} current={getSectionSort(sec.id)} onCycle={cycleSectionSort} />
              {selectMode && (
                <button
                  onClick={() => selectAll(sec.items.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed[sec.id] && sortProjects(sec.items, getSectionSort(sec.id)).map(p => (
              <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields}
                selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect}
                fundingMap={fundingMap} currentUser={currentUser} onRefresh={refreshAll} todayStr={todayStr} />
            ))}
          </div>
        ))}

        {blocked.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('blocked')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBucket('blocked') } }} aria-expanded={!collapsed.blocked} aria-controls="section-blocked" className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-red-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.blocked ? '▸' : '▾'}</span>
                Blocked ({blocked.length})
              </button>
              <SortToggle sectionKey="blocked" current={getSectionSort('blocked')} onCycle={cycleSectionSort} />
              {selectMode && (
                <button
                  onClick={() => selectAll(blocked.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.blocked && sortProjects(blocked, getSectionSort('blocked')).map(p => (
              <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields}
                selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect}
                fundingMap={fundingMap} currentUser={currentUser} onRefresh={refreshAll} todayStr={todayStr} />
            ))}
          </div>
        )}

        {active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('active')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBucket('active') } }} aria-expanded={!collapsed.active} aria-controls="section-active" className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-gray-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.active ? '▸' : '▾'}</span>
                Active ({active.length})
              </button>
              <SortToggle sectionKey="active" current={getSectionSort('active')} onCycle={cycleSectionSort} />
              {selectMode && (
                <button
                  onClick={() => selectAll(active.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.active && sortProjects(active, getSectionSort('active')).map(p => (
              <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields}
                selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect}
                fundingMap={fundingMap} currentUser={currentUser} onRefresh={refreshAll} todayStr={todayStr} />
            ))}
          </div>
        )}

        {filteredLoyalty.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('loyalty')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBucket('loyalty') } }} aria-expanded={!collapsed.loyalty} aria-controls="section-loyalty" className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-purple-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.loyalty ? '▸' : '▾'}</span>
                Loyalty ({filteredLoyalty.length})
              </button>
              <SortToggle sectionKey="loyalty" current={getSectionSort('loyalty')} onCycle={cycleSectionSort} />
              {selectMode && (
                <button
                  onClick={() => selectAll(filteredLoyalty.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.loyalty && sortProjects(filteredLoyalty, getSectionSort('loyalty')).map(p => (
              <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields}
                selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect}
                fundingMap={fundingMap} currentUser={currentUser} onRefresh={refreshAll} todayStr={todayStr} />
            ))}
          </div>
        )}

        {complete.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('complete')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBucket('complete') } }} aria-expanded={!collapsed.complete} aria-controls="section-complete" className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-2 text-left hover:text-gray-500 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.complete ? '▸' : '▾'}</span>
                Complete ({complete.length})
              </button>
              {/* #15: Descending sort shows most recently completed first — correct UX for tracking completions */}
              <SortToggle sectionKey="complete" current={getSectionSort('complete')} onCycle={cycleSectionSort} />
              {selectMode && (
                <button
                  onClick={() => selectAll(complete.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.complete && sortProjects(complete, getSectionSort('complete')).map(p => (
              <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields}
                selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect}
                fundingMap={fundingMap} currentUser={currentUser} onRefresh={refreshAll} todayStr={todayStr} />
            ))}
          </div>
        )}

        {projects.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <div className="text-3xl mb-3">&#10003;</div>
            <div>No projects assigned to you.</div>
          </div>
        )}

        {projects.length > 0 && filtered.length === 0 && hasActiveFilters && (
          <div className="text-center py-12 text-gray-500 text-sm">
            No projects found matching your filters.
          </div>
        )}

        {projects.length > 0 && filtered.length > 0 && blocked.length === 0 && active.length === 0 && complete.length === 0 && filteredLoyalty.length === 0 && followUps.length === 0 && dynamicSections.every(s => s.items.length === 0) && (
          <div className="text-center py-12 text-gray-500 text-sm">
            No projects in any section{hasActiveFilters ? ' matching your filters' : ''}.
          </div>
        )}
      </div>

      {/* ── Bulk Action Bar ─────────────────────────────────────────── */}
      {selectMode && selectedIds.size > 0 && (
        <BulkActionBar
          selectedIds={selectedIds}
          selectedProjects={selectedProjects}
          currentUser={currentUser}
          onComplete={handleBulkComplete}
          onExit={exitSelectMode}
          actions={['reassign', 'blocker', 'disposition', 'followup']}
        />
      )}

      {selectedProject && !selectMode && (
        <ProjectPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onProjectUpdated={refreshAll}
        />
      )}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={() => { setShowNewProject(false); refreshAll() }}
          existingIds={projects.map(p => p.id)}
          pms={availablePms}
        />
      )}
      {showCardConfig && (
        <CardFieldsModal
          selected={cardFields}
          onSave={(fields) => { updatePref('queue_card_fields', fields); setShowCardConfig(false) }}
          onClose={() => setShowCardConfig(false)}
        />
      )}
    </div>
  )
}

// ── Sort Toggle Button ───────────────────────────────────────────────────────

function SortToggle({ sectionKey, current, onCycle }: { sectionKey: string; current: SectionSortKey; onCycle: (key: string) => void }) {
  const labels: Record<SectionSortKey, string> = { days: 'Days', contract: 'Value', name: 'Name' }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onCycle(sectionKey) }}
      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors px-1.5 py-0.5 rounded border border-gray-700/50 hover:border-gray-600"
      title={`Sort by: ${labels[current]}`}
    >
      <ArrowUpDown className="w-3 h-3" />
      {labels[current]}
    </button>
  )
}

// ── Funding Badge ────────────────────────────────────────────────────────────

function FundingBadge({ funding, onUpdate }: { funding?: FundingRecord; onUpdate?: (milestone: string, status: string) => void }) {
  const [showDropdown, setShowDropdown] = useState(false)

  if (!funding) return null

  const milestones: { label: string; key: string; status: string | null }[] = [
    { label: 'M3', key: 'm3_status', status: funding.m3_status },
    { label: 'M2', key: 'm2_status', status: funding.m2_status },
    { label: 'M1', key: 'm1_status', status: funding.m1_status },
  ]

  const active = milestones.find(m => m.status && m.status !== 'Not Eligible')
  if (!active || !active.status) return null

  const statusShort: Record<string, string> = { Eligible: 'Eligible', Submitted: 'Sub', Funded: 'Funded', Rejected: 'Rej' }
  const statusColor: Record<string, string> = { Eligible: 'text-green-400', Submitted: 'text-blue-400', Funded: 'text-emerald-300', Rejected: 'text-red-400' }
  const display = statusShort[active.status] ?? active.status
  const color = statusColor[active.status] ?? 'text-gray-400'

  return (
    <span className="relative ml-1">
      <button onClick={e => { e.stopPropagation(); if (onUpdate) setShowDropdown(!showDropdown) }}
        className={`text-[10px] font-medium ${color} ${onUpdate ? 'hover:underline cursor-pointer' : ''}`}>
        {active.label}: {display}
      </button>
      {showDropdown && onUpdate && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-xl z-50 py-1 min-w-[120px]"
          onClick={e => e.stopPropagation()}>
          {['Submitted', 'Funded', 'Rejected'].map(s => (
            <button key={s} onClick={() => { onUpdate(active.key, s); setShowDropdown(false) }}
              className={`block w-full text-left px-3 py-1 text-[10px] hover:bg-gray-700 ${statusColor[s] ?? 'text-gray-400'}`}>
              {active.label}: {s}
            </button>
          ))}
          <button onClick={() => setShowDropdown(false)} className="block w-full text-left px-3 py-1 text-[10px] text-gray-500 hover:bg-gray-700">Cancel</button>
        </div>
      )}
    </span>
  )
}

// ── Last Activity Indicator ──────────────────────────────────────────────────

function LastActivity({ p }: { p: Project }) {
  const days = daysAgo(p.stage_date) // Best available proxy
  if (days > 5) {
    return <span className="text-[10px] text-amber-400 font-medium">Stale {days}d</span>
  }
  return <span className="text-[10px] text-gray-600">{days}d ago</span>
}

// ── Card field renderer ──────────────────────────────────────────────────────

function renderCardField(key: string, p: Project) {
  switch (key) {
    case 'name': return null
    case 'city': return p.city ? <span key={key}>{p.city}</span> : null
    case 'address': return p.address ? <span key={key}>{p.address}</span> : null
    case 'financier': return p.financier ? <span key={key}>{p.financier}</span> : null
    case 'contract': return p.contract ? <span key={key}>{fmt$(p.contract)}</span> : null
    case 'systemkw': return p.systemkw ? <span key={key}>{p.systemkw} kW</span> : null
    case 'ahj': return p.ahj ? <span key={key}>{p.ahj}</span> : null
    case 'pm': return p.pm ? <span key={key}>{p.pm}</span> : null
    case 'stage': return <span key={key} className="text-green-400">{STAGE_LABELS[p.stage]}</span>
    case 'sale_date': return p.sale_date ? <span key={key}>{fmtDate(p.sale_date)}</span> : null
    default: return null
  }
}

// ── Queue Card ───────────────────────────────────────────────────────────────

function QueueCard({ p, taskMap, onOpen, cardFields, selectMode, isSelected, onToggleSelect, fundingMap, currentUser, onRefresh, todayStr }: {
  p: Project
  taskMap: Record<string, TaskEntry>
  onOpen: (p: Project) => void
  cardFields: string[]
  selectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  fundingMap: Record<string, FundingRecord>
  currentUser: { name?: string; id?: string } | null
  onRefresh: () => void
  todayStr: string
}) {
  const sla = getSLA(p)
  const nextTask = getNextTask(p, taskMap)
  const stuck = getStuckTasks(p, taskMap)
  const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date)

  const metaFields = cardFields.filter(k => k !== 'name' && k !== 'stage')
  const showStageInHeader = cardFields.includes('stage')

  // Inline quick action states
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [followUpDate, setFollowUpDate] = useState('')
  const [showQuickNote, setShowQuickNote] = useState(false)
  const [quickNote, setQuickNote] = useState('')
  const [quickNoteSubmitting, setQuickNoteSubmitting] = useState(false)
  const [clearingBlocker, setClearingBlocker] = useState(false)

  const handleSetFollowUp = useCallback(async (date: string) => {
    if (!date) return
    try {
      await updateProject(p.id, { follow_up_date: date })
      setShowDatePicker(false)
      setFollowUpDate('')
      onRefresh()
    } catch (err) {
      console.error('Failed to set follow-up date:', err)
      alert('Failed to set follow-up date. Please try again.')
    }
  }, [p.id, onRefresh])

  const handleClearBlocker = useCallback(async () => {
    if (!p.blocker) return
    if (!window.confirm(`Clear blocker on ${p.name}?`)) return
    setClearingBlocker(true)
    try {
      // Log to audit
      await db().from('audit_log').insert({
        project_id: p.id,
        field: 'blocker',
        old_value: p.blocker,
        new_value: null,
        changed_by: currentUser?.name ?? 'unknown',
        changed_by_id: currentUser?.id ?? null,
      })
      await updateProject(p.id, { blocker: null })
      onRefresh()
    } finally {
      setClearingBlocker(false)
    }
  }, [p.id, p.name, p.blocker, currentUser, onRefresh])

  const handleQuickNote = useCallback(async () => {
    if (!quickNote.trim()) return
    setQuickNoteSubmitting(true)
    try {
      await addNote({
        project_id: p.id,
        text: quickNote.trim(),
        time: new Date().toISOString(),
        pm: currentUser?.name ?? null,
        pm_id: currentUser?.id ?? null,
      })
      setQuickNote('')
      setShowQuickNote(false)
    } catch (err) {
      console.error('Failed to add note:', err)
      alert('Failed to add note. Please try again.')
      // Note text is preserved on failure — not cleared
    } finally {
      setQuickNoteSubmitting(false)
    }
  }, [quickNote, p.id, currentUser])

  return (
    <div className="mb-3">
      <div
        onClick={() => {
          if (selectMode && onToggleSelect) {
            onToggleSelect(p.id)
          } else {
            onOpen(p)
          }
        }}
        className={`group bg-gray-800 hover:bg-gray-700 border rounded-xl p-4 cursor-pointer transition-colors relative ${
          isSelected ? 'border-green-500 ring-1 ring-green-500/30' : 'border-gray-700'
        }`}
      >
        {selectMode && (
          <SelectCheckbox selected={!!isSelected} />
        )}
        <div className="flex items-start gap-3">
          {/* Priority dot */}
          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
            p.blocker ? 'bg-red-500' : STATUS_COLOR[sla.status]
          }`} />

          <div className="flex-1 min-w-0">
            {/* Name + ID + stage + funding */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white text-sm">{p.name}</span>
              <span className="text-xs text-gray-500">{p.id}</span>
              {showStageInHeader && <>
                <span className="text-xs text-gray-500">·</span>
                <span className="text-xs text-green-400">{STAGE_LABELS[p.stage]}</span>
              </>}
              <FundingBadge funding={fundingMap[p.id]} />
            </div>

            {/* Meta row driven by cardFields */}
            {metaFields.length > 0 && (
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-400 flex-wrap">
                {metaFields.map((key, i) => {
                  const el = renderCardField(key, p)
                  if (!el) return null
                  return <span key={key} className="flex items-center gap-1">{i > 0 && <span className="text-gray-600 mx-1">·</span>}{el}</span>
                })}
              </div>
            )}

            {/* Blocker */}
            {p.blocker && (
              <div className="mt-2 text-xs text-red-400 bg-red-950 rounded-lg px-3 py-1.5 flex items-center gap-2">
                <span className="flex-1">{p.blocker}</span>
                {!selectMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClearBlocker() }}
                    className="text-red-500 hover:text-red-300 transition-colors flex-shrink-0"
                    title="Clear blocker"
                    disabled={clearingBlocker}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* Stuck tasks */}
            {stuck.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {stuck.map(t => (
                  <div key={t.name} className={`flex items-baseline gap-1.5 text-xs rounded-lg px-2.5 py-1 ${
                    t.status === 'Pending Resolution'
                      ? 'bg-red-950 text-red-300'
                      : 'bg-amber-950 text-amber-300'
                  }`}>
                    <span>{t.status === 'Pending Resolution' ? '⏸' : '↩'}</span>
                    <span className="font-medium">{t.name}</span>
                    {t.reason && (
                      <>
                        <span className="opacity-50">--</span>
                        <span className="opacity-75">{t.reason}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Next task */}
            {!p.blocker && stuck.length === 0 && nextTask && (
              <div className="mt-2 text-xs text-gray-400">
                Next: <span className="text-white">{nextTask}</span>
              </div>
            )}
          </div>

          {/* Right side — SLA + cycle + last activity + quick actions */}
          <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
            <div className={`text-sm font-bold font-mono ${
              p.blocker ? 'text-red-400' :
              sla.status === 'crit' ? 'text-red-400' :
              sla.status === 'risk' ? 'text-amber-400' :
              sla.status === 'warn' ? 'text-yellow-400' :
              'text-gray-400'
            }`}>{sla.days}d</div>
            <div className="text-xs text-gray-600">{cycle}d total</div>
            <LastActivity p={p} />
            {/* Quick action icons */}
            {!selectMode && (
              <div className="flex items-center gap-1.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDatePicker(!showDatePicker) }}
                  className="text-gray-500 hover:text-green-400 transition-colors p-0.5"
                  title="Set follow-up date"
                >
                  <Calendar className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowQuickNote(!showQuickNote) }}
                  className="text-gray-500 hover:text-blue-400 transition-colors p-0.5"
                  title="Quick note"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline follow-up date picker */}
      {showDatePicker && !selectMode && (
        <div className="mt-1 ml-5 flex items-center gap-2 bg-gray-850 rounded-lg px-3 py-2 border border-gray-700" onClick={e => e.stopPropagation()}>
          <Calendar className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          <input
            type="date"
            value={followUpDate}
            onChange={e => setFollowUpDate(e.target.value)}
            min={todayStr}
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:border-green-500"
            autoFocus
          />
          <button
            onClick={() => handleSetFollowUp(followUpDate)}
            disabled={!followUpDate}
            className="text-xs px-2 py-1 rounded bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Set
          </button>
          <button
            onClick={() => { setShowDatePicker(false); setFollowUpDate('') }}
            className="text-xs text-gray-500 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Inline quick note */}
      {showQuickNote && !selectMode && (
        <div className="mt-1 ml-5 flex items-center gap-2 bg-gray-850 rounded-lg px-3 py-2 border border-gray-700" onClick={e => e.stopPropagation()}>
          <MessageSquare className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
          <input
            value={quickNote}
            onChange={e => setQuickNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuickNote() }}
            placeholder="Add a note..."
            className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1 focus:outline-none focus:border-green-500 placeholder-gray-500"
            autoFocus
          />
          <button
            onClick={handleQuickNote}
            disabled={!quickNote.trim() || quickNoteSubmitting}
            className="text-xs px-2 py-1 rounded bg-green-700 text-white hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {quickNoteSubmitting ? '...' : 'Add'}
          </button>
          <button
            onClick={() => { setShowQuickNote(false); setQuickNote('') }}
            className="text-xs text-gray-500 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Card Fields Modal ────────────────────────────────────────────────────────

function CardFieldsModal({ selected, onSave, onClose }: {
  selected: string[]
  onSave: (fields: string[]) => void
  onClose: () => void
}) {
  const [fields, setFields] = useState<Set<string>>(new Set(selected))

  function toggle(key: string) {
    setFields(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-xs mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-white">Card Fields</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {CARD_FIELD_OPTIONS.map(opt => (
            <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={fields.has(opt.key)} onChange={() => toggle(opt.key)}
                className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500 focus:ring-offset-gray-900" />
              <span className={`text-xs ${fields.has(opt.key) ? 'text-gray-200' : 'text-gray-500'}`}>{opt.label}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800">
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md px-3 py-1.5">Cancel</button>
          <button onClick={() => onSave([...fields])} className="text-xs bg-green-600 hover:bg-green-500 text-white font-medium rounded-md px-3 py-1.5">Save</button>
        </div>
      </div>
    </div>
  )
}
