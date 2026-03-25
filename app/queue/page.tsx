'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'
import { ALL_TASKS_MAP } from '@/lib/tasks'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { usePreferences } from '@/lib/usePreferences'
import { useSupabaseQuery, useServerFilter } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { BulkActionBar, useBulkSelect, SelectCheckbox } from '@/components/BulkActionBar'
import type { Project } from '@/types/database'

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

// Now carries status + reason per task
interface TaskEntry { status: string; reason?: string }
interface TaskStateRow { project_id: string; task_id: string; status: string; reason?: string | null; follow_up_date?: string | null }

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

// ── Configurable queue sections ──────────────────────────────────────────
interface QueueSectionConfig { id: string; label: string; task_id: string; match_status: string; color: string; icon: string; sort_order: number }
const HARDCODED_SECTIONS: QueueSectionConfig[] = [
  { id: 'hc-1', label: 'City Permit Approval — Ready to Start', task_id: 'city_permit', match_status: 'Ready To Start', color: 'blue', icon: '📋', sort_order: 1 },
  { id: 'hc-2', label: 'City Permit — Submitted, Pending Approval', task_id: 'city_permit', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'indigo', icon: '📄', sort_order: 2 },
  { id: 'hc-3', label: 'Utility Permit — Submitted, Pending Approval', task_id: 'util_permit', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'purple', icon: '📄', sort_order: 3 },
  { id: 'hc-4', label: 'Utility Inspection — Ready to Start', task_id: 'util_insp', match_status: 'Ready To Start', color: 'teal', icon: '⚡', sort_order: 4 },
  { id: 'hc-5', label: 'Utility Inspection — Submitted, Pending Approval', task_id: 'util_insp', match_status: 'In Progress,Scheduled,Pending Resolution,Revision Required', color: 'cyan', icon: '⚡', sort_order: 5 },
]

