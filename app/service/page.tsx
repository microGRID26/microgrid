'use client'

import { useState } from 'react'
import { loadProjectById } from '@/lib/api'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { fmtDate } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useSupabaseQuery } from '@/lib/hooks'
import type { Project, ServiceCall } from '@/types/database'

const STATUS_STYLE: Record<string, string> = {
  'Open':        'bg-red-900 text-red-300',
  'Scheduled':   'bg-blue-900 text-blue-300',
  'In Progress': 'bg-amber-900 text-amber-300',
  'Escalated':   'bg-amber-900 text-amber-300',
  'Re-Opened':   'bg-red-900 text-red-300',
  'Closed':      'bg-green-900 text-green-300',
}

export default function ServicePage() {
  const [selected, setSelected] = useState<Project | null>(null)
  const [loadingProject, setLoadingProject] = useState(false)

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const { data: calls, loading, refresh, totalCount, hasMore, currentPage, nextPage, prevPage, setPage } = useSupabaseQuery('service_calls', {
    select: 'id, project_id, status, type, issue, created, date, resolution, pm, pm_id, priority, project:projects(name, city)',
    order: { column: 'created', ascending: false },
    page: 1,
    pageSize: 100,
  })

  const openProject = async (projectId: string) => {
    setLoadingProject(true)
    const data = await loadProjectById(projectId)
    if (!data) {
      alert(`Failed to load project ${projectId}`)
      setLoadingProject(false)
      return
    }
    setSelected(data)
    setLoadingProject(false)
  }

  const filtered = (calls as unknown as ServiceCall[]).filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!c.project?.name?.toLowerCase().includes(q) && !c.project_id?.toLowerCase().includes(q) && !c.issue?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const counts: Record<string, number> = { all: calls.length }
  ;(calls as unknown as ServiceCall[]).forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1 })

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading service calls...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Service" />

      {/* Status tabs */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-1 px-4 py-2 flex-shrink-0">
        {[
          { key: 'all', label: `All (${counts.all})` },
          { key: 'Open', label: `Open (${counts['Open'] ?? 0})` },
          { key: 'In Progress', label: `In Progress (${counts['In Progress'] ?? 0})` },
          { key: 'Escalated', label: `Escalated (${counts['Escalated'] ?? 0})` },
          { key: 'Closed', label: `Closed (${counts['Closed'] ?? 0})` },
        ].map(t => (
          <button key={t.key} onClick={() => { setStatusFilter(t.key); setPage(1) }}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${statusFilter === t.key ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search..."
          className="ml-auto text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-36 focus:outline-none focus:border-green-500 placeholder-gray-500" />
        {totalCount != null && (
          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-gray-500">{totalCount} total</span>
            <Pagination
              currentPage={currentPage}
              totalCount={totalCount}
              pageSize={100}
              hasMore={hasMore}
              onPrevPage={prevPage}
              onNextPage={nextPage}
            />
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-3xl mb-3">✓</div>
            <div>{calls.length === 0 ? 'No service calls in database.' : 'No service calls match your filters.'}</div>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="bg-gray-950 sticky top-0">
              <tr>
                {['Status','Project','Issue','PM','Created','Scheduled','Priority'].map(h => (
                  <th key={h} className="text-left text-gray-400 font-medium px-3 py-2 border-b border-gray-800">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(call => {
                return (
                  <tr key={call.id} onClick={() => openProject(call.project_id)}
                    className="border-b border-gray-800 cursor-pointer hover:bg-gray-800">
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[call.status] ?? 'bg-gray-800 text-gray-400'}`}>
                        {call.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-white">{call.project?.name ?? call.project_id}</div>
                      <div className="text-gray-500">{call.project_id} {call.project?.city ? `· ${call.project.city}` : ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      {call.type && call.type !== 'NetSuite Import' && <div className="text-gray-300">{call.type}</div>}
                      {call.issue && <div className="text-gray-500 truncate max-w-xs">{call.issue}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{call.pm ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-400">{fmtDate(call.created?.slice(0,10))}</td>
                    <td className="px-3 py-2 text-gray-400">{fmtDate(call.date)}</td>
                    <td className="px-3 py-2">
                      {call.priority && (
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          call.priority === 'high' ? 'bg-red-900 text-red-300' :
                          call.priority === 'medium' ? 'bg-amber-900 text-amber-300' :
                          'bg-gray-800 text-gray-400'
                        }`}>{call.priority}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <ProjectPanel project={selected} onClose={() => setSelected(null)} onProjectUpdated={refresh} />
      )}
    </div>
  )
}
