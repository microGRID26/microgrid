'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadProjectsByIds } from '@/lib/api'
import { loadCrewsByIds } from '@/lib/api'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS } from '@/lib/utils'
import { exportProjectsCSV, ALL_EXPORT_FIELDS, DEFAULT_EXPORT_KEYS } from '@/lib/export-utils'
import { classify, cycleDays, getSLA, getStuckTasks } from '@/lib/classify'
import type { Section, TaskEntry, StuckTask } from '@/lib/classify'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import { Nav } from '@/components/Nav'
import { usePreferences } from '@/lib/usePreferences'
import type { ExportPreset } from '@/lib/usePreferences'
import { useSupabaseQuery } from '@/lib/hooks'
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

// ── SLA BADGE ─────────────────────────────────────────────────────────────────
function SlaBadge({ p }: { p: Project }) {
  const sla = getSLA(p)
  const colors = {
    crit: 'bg-red-900 text-red-300',
    risk: 'bg-amber-900 text-amber-300',
    warn: 'bg-yellow-900 text-yellow-300',
    ok:   'bg-gray-700 text-gray-300',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${colors[sla.status]}`}>
      {sla.days}d
    </span>
  )
}

// ── PROJECT ROW ───────────────────────────────────────────────────────────────
function ProjectRow({ p, stuckTasks, onSelect, selected }: {
  p: Project
  stuckTasks: StuckTask[]
  onSelect: (p: Project) => void
  selected: boolean
}) {
  const sla = getSLA(p)
  const cycle = cycleDays(p)

  return (
    <div
      onClick={() => onSelect(p)}
      className={`px-4 py-3 cursor-pointer hover:bg-gray-800 border-b border-gray-800 transition-colors ${selected ? 'bg-gray-800' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* Stage dot */}
        <div className={`w-1.5 h-8 rounded-full flex-shrink-0 ${
          p.blocker ? 'bg-red-500' :
          sla.status === 'crit' ? 'bg-red-500' :
          sla.status === 'risk' ? 'bg-amber-500' :
          sla.status === 'warn' ? 'bg-yellow-500' :
          'bg-green-500'
        }`} />

        {/* Name + ID */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{p.name}</div>
          <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
            <span>{p.id}</span>
            <span>·</span>
            <span>{p.city}</span>
            {p.pm && <><span>·</span><span className="text-gray-400">{p.pm}</span></>}
          </div>
        </div>

        {/* Stage */}
        <div className="text-xs text-gray-400 hidden sm:block w-20 text-right">
          {STAGE_LABELS[p.stage] ?? p.stage}
        </div>

        {/* SLA */}
        <SlaBadge p={p} />

        {/* Cycle days */}
        {cycle >= 90 && (
          <span className="text-xs text-amber-400 hidden md:block">{cycle}d total</span>
        )}

        {/* Blocker */}
        {p.blocker && (
          <div className="text-xs text-red-400 max-w-[160px] truncate hidden lg:block">
            🚫 {p.blocker}
          </div>
        )}
      </div>

      {/* Stuck tasks — shown inline below the name row */}
      {stuckTasks.length > 0 && (
        <div className="mt-1.5 ml-5 flex flex-wrap gap-1.5">
          {stuckTasks.map(t => (
            <span key={t.name} className={`text-xs rounded px-2 py-0.5 ${
              t.status === 'Pending Resolution'
                ? 'bg-red-950 text-red-300'
                : 'bg-amber-950 text-amber-300'
            }`}>
              {t.status === 'Pending Resolution' ? '⏸' : '↩'}{' '}
              {t.name}{t.reason ? ` — ${t.reason}` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SECTION ───────────────────────────────────────────────────────────────────
function CommandSection({
  id, title, projects, color, taskMapAll, onSelect, selectedId, collapsed, onToggle,
}: {
  id: Section
  title: string
  projects: Project[]
  color: string
  taskMapAll: Record<string, Record<string, TaskEntry>>
  onSelect: (p: Project) => void
  selectedId: string | null
  collapsed: boolean
  onToggle: () => void
}) {
  if (projects.length === 0) return null
  return (
    <div className="border-b border-gray-800">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800 transition-colors"
      >
        <span className={`text-xs font-bold uppercase tracking-wider ${color}`}>{title}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${color} bg-opacity-20`}>
          {projects.length}
        </span>
        <span className="ml-auto text-gray-600 text-xs">{collapsed ? '▶' : '▼'}</span>
      </button>
      {!collapsed && projects.map(p => (
        <ProjectRow
          key={p.id}
          p={p}
          stuckTasks={getStuckTasks(p, taskMapAll[p.id] ?? {})}
          onSelect={onSelect}
          selected={selectedId === p.id}
        />
      ))}
    </div>
  )
}

// ── METRIC CARD ───────────────────────────────────────────────────────────────
function Metric({ label, value, color = 'text-white', onClick }: {
  label: string
  value: string | number
  color?: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-0.5 px-4 py-3 hover:bg-gray-800 rounded-lg transition-colors text-left"
    >
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold font-mono ${color}`}>{value}</span>
    </button>
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
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
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

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function CommandPage() {
  const supabase = createClient()

  // ── Data queries via useSupabaseQuery ────────────────────────────────────
  const projectsQuery = useSupabaseQuery('projects', {
    select: 'id, name, city, pm, pm_id, stage, stage_date, sale_date, contract, blocker, disposition, address, financier, follow_up_date',
    order: { column: 'stage_date', ascending: true },
    limit: 5000,
  })

  // Optimized: only load stuck tasks (Pending Resolution / Revision Required / Complete)
  // instead of all 25K+ task_state rows
  const taskQuery = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, status, reason, completed_date, follow_up_date',
    filters: { status: { in: ['Pending Resolution', 'Revision Required', 'Complete'] } },
    limit: 50000,
  })

  const projects = (projectsQuery.data ?? []) as unknown as Project[]
  const taskStates = (taskQuery.data ?? []) as unknown as TaskStateRow[]
  const loading = projectsQuery.loading || taskQuery.loading

  // ── Schedule (manual — requires enrichment with project/crew names) ──────
  const [todaySchedule, setTodaySchedule] = useState<ScheduleEntry[]>([])
  const [scheduleIncomplete, setScheduleIncomplete] = useState(false)

  const loadSchedule = useCallback(async () => {
    setScheduleIncomplete(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedRes = await (supabase as any).from('schedule')
      .select('id, project_id, job_type, time, status, crew_id')
      .eq('date', new Date().toISOString().slice(0, 10))
      .neq('status', 'cancelled')
      .order('time')

    if (schedRes.error) { console.error('schedule load failed:', schedRes.error); return }
    if (!schedRes.data) return

    const rawJobs = schedRes.data as ScheduleEntry[]
    let enrichmentFailed = false
    // Batch-fetch project names via API layer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schedPids = [...new Set(rawJobs.map((j: any) => j.project_id).filter(Boolean))]
    const projNameMap: Record<string, string> = {}
    if (schedPids.length > 0) {
      try {
        const projects = await loadProjectsByIds(schedPids as string[])
        projects.forEach((p) => { projNameMap[p.id] = p.name })
      } catch { enrichmentFailed = true }
    }
    // Batch-fetch crew names via API layer
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
    // Merge names onto schedule entries
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawJobs.forEach((j: any) => {
      j.project_name = projNameMap[j.project_id] ?? null
      j.crew_name = crewNameMap[j.crew_id] ?? null
    })
    setTodaySchedule(rawJobs)
  }, [supabase])

  // Load schedule on mount
  useEffect(() => { loadSchedule() }, [loadSchedule])

  // Combined refresh for callbacks
  const refresh = useCallback(() => {
    projectsQuery.refresh()
    taskQuery.refresh()
    loadSchedule()
  }, [projectsQuery.refresh, taskQuery.refresh, loadSchedule])

  // ── Auth ─────────────────────────────────────────────────────────────────
  const [user, setUser] = useState<{ email: string } | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUser({ email: user.email ?? '' })
    })
  }, [supabase])

  // ── UI state ─────────────────────────────────────────────────────────────
  const [pmFilter, setPmFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [displayName, setDisplayName] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mg_display_name') ?? '' : ''
  )
  const [showNameInput, setShowNameInput] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [collapsed, setCollapsed] = useState<Partial<Record<Section, boolean>>>({
    overdue: true, blocked: true, pending: true, crit: true, risk: true,
    stall: true, aging: true, ok: true, loyalty: true, inService: true,
  })
  const [lastRefresh, setLastRefresh] = useState(0)
  const [minutesAgo, setMinutesAgo] = useState(0)
  const [showExport, setShowExport] = useState(false)

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

  // Filtered projects
  const filtered = useMemo(() => {
    let result = pmFilter === 'all' ? projects : projects.filter(p => p.pm_id === pmFilter)
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
  }, [projects, pmFilter, search])

  // Overdue + Pending Resolution: single pass over taskStates
  const { overduePids, pendingPids } = useMemo(() => {
    const overdue = new Set<string>()
    const pending = new Set<string>()
    for (const t of taskStates) {
      // Overdue: task is stuck (Pending Resolution or Revision Required) with a follow_up_date in the past
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

  const sections = useMemo(() => classify(filtered, overduePids, pendingPids), [filtered, overduePids, pendingPids])
  const pms = useMemo(() => {
    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
    return [...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [projects])
  const totalContract = useMemo(() => filtered.reduce((s, p) => s + (Number(p.contract) || 0), 0), [filtered])

  // When search is active, any section with results is force-expanded — synchronous, no timing issues
  const effectiveCollapsed = (id: Section, count: number): boolean => {
    if (search.trim() && count > 0) return false
    return !!collapsed[id]
  }

  function toggleSection(id: Section) {
    setCollapsed(c => ({ ...c, [id]: !c[id] }))
  }

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
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-44 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          <select value={pmFilter} onChange={e => setPmFilter(e.target.value)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All PMs</option>
            {pms.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
          </select>
          <span className="text-xs text-gray-500">
            {filtered.length} projects
          </span>
          <button onClick={refresh} className="text-xs text-gray-500 hover:text-white transition-colors">
            ↻ {minutesAgo}m ago
          </button>
          <button onClick={() => setShowExport(true)}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
          {showNameInput ? (
            <input autoFocus defaultValue={displayName}
              onBlur={e => { const v = e.target.value.trim(); if(v){ localStorage.setItem('mg_display_name',v); setDisplayName(v); } setShowNameInput(false); }}
              onKeyDown={e => { if(e.key==='Enter') (e.target as HTMLInputElement).blur(); if(e.key==='Escape') setShowNameInput(false); }}
              className="text-xs bg-gray-800 text-white border border-gray-600 rounded px-2 py-1 w-28 focus:outline-none focus:border-green-500"
              placeholder="Your name"
            />
          ) : (
            <button onClick={() => setShowNameInput(true)} className="text-xs text-gray-500 hover:text-white">
              {displayName || user?.email?.split('@')[0]}
            </button>
          )}
        </>} />

      {/* ── METRICS BAR ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-1 px-2 overflow-x-auto">
        <Metric label="Total" value={filtered.length} />
        <Metric label="Blocked" value={sections.blocked.length}
          color={sections.blocked.length ? 'text-red-400' : 'text-white'}
          onClick={() => setCollapsed(c => ({ ...c, blocked: false }))} />
        <Metric label="Pending" value={sections.pending.length}
          color={sections.pending.length ? 'text-orange-400' : 'text-white'}
          onClick={() => setCollapsed(c => ({ ...c, pending: false }))} />
        <Metric label="Critical" value={sections.crit.length}
          color={sections.crit.length ? 'text-red-400' : 'text-white'}
          onClick={() => setCollapsed(c => ({ ...c, crit: false }))} />
        <Metric label="At Risk" value={sections.risk.length}
          color={sections.risk.length ? 'text-amber-400' : 'text-white'}
          onClick={() => setCollapsed(c => ({ ...c, risk: false }))} />
        <Metric label="90+ Day Cycle" value={sections.aging.length}
          color={sections.aging.length ? 'text-amber-400' : 'text-white'}
          onClick={() => setCollapsed(c => ({ ...c, aging: false }))} />
        <Metric label="Portfolio" value={fmt$(totalContract)} />
        <div className="ml-auto" />
      </div>

      {/* ── TODAY'S SCHEDULE WIDGET ───────────────────────────────────────── */}
      {todaySchedule.length > 0 && (
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-2">
          <div className="text-xs text-green-400 font-bold uppercase tracking-wider mb-2">
            Today&apos;s Schedule ({todaySchedule.length})
            {scheduleIncomplete && <span className="text-amber-400 font-normal ml-2">Schedule data incomplete</span>}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {todaySchedule.map(job => {
              const j = job
              const statusColor = j.status === 'complete' ? 'bg-green-400' : j.status === 'in_progress' ? 'bg-amber-400' : 'bg-blue-400'
              return (
                <div key={job.id} className="flex-shrink-0 bg-gray-800 rounded-lg px-3 py-2 min-w-[180px]">
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

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <CommandSection id="overdue" title="Overdue Tasks"
            projects={sections.overdue} color="text-red-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('overdue', sections.overdue.length)} onToggle={() => toggleSection('overdue')} />

          <CommandSection id="blocked" title="Blocked"
            projects={sections.blocked} color="text-red-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('blocked', sections.blocked.length)} onToggle={() => toggleSection('blocked')} />

          <CommandSection id="pending" title="Pending Resolution"
            projects={sections.pending} color="text-orange-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('pending', sections.pending.length)} onToggle={() => toggleSection('pending')} />

          <CommandSection id="crit" title="Critical — Past SLA"
            projects={sections.crit} color="text-red-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('crit', sections.crit.length)} onToggle={() => toggleSection('crit')} />

          <CommandSection id="risk" title="At Risk"
            projects={sections.risk} color="text-amber-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('risk', sections.risk.length)} onToggle={() => toggleSection('risk')} />

          <CommandSection id="stall" title="Stalled — No Movement 5+ Days"
            projects={sections.stall} color="text-yellow-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('stall', sections.stall.length)} onToggle={() => toggleSection('stall')} />

          <CommandSection id="aging" title="Aging Projects — 90+ Day Cycle"
            projects={sections.aging} color="text-amber-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('aging', sections.aging.length)} onToggle={() => toggleSection('aging')} />

          <CommandSection id="ok" title={`On Track — ${sections.ok.length}`}
            projects={sections.ok} color="text-green-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('ok', sections.ok.length)} onToggle={() => toggleSection('ok')} />

          <CommandSection id="loyalty" title={`Loyalty (${sections.loyalty.length})`}
            projects={sections.loyalty} color="text-purple-400" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('loyalty', sections.loyalty.length)} onToggle={() => toggleSection('loyalty')} />

          <CommandSection id="inService" title={`In Service (${sections.inService.length})`}
            projects={sections.inService} color="text-gray-500" taskMapAll={taskMapAll}
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={effectiveCollapsed('inService', sections.inService.length)} onToggle={() => toggleSection('inService')} />
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
          onClose={() => setSelectedProject(null)}
          onProjectUpdated={refresh}
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
