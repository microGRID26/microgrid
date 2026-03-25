'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { loadChangeOrders, loadProjectById, searchProjects } from '@/lib/api'
import { cn, fmtDate, fmt$ } from '@/lib/utils'
import { Nav } from '@/components/Nav'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useSupabaseQuery, useRealtimeSubscription } from '@/lib/hooks'
import type { Project, ChangeOrder } from '@/types/database'
import { ClipboardList, Plus, X, Check } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const STATUSES = ['Open', 'In Progress', 'Waiting On Signature', 'Complete', 'Cancelled'] as const
const PRIORITIES = ['Low', 'Medium', 'High'] as const
const TYPES = ['HCO Change Order', 'Addendum', 'Cancellation', 'Other'] as const
const REASONS = ['Production Adjustment', 'Customer Request', 'Engineering Audit', 'Panel Upgrade', 'Battery Add', 'System Downsize', 'Financier Change', 'Other'] as const
const ORIGINS = ['Internal Audit', 'Customer Request', 'EC Request', 'Engineering', 'Finance', 'Other'] as const

const WORKFLOW_STEPS = [
  { key: 'design_request_submitted', label: 'Design Request Submitted (HCO)' },
  { key: 'design_in_progress', label: 'Design In Progress' },
  { key: 'design_pending_approval', label: 'Design Pending Approval (HCO)' },
  { key: 'design_approved', label: 'Design Approved (HCO)' },
  { key: 'design_complete', label: 'Design Complete' },
  { key: 'design_signed', label: 'Design Complete and Signed (HCO)' },
] as const

const STATUS_STYLE: Record<string, string> = {
  'Open': 'bg-red-900 text-red-300',
  'In Progress': 'bg-blue-900 text-blue-300',
  'Waiting On Signature': 'bg-amber-900 text-amber-300',
  'Complete': 'bg-green-900 text-green-300',
  'Cancelled': 'bg-gray-700 text-gray-400',
}

const PRIORITY_STYLE: Record<string, string> = {
  'High': 'bg-red-900 text-red-300',
  'Medium': 'bg-amber-900 text-amber-300',
  'Low': 'bg-gray-700 text-gray-300',
}

function workflowProgress(co: ChangeOrder): { done: number; total: number } {
  let done = 0
  for (const step of WORKFLOW_STEPS) {
    if (co[step.key as keyof ChangeOrder]) done++
  }
  return { done, total: WORKFLOW_STEPS.length }
}

// ── DESIGN COMPARISON FIELD DEFS ─────────────────────────────────────────────
const COMPARISON_FIELDS: { label: string; origKey: string; newKey: string; format?: 'number' | 'currency' | 'percent' | 'text' }[] = [
  { label: 'KWH/YR', origKey: 'original_kwh_yr', newKey: 'new_kwh_yr', format: 'number' },
  { label: 'Panel Count', origKey: 'original_panel_count', newKey: 'new_panel_count', format: 'number' },
  { label: 'Panel Size', origKey: 'original_panel_size', newKey: 'new_panel_size', format: 'text' },
  { label: 'Panel Type', origKey: 'original_panel_type', newKey: 'new_panel_type', format: 'text' },
  { label: 'System Size (kW)', origKey: 'original_system_size', newKey: 'new_system_size', format: 'number' },
]

function formatField(value: any, format?: string): string {
  if (value == null || value === '') return '-'
  if (format === 'currency') return fmt$(Number(value))
  if (format === 'percent') return `${value}%`
  if (format === 'number') return Number(value).toLocaleString()
  return String(value)
}

// ── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function ChangeOrdersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-900 flex items-center justify-center"><div className="text-green-400 text-sm animate-pulse">Loading...</div></div>}>
      <ChangeOrdersContent />
    </Suspense>
  )
}

function ChangeOrdersContent() {
  const { user: currentUser } = useCurrentUser()
  const [orders, setOrders] = useState<ChangeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ChangeOrder | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
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
      alert(`Failed to load project ${projectId}`)
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
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-1 px-4 py-2 flex-shrink-0 flex-wrap">
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
            className="text-xs px-3 py-1.5 rounded-md bg-green-700 hover:bg-green-600 text-white font-medium flex items-center gap-1.5 transition-colors">
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
              <thead className="bg-gray-950 sticky top-0 z-10">
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
    </div>
  )
}

