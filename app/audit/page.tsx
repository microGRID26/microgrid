'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/Nav'
import { fmt$, daysAgo, STAGE_LABELS, SLA_THRESHOLDS, STAGE_TASKS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'

const ALL_TASKS = Object.values(STAGE_TASKS).flat()

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
  const [search, setSearch] = useState('')

  const loadData = useCallback(async () => {
    const [projRes, taskRes] = await Promise.all([
      supabase.from('projects').select('id, name, city, pm, pm_id, stage, contract, stage_date').neq('stage', 'complete').not('disposition', 'in', '("Cancelled","In Service")'),
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

  const pmMap = new Map<string, string>()
  projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
  const pms = [...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))

  function ts(pid: string, tid: string): string {
    return taskStates[pid]?.[tid] ?? 'Not Ready'
  }

  function getSLA(p: Project) {
    const t = SLA_THRESHOLDS[p.stage] ?? { crit: 7, risk: 5 }
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
    if (pmFilter !== 'all' && p.pm_id !== pmFilter) return
    if (stageFilter && p.stage !== stageFilter) return
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!p.name?.toLowerCase().includes(q) && !p.id?.toLowerCase().includes(q) && !p.city?.toLowerCase().includes(q)) return
    }
    const stageTasks = STAGE_TASKS[p.stage] ?? []
    let flagged: { task: { id: string; name: string }; status: string }[] = []

    if (filter === 'stuck') {
      ALL_TASKS.forEach(t => { const s = ts(p.id, t.id); if (STUCK.includes(s)) flagged.push({ task: t, status: s }) })
    } else if (filter === 'active') {
      ALL_TASKS.forEach(t => { const s = ts(p.id, t.id); if (ACTIVE_STATUSES.includes(s)) flagged.push({ task: t, status: s }) })
    } else if (filter === 'incomplete') {
      stageTasks.forEach(t => { const s = ts(p.id, t.id); if (s !== 'Complete') flagged.push({ task: t, status: s }) })
    } else if (filter === 'missing') {
      stageTasks.forEach(t => { const s = ts(p.id, t.id); if (s === 'Not Ready' || s === 'Ready To Start') flagged.push({ task: t, status: s }) })
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
      <Nav active="Audit" right={
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-40 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
        } />

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
          {Object.keys(STAGE_TASKS).map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
        </select>
        <select value={pmFilter} onChange={e => setPmFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All PMs</option>
          {pms.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
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
