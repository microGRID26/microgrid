'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadProjectsByIds, loadTickets, upsertTaskState, insertTaskHistory, loadTodaySchedule } from '@/lib/api'
import { loadCrewsByIds } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS, STAGE_ORDER, STAGE_TASKS } from '@/lib/utils'
import { MetricCard, ActionRow, ActionSection, PipelineBar } from './components/CommandWidgets'
import { ExportModal } from './components/ExportModal'
import { SalesPulseCard } from './components/SalesPulseCard'
import { classify, getStuckTasks } from '@/lib/classify'
import type { TaskEntry } from '@/lib/classify'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useSupabaseQuery, usePmFilter, useOrg } from '@/lib/hooks'
import { useRouter } from 'next/navigation'
import type { Project, Schedule } from '@/types/database'
import QADailyDriver from '@/components/qa/QADailyDriver'

/** Schedule entry enriched with project/crew names for today's schedule display */
type ScheduleEntry = Schedule & { project_name?: string | null; crew_name?: string | null }

interface TaskStateRow {
  project_id: string
  task_id: string
  status: string
  reason?: string | null
  completed_date: string | null
  follow_up_date?: string | null
}

// ── SORT HELPERS ──────────────────────────────────────────────────────────────
type SortCol = 'name' | 'stage' | 'days' | 'blocker' | 'nextTask' | 'contract' | 'followUp'
type SortDir = 'asc' | 'desc'

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function CommandPage() {
  const supabase = createClient()
  const router = useRouter()
  const { user: currentUser } = useCurrentUser()
  const { orgId } = useOrg()

  // ── Data queries via useSupabaseQuery ────────────────────────────────────
  const projectsQuery = useSupabaseQuery('projects', {
    select: 'id, name, city, pm, pm_id, stage, stage_date, sale_date, contract, blocker, disposition, address, financier, follow_up_date, consultant, advisor, install_complete_date',
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled', 'Legal', 'On Hold'] } },
    order: { column: 'stage_date', ascending: true },
    limit: 5000,
  })

  // Load stuck + complete tasks, plus tasks with follow_up dates
  const taskQuery = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, status, reason, completed_date, follow_up_date',
    filters: { status: { in: ['Pending Resolution', 'Revision Required', 'Complete'] } },
    limit: 50000,
  })

  // Separate query for follow-up tasks (any status with a follow_up_date)
  const followUpQuery = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, status, reason, follow_up_date',
    filters: { follow_up_date: { isNot: null } },
    limit: 10000,
  })

  const projects = (projectsQuery.data ?? []) as unknown as Project[]
  const taskStates = (taskQuery.data ?? []) as unknown as TaskStateRow[]
  const followUpTasks = (followUpQuery.data ?? []) as unknown as TaskStateRow[]
  const loading = projectsQuery.loading || taskQuery.loading

  // ── Schedule (manual — requires enrichment with project/crew names) ──────
  const [todaySchedule, setTodaySchedule] = useState<ScheduleEntry[]>([])
  const [scheduleIncomplete, setScheduleIncomplete] = useState(false)

  const loadSchedule = useCallback(async () => {
    setScheduleIncomplete(false)
    const { data: schedData, error: schedError } = await loadTodaySchedule(orgId ?? undefined)

    if (schedError) { handleApiError(schedError, '[command] schedule load'); return }
    if (!schedData || schedData.length === 0) return

    const rawJobs = schedData as ScheduleEntry[]
    let enrichmentFailed = false
    const schedPids = [...new Set(rawJobs.map((j) => j.project_id).filter(Boolean))]
    const projNameMap: Record<string, string> = {}
    if (schedPids.length > 0) {
      try {
        const projs = await loadProjectsByIds(schedPids as string[])
        projs.forEach((p) => { projNameMap[p.id] = p.name })
      } catch (e) { handleApiError(e, '[command] loadProjectsByIds'); enrichmentFailed = true }
    }
    const schedCids = [...new Set(rawJobs.map((j) => j.crew_id).filter(Boolean))]
    const crewNameMap: Record<string, string> = {}
    if (schedCids.length > 0) {
      try {
        const crews = await loadCrewsByIds(schedCids as string[])
        crews.forEach((c) => { crewNameMap[c.id] = c.name })
      } catch (e) { handleApiError(e, '[command] loadCrewsByIds'); enrichmentFailed = true }
    }
    if (enrichmentFailed) setScheduleIncomplete(true)
    rawJobs.forEach((j: ScheduleEntry) => {
      j.project_name = projNameMap[j.project_id] ?? null
      j.crew_name = crewNameMap[j.crew_id] ?? null
    })
    setTodaySchedule(rawJobs)
  }, [orgId])

  useEffect(() => { loadSchedule() }, [loadSchedule])

  const refresh = useCallback(() => {
    projectsQuery.refresh()
    taskQuery.refresh()
    followUpQuery.refresh()
    loadSchedule()
  }, [projectsQuery.refresh, taskQuery.refresh, followUpQuery.refresh, loadSchedule])

  // ── Auth ─────────────────────────────────────────────────────────────────
  const [user, setUser] = useState<{ email: string } | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUser({ email: user.email ?? '' })
    })
  }, [supabase])

  // ── UI state ─────────────────────────────────────────────────────────────
  const [search, setSearch] = useState<string>('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedTab, setSelectedTab] = useState<'tasks' | 'notes' | 'info' | 'bom' | 'files' | undefined>(undefined)
  const [lastRefresh, setLastRefresh] = useState(0)
  const [minutesAgo, setMinutesAgo] = useState(0)
  const [showExport, setShowExport] = useState(false)
  const [stageFilter, setStageFilter] = useState<string | null>(null)

  // Action sections open/closed state
  const [stuckOpen, setStuckOpen] = useState(true)

  // Table sort
  const [sortCol, setSortCol] = useState<SortCol>('days')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // ── PM filter (shared hook) ─────────────────────────────────────────────
  const pmUsers = useMemo(() => {
    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
    return [...pmMap.entries()].map(([id, name]) => ({ id, name }))
  }, [projects])

  const { pmFilter, setPmFilter, pmOptions: pms, isMyProjects } = usePmFilter(pmUsers, 'command')

  // Fallback: if user has no PM entries, switch to 'all'
  useEffect(() => {
    if (pmFilter !== 'all' && pmFilter !== '' && projects.length > 0) {
      const hasProjects = projects.some(p => p.pm_id === pmFilter)
      if (!hasProjects) setPmFilter('all')
    }
  }, [pmFilter, setPmFilter, projects])

  // Track last refresh timestamp when data finishes loading
  const prevLoading = useRef(true)
  useEffect(() => {
    if (prevLoading.current && !loading) {
      setLastRefresh(Date.now())
    }
    prevLoading.current = loading
  }, [loading])

  // Update "minutes ago" display every 60 seconds
  useEffect(() => {
    if (!lastRefresh) return
    setMinutesAgo(Math.round((Date.now() - lastRefresh) / 60000))
    const interval = setInterval(() => {
      setMinutesAgo(Math.round((Date.now() - lastRefresh) / 60000))
    }, 60000)
    return () => clearInterval(interval)
  }, [lastRefresh])

  // Build task map: { projectId: { taskId: { status, reason, completed_date } } }
  const taskMapAll = useMemo(() => {
    const map: Record<string, Record<string, TaskEntry>> = {}
    for (const t of taskStates) {
      if (!map[t.project_id]) map[t.project_id] = {}
      map[t.project_id][t.task_id] = {
        status: t.status,
        reason: t.reason ?? undefined,
        completed_date: t.completed_date,
      }
    }
    return map
  }, [taskStates])

  // Filtered projects (PM + search + sales role)
  const filtered = useMemo(() => {
    let result = projects
    // Sales role: only show projects where consultant or advisor matches user name
    if (currentUser?.isSales && currentUser.name) {
      const salesName = currentUser.name.toLowerCase()
      result = result.filter(p =>
        p.consultant?.toLowerCase() === salesName ||
        p.advisor?.toLowerCase() === salesName
      )
    }
    if (pmFilter !== 'all') {
      result = result.filter(p => p.pm_id === pmFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.id?.toLowerCase().includes(q) ||
        p.city?.toLowerCase().includes(q) ||
        p.pm?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q)
      )
    }
    return result
  }, [projects, pmFilter, search, currentUser])

  // Active projects (exclude Cancelled, In Service, Loyalty, complete)
  const activeProjects = useMemo(() =>
    filtered.filter(p =>
      p.disposition !== 'Cancelled' &&
      p.disposition !== 'In Service' &&
      p.disposition !== 'Loyalty' &&
      p.disposition !== 'Legal' &&
      p.disposition !== 'On Hold' &&
      p.stage !== 'complete'
    ),
    [filtered]
  )

  // ── Follow-ups due today or overdue ──────────────────────────────────────
  const followUpsDue = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const projectTaskMap = new Map<string, { taskId: string; taskName: string; followUpDate: string; daysOverdue: number }>()

    // Check task-level follow-ups
    for (const t of followUpTasks) {
      if (!t.follow_up_date) continue
      const d = t.follow_up_date
      if (d > today) continue // future, skip
      const overdue = daysAgo(d)
      const existing = projectTaskMap.get(t.project_id + ':' + t.task_id)
      if (!existing) {
        const taskDef = STAGE_TASKS[Object.keys(STAGE_TASKS).find(s =>
          STAGE_TASKS[s].some(st => st.id === t.task_id)
        ) ?? '']?.find(st => st.id === t.task_id)
        if (!taskDef) {
          console.warn(`Task ID "${t.task_id}" not found in STAGE_TASKS`)
        }
        const fallbackName = t.task_id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        projectTaskMap.set(t.project_id + ':' + t.task_id, {
          taskId: t.task_id,
          taskName: taskDef?.name ?? fallbackName,
          followUpDate: d,
          daysOverdue: overdue,
        })
      }
    }

    // Also check project-level follow_up_date
    for (const p of activeProjects) {
      if (p.follow_up_date && p.follow_up_date <= today) {
        projectTaskMap.set(p.id + ':project', {
          taskId: 'project',
          taskName: 'Project Follow-up',
          followUpDate: p.follow_up_date,
          daysOverdue: daysAgo(p.follow_up_date),
        })
      }
    }

    // Merge with project data
    const items: { project: Project; taskName: string; followUpDate: string; daysOverdue: number }[] = []
    const projectMap = new Map(filtered.map(p => [p.id, p]))

    for (const [key, info] of projectTaskMap) {
      const pid = key.split(':')[0]
      const project = projectMap.get(pid)
      if (!project) continue
      // Respect PM filter
      if (pmFilter !== 'all' && project.pm_id !== pmFilter) continue
      items.push({ project, taskName: info.taskName, followUpDate: info.followUpDate, daysOverdue: info.daysOverdue })
    }

    return items.sort((a, b) => b.daysOverdue - a.daysOverdue)
  }, [followUpTasks, activeProjects, filtered, pmFilter])

  // ── Blocked projects ────────────────────────────────────────────────────
  const blockedProjects = useMemo(() =>
    activeProjects.filter(p => p.blocker).sort((a, b) => daysAgo(b.stage_date) - daysAgo(a.stage_date)),
    [activeProjects]
  )

  // ── Stuck tasks ──────────────────────────────────────────────────────────
  const stuckItems = useMemo(() => {
    const items: { project: Project; taskId: string; taskName: string; status: string; reason: string }[] = []
    for (const p of activeProjects) {
      const tasks = getStuckTasks(p, taskMapAll[p.id] ?? {})
      for (const t of tasks) {
        items.push({ project: p, taskId: t.id, taskName: t.name, status: t.status, reason: t.reason })
      }
    }
    return items
  }, [activeProjects, taskMapAll])

  // ── Stats ───────────────────────────────────────────────────────────────
  const totalContract = useMemo(() =>
    activeProjects.reduce((s, p) => s + (Number(p.contract) || 0), 0),
    [activeProjects]
  )

  const installsThisMonth = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    return filtered.filter(p => {
      const d = p.install_complete_date
      if (!d) return false
      const dt = new Date(d + 'T00:00:00')
      return dt.getFullYear() === year && dt.getMonth() === month
    }).length
  }, [filtered])

  // ── Ticket counts ────────────────────────────────────────────────────────
  const [myTicketCount, setMyTicketCount] = useState(0)
  useEffect(() => {
    if (!currentUser?.name) return
    loadTickets({}).then(tix => {
      const mine = tix.filter(t => t.assigned_to === currentUser.name && !['resolved', 'closed'].includes(t.status))
      setMyTicketCount(mine.length)
    }).catch(e => handleApiError(e, '[command] loadTickets'))
  }, [currentUser?.name])

  // For classify (still used for overdue/pending detection)
  const { overduePids, pendingPids } = useMemo(() => {
    const overdue = new Set<string>()
    const pending = new Set<string>()
    for (const t of taskStates) {
      if ((t.status === 'Pending Resolution' || t.status === 'Revision Required') &&
          t.follow_up_date && daysAgo(t.follow_up_date) > 0) {
        overdue.add(t.project_id)
      }
      if (t.status === 'Pending Resolution') {
        pending.add(t.project_id)
      }
    }
    return { overduePids: overdue, pendingPids: pending }
  }, [taskStates])

  // Keep classify available for compatibility
  const sections = useMemo(() => classify(filtered, overduePids, pendingPids), [filtered, overduePids, pendingPids])

  // ── Next task helper ────────────────────────────────────────────────────
  const getNextTask = useCallback((p: Project): string => {
    const tasks = STAGE_TASKS[p.stage] ?? []
    const projTasks = taskMapAll[p.id] ?? {}
    for (const t of tasks) {
      const status = projTasks[t.id]?.status ?? 'Not Ready'
      if (status !== 'Complete') return t.name
    }
    return '—'
  }, [taskMapAll])

  // ── Project table data ──────────────────────────────────────────────────
  const tableProjects = useMemo(() => {
    let list = activeProjects
    if (stageFilter) {
      list = list.filter(p => p.stage === stageFilter)
    }
    // Pre-compute getNextTask for all items to avoid repeated lookups in comparator
    const nextTaskCache = new Map(list.map(p => [p.id, getNextTask(p)]))
    // Sort
    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'name':
          cmp = (a.name ?? '').localeCompare(b.name ?? '')
          break
        case 'stage': {
          const ai = STAGE_ORDER.indexOf(a.stage)
          const bi = STAGE_ORDER.indexOf(b.stage)
          cmp = ai - bi
          break
        }
        case 'days':
          cmp = daysAgo(a.stage_date) - daysAgo(b.stage_date)
          break
        case 'blocker':
          cmp = (a.blocker ? 1 : 0) - (b.blocker ? 1 : 0)
          break
        case 'nextTask':
          cmp = (nextTaskCache.get(a.id) ?? '').localeCompare(nextTaskCache.get(b.id) ?? '')
          break
        case 'contract':
          cmp = (Number(a.contract) || 0) - (Number(b.contract) || 0)
          break
        case 'followUp':
          cmp = (a.follow_up_date ?? '9999').localeCompare(b.follow_up_date ?? '9999')
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [activeProjects, stageFilter, sortCol, sortDir, getNextTask])

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir(col === 'name' || col === 'nextTask' ? 'asc' : 'desc')
    }
  }

  function sortIcon(col: SortCol) {
    if (sortCol !== col) return ''
    return sortDir === 'asc' ? ' ▲' : ' ▼'
  }

  // ── Follow-up date display helper ───────────────────────────────────────
  function renderFollowUp(date: string | null | undefined) {
    if (!date) return <span className="text-gray-600">—</span>
    const today = new Date().toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    if (date < today) return <span className="text-red-400">{daysAgo(date)}d overdue</span>
    if (date === today) return <span className="text-amber-400">Today</span>
    if (date === tomorrow) return <span className="text-blue-400">Tomorrow</span>
    return <span className="text-gray-400">{fmtDate(date)}</span>
  }

  // Open project panel with optional tab
  function openProject(p: Project, tab?: 'tasks' | 'notes' | 'info' | 'bom' | 'files') {
    setSelectedProject(p)
    setSelectedTab(tab)
  }

  const userLoading = !currentUser

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-green-400 text-sm animate-pulse">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">

      {/* ── TOP NAV ──────────────────────────────────────────────────────── */}
      <Nav active="Command" onNewProject={() => setShowNewProject(true)} />

      {/* ── QA DAILY DRIVER ─────────────────────────────────────────────── */}
      <QADailyDriver />

      {/* ── FILTER BAR ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex flex-wrap items-center gap-2">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search projects..."
          aria-label="Search projects"
          className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-44 focus:outline-none focus:border-green-500 placeholder-gray-500"
        />
        <div className="flex items-center bg-gray-800 rounded-md border border-gray-700" role="group" aria-label="Project filter toggle">
          <button
            onClick={() => setPmFilter(currentUser?.id ?? 'all')}
            disabled={userLoading}
            aria-label="Show my projects"
            aria-pressed={isMyProjects}
            className={`text-xs px-3 py-1.5 rounded-l-md transition-colors disabled:opacity-50 ${isMyProjects ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            My Projects
          </button>
          <button
            onClick={() => setPmFilter('all')}
            disabled={userLoading}
            aria-label="Show all projects"
            aria-pressed={!isMyProjects}
            className={`text-xs px-3 py-1.5 rounded-r-md transition-colors disabled:opacity-50 ${!isMyProjects ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            All
          </button>
        </div>
        {!isMyProjects && (
          <select value={pmFilter} onChange={e => setPmFilter(e.target.value)}
            aria-label="Filter by PM"
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All PMs</option>
            {pms.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
          </select>
        )}
        <span className="text-xs text-gray-500">
          {activeProjects.length} active
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={refresh} aria-label="Refresh data" className="text-xs text-gray-500 hover:text-white transition-colors">
            ↻ {minutesAgo}m ago
          </button>
          <button onClick={() => setShowExport(true)}
            aria-label="Export projects to CSV"
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* ── PERSONAL STATS ROW ─────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <MetricCard
            label="My Active"
            value={activeProjects.length}
            accent="border-green-600"
          />
          <MetricCard
            label="Blocked"
            value={blockedProjects.length}
            accent={blockedProjects.length > 0 ? 'border-red-500' : 'border-gray-700'}
            onClick={() => router.push('/queue?blockedOnly=true')}
          />
          <MetricCard
            label="Follow-ups Due"
            value={followUpsDue.length}
            accent={followUpsDue.length > 0 ? 'border-amber-500' : 'border-gray-700'}
            onClick={() => router.push('/queue?section=followups')}
          />
          <MetricCard
            label="My Tickets"
            value={myTicketCount}
            accent={myTicketCount > 0 ? 'border-orange-500' : 'border-gray-700'}
            onClick={() => router.push(`/tickets?assigned=${encodeURIComponent(currentUser?.name ?? '')}`)}
          />
          <MetricCard
            label="Installs This Month"
            value={installsThisMonth}
            accent="border-blue-500"
          />
          <MetricCard
            label="Portfolio Value"
            value={totalContract >= 1000000 ? `$${(totalContract / 1000000).toFixed(1)}M` : fmt$(totalContract)}
            accent="border-gray-700"
          />
        </div>
      </div>

      {/* ── MAIN SCROLLABLE CONTENT ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 py-4 space-y-4">

          {/* Sales pulse — admin / non-sales only (sales reps see their own pipeline) */}
          {!currentUser?.isSales && (
            <SalesPulseCard onRepClick={(rep) => setSearch(rep)} />
          )}

          {/* ── ACTION ITEMS ──────────────────────────────────────────── */}
          <div className="space-y-3">

            {/* Fix These First — stuck/blocked projects */}
            <ActionSection
              title="Fix These First"
              count={stuckItems.length}
              color="text-red-400"
              open={stuckOpen}
              onToggle={() => setStuckOpen(!stuckOpen)}
            >
              {stuckItems.map((item, i) => (
                <ActionRow key={`${item.project.id}-${item.taskName}-${i}`} onClick={() => openProject(item.project, 'tasks')}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    item.status === 'Pending Resolution' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">
                      {item.status === 'Pending Resolution' ? 'Resolve' : 'Revise'}: {item.taskName}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {item.project.name} · {item.project.id}
                      {item.reason && <span className="text-gray-600"> — {item.reason}</span>}
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (!confirm(`Resolve "${item.taskName}" on ${item.project.name}? This sets it to In Progress.`)) return
                      await upsertTaskState({ project_id: item.project.id, task_id: item.taskId, status: 'In Progress', reason: null })
                      await insertTaskHistory({ project_id: item.project.id, task_id: item.taskId, status: 'In Progress', changed_by: currentUser?.name ?? 'Unknown' })
                      refresh()
                    }}
                    className="text-xs px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded-md font-medium flex-shrink-0"
                  >Resolve</button>
                </ActionRow>
              ))}
            </ActionSection>
          </div>

          {/* ── PIPELINE SNAPSHOT ─────────────────────────────────────── */}
          <PipelineBar
            projects={filtered}
            stageFilter={stageFilter}
            onStageClick={setStageFilter}
          />

          {/* ── TODAY'S SCHEDULE WIDGET ──────────────────────────────── */}
          {todaySchedule.length > 0 && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="text-xs text-green-400 font-bold uppercase tracking-wider mb-3">
                Today&apos;s Schedule ({todaySchedule.length})
                {scheduleIncomplete && <span className="text-amber-400 font-normal ml-2">Schedule data incomplete</span>}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {todaySchedule.map(job => {
                  const j = job
                  const statusColor = j.status === 'complete' ? 'bg-green-400' : j.status === 'in_progress' ? 'bg-amber-400' : 'bg-blue-400'
                  const proj = filtered.find(p => p.id === job.project_id)
                  return (
                    <div
                      key={job.id}
                      onClick={() => proj && openProject(proj)}
                      className="flex-shrink-0 bg-gray-900 rounded-lg px-3 py-2 min-w-[180px] cursor-pointer hover:bg-gray-700 transition-colors"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                        <span className="text-xs font-medium text-white truncate">{j.project_name ?? job.project_id}</span>
                      </div>
                      <div className="text-xs text-gray-400">{job.job_type} · {job.time ?? 'TBD'}</div>
                      {j.crew_name && <div className="text-xs text-gray-500 mt-0.5">{j.crew_name}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── PUSH THESE FORWARD — next actionable task per project ── */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-sm text-gray-300 font-bold uppercase tracking-wider">
                Push These Forward
              </span>
              <a href="/queue" className="text-xs text-green-400 hover:text-green-300 transition-colors">
                Full worklist →
              </a>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {(() => {
                const actionItems = filtered
                  .filter(p => !p.blocker)
                  .map(p => {
                    const next = getNextTask(p)
                    const days = daysAgo(p.stage_date)
                    return { project: p, nextTask: next, days }
                  })
                  .filter(item => item.nextTask && item.nextTask !== '—')
                  .sort((a, b) => b.days - a.days)
                  .slice(0, 20)

                if (actionItems.length === 0) {
                  return (
                    <div className="px-4 py-8 text-center text-gray-600 text-sm">
                      Nothing to push — all projects are on track or need fixes above
                    </div>
                  )
                }

                return actionItems.map(({ project: p, nextTask, days }) => (
                  <div
                    key={p.id}
                    onClick={() => openProject(p)}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-700 border-b border-gray-800/50 transition-colors"
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      days >= 30 ? 'bg-red-500' : days >= 14 ? 'bg-amber-500' : 'bg-green-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">{nextTask}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {p.name} · {STAGE_LABELS[p.stage]} · {days}d
                        {p.pm && !isMyProjects && <span className="text-gray-600"> · {p.pm}</span>}
                      </div>
                    </div>
                    {p.follow_up_date && (
                      <div className="text-xs flex-shrink-0">{renderFollowUp(p.follow_up_date)}</div>
                    )}
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Export modal */}
      {showExport && (
        <ExportModal projects={filtered} onClose={() => setShowExport(false)} />
      )}

      {/* Full Project Panel modal */}
      {selectedProject && (
        <ProjectPanel
          project={selectedProject}
          onClose={() => { setSelectedProject(null); setSelectedTab(undefined) }}
          onProjectUpdated={refresh}
          initialTab={selectedTab}
        />
      )}

      {/* New Project modal */}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={() => { setShowNewProject(false); refresh() }}
          existingIds={projects.map(p => p.id)}
          pms={pms}
        />
      )}
    </div>
  )
}