// ── COMPARISON ROW — local state + save on blur ─────────────────────────────
function ComparisonRow({ field: f, co, updateField }: {
  field: typeof COMPARISON_FIELDS[number]
  co: ChangeOrder
  updateField: (field: string, value: any) => void
}) {
  const origVal = co[f.origKey as keyof ChangeOrder]
  const newVal = co[f.newKey as keyof ChangeOrder]
  const [localVal, setLocalVal] = useState(String(newVal ?? ''))

  useEffect(() => { setLocalVal(String(newVal ?? '')) }, [newVal])

  const changed = localVal != null && localVal !== '' && String(origVal) !== String(localVal)

  async function handleBlur() {
    const parsed = f.format === 'text' ? (localVal || null) : (localVal !== '' ? Number(localVal) : null)
    if (String(parsed ?? '') !== String(newVal ?? '')) {
      try {
        await updateField(f.newKey, parsed)
      } catch {
        // Revert local state on save failure
        setLocalVal(String(newVal ?? ''))
      }
    }
  }

  return (
    <div className="grid grid-cols-3 gap-0 px-3 py-1.5 border-b border-gray-800/50 last:border-0 items-center">
      <span className="text-xs text-gray-400">{f.label}</span>
      <span className="text-xs text-gray-300 text-center">{formatField(origVal, f.format)}</span>
      <div className="flex justify-center">
        <input
          type={f.format === 'text' ? 'text' : 'number'}
          value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          placeholder="-"
          className={cn(
            'text-xs text-center bg-transparent border-b border-gray-700 focus:border-green-500 focus:outline-none w-20 py-0.5',
            changed ? 'text-green-400 font-medium border-green-800' : 'text-gray-400'
          )}
        />
      </div>
    </div>
  )
}

