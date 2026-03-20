'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/Nav'
import { fmtDate } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'

interface ServiceCall {
  id: string
  project_id: string
  status: string
  issue_type: string | null
  description: string | null
  created_at: string
  scheduled_date: string | null
  resolved_date: string | null
  pm: string | null
  priority: string | null
  project?: { name: string; city: string } | null
}

const STATUS_STYLE: Record<string, string> = {
  open:       'bg-red-900 text-red-300',
  scheduled:  'bg-blue-900 text-blue-300',
  in_progress:'bg-amber-900 text-amber-300',
  closed:     'bg-green-900 text-green-300',
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open', scheduled: 'Scheduled', in_progress: 'In Progress', closed: 'Closed'
}

export default function ServicePage() {
  const supabase = createClient()
  const [calls, setCalls] = useState<ServiceCall[]>([])
  const [selected, setSelected] = useState<Project | null>(null)
  const [loadingProject, setLoadingProject] = useState(false)
  const [loading, setLoading] = useState(true)

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const loadData = useCallback(async () => {
    const svcRes = await (supabase as any).from('service_calls').select('id, project_id, status, issue_type, description, created_at, pm, pm_id, project:projects(name, city)').order('created_at', { ascending: false })
    if (svcRes.data) setCalls(svcRes.data as ServiceCall[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const openProject = async (projectId: string) => {
    setLoadingProject(true)
    const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single()
    if (error || !data) {
      console.error('Failed to load project:', error)
      alert(`Failed to load project ${projectId}`)
      setLoadingProject(false)
      return
    }
    setSelected(data as Project)
    setLoadingProject(false)
  }

  const filtered = calls.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!c.project?.name?.toLowerCase().includes(q) && !c.project_id?.toLowerCase().includes(q) && !c.description?.toLowerCase().includes(q)) return false
    }
    return true
  })

  const counts = { all: calls.length, open: 0, scheduled: 0, in_progress: 0, closed: 0 }
  calls.forEach(c => { if (counts[c.status as keyof typeof counts] !== undefined) (counts as any)[c.status]++ })

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
          { key: 'open', label: `Open (${counts.open})` },
          { key: 'scheduled', label: `Scheduled (${counts.scheduled})` },
          { key: 'in_progress', label: `In Progress (${counts.in_progress})` },
          { key: 'closed', label: `Closed (${counts.closed})` },
        ].map(t => (
          <button key={t.key} onClick={() => setStatusFilter(t.key)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${statusFilter === t.key ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search..."
          className="ml-auto text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-36 focus:outline-none focus:border-green-500 placeholder-gray-500" />
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
                        {STATUS_LABELS[call.status] ?? call.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-white">{call.project?.name ?? call.project_id}</div>
                      <div className="text-gray-500">{call.project_id} {call.project?.city ? `· ${call.project.city}` : ''}</div>
                    </td>
                    <td className="px-3 py-2">
                      {call.issue_type && <div className="text-gray-300">{call.issue_type}</div>}
                      {call.description && <div className="text-gray-500 truncate max-w-xs">{call.description}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{call.pm ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-400">{fmtDate(call.created_at?.slice(0,10))}</td>
                    <td className="px-3 py-2 text-gray-400">{fmtDate(call.scheduled_date) || '—'}</td>
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
        <ProjectPanel project={selected} onClose={() => setSelected(null)} onProjectUpdated={loadData} />
      )}
    </div>
  )
}
