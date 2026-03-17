'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS } from '@/lib/utils'
import { exportProjectsCSV, ALL_EXPORT_FIELDS, DEFAULT_EXPORT_KEYS } from '@/lib/export-utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
import type { Project, Schedule } from '@/types/database'

// ── SLA THRESHOLDS ─────────────────────────────────────────────────────────────
const SLA: Record<string, { target: number; risk: number; crit: number }> = {
  evaluation: { target: 3,  risk: 4,  crit: 6  },
  survey:     { target: 3,  risk: 5,  crit: 10 },
  design:     { target: 3,  risk: 5,  crit: 10 },
  permit:     { target: 21, risk: 30, crit: 45 },
  install:    { target: 5,  risk: 7,  crit: 10 },
  inspection: { target: 14, risk: 21, crit: 30 },
  complete:   { target: 3,  risk: 5,  crit: 7  },
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function cycleDays(p: Project): number {
  return daysAgo(p.sale_date) || daysAgo(p.stage_date) || 0
}

function getSLA(p: Project) {
  const t = SLA[p.stage] ?? { target: 3, risk: 5, crit: 7 }
  const days = daysAgo(p.stage_date)
  let status: 'ok' | 'warn' | 'risk' | 'crit' = 'ok'
  if (days >= t.crit) status = 'crit'
  else if (days >= t.risk) status = 'risk'
  else if (days >= t.target) status = 'warn'
  return { days, status, ...t }
}

function isBlocked(p: Project) { return !!p.blocker }
function isStalled(p: Project) { return !p.blocker && daysAgo(p.stage_date) >= 5 }

// ── TYPES ─────────────────────────────────────────────────────────────────────
type Section = 'overdue' | 'blocked' | 'crit' | 'risk' | 'stall' | 'aging' | 'ok'

interface Classified {
  overdue: Project[]
  blocked: Project[]
  crit: Project[]
  risk: Project[]
  stall: Project[]
  aging: Project[]
  ok: Project[]
}

interface TaskState {
  project_id: string
  task_id: string
  status: string
  completed_date: string | null
}

// ── CLASSIFY PROJECTS ─────────────────────────────────────────────────────────
function classify(projects: Project[], overduePids: Set<string>): Classified {
  const active = projects.filter(p => p.stage !== 'complete')
  return {
    overdue:  projects.filter(p => overduePids.has(p.id)),
    blocked:  active.filter(p => isBlocked(p)),
    crit:     active.filter(p => !isBlocked(p) && getSLA(p).status === 'crit'),
    risk:     active.filter(p => !isBlocked(p) && getSLA(p).status === 'risk'),
    stall:    active.filter(p => !isBlocked(p) && getSLA(p).status === 'ok' && isStalled(p)),
    aging:    projects.filter(p => p.stage !== 'complete' && cycleDays(p) >= 90),
    ok:       active.filter(p => !isBlocked(p) && getSLA(p).status === 'ok' && !isStalled(p)),
  }
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
function ProjectRow({
  p,
  onSelect,
  selected,
}: {
  p: Project
  onSelect: (p: Project) => void
  selected: boolean
}) {
  const sla = getSLA(p)
  const cycle = cycleDays(p)

  return (
    <div
      onClick={() => onSelect(p)}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800 border-b border-gray-800 transition-colors ${selected ? 'bg-gray-800' : ''}`}
    >
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
  )
}

// ── SECTION ───────────────────────────────────────────────────────────────────
function CommandSection({
  id,
  title,
  projects,
  color,
  onSelect,
  selectedId,
  collapsed,
  onToggle,
}: {
  id: Section
  title: string
  projects: Project[]
  color: string
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
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-850 transition-colors"
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
          <div className="flex items-center gap-2 mb-1">
            <button onClick={() => setSelected(new Set(DEFAULT_EXPORT_KEYS))}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Select all</button>
            <span className="text-gray-700">·</span>
            <button onClick={() => setSelected(new Set())}
              className="text-xs text-gray-400 hover:text-white transition-colors">Clear all</button>
          </div>
          {FIELD_GROUPS.map(group => (
            <div key={group.label}>
              <button
                onClick={() => toggleGroup(group.keys)}
                className="flex items-center gap-2 mb-2 group">
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
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggle(key)}
                      className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
                    />
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
  const [projects, setProjects] = useState<Project[]>([])
  const [taskStates, setTaskStates] = useState<TaskState[]>([])
  const [todaySchedule, setTodaySchedule] = useState<Schedule[]>([])
  const [user, setUser] = useState<{ email: string } | null>(null)
  const [pmFilter, setPmFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [displayName, setDisplayName] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mg_display_name') ?? '' : ''
  )
  const [showNameInput, setShowNameInput] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [collapsed, setCollapsed] = useState<Partial<Record<Section, boolean>>>({
    aging: true, ok: false,
  })
  const [loading, setLoading] = useState(true)

  async function signOut() {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [showExport, setShowExport] = useState(false)

  // Load data
  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) setUser({ email: user.email ?? '' })

    const [projRes, taskRes, schedRes] = await Promise.all([
      supabase.from('projects').select('*').order('stage_date', { ascending: true }),
      supabase.from('task_state').select('project_id, task_id, status, completed_date'),
      supabase.from('schedule')
        .select('*, project:projects(name)')
        .eq('date', new Date().toISOString().slice(0, 10))
        .order('time'),
    ])

    if (projRes.data) setProjects(projRes.data as Project[])
    if (taskRes.data) setTaskStates(taskRes.data as TaskState[])
    if (schedRes.data) setTodaySchedule(schedRes.data as any)
    setLastRefresh(Date.now())
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('projects-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_state' }, () => loadData())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [loadData])

  // Filtered projects
  const filtered = (() => {
    let result = pmFilter === 'all' ? projects : projects.filter(p => p.pm === pmFilter)
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
  })()

  // Get overdue task project IDs
  const overduePids = new Set(
    taskStates
      .filter(t => t.status !== 'Complete' && t.completed_date && daysAgo(t.completed_date) > 0)
      .map(t => t.project_id)
  )

  const sections = classify(filtered, overduePids)
  const pms = [...new Set(projects.map(p => p.pm).filter(Boolean))].sort() as string[]

  // Stats
  const totalContract = filtered.reduce((s, p) => s + (Number(p.contract) || 0), 0)

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
      <nav className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 sticky top-0 z-50">
        <span className="text-green-400 font-bold text-base mr-2">MicroGRID</span>
        {[
          { label: 'Command',  href: '/command'  },
          { label: 'Queue',    href: '/queue'    },
          { label: 'Pipeline', href: '/pipeline' },
          { label: 'Analytics',href: '/analytics'},
          { label: 'Audit',    href: '/audit'    },
          { label: 'Schedule', href: '/schedule' },
          { label: 'Service',  href: '/service'  },
          { label: 'Funding',  href: '/funding'  },
        ].map(v => (
          <a key={v.label} href={v.href}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${v.label === 'Command' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            {v.label}
          </a>
        ))}
        <a href="/admin"
          className="text-xs px-3 py-1.5 rounded-md transition-colors text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Admin
        </a>
        <a href="/help"
          className="text-xs px-3 py-1.5 rounded-md transition-colors text-gray-400 hover:text-white hover:bg-gray-800 flex items-center gap-1.5">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Help
        </a>
        <button onClick={signOut}
          className="text-xs px-3 py-1.5 rounded-md transition-colors text-gray-500 hover:text-white hover:bg-gray-800">
          Sign out
        </button>

        <div className="ml-auto flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-44 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          <select
            value={pmFilter}
            onChange={e => setPmFilter(e.target.value)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5"
          >
            <option value="all">All PMs</option>
            {pms.map(pm => <option key={pm} value={pm}>{pm}</option>)}
          </select>
          <button onClick={loadData} className="text-xs text-gray-500 hover:text-white transition-colors">
            ↻ {Math.round((Date.now() - lastRefresh) / 60000)}m ago
          </button>
          <button
            onClick={() => setShowExport(true)}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </button>
          {showNameInput ? (
            <input
              autoFocus
              defaultValue={displayName}
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
          <button
            onClick={() => setShowNewProject(true)}
            className="text-xs bg-green-600 hover:bg-green-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
          >+ New Project</button>
        </div>
      </nav>

      {/* ── METRICS BAR ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-1 px-2 overflow-x-auto">
        <Metric label="Total" value={filtered.length} />
        <Metric label="Blocked" value={sections.blocked.length}
          color={sections.blocked.length ? 'text-red-400' : 'text-white'}
          onClick={() => setCollapsed(c => ({ ...c, blocked: false }))} />
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
          <div className="text-xs text-green-400 font-bold uppercase tracking-wider mb-2">Today's Schedule</div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {todaySchedule.map(job => (
              <div key={job.id} className="flex-shrink-0 bg-gray-800 rounded-lg px-3 py-2 min-w-[160px]">
                <div className="text-xs font-medium text-white">{(job as any).project?.name ?? job.project_id}</div>
                <div className="text-xs text-gray-400 mt-0.5">{job.job_type} · {job.time ?? 'TBD'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Project list */}
        <div className="flex-1 overflow-y-auto">

          <CommandSection id="overdue" title="Overdue Tasks"
            projects={sections.overdue} color="text-red-400"
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={!!collapsed.overdue} onToggle={() => toggleSection('overdue')} />

          <CommandSection id="blocked" title="Blocked"
            projects={sections.blocked} color="text-red-400"
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={!!collapsed.blocked} onToggle={() => toggleSection('blocked')} />

          <CommandSection id="crit" title="Critical — Past SLA"
            projects={sections.crit} color="text-red-400"
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={!!collapsed.crit} onToggle={() => toggleSection('crit')} />

          <CommandSection id="risk" title="At Risk"
            projects={sections.risk} color="text-amber-400"
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={!!collapsed.risk} onToggle={() => toggleSection('risk')} />

          <CommandSection id="stall" title="Stalled — No Movement 5+ Days"
            projects={sections.stall} color="text-yellow-400"
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={!!collapsed.stall} onToggle={() => toggleSection('stall')} />

          <CommandSection id="aging" title="Aging Projects — 90+ Day Cycle"
            projects={sections.aging} color="text-amber-400"
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={!!collapsed.aging} onToggle={() => toggleSection('aging')} />

          <CommandSection id="ok" title={`On Track — ${sections.ok.length}`}
            projects={sections.ok} color="text-green-400"
            onSelect={setSelectedProject} selectedId={selectedProject?.id ?? null}
            collapsed={!!collapsed.ok} onToggle={() => toggleSection('ok')} />
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
          onProjectUpdated={loadData}
        />
      )}

      {/* New Project modal */}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(id) => { setShowNewProject(false); loadData(); }}
          existingIds={projects.map(p => p.id)}
          pms={pms}
        />
      )}
    </div>
  )
}


