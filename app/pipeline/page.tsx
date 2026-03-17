'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { daysAgo, fmt$, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
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
  return { days, status, pct: Math.min(100, Math.round(days / t.crit * 100)) }
}

const AGE_COLOR: Record<string, string> = {
  crit: '#ef4444',
  risk: '#f59e0b',
  warn: '#eab308',
  ok:   '#22c55e',
}

export default function PipelinePage() {
  const supabase = createClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  // Filters
  const [pmFilter, setPmFilter] = useState('all')
  const [financierFilter, setFinancierFilter] = useState('all')
  const [ahjFilter, setAhjFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'name' | 'sla' | 'contract' | 'cycle'>('sla')

  const loadData = useCallback(async () => {
    const { data } = await supabase.from('projects').select('*')
    if (data) setProjects(data as Project[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Unique filter values
  const pms = [...new Set(projects.map(p => p.pm).filter(Boolean))].sort() as string[]
  const financiers = [...new Set(projects.map(p => p.financier).filter(Boolean))].sort() as string[]
  const ahjs = [...new Set(projects.map(p => p.ahj).filter(Boolean))].sort() as string[]

  // Apply filters
  const filtered = projects.filter(p => {
    if (pmFilter !== 'all' && p.pm !== pmFilter) return false
    if (financierFilter !== 'all' && p.financier !== financierFilter) return false
    if (ahjFilter !== 'all' && p.ahj !== ahjFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return p.name?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q) || p.city?.toLowerCase().includes(q)
    }
    return true
  })

  // Sort within each column
  function sortedCards(cards: Project[]) {
    return [...cards].sort((a, b) => {
      if (sort === 'sla') return getSLA(b).days - getSLA(a).days
      if (sort === 'contract') return (Number(b.contract) || 0) - (Number(a.contract) || 0)
      if (sort === 'cycle') return (daysAgo(a.sale_date) || 0) - (daysAgo(b.sale_date) || 0)
      return (a.name ?? '').localeCompare(b.name ?? '')
    })
  }

  const totalContract = filtered.reduce((s, p) => s + (Number(p.contract) || 0), 0)

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading pipeline...</div>
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
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${v.label === 'Pipeline' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
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

        <div className="ml-auto text-xs text-gray-500">
          {filtered.length} projects · {fmt$(totalContract)}
        </div>
      </nav>

      {/* Filter bar */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 flex-shrink-0 flex-wrap">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-36 focus:outline-none focus:border-green-500 placeholder-gray-500"
        />
        <select value={pmFilter} onChange={e => setPmFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All PMs</option>
          {pms.map(pm => <option key={pm} value={pm}>{pm}</option>)}
        </select>
        <select value={financierFilter} onChange={e => setFinancierFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Financiers</option>
          {financiers.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={ahjFilter} onChange={e => setAhjFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All AHJs</option>
          {ahjs.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">Sort:</span>
          {(['sla','name','contract','cycle'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${sort === s ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>
              {s === 'sla' ? 'Days' : s === 'contract' ? '$' : s === 'cycle' ? 'Cycle' : 'Name'}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-0 h-full min-w-max">
          {STAGE_ORDER.map(stageId => {
            const cards = sortedCards(filtered.filter(p => p.stage === stageId))
            const colContract = cards.reduce((s, p) => s + (Number(p.contract) || 0), 0)
            const blocked = cards.filter(p => p.blocker).length
            const crit = cards.filter(p => !p.blocker && getSLA(p).status === 'crit').length

            return (
              <div key={stageId} className="flex flex-col border-r border-gray-800 w-52 flex-shrink-0">
                {/* Column header */}
                <div className="bg-gray-950 border-b border-gray-800 px-3 py-2.5 sticky top-0 flex-shrink-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{STAGE_LABELS[stageId]}</span>
                    <span className="text-xs text-gray-400 font-mono">{cards.length}</span>
                  </div>
                  <div className="text-xs text-gray-500">{fmt$(colContract)}</div>
                  {(blocked > 0 || crit > 0) && (
                    <div className="flex gap-1 mt-1">
                      {blocked > 0 && <span className="text-xs bg-red-950 text-red-400 px-1.5 rounded">{blocked} blocked</span>}
                      {crit > 0 && <span className="text-xs bg-red-950 text-red-400 px-1.5 rounded">{crit} critical</span>}
                    </div>
                  )}
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {cards.map(p => {
                    const sla = getSLA(p)
                    return (
                      <div
                        key={p.id}
                        onClick={() => setSelected(p)}
                        className={`bg-gray-800 rounded-lg p-2.5 cursor-pointer hover:bg-gray-750 border transition-colors ${
                          p.blocker ? 'border-l-2 border-l-red-500 border-gray-700' :
                          sla.status === 'crit' ? 'border-l-2 border-l-red-500 border-gray-700' :
                          sla.status === 'risk' ? 'border-l-2 border-l-amber-500 border-gray-700' :
                          selected?.id === p.id ? 'border-green-600' : 'border-gray-700'
                        }`}
                      >
                        {/* Name */}
                        <div className="text-xs font-medium text-white truncate mb-0.5">{p.name}</div>
                        {/* ID */}
                        <div className="text-xs text-gray-500 mb-1">{p.id}</div>
                        {/* kW + contract */}
                        <div className="text-xs text-gray-400 mb-1.5">
                          {p.systemkw && <span>{p.systemkw} kW · </span>}
                          <span>{fmt$(p.contract)}</span>
                        </div>
                        {/* Financier */}
                        {p.financier && <div className="text-xs text-gray-500 truncate mb-1.5">{p.financier}</div>}
                        {/* Footer */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">{p.pm}</span>
                          <span className={`text-xs font-mono font-bold ${
                            p.blocker ? 'text-red-400' :
                            sla.status === 'crit' ? 'text-red-400' :
                            sla.status === 'risk' ? 'text-amber-400' :
                            sla.status === 'warn' ? 'text-yellow-400' : 'text-gray-400'
                          }`}>{sla.days}d</span>
                        </div>
                        {/* SLA progress bar */}
                        <div className="mt-1.5 h-0.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${sla.pct}%`, backgroundColor: AGE_COLOR[sla.status] }}
                          />
                        </div>
                        {/* Blocker */}
                        {p.blocker && (
                          <div className="mt-1.5 text-xs text-red-400 truncate">🚫 {p.blocker}</div>
                        )}
                      </div>
                    )
                  })}
                  {cards.length === 0 && (
                    <div className="text-xs text-gray-700 text-center py-4">Empty</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Project Panel */}
      {selected && (
        <ProjectPanel
          project={selected}
          onClose={() => setSelected(null)}
          onProjectUpdated={loadData}
        />
      )}
    </div>
  )
}
