'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
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

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function CommandPage() {
  const supabase = createClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [taskStates, setTaskStates] = useState<TaskState[]>([])
  const [todaySchedule, setTodaySchedule] = useState<Schedule[]>([])
  const [user, setUser] = useState<{ email: string } | null>(null)
  const [pmFilter, setPmFilter] = useState<string>('all')
  const [search, setSearch] = useState<string>('')
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [collapsed, setCollapsed] = useState<Partial<Record<Section, boolean>>>({
    aging: true, ok: false,
  })
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(Date.now())

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
        {['Command','Queue','Pipeline','Analytics','Audit','Schedule','Service','Funding'].map(v => (
          <a key={v} href={v === 'Queue' ? '/queue' : '#'}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${v === 'Command' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            {v}
          </a>
        ))}
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
          <button
            onClick={loadData}
            className="text-xs text-gray-500 hover:text-white transition-colors"
          >
            ↻ {Math.round((Date.now() - lastRefresh) / 60000)}m ago
          </button>
          <span className="text-xs text-gray-500">{user?.email}</span>
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

      {/* Full Project Panel modal */}
      {selectedProject && (
        <ProjectPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onProjectUpdated={loadData}
        />
      )}
    </div>
  )
}