export default function QueuePage() {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [showNewProject, setShowNewProject] = useState(false)
  const [userPm, setUserPm] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mg_pm') ?? ''
    return ''
  })
  const [search, setSearch] = useState('')
  const [showCardConfig, setShowCardConfig] = useState(false)
  const { prefs, updatePref } = usePreferences()
  const cardFields = prefs.queue_card_fields

  // ── Queue sections from DB (with hardcoded fallback) ───────────────────
  const [queueSections, setQueueSections] = useState<QueueSectionConfig[]>(HARDCODED_SECTIONS)

  const { data: queueSectionsData } = useSupabaseQuery('queue_sections' as any, {
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
  // Build PM filter for useSupabaseQuery
  const pmFilters = useMemo(() => {
    const f: Record<string, any> = {}
    if (userPm) f.pm_id = { eq: userPm }
    return f
  }, [userPm])

  // ── Task IDs needed for queue sections ─────────────────────────────────
  const queueTaskIds = useMemo(() => {
    const sectionTaskIds = queueSections.map(s => s.task_id)
    return [...new Set(['city_permit', 'util_permit', 'util_insp', 'welcome', 'ia', 'ub', 'sched_survey', 'ntp', ...sectionTaskIds])]
  }, [queueSections])

  // ── Query 1: Projects with PM filter ─────────────────────
  const {
    data: projectsRaw,
    loading: projectsLoading,
    refresh: refreshProjects,
  } = useSupabaseQuery('projects', {
    select: 'id, name, city, address, pm, pm_id, stage, stage_date, sale_date, contract, blocker, financier, disposition, follow_up_date',
    filters: pmFilters,
    limit: 5000,
    subscribe: true,
  })
  const projects = projectsRaw as unknown as Project[]

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

  // ── Merge task data + follow-up data ───────────────────────────────────
  const taskStates: TaskStateRow[] = useMemo(() => {
    const allTasks: TaskStateRow[] = [...(taskDataRaw as unknown as TaskStateRow[])]
    for (const fu of followUpDataRaw as any[]) {
      const existing = allTasks.find(t => t.project_id === fu.project_id && t.task_id === fu.task_id)
      if (existing) {
        existing.follow_up_date = fu.follow_up_date
      } else {
        allTasks.push({ project_id: fu.project_id, task_id: fu.task_id, status: '', follow_up_date: fu.follow_up_date })
      }
    }
    return allTasks
  }, [taskDataRaw, followUpDataRaw])

  // ── Extract PM dropdown from loaded projects ───────────────────────────
  const availablePms = useMemo(() => {
    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
    return [...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [projects])

  // ── Refresh all queries ────────────────────────────────────────────────
  const refreshAll = useCallback(() => {
    refreshProjects()
    refreshTasks()
    refreshFollowUps()
  }, [refreshProjects, refreshTasks, refreshFollowUps])

  const { user: currentUser } = useCurrentUser()

  // ── Bulk selection ────────────────────────────────────────────────────
  const {
    selectMode, setSelectMode, selectedIds, selectedProjects,
    toggleSelect, selectAll, deselectAll, exitSelectMode,
  } = useBulkSelect(projects)

  const handleBulkComplete = useCallback(() => {
    exitSelectMode()
    refreshAll()
  }, [exitSelectMode, refreshAll])

  function selectPm(pm: string) {
    setUserPm(pm)
    localStorage.setItem('mg_pm', pm)
  }

  const loading = projectsLoading || tasksLoading

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
    followups: false, blocked: true, active: true, loyalty: true, complete: true,
  }))
  const toggleBucket = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // Build task map per project: { projectId: { taskId: { status, reason } } }
  const taskMap = useMemo(() => {
    const map: Record<string, Record<string, TaskEntry>> = {}
    for (const t of taskStates) {
      if (!map[t.project_id]) map[t.project_id] = {}
      map[t.project_id][t.task_id] = {
        status: t.status,
        reason: t.reason ?? undefined,
      }
    }
    return map
  }, [taskStates])

  // In Service, Cancelled, and Loyalty projects excluded from main sections
  // Loyalty gets its own collapsible section below
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

  const sorted = useMemo(() => [...searched].sort((a, b) => priority(a) - priority(b)), [searched])
  const blocked = useMemo(() => sorted.filter(p => p.blocker), [sorted])
  const complete = useMemo(() => sorted.filter(p => p.stage === 'complete'), [sorted])

  // Follow-ups: projects with task-level or project-level follow_up_date today or overdue
  const followUps = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
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
      .map(p => ({ ...p, _taskFollowUp: taskFollowUpMap[p.id] ?? null, _followUpDate: taskFollowUpMap[p.id]?.date ?? p.follow_up_date }))
      .sort((a, b) => (a._followUpDate ?? '').localeCompare(b._followUpDate ?? ''))
  }, [sorted, taskStates])

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-green-400 text-sm animate-pulse">Loading your queue...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Queue" onNewProject={() => setShowNewProject(true)} right={<>
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
          <button onClick={() => setShowCardConfig(true)} className="text-gray-400 hover:text-white transition-colors p-1" title="Card fields">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </>} />

      {/* Stats + Search */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-6 px-6 py-3">
        <div>
          <div className="text-xs text-gray-500">Total</div>
          <div className="text-xl font-bold text-white font-mono">{live.length}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Blocked</div>
          <div className={`text-xl font-bold font-mono ${blocked.length ? 'text-red-400' : 'text-white'}`}>{blocked.length}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Critical</div>
          <div className={`text-xl font-bold font-mono ${active.filter(p => getSLA(p).status === 'crit').length ? 'text-red-400' : 'text-white'}`}>
            {active.filter(p => getSLA(p).status === 'crit').length}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Portfolio</div>
          <div className="text-xl font-bold text-white font-mono">
            {fmt$(live.reduce((s, p) => s + (Number(p.contract) || 0), 0))}
          </div>
        </div>

      </div>

      {/* Queue list */}
      <div className={`flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 py-4 ${selectMode && selectedIds.size > 0 ? 'pb-20' : ''}`}>

        <div className="mb-6 bg-amber-950/30 border border-amber-900/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => toggleBucket('followups')} className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-amber-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.followups ? '▸' : '▾'}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                Follow-ups Today ({followUps.length})
              </button>
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
            {!collapsed.followups && followUps.map(p => (
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
                  </div>
                  {p.city && <div className="text-xs text-gray-400 mt-0.5">{p.city}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  {(p as any)._taskFollowUp && (
                    <div className="text-[10px] text-gray-400 mb-0.5">{(p as any)._taskFollowUp.taskName}</div>
                  )}
                  <div className={`text-xs font-medium ${
                    (p as any)._followUpDate === new Date().toISOString().split('T')[0] ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {(p as any)._followUpDate === new Date().toISOString().split('T')[0]
                      ? 'Today'
                      : `${daysAgo((p as any)._followUpDate)}d overdue`}
                  </div>
                </div>
              </div>
            ))}
          </div>

        {dynamicSections.map(sec => sec.items.length > 0 && (
          <div key={sec.id} className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket(sec.id)} className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-left transition-colors flex-1 ${COLOR_MAP[sec.color] ?? 'text-gray-400'} ${COLOR_HOVER[sec.color] ?? 'hover:text-gray-300'}`}>
                <span className="text-[10px]">{collapsed[sec.id] ? '▸' : '▾'}</span>
                {sec.icon} {sec.label} ({sec.items.length})
              </button>
              {selectMode && (
                <button
                  onClick={() => selectAll(sec.items.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed[sec.id] && sec.items.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields} selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect} />)}
          </div>
        ))}

        {blocked.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('blocked')} className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-red-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.blocked ? '▸' : '▾'}</span>
                🚫 Blocked ({blocked.length})
              </button>
              {selectMode && (
                <button
                  onClick={() => selectAll(blocked.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.blocked && blocked.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields} selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect} />)}
          </div>
        )}

        {active.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('active')} className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-gray-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.active ? '▸' : '▾'}</span>
                Active ({active.length})
              </button>
              {selectMode && (
                <button
                  onClick={() => selectAll(active.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.active && active.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields} selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect} />)}
          </div>
        )}

        {searchedLoyalty.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('loyalty')} className="text-xs font-bold text-purple-400 uppercase tracking-wider flex items-center gap-2 text-left hover:text-purple-300 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.loyalty ? '▸' : '▾'}</span>
                💜 Loyalty ({searchedLoyalty.length})
              </button>
              {selectMode && (
                <button
                  onClick={() => selectAll(searchedLoyalty.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.loyalty && searchedLoyalty.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields} selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect} />)}
          </div>
        )}

        {complete.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => toggleBucket('complete')} className="text-xs font-bold text-gray-600 uppercase tracking-wider flex items-center gap-2 text-left hover:text-gray-500 transition-colors flex-1">
                <span className="text-[10px]">{collapsed.complete ? '▸' : '▾'}</span>
                Complete ({complete.length})
              </button>
              {selectMode && (
                <button
                  onClick={() => selectAll(complete.map(p => p.id))}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
                >
                  Select All
                </button>
              )}
            </div>
            {!collapsed.complete && complete.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} cardFields={cardFields} selectMode={selectMode} isSelected={selectedIds.has(p.id)} onToggleSelect={toggleSelect} />)}
          </div>
        )}

        {projects.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <div className="text-3xl mb-3">✓</div>
            <div>No projects assigned to you.</div>
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

function QueueCard({ p, taskMap, onOpen, cardFields, selectMode, isSelected, onToggleSelect }: {
  p: Project
  taskMap: Record<string, TaskEntry>
  onOpen: (p: Project) => void
  cardFields: string[]
  selectMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const sla = getSLA(p)
  const nextTask = getNextTask(p, taskMap)
  const stuck = getStuckTasks(p, taskMap)
  const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date)

  const metaFields = cardFields.filter(k => k !== 'name' && k !== 'stage')
  const showStageInHeader = cardFields.includes('stage')

  return (
    <div
      onClick={() => {
        if (selectMode && onToggleSelect) {
          onToggleSelect(p.id)
        } else {
          onOpen(p)
        }
      }}
      className={`bg-gray-800 hover:bg-gray-700 border rounded-xl p-4 mb-3 cursor-pointer transition-colors relative ${
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
          {/* Name + ID + stage */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{p.name}</span>
            <span className="text-xs text-gray-500">{p.id}</span>
            {showStageInHeader && <>
              <span className="text-xs text-gray-500">·</span>
              <span className="text-xs text-green-400">{STAGE_LABELS[p.stage]}</span>
            </>}
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
            <div className="mt-2 text-xs text-red-400 bg-red-950 rounded-lg px-3 py-1.5">
              {p.blocker}
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

        {/* Right side — SLA + cycle */}
        <div className="text-right flex-shrink-0">
          <div className={`text-sm font-bold font-mono ${
            p.blocker ? 'text-red-400' :
            sla.status === 'crit' ? 'text-red-400' :
            sla.status === 'risk' ? 'text-amber-400' :
            sla.status === 'warn' ? 'text-yellow-400' :
            'text-gray-400'
          }`}>{sla.days}d</div>
          <div className="text-xs text-gray-600 mt-0.5">{cycle}d total</div>
        </div>
      </div>
    </div>
  )
}

function CardFieldsModal({ selected, onSave, onClose }: {
  selected: string[]
  onSave: (fields: string[]) => void
  onClose: () => void
}) {
  const [fields, setFields] = useState<Set<string>>(new Set(selected))

  function toggle(key: string) {
    setFields(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
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
