'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'

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
interface TaskStateRow { project_id: string; task_id: string; status: string; reason?: string | null }

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

export default function QueuePage() {
  const supabase = createClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [taskStates, setTaskStates] = useState<TaskStateRow[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [userPm, setUserPm] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mg_pm') ?? ''
    return ''
  })
  const [availablePms, setAvailablePms] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const loadData = useCallback(async () => {
    const pm = userPm
    const [projRes, taskRes, allProjRes] = await Promise.all([
      // When no PM selected, load ALL projects so user can see everything
      pm
        ? supabase.from('projects').select('*').eq('pm', pm)
        : supabase.from('projects').select('*'),
      supabase.from('task_state').select('project_id, task_id, status, reason'),
      supabase.from('projects').select('pm'),
    ])

    if (projRes.data) setProjects(projRes.data as Project[])
    if (taskRes.data) setTaskStates(taskRes.data as TaskStateRow[])
    if (allProjRes.data) {
      const pms = [...new Set((allProjRes.data as any[]).map(p => p.pm).filter(Boolean))].sort()
      setAvailablePms(pms)
    }
    setLoading(false)
  }, [userPm])

  function selectPm(pm: string) {
    setUserPm(pm)
    localStorage.setItem('mg_pm', pm)
  }

  useEffect(() => { loadData() }, [loadData])

  // Build task map per project: { projectId: { taskId: { status, reason } } }
  const taskMap: Record<string, Record<string, TaskEntry>> = {}
  for (const t of taskStates) {
    if (!taskMap[t.project_id]) taskMap[t.project_id] = {}
    taskMap[t.project_id][t.task_id] = {
      status: t.status,
      reason: t.reason ?? undefined,
    }
  }

  // In Service projects are legacy — PMs are done with them, exclude entirely
  const live = projects.filter(p => p.disposition !== 'In Service')

  // Apply search filter
  const searched = search.trim()
    ? live.filter(p => {
        const q = search.toLowerCase()
        return p.name?.toLowerCase().includes(q) ||
          p.id?.toLowerCase().includes(q) ||
          p.city?.toLowerCase().includes(q)
      })
    : live

  const sorted = [...searched].sort((a, b) => priority(a) - priority(b))
  const blocked = sorted.filter(p => p.blocker)
  const active = sorted.filter(p => !p.blocker && p.stage !== 'complete')
  const complete = sorted.filter(p => p.stage === 'complete')

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-green-400 text-sm animate-pulse">Loading your queue...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Nav */}
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
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${v.label === 'Queue' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
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

        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
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
            {availablePms.map(pm => <option key={pm} value={pm}>{pm}</option>)}
          </select>
          <span className="text-gray-500">{live.length} projects</span>
        </div>
      </nav>

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
        <div className="ml-auto">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-44 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
        </div>
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 py-4">

        {blocked.length > 0 && (
          <div className="mb-6">
            <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">🚫 Blocked ({blocked.length})</div>
            {blocked.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} />)}
          </div>
        )}

        {active.length > 0 && (
          <div className="mb-6">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Active ({active.length})</div>
            {active.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} />)}
          </div>
        )}

        {complete.length > 0 && (
          <div className="mb-6">
            <div className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">Complete ({complete.length})</div>
            {complete.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} />)}
          </div>
        )}

        {projects.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <div className="text-3xl mb-3">✓</div>
            <div>No projects assigned to you.</div>
          </div>
        )}
      </div>

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

function QueueCard({ p, taskMap, onOpen }: {
  p: Project
  taskMap: Record<string, TaskEntry>
  onOpen: (p: Project) => void
}) {
  const sla = getSLA(p)
  const nextTask = getNextTask(p, taskMap)
  const stuck = getStuckTasks(p, taskMap)
  const cycle = daysAgo(p.sale_date) ?? daysAgo(p.stage_date) ?? 0

  return (
    <div
      onClick={() => onOpen(p)}
      className="bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl p-4 mb-3 cursor-pointer transition-colors"
    >
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
            <span className="text-xs text-gray-500">·</span>
            <span className="text-xs text-green-400">{STAGE_LABELS[p.stage]}</span>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
            <span>{p.city}</span>
            {p.financier && <><span>·</span><span>{p.financier}</span></>}
            {p.contract && <><span>·</span><span>{fmt$(p.contract)}</span></>}
          </div>

          {/* Blocker */}
          {p.blocker && (
            <div className="mt-2 text-xs text-red-400 bg-red-950 rounded-lg px-3 py-1.5">
              🚫 {p.blocker}
            </div>
          )}

          {/* Stuck tasks — now with reasons */}
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
                      <span className="opacity-50">—</span>
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