// ── DETAIL PANEL ─────────────────────────────────────────────────────────────
function ChangeOrderDetailPanel({ order, users, currentUser, onClose, onUpdated, onOpenProject }: {
  order: ChangeOrder
  users: { id: string; name: string }[]
  currentUser: any
  onClose: () => void
  onUpdated: (co: ChangeOrder) => void
  onOpenProject: (pid: string) => void
}) {
  const supabase = createClient()
  const [co, setCo] = useState<ChangeOrder>(order)
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Sync when parent changes selection
  useEffect(() => {
    setCo(order)
    setNewNote('')
  }, [order.id])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function updateField(field: string, value: any) {
    const updates = { [field]: value, updated_at: new Date().toISOString() }
    const { error } = await db().from('change_orders').update(updates).eq('id', co.id)
    if (error) {
      console.error('change_orders update failed:', error)
      showToast('Save failed')
      return
    }
    const updated = { ...co, ...updates }
    setCo(updated)
    onUpdated(updated)
  }

  async function toggleWorkflowStep(key: string) {
    const current = co[key as keyof ChangeOrder]
    const newVal = !current
    const updates: Record<string, any> = { [key]: newVal, updated_at: new Date().toISOString() }

    // Count completed steps after this toggle
    let doneAfter = 0
    for (const step of WORKFLOW_STEPS) {
      const val = step.key === key ? newVal : co[step.key as keyof ChangeOrder]
      if (val) doneAfter++
    }

    // Auto-advance status based on workflow progress
    if (doneAfter === WORKFLOW_STEPS.length && co.status !== 'Complete') {
      updates.status = 'Complete'
    } else if (doneAfter > 0 && co.status === 'Open') {
      updates.status = 'In Progress'
    } else if (doneAfter === 0 && co.status === 'In Progress') {
      updates.status = 'Open'
    }

    const { error } = await db().from('change_orders').update(updates).eq('id', co.id)
    if (error) {
      console.error('Failed to update workflow step:', error)
      return
    }
    const updated = { ...co, ...updates }
    setCo(updated)
    onUpdated(updated)

    if (updates.status === 'Complete') showToast('All steps done — marked Complete')
    else if (updates.status === 'In Progress') showToast('Workflow started — In Progress')
    else showToast(newVal ? 'Step completed' : 'Step unchecked')
  }

  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    const now = new Date()
    const stamp = now.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
      + ' ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const by = currentUser?.name ?? 'Unknown'
    const entry = `${stamp} ${by} - ${newNote.trim()}`
    const updated = co.notes ? `${entry}\n\n${co.notes}` : entry
    await updateField('notes', updated)
    setNewNote('')
    setSaving(false)
    showToast('Note added')
  }

  const wp = workflowProgress(co)

  return (
    <div className="w-full lg:w-[480px] xl:w-[540px] bg-gray-950 border-l border-gray-800 flex flex-col overflow-hidden flex-shrink-0">
      {/* Toast */}
      {toast && (
        <div className="absolute top-4 right-4 bg-gray-700 text-white text-xs px-4 py-2 rounded-lg shadow-lg z-10">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-gray-500 font-mono">CO-{co.id}</span>
              <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_STYLE[co.status])}>
                {co.status}
              </span>
              <span className={cn('text-xs px-2 py-0.5 rounded-full', PRIORITY_STYLE[co.priority])}>
                {co.priority}
              </span>
            </div>
            <h3 className="text-base font-bold text-white truncate">{co.title}</h3>
            <div className="text-xs text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
              <button onClick={() => onOpenProject(co.project_id)} className="text-green-400 hover:text-green-300 hover:underline">
                {co.project?.name ?? co.project_id}
              </button>
              <span className="text-gray-600">({co.project_id})</span>
              {co.assigned_to && <><span>·</span><span>Assigned: {co.assigned_to}</span></>}
              {co.created_by && <><span>·</span><span>By: {co.created_by}</span></>}
              {co.created_at && <><span>·</span><span>{fmtDate(co.created_at.slice(0, 10))}</span></>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl ml-3 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick controls */}
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Status:</span>
            <select value={co.status}
              onChange={e => updateField('status', e.target.value)}
              className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-green-500">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Priority:</span>
            <select value={co.priority}
              onChange={e => updateField('priority', e.target.value)}
              className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-green-500">
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Assigned:</span>
            <select value={co.assigned_to ?? ''}
              onChange={e => updateField('assigned_to', e.target.value || null)}
              className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-green-500">
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          </div>
        </div>

        {/* Type / Reason / Origin */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Type:</span>
            <select value={co.type}
              onChange={e => updateField('type', e.target.value)}
              className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-green-500">
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Reason:</span>
            <select value={co.reason ?? ''}
              onChange={e => updateField('reason', e.target.value || null)}
              className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-green-500">
              <option value="">None</option>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Origin:</span>
            <select value={co.origin ?? ''}
              onChange={e => updateField('origin', e.target.value || null)}
              className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:border-green-500">
              <option value="">None</option>
              {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Workflow Checklist */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Design Workflow</span>
            <span className="text-gray-500 normal-case font-normal">{wp.done}/{wp.total} steps</span>
          </div>
          {/* Progress bar */}
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mb-3">
            <div
              className={cn('h-full rounded-full transition-all duration-300',
                wp.done === wp.total ? 'bg-green-500' : 'bg-green-600'
              )}
              style={{ width: `${(wp.done / wp.total) * 100}%` }}
            />
          </div>
          <div className="space-y-1">
            {WORKFLOW_STEPS.map((step, i) => {
              const checked = co[step.key as keyof ChangeOrder] as boolean
              return (
                <button key={step.key}
                  onClick={() => toggleWorkflowStep(step.key)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors',
                    checked ? 'bg-green-900/20 hover:bg-green-900/30' : 'hover:bg-gray-800'
                  )}>
                  <div className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                    checked ? 'bg-green-600 border-green-600' : 'border-gray-600'
                  )}>
                    {checked && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className={cn('text-xs', checked ? 'text-green-300 line-through' : 'text-gray-300')}>
                    {i + 1}. {step.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Design Comparison */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Design Comparison</div>
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            {/* Header row */}
            <div className="grid grid-cols-3 gap-0 px-3 py-2 bg-gray-800/50 border-b border-gray-800">
              <span className="text-xs text-gray-500 font-medium">Field</span>
              <span className="text-xs text-gray-500 font-medium text-center">Original</span>
              <span className="text-xs text-gray-500 font-medium text-center">New</span>
            </div>
            {COMPARISON_FIELDS.map(f => (
              <ComparisonRow key={f.label} field={f} co={co} updateField={updateField} />
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Design Notes</div>
          <div className="flex gap-2 mb-2">
            <input
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addNote() }}
              placeholder="Add a note..."
              className="flex-1 bg-gray-800 text-gray-200 text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none placeholder-gray-600"
            />
            <button onClick={addNote} disabled={!newNote.trim() || saving}
              className="text-xs px-3 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white font-medium disabled:opacity-50 transition-colors">
              {saving ? '...' : 'Add'}
            </button>
          </div>
          {co.notes ? (
            <div className="bg-gray-800 rounded-lg px-3 py-2 max-h-48 overflow-y-auto">
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{co.notes}</pre>
            </div>
          ) : (
            <div className="text-xs text-gray-600 text-center py-3">No notes yet</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── NEW CHANGE ORDER MODAL ───────────────────────────────────────────────────
function NewChangeOrderModal({ users, currentUser, onClose, onCreated }: {
  users: { id: string; name: string }[]
  currentUser: any
  onClose: () => void
  onCreated: (co: ChangeOrder) => void
}) {
  const [projectSearch, setProjectSearch] = useState('')
  const [projectResults, setProjectResults] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [searching, setSearching] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<string>('HCO Change Order')
  const [reason, setReason] = useState<string>('')
  const [origin, setOrigin] = useState<string>('')
  const [priority, setPriority] = useState<string>('Medium')
  const [assignedTo, setAssignedTo] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => { return () => { mountedRef.current = false } }, [])

  // Debounced project search
  useEffect(() => {
    if (projectSearch.trim().length < 2) {
      setProjectResults([])
      return
    }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      const q = projectSearch.trim()
      const data = await searchProjects(q, 10)
      if (!mountedRef.current) return
      if (data) setProjectResults(data as Project[])
      setSearching(false)
    }, 250)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [projectSearch])

  function selectProject(p: Project) {
    setSelectedProject(p)
    setProjectSearch('')
    setProjectResults([])
    // Auto-populate title
    if (!title) setTitle(`Change Order - ${p.name}`)
  }

  async function handleCreate() {
    if (!selectedProject || !title.trim()) return
    setSaving(true)
    const p = selectedProject
    const now = new Date().toISOString()
    const payload = {
      project_id: selectedProject.id,
      title: title.trim(),
      status: 'Open',
      priority,
      type,
      reason: reason || null,
      origin: origin || null,
      assigned_to: assignedTo || null,
      created_by: currentUser?.name ?? null,
      created_at: now,
      updated_at: now,
      // Auto-populate original values from project
      original_panel_count: p.module_qty ?? null,
      original_panel_type: p.module ?? null,
      original_system_size: p.systemkw ?? null,
      original_plan_type: (p as any).financing_type ?? null,
      original_lease_ppa_escalator: (p as any).tpo_escalator ?? null,
      original_adv_pmt_schedule: (p as any).financier_adv_pmt ?? null,
      original_loan_amount: (p as any).down_payment ?? null,
    }
    const { data, error } = await db().from('change_orders').insert(payload).select('*, project:projects(name, city, pm, pm_id)').single()
    setSaving(false)
    if (data) {
      onCreated(data as ChangeOrder)
    } else {
      console.error('Failed to create change order:', error)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">New Change Order</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Project search */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Project *</label>
            {selectedProject ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 border border-gray-700">
                <div>
                  <div className="text-xs text-white font-medium">{selectedProject.name}</div>
                  <div className="text-xs text-gray-500">{selectedProject.id} · {selectedProject.city}</div>
                </div>
                <button onClick={() => setSelectedProject(null)} className="text-gray-500 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  placeholder="Search by project name or ID..."
                  autoFocus
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none placeholder-gray-500"
                />
                {searching && <div className="absolute right-3 top-2 text-xs text-gray-500">Searching...</div>}
                {projectResults.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {projectResults.map(p => (
                      <button key={p.id} onClick={() => selectProject(p)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors border-b border-gray-700/50 last:border-0">
                        <div className="text-xs text-white">{p.name}</div>
                        <div className="text-xs text-gray-500">{p.id} · {p.city} · {p.pm}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Production Adjustment - Panel Reduction"
              className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none placeholder-gray-500" />
          </div>

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none">
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Reason + Origin */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Reason</label>
              <select value={reason} onChange={e => setReason(e.target.value)}
                className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none">
                <option value="">Select...</option>
                {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Origin</label>
              <select value={origin} onChange={e => setOrigin(e.target.value)}
                className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none">
                <option value="">Select...</option>
                {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {/* Assigned To */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Assigned To</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none">
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
            </select>
          </div>

          {/* Auto-populated preview */}
          {selectedProject && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Auto-populated from project:</div>
              <div className="bg-gray-800 rounded-lg px-3 py-2 text-xs text-gray-400 space-y-0.5">
                {selectedProject.module_qty && <div>Panel Count: <span className="text-gray-200">{selectedProject.module_qty}</span></div>}
                {selectedProject.module && <div>Panel Type: <span className="text-gray-200">{selectedProject.module}</span></div>}
                {selectedProject.systemkw && <div>System Size: <span className="text-gray-200">{selectedProject.systemkw} kW</span></div>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors">
            Cancel
          </button>
          <button onClick={handleCreate}
            disabled={!selectedProject || !title.trim() || saving}
            className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {saving ? 'Creating...' : 'Create Change Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
