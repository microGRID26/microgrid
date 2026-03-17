'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt$, daysAgo, STAGE_LABELS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'

const SLA: Record<string, { crit: number; risk: number }> = {
  evaluation: { crit: 6,  risk: 4  },
  survey:     { crit: 10, risk: 5  },
  design:     { crit: 10, risk: 5  },
  permit:     { crit: 45, risk: 30 },
  install:    { crit: 10, risk: 7  },
  inspection: { crit: 30, risk: 21 },
  complete:   { crit: 7,  risk: 5  },
}

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

const ALL_TASKS = Object.values(TASKS).flat()

const STATUS_STYLE: Record<string, string> = {
  'Pending Resolution': 'bg-red-900 text-red-300',
  'Revision Required':  'bg-amber-900 text-amber-300',
  'In Progress':        'bg-blue-900 text-blue-300',
  'Ready To Start':     'bg-gray-700 text-gray-300',
  'Not Ready':          'bg-gray-800 text-gray-500',
}

type AuditFilter = 'stuck' | 'active' | 'incomplete' | 'missing'
type AuditSort = 'count' | 'contract' | 'sla' | 'name'

export default function AuditPage() {
  const supabase = createClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [taskStates, setTaskStates] = useState<Record<string, Record<string, string>>>({})
  const [selected, setSelected] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<AuditFilter>('stuck')
  const [sort, setSort] = useState<AuditSort>('count')
  const [pmFilter, setPmFilter] = useState('all')
  const [stageFilter, setStageFilter] = useState('')

  const loadData = useCallback(async () => {
    const [projRes, taskRes] = await Promise.all([
      supabase.from('projects').select('*').neq('stage', 'complete'),
      supabase.from('task_state').select('project_id, task_id, status'),
    ])
    if (projRes.data) setProjects(projRes.data as Project[])
    if (taskRes.data) {
      const map: Record<string, Record<string, string>> = {}
      taskRes.data.forEach((t: any) => {
        if (!map[t.project_id]) map[t.project_id] = {}
        map[t.project_id][t.task_id] = t.status
      })
      setTaskStates(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const pms = [...new Set(projects.map(p => p.pm).filter(Boolean))].sort() as string[]

  function ts(pid: string, tid: string): string {
    return taskStates[pid]?.[tid] ?? 'Not Ready'
  }

  function getSLA(p: Project) {
    const t = SLA[p.stage] ?? { crit: 7, risk: 5 }
    const days = daysAgo(p.stage_date)
    let status: 'ok' | 'risk' | 'crit' = 'ok'
    if (days >= t.crit) status = 'crit'
    else if (days >= t.risk) status = 'risk'
    return { days, status }
  }

  // Build audit rows
  const STUCK = ['Pending Resolution', 'Revision Required']
  const ACTIVE_STATUSES = ['In Progress', 'Scheduled', 'Ready To Start']

  interface AuditRow { p: Project; flagged: { task: { id: string; name: string }; status: string }[] }
  const rows: AuditRow[] = []

  projects.forEach(p => {
    if (pmFilter !== 'all' && p.pm !== pmFilter) return
    if (stageFilter && p.stage !== stageFilter) return
    const stageTasks = TASKS[p.stage] ?? []
    let flagged: { task: { id: string; name: string }; status: string }[] = []

    if (filter === 'stuck') {
      ALL_TASKS.forEach(t => { const s = ts(p.id, t.id); if (STUCK.includes(s)) flagged.push({ task: t, status: s }) })
    } else if (filter === 'active') {
      ALL_TASKS.forEach(t => { const s = ts(p.id, t.id); if (ACTIVE_STATUSES.includes(s)) flagged.push({ task: t, status: s }) })
    } else if (filter === 'incomplete') {
      stageTasks.filter(t => t.req).forEach(t => { const s = ts(p.id, t.id); if (s !== 'Complete') flagged.push({ task: t, status: s }) })
    } else if (filter === 'missing') {
      stageTasks.filter(t => t.req).forEach(t => { const s = ts(p.id, t.id); if (s === 'Not Ready' || s === 'Ready To Start') flagged.push({ task: t, status: s }) })
    }
    if (flagged.length) rows.push({ p, flagged })
  })

  // Sort
  rows.sort((a, b) => {
    if (sort === 'count') return b.flagged.length - a.flagged.length
    if (sort === 'contract') return (Number(b.p.contract) || 0) - (Number(a.p.contract) || 0)
    if (sort === 'sla') return getSLA(b.p).days - getSLA(a.p).days
    return (a.p.name ?? '').localeCompare(b.p.name ?? '')
  })

  const totalFlagged = rows.reduce((s, r) => s + r.flagged.length, 0)

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading audit...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Nav */}
      <nav className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 sticky top-0 z-50 flex-shrink-0">
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
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${v.label === 'Audit' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
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

      </nav>

      {/* Filters */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 flex-shrink-0 flex-wrap">
        <select value={filter} onChange={e => setFilter(e.target.value as AuditFilter)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="stuck">Stuck (Pending + Revision)</option>
          <option value="active">Active tasks</option>
          <option value="incomplete">All incomplete required</option>
          <option value="missing">Not started required</option>
        </select>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="">All Stages</option>
          {Object.keys(TASKS).map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <select value={pmFilter} onChange={e => setPmFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All PMs</option>
          {pms.map(pm => <option key={pm} value={pm}>{pm}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as AuditSort)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="count">Most issues first</option>
          <option value="sla">Days in stage</option>
          <option value="contract">Contract value</option>
          <option value="name">Name A–Z</option>
        </select>
        <span className="text-xs text-gray-500 ml-2">{rows.length} projects · {totalFlagged} flagged tasks</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-3xl mb-3">✓</div>
            <div>No issues found.</div>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="bg-gray-950 sticky top-0">
              <tr>
                {['Customer','Stage','PM','Contract','Days','Flagged Tasks'].map(h => (
                  <th key={h} className="text-left text-gray-400 font-medium px-3 py-2 border-b border-gray-800">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, flagged }) => {
                const sla = getSLA(p)
                return (
                  <tr key={p.id} onClick={() => setSelected(p)}
                    className="border-b border-gray-800 cursor-pointer hover:bg-gray-800">
                    <td className="px-3 py-2">
                      <div className="font-medium text-white">{p.name}</div>
                      <div className="text-gray-500">{p.id}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-400">{STAGE_LABELS[p.stage]}</td>
                    <td className="px-3 py-2 text-gray-400">{p.pm}</td>
                    <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(p.contract)}</td>
                    <td className="px-3 py-2">
                      <span className={`font-mono font-bold ${sla.status === 'crit' ? 'text-red-400' : sla.status === 'risk' ? 'text-amber-400' : 'text-gray-400'}`}>
                        {sla.days}d
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {flagged.map(f => (
                          <span key={f.task.id} className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[f.status] ?? 'bg-gray-800 text-gray-400'}`}>
                            {f.task.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <ProjectPanel project={selected} onClose={() => setSelected(null)} onProjectUpdated={loadData} />
      )}
    </div>
  )
}
