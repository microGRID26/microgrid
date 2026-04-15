'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { loadChangeOrders, loadProjectById } from '@/lib/api'
import { cn, fmtDate } from '@/lib/utils'
import { Nav } from '@/components/Nav'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useSupabaseQuery, useRealtimeSubscription } from '@/lib/hooks'
import type { Project, ChangeOrder } from '@/types/database'
import { ClipboardList, Plus } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

import { ChangeOrderDetailPanel } from './components/ChangeOrderDetailPanel'
import { NewChangeOrderModal } from './components/NewChangeOrderModal'
import { STATUS_STYLE, PRIORITY_STYLE, workflowProgress } from './components/constants'

// ── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function ChangeOrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-900 flex items-center justify-center"><div className="text-green-400 text-sm animate-pulse">Loading...</div></div>}>
      <ChangeOrdersContent />
    </Suspense>
  )
}

function ChangeOrdersContent() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()

  // Role gate: Manager+ only
  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <>
        <Nav active="Change Orders" />
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">Change Orders is available to Managers and above.</p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              ← Back to Command Center
            </a>
          </div>
        </div>
      </>
    )
  }

  const [orders, setOrders] = useState<ChangeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ChangeOrder | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'|'info'} | null>(null)
  // Filters
  const searchParams = useSearchParams()
  const projectParam = searchParams.get('project')
  const [statusFilter, setStatusFilter] = useState<string>('active')
  const [pmFilter, setPmFilter] = useState<string>('all')
  const [search, setSearch] = useState(projectParam ?? '')

  // ── DATA LOADING ─────────────────────────────────────────────────────────
  // Users via useSupabaseQuery
  const { data: users } = useSupabaseQuery('users', {
    select: 'id, name',
    filters: { active: 'TRUE' },
    order: { column: 'name', ascending: true },
  })

  // Change orders with project join via API layer
  const loadData = useCallback(async () => {
    const { data } = await loadChangeOrders()
    if (data) setOrders(data as ChangeOrder[])
    setLoading(false)
  }, [])

  const loadDataRef = useRef(loadData)
  useEffect(() => { loadDataRef.current = loadData }, [loadData])

  useEffect(() => { loadData() }, [loadData])

  // Realtime subscription for change_orders via hook
  useRealtimeSubscription('change_orders', {
    onChange: useCallback(() => loadDataRef.current(), []),
  })

  // ── FILTERING ──────────────────────────────────────────────────────────────
  const pmMap = new Map<string, string>()
  orders.forEach(co => {
    if (co.project?.pm_id && co.project?.pm) pmMap.set(co.project.pm_id, co.project.pm)
  })
  const pms = [...pmMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))

  const filtered = orders.filter(co => {
    // Status filter
    if (statusFilter === 'active') {
      if (co.status === 'Complete' || co.status === 'Cancelled') return false
    } else if (statusFilter !== 'all' && co.status !== statusFilter) {
      return false
    }

    // PM filter
    if (pmFilter !== 'all' && co.project?.pm_id !== pmFilter) return false

    // Search — narrows, doesn't bypass other filters
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      const name = co.project?.name?.toLowerCase() ?? ''
      const pid = co.project_id?.toLowerCase() ?? ''
      const title = co.title?.toLowerCase() ?? ''
      if (!name.includes(q) && !pid.includes(q) && !title.includes(q)) return false
    }

    return true
  })

  // Status counts (unfiltered by status, but filtered by PM + search)
  const baseFiltered = orders.filter(co => {
    if (pmFilter !== 'all' && co.project?.pm_id !== pmFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      const name = co.project?.name?.toLowerCase() ?? ''
      const pid = co.project_id?.toLowerCase() ?? ''
      const title = co.title?.toLowerCase() ?? ''
      if (!name.includes(q) && !pid.includes(q) && !title.includes(q)) return false
    }
    return true
  })
  const counts = {
    all: baseFiltered.length,
    active: baseFiltered.filter(co => co.status !== 'Complete' && co.status !== 'Cancelled').length,
    'Open': baseFiltered.filter(co => co.status === 'Open').length,
    'In Progress': baseFiltered.filter(co => co.status === 'In Progress').length,
    'Waiting On Signature': baseFiltered.filter(co => co.status === 'Waiting On Signature').length,
    'Complete': baseFiltered.filter(co => co.status === 'Complete').length,
    'Cancelled': baseFiltered.filter(co => co.status === 'Cancelled').length,
  }

  // ── HANDLERS ─────────────────────────────────────────────────────────────
  const openProject = async (projectId: string) => {
    const data = await loadProjectById(projectId)
    if (!data) {
      setToast({ message: `Failed to load project ${projectId}`, type: 'error' }); setTimeout(() => setToast(null), 3000)
      return
    }
    setSelectedProject(data)
  }

  const onOrderCreated = (co: ChangeOrder) => {
    setShowNewModal(false)
    loadData()
    setSelected(co)
  }

  // ── LOADING STATE ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading change orders...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Change Orders" />

      {/* Status tabs + filters */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-1 px-4 py-2 flex-shrink-0 flex-wrap">
        {[
          { key: 'active', label: `Active (${counts.active})` },
          { key: 'all', label: `All (${counts.all})` },
          { key: 'Open', label: `Open (${counts['Open']})` },
          { key: 'In Progress', label: `In Progress (${counts['In Progress']})` },
          { key: 'Waiting On Signature', label: `Waiting (${counts['Waiting On Signature']})` },
          { key: 'Complete', label: `Complete (${counts['Complete']})` },
        ].map(t => (
          <button key={t.key} onClick={() => setStatusFilter(t.key)}
            className={cn('text-xs px-3 py-1.5 rounded-md transition-colors',
              statusFilter === t.key ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-white'
            )}>
            {t.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-40 focus:outline-none focus:border-green-500 placeholder-gray-500" />
          <select value={pmFilter} onChange={e => setPmFilter(e.target.value)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All PMs</option>
            {pms.map(pm => <option key={pm.id} value={pm.id}>{pm.name}</option>)}
          </select>
          <button onClick={() => setShowNewModal(true)}
            className="text-xs px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-500 text-white font-medium flex items-center gap-1.5 transition-colors">
            <Plus className="w-3 h-3" /> New Change Order
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table */}
        <div className={cn('flex-1 overflow-auto', selected && 'hidden lg:block lg:flex-1')}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <ClipboardList className="w-10 h-10 mb-3 text-gray-600" />
              <div className="text-sm">No change orders found</div>
              <div className="text-xs mt-1">Adjust your filters or create a new change order</div>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-900 sticky top-0 z-10">
                <tr className="text-xs text-gray-500 text-left">
                  <th className="px-4 py-2.5 font-medium">ID</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Reason</th>
                  <th className="px-4 py-2.5 font-medium">Assigned</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5 font-medium">Workflow</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(co => {
                  const wp = workflowProgress(co)
                  const isSelected = selected?.id === co.id
                  return (
                    <tr key={co.id}
                      onClick={() => setSelected(co)}
                      className={cn(
                        'border-b border-gray-800 cursor-pointer transition-colors hover:bg-gray-800',
                        isSelected && 'bg-gray-800'
                      )}>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">CO-{co.id}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={e => { e.stopPropagation(); openProject(co.project_id) }}
                          className="text-left group"
                        >
                          <div className="text-xs text-green-400 group-hover:text-green-300 group-hover:underline truncate max-w-[180px]">{co.project?.name ?? co.project_id}</div>
                          <div className="text-xs text-gray-500">{co.project_id}</div>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-200 truncate max-w-[180px]">{co.title}</td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_STYLE[co.status] ?? 'bg-gray-700 text-gray-300')}>
                          {co.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full', PRIORITY_STYLE[co.priority] ?? 'bg-gray-700 text-gray-300')}>
                          {co.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{co.type}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{co.reason ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{co.assigned_to ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{co.created_at ? fmtDate(co.created_at.slice(0, 10)) : '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(wp.done / wp.total) * 100}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{wp.done}/{wp.total}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <ChangeOrderDetailPanel
            order={selected}
            users={users}
            currentUser={currentUser}
            onClose={() => setSelected(null)}
            onUpdated={(updated) => {
              setSelected(updated)
              loadData()
            }}
            onOpenProject={openProject}
          />
        )}
      </div>

      {/* New Change Order Modal */}
      {showNewModal && (
        <NewChangeOrderModal
          users={users}
          currentUser={currentUser}
          onClose={() => setShowNewModal(false)}
          onCreated={onOrderCreated}
        />
      )}

      {/* Project Panel (when viewing a linked project) */}
      {selectedProject && (
        <ProjectPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onProjectUpdated={loadData}
        />
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
        }`}>{toast.message}</div>
      )}
    </div>
  )
}
