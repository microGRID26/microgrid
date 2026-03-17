'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { daysAgo, fmt$, fmtDate, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'

const SLA: Record<string, { target: number; risk: number; crit: number }> = {
  evaluation: { target: 3,  risk: 4,  crit: 6  },
  survey:     { target: 3,  risk: 5,  crit: 10 },
  design:     { target: 3,  risk: 5,  crit: 10 },
  permit:     { target: 21, risk: 30, crit: 45 },
  install:    { target: 5,  risk: 7,  crit: 10 },
  inspection: { target: 14, risk: 21, crit: 30 },
  complete:   { target: 3,  risk: 5,  crit: 7  },
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

function priority(p: Project): number {
  if (p.blocker) return 0
  const s = getSLA(p).status
  if (s === 'crit') return 1
  if (s === 'risk') return 2
  if (s === 'warn') return 3
  return 4
}

interface TaskState { project_id: string; task_id: string; status: string }

const TASKS: Record<string, { id: string; name: string; req: boolean }[]> = {
  evaluation: [
    { id: 'welcome', name: 'Welcome Call', req: true },
    { id: 'ia', name: 'IA Confirmation', req: true },
    { id: 'ub', name: 'UB Confirmation', req: true },
    { id: 'sched_survey', name: 'Schedule Site Survey', req: true },
    { id: 'ntp', name: 'NTP Procedure', req: true },
  ],
  survey: [
    { id: 'site_survey', name: 'Site Survey', req: true },
    { id: 'survey_review', name: 'Survey Review', req: true },
  ],
  design: [
    { id: 'build_design', name: 'Build Design', req: true },
    { id: 'scope', name: 'Scope of Work', req: true },
    { id: 'monitoring', name: 'Monitoring', req: true },
    { id: 'build_eng', name: 'Build Engineering', req: true },
    { id: 'eng_approval', name: 'Engineering Approval', req: true },
    { id: 'stamps', name: 'Stamps Required', req: true },
  ],
  permit: [
    { id: 'hoa', name: 'HOA Approval', req: true },
    { id: 'om_review', name: 'OM Project Review', req: true },
    { id: 'city_permit', name: 'City Permit Approval', req: true },
    { id: 'util_permit', name: 'Utility Permit Approval', req: true },
  ],
  install: [
    { id: 'sched_install', name: 'Schedule Installation', req: true },
    { id: 'inventory', name: 'Inventory Allocation', req: true },
    { id: 'install_done', name: 'Installation Complete', req: true },
  ],
  inspection: [
    { id: 'insp_review', name: 'Inspection Review', req: true },
    { id: 'sched_city', name: 'Schedule City Inspection', req: true },
    { id: 'sched_util', name: 'Schedule Utility Inspection', req: true },
    { id: 'city_insp', name: 'City Inspection', req: true },
    { id: 'util_insp', name: 'Utility Inspection', req: true },
  ],
  complete: [
    { id: 'pto', name: 'Permission to Operate', req: true },
    { id: 'in_service', name: 'In Service', req: true },
  ],
}

function getNextTask(p: Project, taskMap: Record<string, string>): string | null {
  const tasks = TASKS[p.stage] ?? []
  for (const t of tasks) {
    const s = taskMap[t.id] ?? 'Not Ready'
    if (s !== 'Complete') return t.name
  }
  return null
}

function getStuckTasks(p: Project, taskMap: Record<string, string>): string[] {
  const tasks = TASKS[p.stage] ?? []
  return tasks
    .filter(t => {
      const s = taskMap[t.id] ?? 'Not Ready'
      return s === 'Pending Resolution' || s === 'Revision Required'
    })
    .map(t => t.name)
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
  const [taskStates, setTaskStates] = useState<TaskState[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [userPm, setUserPm] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('mg_pm') ?? ''
    return ''
  })
  const [availablePms, setAvailablePms] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const pm = userPm
    const [projRes, taskRes, allProjRes] = await Promise.all([
      pm ? supabase.from('projects').select('*').eq('pm', pm) : Promise.resolve({ data: [] }),
      supabase.from('task_state').select('project_id, task_id, status'),
      supabase.from('projects').select('pm'),
    ])

    if (projRes.data) setProjects(projRes.data as Project[])
    if (taskRes.data) setTaskStates(taskRes.data as TaskState[])
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

  // Build task map per project
  const taskMap: Record<string, Record<string, string>> = {}
  for (const t of taskStates) {
    if (!taskMap[t.project_id]) taskMap[t.project_id] = {}
    taskMap[t.project_id][t.task_id] = t.status
  }

  const sorted = [...projects].sort((a, b) => priority(a) - priority(b))

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

        <div className="ml-auto text-xs text-gray-400">
          <select
            value={userPm}
            onChange={e => selectPm(e.target.value)}
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-2 py-1 mr-2"
          >
            <option value="">Select PM...</option>
            {availablePms.map(pm => <option key={pm} value={pm}>{pm}</option>)}
          </select>
          <span className="text-gray-500">{projects.length} projects</span>
        </div>
      </nav>

      {/* Stats */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-6 px-6 py-3">
        <div>
          <div className="text-xs text-gray-500">Total</div>
          <div className="text-xl font-bold text-white font-mono">{projects.length}</div>
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
            {fmt$(projects.reduce((s, p) => s + (Number(p.contract) || 0), 0))}
          </div>
        </div>
      </div>

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto max-w-4xl mx-auto w-full px-4 py-4">

        {/* Blocked */}
        {blocked.length > 0 && (
          <div className="mb-6">
            <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">🚫 Blocked ({blocked.length})</div>
            {blocked.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} />)}
          </div>
        )}

        {/* Active */}
        {active.length > 0 && (
          <div className="mb-6">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Active ({active.length})</div>
            {active.map(p => <QueueCard key={p.id} p={p} taskMap={taskMap[p.id] ?? {}} onOpen={setSelectedProject} />)}
          </div>
        )}

        {/* Complete */}
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

      {/* Project Panel */}
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
  taskMap: Record<string, string>
  onOpen: (p: Project) => void
}) {
  const sla = getSLA(p)
  const nextTask = getNextTask(p, taskMap)
  const stuck = getStuckTasks(p, taskMap)
  const cycle = daysAgo(p.sale_date) || daysAgo(p.stage_date) || 0

  return (
    <div
      onClick={() => onOpen(p)}
      className="bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-xl p-4 mb-3 cursor-pointer transition-colors"
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

          {/* Stuck tasks */}
          {stuck.length > 0 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {stuck.map(t => (
                <span key={t} className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded-full">
                  ⚠ {t}
                </span>
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
