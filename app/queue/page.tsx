'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/Nav'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { NewProjectModal } from '@/components/project/NewProjectModal'
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
  const [showNewProject, setShowNewProject] = useState(false)
  const [userPm, setUserPm] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mg_pm') ?? ''
    return ''
  })
  const [availablePms, setAvailablePms] = useState<{ id: string; name: string }[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const pm = userPm
    const [projRes, taskRes] = await Promise.all([
      // When no PM selected, load ALL projects so user can see everything
      pm
        ? supabase.from('projects').select('id, name, city, pm, pm_id, stage, stage_date, sale_date, contract, blocker, financier, disposition, follow_up_date').eq('pm_id', pm).limit(2000)
        : supabase.from('projects').select('id, name, city, pm, pm_id, stage, stage_date, sale_date, contract, blocker, financier, disposition, follow_up_date').limit(2000),
      supabase.from('task_state').select('project_id, task_id, status, reason').limit(10000),
    ])

    if (projRes.error) console.error('projects load failed:', projRes.error)
    if (taskRes.error) console.error('task_state load failed:', taskRes.error)

    if (projRes.data) {
      setProjects(projRes.data as Project[])
      const pmMap = new Map<string, string>()
      ;(projRes.data as any[]).forEach((p: any) => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
      setAvailablePms([...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)))
    }
    if (taskRes.data) setTaskStates(taskRes.data as TaskStateRow[])
    setLoading(false)
  }, [userPm])

  function selectPm(pm: string) {
    setUserPm(pm)
    localStorage.setItem('mg_pm', pm)
  }

  useEffect(() => { loadData() }, [loadData])

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

  // In Service and Cancelled projects excluded — PMs are done with them
  // Loyalty projects remain per CLAUDE.md (PMs still actively manage them)
  const live = useMemo(() => projects.filter(p => p.disposition !== 'In Service' && p.disposition !== 'Cancelled'), [projects])

  // Apply search filter
  const searched = useMemo(() => search.trim()
    ? live.filter(p => {
        const q = search.toLowerCase()
        return p.name?.toLowerCase().includes(q) ||
          p.id?.toLowerCase().includes(q) ||
          p.city?.toLowerCase().includes(q)
      })
    : live, [live, search])

  const sorted = useMemo(() => [...searched].sort((a, b) => priority(a) - priority(b)), [searched])
  const blocked = useMemo(() => sorted.filter(p => p.blocker), [sorted])
  const active = useMemo(() => sorted.filter(p => !p.blocker && p.stage !== 'complete'), [sorted])
  const complete = useMemo(() => sorted.filter(p => p.stage === 'complete'), [sorted])

  // Follow-ups: projects with follow_up_date today or overdue
  const followUps = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    return sorted.filter(p => p.follow_up_date && p.follow_up_date <= today)
      .sort((a, b) => (a.follow_up_date ?? '').localeCompare(b.follow_up_date ?? ''))
  }, [sorted])

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
          <span className="text-xs text-gray-500">{live.length} projects</span>
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
      <div className="flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 py-4">

        {followUps.length > 0 && (
          <div className="mb-6 bg-amber-950/30 border border-amber-900/50 rounded-xl p-4">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
              Follow-ups Due ({followUps.length})
            </div>
            {followUps.map(p => (
              <div
                key={p.id}
                onClick={() => setSelectedProject(p)}
                className="bg-gray-800/80 hover:bg-gray-700 border border-gray-700 rounded-lg p-3 mb-2 cursor-pointer transition-colors flex items-center gap-3"
              >
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
                  <div className={`text-xs font-medium ${
                    p.follow_up_date === new Date().toISOString().split('T')[0] ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {p.follow_up_date === new Date().toISOString().split('T')[0]
                      ? 'Today'
                      : `${daysAgo(p.follow_up_date)}d overdue`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

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
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={() => { setShowNewProject(false); loadData() }}
          existingIds={projects.map(p => p.id)}
          pms={availablePms}
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
  const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date)

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
