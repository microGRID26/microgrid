'use client'

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react'
import { Nav } from '@/components/Nav'
import { ALL_TASKS_MAP } from '@/lib/tasks'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { usePreferences } from '@/lib/usePreferences'
import { useSupabaseQuery, usePmFilter } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { handleApiError } from '@/lib/errors'
import { useSearchParams } from 'next/navigation'
import { BulkActionBar, useBulkSelect } from '@/components/BulkActionBar'
import { db } from '@/lib/db'
import type { Project } from '@/types/database'

import { buildTaskMap } from '@/lib/queue-task-map'
import type { TaskStateRow } from '@/lib/queue-task-map'

import {
  FilterToolbar,
  StatCards,
  FollowUpsSection,
  QueueSection,
  CardFieldsModal,
  // types
  EMPTY_FILTERS,
  HARDCODED_SECTIONS,
  COLOR_MAP,
  COLOR_HOVER,
  // helpers
  priority,
  matchesDaysRange,
} from './components'
import type {
  QueueFilters,
  QueueSectionConfig,
  FundingRecord,
  ProjectWithFollowUp,
  SectionSortKey,
} from './components'

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

  // Load display names for short dropdown labels (AHJ, financier)
  const [ahjDisplayNames, setAhjDisplayNames] = useState<Map<string, string>>(new Map())
  const [financierDisplayNames, setFinancierDisplayNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    Promise.all([
      db().from('ahjs').select('name, display_name').limit(2000),
      db().from('financiers').select('name, display_name').limit(500),
    ]).then(([ahjRes, finRes]) => {
      const ahjMap = new Map<string, string>()
      for (const a of (ahjRes.data ?? []) as { name: string; display_name: string | null }[]) { if (a.display_name) ahjMap.set(a.name, a.display_name) }
      setAhjDisplayNames(ahjMap)
      const finMap = new Map<string, string>()
      for (const f of (finRes.data ?? []) as { name: string; display_name: string | null }[]) { if (f.display_name) finMap.set(f.name, f.display_name) }
      setFinancierDisplayNames(finMap)
    }).catch(err => handleApiError(err, '[queue] display_name load'))
  }, [])

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
    followups: searchParams.get('section') !== 'followups',
    blocked: true, active: true, loyalty: true, complete: true,
    // Dynamic sections default collapsed — toggled by key on render
  }))
  // Default all sections to collapsed (undefined → true)
  const isCollapsed = (key: string) => collapsed[key] !== false
  const toggleBucket = (key: string) => setCollapsed(prev => ({ ...prev, [key]: prev[key] === false }))

  // Build task map per project
  const taskMap = useMemo(() => buildTaskMap(taskStates), [taskStates])

  // Inactive dispositions excluded from main sections
  const live = useMemo(() => projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Cancelled' && p.disposition !== 'Loyalty' && p.disposition !== 'Legal' && p.disposition !== 'On Hold'), [projects])
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
      <FilterToolbar
        search={search}
        onSearchChange={setSearch}
        userPm={userPm}
        onPmChange={selectPm}
        availablePms={availablePms}
        projectCount={projects.length}
        filters={filters}
        onToggleStage={toggleStage}
        onSetFilters={setFilters}
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
        distinctFinanciers={distinctFinanciers}
        distinctAHJs={distinctAHJs}
        financierDisplayNames={financierDisplayNames}
        ahjDisplayNames={ahjDisplayNames}
        selectMode={selectMode}
        selectedCount={selectedIds.size}
        onToggleSelectMode={() => setSelectMode(true)}
        onExitSelectMode={exitSelectMode}
        onShowCardConfig={() => setShowCardConfig(true)}
        isSales={!!currentUser?.isSales}
      />

      {/* ── Stat Cards ────────────────────────────────────────────────── */}
      <StatCards
        filteredCount={filtered.length}
        blockedCount={blocked.length}
        followUpsCount={followUps.length}
        portfolioValue={portfolioValue}
        hasActiveFilters={hasActiveFilters}
        filters={filters}
        onClearAllFilters={clearAllFilters}
        onToggleBlocked={() => setFilters(prev => ({ ...prev, blockedOnly: !prev.blockedOnly }))}
        onScrollToFollowUps={() => {
          if (isCollapsed("followups")) toggleBucket('followups')
          followUpsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
      />

      {/* Queue list */}
      <div className={`flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 py-4 ${selectMode && selectedIds.size > 0 ? 'pb-20' : ''}`}>

        {/* Follow-ups Today */}
        <FollowUpsSection
          ref={followUpsRef}
          followUps={followUps}
          isCollapsed={isCollapsed("followups")}
          onToggle={() => toggleBucket('followups')}
          getSectionSort={getSectionSort('followups')}
          onCycleSort={cycleSectionSort}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onSelectAll={selectAll}
          onToggleSelect={toggleSelect}
          onOpenProject={setSelectedProject}
          fundingMap={fundingMap}
          onRefresh={refreshAll}
          todayStr={todayStr}
        />

        {dynamicSections.map(sec => sec.items.length > 0 && (
          <QueueSection
            key={sec.id}
            sectionKey={sec.id}
            label={<>{sec.icon} {sec.label} ({sec.items.length})</>}
            labelClassName={`${COLOR_MAP[sec.color] ?? 'text-gray-400'} ${COLOR_HOVER[sec.color] ?? 'hover:text-gray-300'}`}
            items={sec.items}
            isCollapsed={isCollapsed(sec.id)}
            onToggle={() => toggleBucket(sec.id)}
            getSectionSort={getSectionSort(sec.id)}
            onCycleSort={cycleSectionSort}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onSelectAll={selectAll}
            onToggleSelect={toggleSelect}
            onOpenProject={setSelectedProject}
            taskMap={taskMap}
            cardFields={cardFields}
            fundingMap={fundingMap}
            currentUser={currentUser}
            onRefresh={refreshAll}
            todayStr={todayStr}
          />
        ))}

        <QueueSection
          sectionKey="blocked"
          label={<>Blocked ({blocked.length})</>}
          labelClassName="text-red-400 hover:text-red-300"
          items={blocked}
          isCollapsed={isCollapsed("blocked")}
          onToggle={() => toggleBucket('blocked')}
          getSectionSort={getSectionSort('blocked')}
          onCycleSort={cycleSectionSort}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onSelectAll={selectAll}
          onToggleSelect={toggleSelect}
          onOpenProject={setSelectedProject}
          taskMap={taskMap}
          cardFields={cardFields}
          fundingMap={fundingMap}
          currentUser={currentUser}
          onRefresh={refreshAll}
          todayStr={todayStr}
        />

        <QueueSection
          sectionKey="active"
          label={<>Active ({active.length})</>}
          labelClassName="text-gray-400 hover:text-gray-300"
          items={active}
          isCollapsed={isCollapsed("active")}
          onToggle={() => toggleBucket('active')}
          getSectionSort={getSectionSort('active')}
          onCycleSort={cycleSectionSort}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onSelectAll={selectAll}
          onToggleSelect={toggleSelect}
          onOpenProject={setSelectedProject}
          taskMap={taskMap}
          cardFields={cardFields}
          fundingMap={fundingMap}
          currentUser={currentUser}
          onRefresh={refreshAll}
          todayStr={todayStr}
        />

        <QueueSection
          sectionKey="loyalty"
          label={<>Loyalty ({filteredLoyalty.length})</>}
          labelClassName="text-purple-400 hover:text-purple-300"
          items={filteredLoyalty}
          isCollapsed={isCollapsed("loyalty")}
          onToggle={() => toggleBucket('loyalty')}
          getSectionSort={getSectionSort('loyalty')}
          onCycleSort={cycleSectionSort}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onSelectAll={selectAll}
          onToggleSelect={toggleSelect}
          onOpenProject={setSelectedProject}
          taskMap={taskMap}
          cardFields={cardFields}
          fundingMap={fundingMap}
          currentUser={currentUser}
          onRefresh={refreshAll}
          todayStr={todayStr}
        />

        <QueueSection
          sectionKey="complete"
          label={<>Complete ({complete.length})</>}
          labelClassName="text-gray-600 hover:text-gray-500"
          items={complete}
          isCollapsed={isCollapsed("complete")}
          onToggle={() => toggleBucket('complete')}
          getSectionSort={getSectionSort('complete')}
          onCycleSort={cycleSectionSort}
          selectMode={selectMode}
          selectedIds={selectedIds}
          onSelectAll={selectAll}
          onToggleSelect={toggleSelect}
          onOpenProject={setSelectedProject}
          taskMap={taskMap}
          cardFields={cardFields}
          fundingMap={fundingMap}
          currentUser={currentUser}
          onRefresh={refreshAll}
          todayStr={todayStr}
        />

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
