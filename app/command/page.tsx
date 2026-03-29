'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadProjectsByIds } from '@/lib/api'
import { loadCrewsByIds } from '@/lib/api'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS, STAGE_ORDER, STAGE_TASKS } from '@/lib/utils'
import { exportProjectsCSV, ALL_EXPORT_FIELDS, DEFAULT_EXPORT_KEYS } from '@/lib/export-utils'
import { classify, cycleDays, getSLA, getStuckTasks } from '@/lib/classify'
import type { Section, TaskEntry, StuckTask } from '@/lib/classify'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { usePreferences } from '@/lib/usePreferences'
import type { ExportPreset } from '@/lib/usePreferences'
import { useSupabaseQuery, usePmFilter } from '@/lib/hooks'
import { useRouter } from 'next/navigation'
import type { Project, Schedule } from '@/types/database'

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

// ── METRIC CARD ───────────────────────────────────────────────────────────────
function MetricCard({ label, value, accent, subtitle, onClick }: {
  label: string
  value: string | number
  accent?: string
  subtitle?: string
  onClick?: () => void
}) {
  const border = accent ?? 'border-gray-700'
  const textColor = accent
    ? accent.replace('border-', 'text-')
    : 'text-white'

  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-1 px-4 py-3 bg-gray-800 rounded-lg border ${border} hover:bg-gray-750 transition-colors text-left min-w-0`}
    >
      <span className="text-xs text-gray-500 uppercase tracking-wider whitespace-nowrap">{label}</span>
      <span className={`text-2xl font-bold font-mono ${textColor}`}>{value}</span>
      {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
    </button>
  )
}

// ── ACTION ITEM ROW ───────────────────────────────────────────────────────────
function ActionRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-800 border-b border-gray-800/50 transition-colors"
    >
      {children}
    </div>
  )
}

// ── COLLAPSIBLE SECTION ───────────────────────────────────────────────────────
function ActionSection({ title, count, color, open, onToggle, children }: {
  title: string
  count: number
  color: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors ${color} bg-opacity-5`}
      >
        <span className={`text-xs font-bold uppercase tracking-wider ${color}`}>{title}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${color} bg-gray-800`}>
          {count}
        </span>
        <span className="ml-auto text-gray-600 text-xs">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="bg-gray-900/50">{children}</div>}
    </div>
  )
}

// ── PIPELINE BAR ──────────────────────────────────────────────────────────────
const STAGE_COLORS: Record<string, string> = {
  evaluation: 'bg-blue-500',
  survey: 'bg-cyan-500',
  design: 'bg-violet-500',
  permit: 'bg-amber-500',
  install: 'bg-orange-500',
  inspection: 'bg-pink-500',
  complete: 'bg-green-500',
}

function PipelineBar({ projects, stageFilter, onStageClick }: {
  projects: Project[]
  stageFilter: string | null
  onStageClick: (stage: string | null) => void
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const s of STAGE_ORDER) c[s] = 0
    for (const p of projects) {
      if (p.disposition === 'Cancelled' || p.disposition === 'In Service' || p.disposition === 'Loyalty') continue
      c[p.stage] = (c[p.stage] ?? 0) + 1
    }
    return c
  }, [projects])

  const max = Math.max(...Object.values(counts), 1)

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Pipeline Snapshot</span>
        {stageFilter && (
          <button
            onClick={() => onStageClick(null)}
            className="text-xs text-green-400 hover:text-green-300 transition-colors"
          >
            Clear filter
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {STAGE_ORDER.filter(s => s !== 'complete').map(stage => {
          const count = counts[stage] ?? 0
          const pct = max > 0 ? (count / max) * 100 : 0
          const isActive = stageFilter === stage
          return (
            <button
              key={stage}
              onClick={() => onStageClick(isActive ? null : stage)}
              className={`w-full flex items-center gap-3 group transition-colors rounded px-1 py-0.5 ${isActive ? 'bg-gray-700' : 'hover:bg-gray-700/50'}`}
            >
              <span className="text-xs text-gray-400 w-20 text-right truncate">{STAGE_LABELS[stage] ?? stage}</span>
              <div className="flex-1 h-4 bg-gray-900 rounded overflow-hidden">
                <div
                  className={`h-full rounded transition-all ${STAGE_COLORS[stage] ?? 'bg-gray-500'} ${isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}
                  style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%` }}
                />
              </div>
              <span className="text-xs font-mono text-gray-300 w-8 text-right">{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── EXPORT FIELD PICKER ───────────────────────────────────────────────────────
const FIELD_GROUPS = [
  { label: 'Core',        keys: ['id','name','city','address','phone','email'] },
  { label: 'Project',     keys: ['stage','stage_date','pm','sale_date','contract','systemkw','financier','financing_type','disposition','blocker'] },
  { label: 'Team',        keys: ['advisor','consultant','dealer'] },
  { label: 'Permitting',  keys: ['ahj','utility','permit_number','utility_app_number','hoa','esid'] },
  { label: 'Dates',       keys: ['ntp_date','survey_scheduled_date','survey_date','install_scheduled_date','install_complete_date','city_permit_date','utility_permit_date','city_inspection_date','utility_inspection_date','pto_date','in_service_date'] },
  { label: 'Equipment',   keys: ['module','module_qty','inverter','inverter_qty','battery','battery_qty'] },
]

function ExportModal({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(DEFAULT_EXPORT_KEYS))
  const { prefs, updatePref } = usePreferences()
  const presets = prefs.export_presets
  const [presetName, setPresetName] = useState('')
  const [showSave, setShowSave] = useState(false)

  function toggle(key: string) {
    setSelected(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  function toggleGroup(keys: string[]) {
    const allOn = keys.every(k => selected.has(k))
    setSelected(s => {
      const n = new Set(s)
      keys.forEach(k => allOn ? n.delete(k) : n.add(k))
      return n
    })
  }

  function loadPreset(preset: ExportPreset) {
    setSelected(new Set(preset.keys))
  }

  function savePreset() {
    if (!presetName.trim()) return
    const newPreset: ExportPreset = { name: presetName.trim(), keys: [...selected] }
    const updated = [...presets.filter(p => p.name !== newPreset.name), newPreset]
    updatePref('export_presets', updated)
    setPresetName('')
    setShowSave(false)
  }

  function deletePreset(name: string) {
    updatePref('export_presets', presets.filter(p => p.name !== name))
  }

  function doExport() {
    exportProjectsCSV(projects, [...selected])
    onClose()
  }

  const fieldMap = Object.fromEntries(ALL_EXPORT_FIELDS.map(f => [f.key, f.label]))

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-white">Export CSV</h2>
            <p className="text-xs text-gray-500 mt-0.5">{projects.length} projects · {selected.size} fields selected</p>
          </div>
          <button onClick={onClose} aria-label="Close export dialog" className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Presets row */}
          <div className="flex items-center gap-2 flex-wrap">
            {presets.length > 0 && (
              <select
                onChange={e => {
                  const p = presets.find(pr => pr.name === e.target.value)
                  if (p) loadPreset(p)
                  e.target.value = ''
                }}
                defaultValue=""
                className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1"
              >
                <option value="" disabled>Load preset...</option>
                {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            )}
            {!showSave ? (
              <button onClick={() => setShowSave(true)}
                className="text-xs text-green-400 hover:text-green-300 transition-colors">Save preset</button>
            ) : (
              <div className="flex items-center gap-1">
                <input
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && savePreset()}
                  placeholder="Preset name"
                  className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1 w-28"
                  autoFocus
                />
                <button onClick={savePreset} className="text-xs text-green-400 hover:text-green-300">Save</button>
                <button onClick={() => setShowSave(false)} className="text-xs text-gray-500 hover:text-white">Cancel</button>
              </div>
            )}
            {presets.length > 0 && (
              <select
                onChange={e => {
                  if (e.target.value) deletePreset(e.target.value)
                  e.target.value = ''
                }}
                defaultValue=""
                className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1"
              >
                <option value="" disabled>Delete preset...</option>
                {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
            )}
          </div>

          <div className="flex items-center gap-2 mb-1">
            <button onClick={() => setSelected(new Set(DEFAULT_EXPORT_KEYS))}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Select all</button>
            <span className="text-gray-700">·</span>
            <button onClick={() => setSelected(new Set())}
              className="text-xs text-gray-400 hover:text-white transition-colors">Clear all</button>
          </div>
          {FIELD_GROUPS.map(group => (
            <div key={group.label}>
              <button onClick={() => toggleGroup(group.keys)} className="flex items-center gap-2 mb-2 group">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider group-hover:text-white transition-colors">
                  {group.label}
                </span>
                <span className="text-xs text-gray-600">
                  ({group.keys.filter(k => selected.has(k)).length}/{group.keys.length})
                </span>
              </button>
              <div className="grid grid-cols-2 gap-1">
                {group.keys.map(key => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)}
                      className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900" />
                    <span className={`text-xs transition-colors ${selected.has(key) ? 'text-gray-200' : 'text-gray-600'}`}>
                      {fieldMap[key] ?? key}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800">
          <button onClick={onClose}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md px-4 py-1.5 transition-colors">
            Cancel
          </button>
          <button onClick={doExport} disabled={selected.size === 0}
            className="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-medium rounded-md px-4 py-1.5 transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download CSV
          </button>
        </div>
      </div>
    </div>
  )
}

// ── SORT HELPERS ──────────────────────────────────────────────────────────────
type SortCol = 'name' | 'stage' | 'days' | 'blocker' | 'nextTask' | 'contract' | 'followUp'
type SortDir = 'asc' | 'desc'

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function CommandPage() {
  const supabase = createClient()
  const router = useRouter()
  const { user: currentUser } = useCurrentUser()

  // ── Data queries via useSupabaseQuery ────────────────────────────────────
  const projectsQuery = useSupabaseQuery('projects', {
    select: 'id, name, city, pm, pm_id, stage, stage_date, sale_date, contract, blocker, disposition, address, financier, follow_up_date, consultant, advisor, install_complete_date',
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
    const schedRes = await supabase.from('schedule')
      .select('id, project_id, job_type, time, status, crew_id')
      .eq('date', new Date().toISOString().slice(0, 10))
      .neq('status', 'cancelled')
      .order('time')

    if (schedRes.error) { console.error('schedule load failed:', schedRes.error); return }
    if (!schedRes.data) return

    const rawJobs = schedRes.data as ScheduleEntry[]
    let enrichmentFailed = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedPids = [...new Set(rawJobs.map((j: any) => j.project_id).filter(Boolean))]
    const projNameMap: Record<string, string> = {}
    if (schedPids.length > 0) {
      try {
        const projs = await loadProjectsByIds(schedPids as string[])
        projs.forEach((p) => { projNameMap[p.id] = p.name })
      } catch { enrichmentFailed = true }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedCids = [...new Set(rawJobs.map((j: any) => j.crew_id).filter(Boolean))]
    const crewNameMap: Record<string, string> = {}
    if (schedCids.length > 0) {
      try {
        const crews = await loadCrewsByIds(schedCids as string[])
        crews.forEach((c) => { crewNameMap[c.id] = c.name })
      } catch { enrichmentFailed = true }
    }
    if (enrichmentFailed) setScheduleIncomplete(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawJobs.forEach((j: any) => {
      j.project_name = projNameMap[j.project_id] ?? null
      j.crew_name = crewNameMap[j.crew_id] ?? null
    })
    setTodaySchedule(rawJobs)
  }, [supabase])

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
    const items: { project: Project; taskName: string; status: string; reason: string }[] = []
    for (const p of activeProjects) {
      const tasks = getStuckTasks(p, taskMapAll[p.id] ?? {})
      for (const t of tasks) {
        items.push({ project: p, taskName: t.name, status: t.status, reason: t.reason })
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const d = (p as any).install_complete_date
      if (!d) return false
      const dt = new Date(d + 'T00:00:00')
      return dt.getFullYear() === year && dt.getMonth() === month
    }).length
  }, [filtered])

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
      <Nav active="Command" onNewProject={() => setShowNewProject(true)} right={<>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search projects..."
            aria-label="Search projects"
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-44 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          {/* My Projects / All Projects toggle */}
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
              className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
              <option value="all">All PMs</option>
              {pms.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
            </select>
          )}
          <span className="text-xs text-gray-500">
            {activeProjects.length} active
          </span>
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
        </>} />

      {/* ── PERSONAL STATS ROW ─────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
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

          {/* ── ACTION ITEMS ──────────────────────────────────────────── */}
          <div className="space-y-3">

            {/* Stuck Tasks */}
            <ActionSection
              title="Stuck Tasks"
              count={stuckItems.length}
              color="text-orange-400"
              open={stuckOpen}
              onToggle={() => setStuckOpen(!stuckOpen)}
            >
              {stuckItems.map((item, i) => (
                <ActionRow key={`${item.project.id}-${item.taskName}-${i}`} onClick={() => openProject(item.project, 'tasks')}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    item.status === 'Pending Resolution' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white truncate">{item.project.name}</span>
                    <span className="text-xs text-gray-500 ml-2">{item.project.id}</span>
                  </div>
                  <span className="text-xs text-gray-400">{item.taskName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    item.status === 'Pending Resolution' ? 'bg-red-950 text-red-300' : 'bg-amber-950 text-amber-300'
                  }`}>
                    {item.status === 'Pending Resolution' ? 'Pending' : 'Revision'}
                  </span>
                  {item.reason && (
                    <span className="text-xs text-gray-500 max-w-[180px] truncate hidden lg:block">{item.reason}</span>
                  )}
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

          {/* ── FULL PROJECT TABLE ────────────────────────────────────── */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                All Projects ({tableProjects.length})
                {stageFilter && (
                  <span className="text-green-400 ml-2 normal-case font-normal">
                    filtered: {STAGE_LABELS[stageFilter]}
                  </span>
                )}
              </span>
            </div>

            {/* Table header */}
            <div className="hidden md:grid grid-cols-[1fr_100px_70px_160px_140px_90px_100px] gap-2 px-4 py-2 border-b border-gray-700 text-xs text-gray-500 uppercase tracking-wider">
              <button onClick={() => toggleSort('name')} className="text-left hover:text-white transition-colors">
                Name{sortIcon('name')}
              </button>
              <button onClick={() => toggleSort('stage')} className="text-left hover:text-white transition-colors">
                Stage{sortIcon('stage')}
              </button>
              <button onClick={() => toggleSort('days')} className="text-right hover:text-white transition-colors">
                Days{sortIcon('days')}
              </button>
              <button onClick={() => toggleSort('blocker')} className="text-left hover:text-white transition-colors">
                Blocker{sortIcon('blocker')}
              </button>
              <button onClick={() => toggleSort('nextTask')} className="text-left hover:text-white transition-colors">
                Next Task{sortIcon('nextTask')}
              </button>
              <button onClick={() => toggleSort('contract')} className="text-right hover:text-white transition-colors">
                Contract{sortIcon('contract')}
              </button>
              <button onClick={() => toggleSort('followUp')} className="text-right hover:text-white transition-colors">
                Follow-up{sortIcon('followUp')}
              </button>
            </div>

            {/* Table rows */}
            <div className="max-h-[600px] overflow-y-auto">
              {tableProjects.length === 0 && (
                <div className="px-4 py-8 text-center text-gray-600 text-sm">
                  {currentUser?.isSales && filtered.length === 0
                    ? 'No projects found. Your consultant/advisor name may not match any projects.'
                    : 'No projects found'}
                </div>
              )}
              {tableProjects.map(p => {
                const days = daysAgo(p.stage_date)
                const nextTask = getNextTask(p)
                return (
                  <div
                    key={p.id}
                    onClick={() => openProject(p)}
                    className={`grid grid-cols-1 md:grid-cols-[1fr_100px_70px_160px_140px_90px_100px] gap-1 md:gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-700 border-b border-gray-800/50 transition-colors items-center ${
                      selectedProject?.id === p.id ? 'bg-gray-700' : ''
                    }`}
                  >
                    {/* Name + ID + city (responsive) */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          p.blocker ? 'bg-red-500' : 'bg-green-500'
                        }`} />
                        <span className="text-sm text-white truncate">{p.name}</span>
                      </div>
                      <div className="text-xs text-gray-500 ml-3.5 truncate">
                        {p.id} · {p.city}
                        {p.pm && !isMyProjects && <span className="text-gray-600 ml-1">· {p.pm}</span>}
                      </div>
                    </div>

                    {/* Stage */}
                    <span className="text-xs text-gray-400 hidden md:block">{STAGE_LABELS[p.stage] ?? p.stage}</span>

                    {/* Days in stage */}
                    <span className={`text-xs font-mono text-right hidden md:block ${
                      days >= 30 ? 'text-red-400' : days >= 14 ? 'text-amber-400' : 'text-gray-400'
                    }`}>
                      {days}d
                    </span>

                    {/* Blocker */}
                    <span className="text-xs text-red-400 truncate hidden md:block">
                      {p.blocker ?? '—'}
                    </span>

                    {/* Next Task */}
                    <span className="text-xs text-gray-400 truncate hidden md:block">{nextTask}</span>

                    {/* Contract */}
                    <span className="text-xs text-gray-300 text-right font-mono hidden md:block">
                      {fmt$(Number(p.contract) || 0)}
                    </span>

                    {/* Follow-up */}
                    <span className="text-xs text-right hidden md:block">
                      {renderFollowUp(p.follow_up_date)}
                    </span>

                    {/* Mobile: show key info inline */}
                    <div className="flex items-center gap-3 md:hidden text-xs text-gray-500">
                      <span>{STAGE_LABELS[p.stage]}</span>
                      <span>{days}d</span>
                      {p.blocker && <span className="text-red-400 truncate max-w-[120px]">{p.blocker}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── LOYALTY + IN SERVICE (collapsed by default) ──────────── */}
          {(sections.loyalty.length > 0 || sections.inService.length > 0) && (
            <div className="space-y-3 mt-2">
              {sections.loyalty.length > 0 && (
                <details className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                  <summary className="px-4 py-2.5 cursor-pointer hover:bg-gray-700 transition-colors text-xs text-purple-400 font-bold uppercase tracking-wider">
                    Loyalty ({sections.loyalty.length})
                  </summary>
                  {sections.loyalty.map(p => (
                    <div
                      key={p.id}
                      onClick={() => openProject(p)}
                      className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-700 border-t border-gray-800/50 transition-colors"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                      <span className="text-sm text-white truncate">{p.name}</span>
                      <span className="text-xs text-gray-500">{p.id}</span>
                      <span className="text-xs text-gray-500 ml-auto">{STAGE_LABELS[p.stage]}</span>
                    </div>
                  ))}
                </details>
              )}
              {sections.inService.length > 0 && (
                <details className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                  <summary className="px-4 py-2.5 cursor-pointer hover:bg-gray-700 transition-colors text-xs text-gray-500 font-bold uppercase tracking-wider">
                    In Service ({sections.inService.length})
                  </summary>
                  {sections.inService.map(p => (
                    <div
                      key={p.id}
                      onClick={() => openProject(p)}
                      className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-gray-700 border-t border-gray-800/50 transition-colors"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-500 flex-shrink-0" />
                      <span className="text-sm text-white truncate">{p.name}</span>
                      <span className="text-xs text-gray-500">{p.id}</span>
                      <span className="text-xs text-gray-500 ml-auto">{STAGE_LABELS[p.stage]}</span>
                    </div>
                  ))}
                </details>
              )}
            </div>
          )}
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
