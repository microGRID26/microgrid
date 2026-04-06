'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { cn, fmtDate } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import {
  loadWorkOrders, loadWorkOrder, createWorkOrder, updateWorkOrderStatus,
  addChecklistItem, toggleChecklistItem, deleteChecklistItem, updateChecklistItemNotes, uploadChecklistPhoto, updateWorkOrder,
  getValidTransitions, WO_CHECKLIST_TEMPLATES,
} from '@/lib/api/work-orders'
import type { WorkOrder, WOChecklistItem, WorkOrderFilters } from '@/lib/api/work-orders'
import type { Project } from '@/types/database'
import { loadProjectById, loadActiveCrews } from '@/lib/api'
import { useRealtimeSubscription } from '@/lib/hooks'
import { ClipboardList, Plus, ChevronDown, ChevronUp, X, Check, Trash2, Download, Camera } from 'lucide-react'

// ── Constants ────────────────────────────────────────────────────────────────

const WO_TYPES = ['install', 'service', 'inspection', 'rnr', 'survey'] as const
const WO_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const WO_STATUSES = ['draft', 'assigned', 'in_progress', 'complete', 'cancelled'] as const

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-700 text-gray-300',
  assigned: 'bg-blue-900 text-blue-300',
  in_progress: 'bg-amber-900 text-amber-300',
  complete: 'bg-green-900 text-green-300',
  cancelled: 'bg-red-900 text-red-300',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  complete: 'Complete',
  cancelled: 'Cancelled',
}

const PRIORITY_BADGE: Record<string, string> = {
  low: 'bg-gray-700 text-gray-300',
  normal: 'bg-blue-900 text-blue-300',
  high: 'bg-amber-900 text-amber-300',
  urgent: 'bg-red-900 text-red-300',
}

const TYPE_LABEL: Record<string, string> = {
  install: 'Installation',
  service: 'Service',
  inspection: 'Inspection',
  rnr: 'Roof Remove & Reinstall',
  survey: 'Survey',
}

// ── Create Work Order Modal ──────────────────────────────────────────────────

function CreateWOModal({
  onClose,
  onCreated,
  prefill,
}: {
  onClose: () => void
  onCreated: () => void
  prefill?: { projectId?: string; projectName?: string; type?: string }
}) {
  const { user: currentUser } = useCurrentUser()
  const [projectId, setProjectId] = useState(prefill?.projectId ?? '')
  const [type, setType] = useState(prefill?.type ?? 'install')
  const [priority, setPriority] = useState('normal')
  const [scheduledDate, setScheduledDate] = useState('')
  const [crew, setCrew] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [description, setDescription] = useState('')
  const [specialInstructions, setSpecialInstructions] = useState('')
  const [customChecklist, setCustomChecklist] = useState<string[]>([])
  const [newItem, setNewItem] = useState('')
  const [useDefaults, setUseDefaults] = useState(true)
  const [saving, setSaving] = useState(false)
  const [crews, setCrews] = useState<{ id: string; name: string }[]>([])

  // Load crews
  useEffect(() => {
    async function load() {
      const { data } = await loadActiveCrews()
      if (data) setCrews((data as { id: string; name: string }[]).map(c => ({ id: c.id, name: c.name })))
    }
    load()
  }, [])

  const defaultChecklist = WO_CHECKLIST_TEMPLATES[type] ?? []

  function addItem() {
    if (!newItem.trim()) return
    setCustomChecklist(prev => [...prev, newItem.trim()])
    setNewItem('')
  }

  async function handleCreate() {
    if (!projectId.trim()) return
    setSaving(true)

    const checklistItems = useDefaults
      ? [...defaultChecklist, ...customChecklist]
      : customChecklist

    const result = await createWorkOrder({
      project_id: projectId.trim(),
      type,
      status: crew ? 'assigned' : 'draft',
      assigned_crew: crew || null,
      assigned_to: assignedTo || null,
      scheduled_date: scheduledDate || null,
      started_at: null,
      completed_at: null,
      priority,
      description: description || null,
      special_instructions: specialInstructions || null,
      customer_signature: false,
      customer_signed_at: null,
      materials_used: [],
      time_on_site_minutes: null,
      notes: null,
      created_by: currentUser?.name ?? null,
    }, checklistItems.length > 0 ? checklistItems : undefined)

    setSaving(false)
    if (result) {
      onCreated()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Create Work Order</h2>
          <button onClick={onClose} aria-label="Close create work order dialog" className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Project ID */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Project ID *</label>
            <input
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              placeholder="PROJ-XXXXX"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
            />
            {prefill?.projectName && (
              <div className="text-xs text-gray-500 mt-1">{prefill.projectName}</div>
            )}
          </div>

          {/* Type + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {WO_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm">
                {WO_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Crew + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Assigned Crew</label>
              <select value={crew} onChange={e => setCrew(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm">
                <option value="">-- None --</option>
                {crews.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Scheduled Date</label>
              <input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Assigned To */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Assigned To (person)</label>
            <input value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              placeholder="Name"
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-none" />
          </div>

          {/* Special Instructions */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Special Instructions</label>
            <textarea value={specialInstructions} onChange={e => setSpecialInstructions(e.target.value)}
              rows={2}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-none" />
          </div>

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400">Checklist</label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={useDefaults} onChange={e => setUseDefaults(e.target.checked)}
                  className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-green-500" />
                <span className="text-xs text-gray-500">Use default template</span>
              </label>
            </div>
            {useDefaults && defaultChecklist.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-3 mb-2 space-y-1">
                {defaultChecklist.map((item, i) => (
                  <div key={i} className="text-xs text-gray-400 flex items-center gap-2">
                    <div className="w-3 h-3 rounded border border-gray-600 flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            )}
            {customChecklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-300 mb-1">
                <div className="w-3 h-3 rounded border border-green-600 flex-shrink-0" />
                {item}
                <button onClick={() => setCustomChecklist(prev => prev.filter((_, idx) => idx !== i))}
                  className="ml-auto text-gray-600 hover:text-red-400"><X className="w-3 h-3" /></button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input value={newItem} onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem() }}
                placeholder="Add checklist item..."
                className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-green-500" />
              <button onClick={addItem} className="text-xs text-green-400 hover:text-green-300 px-2">Add</button>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-800">
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white px-4 py-2">Cancel</button>
          <button onClick={handleCreate} disabled={saving || !projectId.trim()}
            className={cn(
              'text-xs px-4 py-2 rounded-lg font-medium transition-colors',
              projectId.trim() && !saving
                ? 'bg-green-600 hover:bg-green-500 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            )}>
            {saving ? 'Creating...' : 'Create Work Order'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDone }: { message: string; type?: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 5000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className={cn(
      'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 text-sm px-5 py-3 rounded-xl shadow-xl max-w-[90vw] text-center',
      type === 'success' ? 'bg-green-800 text-green-100' : 'bg-red-800 text-red-100'
    )}>
      {message}
    </div>
  )
}

// ── Work Order Detail (Expandable Row) ───────────────────────────────────────

function WODetail({
  woId,
  onClose,
  onUpdated,
  onOpenProject,
  showToast,
}: {
  woId: string
  onClose: () => void
  onUpdated: () => void
  onOpenProject: (projectId: string) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const { user: currentUser } = useCurrentUser()
  const [wo, setWO] = useState<WorkOrder | null>(null)
  const [checklist, setChecklist] = useState<WOChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newItem, setNewItem] = useState('')
  const [notes, setNotes] = useState('')
  const [timeOnSite, setTimeOnSite] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const result = await loadWorkOrder(woId)
    if (result) {
      setWO(result.wo)
      setChecklist(result.checklist)
      setNotes(result.wo.notes ?? '')
      setTimeOnSite(result.wo.time_on_site_minutes?.toString() ?? '')
    }
    setLoading(false)
  }, [woId])

  useEffect(() => { load() }, [load])

  async function handleStatusAdvance() {
    if (!wo) return
    const transitions = getValidTransitions(wo.status)
    // Pick the next logical status (first non-cancelled)
    const next = transitions.find(s => s !== 'cancelled')
    if (!next) return
    const ok = await updateWorkOrderStatus(wo.id, next)
    if (ok) { load(); onUpdated() } else { showToast('Failed to update status', 'error') }
  }

  async function handleCancel() {
    if (!wo || !confirm('Cancel this work order?')) return
    const ok = await updateWorkOrderStatus(wo.id, 'cancelled')
    if (ok) { load(); onUpdated() } else { showToast('Failed to cancel work order', 'error') }
  }

  async function handleAddItem() {
    if (!newItem.trim() || !wo) return
    const result = await addChecklistItem(wo.id, newItem.trim())
    if (result) {
      setNewItem('')
      load()
    } else {
      showToast('Failed to add checklist item', 'error')
    }
  }

  async function handleToggleItem(item: WOChecklistItem) {
    await toggleChecklistItem(item.id, !item.completed, currentUser?.name ?? 'Unknown')
    load()
  }

  async function handleDeleteItem(itemId: string) {
    const ok = await deleteChecklistItem(itemId)
    if (ok) {
      load()
    } else {
      showToast('Failed to delete checklist item', 'error')
    }
  }

  async function handleSaveNotes() {
    if (!wo) return
    setSaving(true)
    await updateWorkOrder(wo.id, {
      notes,
      time_on_site_minutes: timeOnSite ? parseInt(timeOnSite, 10) : null,
    })
    setSaving(false)
    onUpdated()
  }

  async function handleSignature() {
    if (!wo) return
    await updateWorkOrder(wo.id, {
      customer_signature: true,
      customer_signed_at: new Date().toISOString(),
    })
    load()
  }

  if (loading) return (
    <div className="bg-gray-800 rounded-xl p-6 animate-pulse">
      <div className="h-4 w-32 bg-gray-700 rounded mb-4" />
      <div className="h-4 w-48 bg-gray-700 rounded" />
    </div>
  )

  if (!wo) return <div className="text-red-400 text-sm p-4">Work order not found</div>

  const completedCount = checklist.filter(c => c.completed).length
  const totalCount = checklist.length
  const transitions = getValidTransitions(wo.status)
  const nextStatus = transitions.find(s => s !== 'cancelled')

  return (
    <div className="bg-gray-850 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gray-800 px-5 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-white font-bold text-lg">{wo.wo_number}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_BADGE[wo.status])}>{STATUS_LABEL[wo.status]}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full', PRIORITY_BADGE[wo.priority])}>{wo.priority}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-gray-400">{TYPE_LABEL[wo.type] ?? wo.type}</span>
            {wo.project && (
              <button onClick={() => onOpenProject(wo.project_id)}
                className="text-sm text-green-400 hover:text-green-300">{wo.project.name} ({wo.project_id})</button>
            )}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close work order detail" className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Assignment info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500 text-xs block">Crew</span>
            <span className="text-white">{wo.assigned_crew ?? '---'}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Assigned To</span>
            <span className="text-white">{wo.assigned_to ?? '---'}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Scheduled</span>
            <span className="text-white">{wo.scheduled_date ? fmtDate(wo.scheduled_date) : '---'}</span>
          </div>
          <div>
            <span className="text-gray-500 text-xs block">Time on Site</span>
            <span className="text-white">{wo.time_on_site_minutes ? `${wo.time_on_site_minutes} min` : '---'}</span>
          </div>
        </div>

        {/* Description */}
        {wo.description && (
          <div>
            <span className="text-xs text-gray-500 block mb-1">Description</span>
            <p className="text-sm text-gray-300">{wo.description}</p>
          </div>
        )}

        {/* Special Instructions */}
        {wo.special_instructions && (
          <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
            <span className="text-xs text-amber-400 font-medium block mb-1">Special Instructions</span>
            <p className="text-sm text-amber-200">{wo.special_instructions}</p>
          </div>
        )}

        {/* Checklist */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              Checklist
              {totalCount > 0 && (
                <span className={cn('text-xs', completedCount === totalCount ? 'text-green-400' : 'text-gray-500')}>
                  {completedCount}/{totalCount}
                </span>
              )}
            </h3>
            {totalCount > 0 && (
              <div className="w-24 bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
            )}
          </div>
          <div className="space-y-1">
            {checklist.map(item => (
              <div key={item.id} className="group py-1">
                <div className="flex items-center gap-3">
                  <button onClick={() => handleToggleItem(item)}
                    className={cn(
                      'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                      item.completed
                        ? 'bg-green-600 border-green-500 text-white'
                        : 'border-gray-600 hover:border-green-500'
                    )}>
                    {item.completed && <Check className="w-3 h-3" />}
                  </button>
                  <span className={cn('text-sm flex-1', item.completed ? 'text-gray-500 line-through' : 'text-gray-300')}>
                    {item.description}
                  </span>
                  {item.completed_by && (
                    <span className="text-xs text-gray-600">{item.completed_by}</span>
                  )}
                  {/* Photo capture */}
                  <label className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-blue-400 transition-opacity cursor-pointer">
                    <Camera className="w-3 h-3" />
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const url = await uploadChecklistPhoto(item.id, file)
                      if (url) { item.photo_url = url; setChecklist([...checklist]) }
                    }} />
                  </label>
                  <button onClick={() => handleDeleteItem(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-opacity">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {/* Photo thumbnail + notes */}
                <div className="ml-8 mt-0.5 space-y-1">
                  {item.photo_url && (
                    <a href={item.photo_url} target="_blank" rel="noopener noreferrer">
                      <img src={item.photo_url} alt="" className="w-16 h-16 object-cover rounded border border-gray-700 hover:border-green-500 transition-colors" />
                    </a>
                  )}
                  <input
                    defaultValue={item.notes ?? ''}
                    placeholder="Add note..."
                    onBlur={async (e) => {
                      const val = e.target.value.trim() || null
                      if (val !== (item.notes ?? null)) {
                        await updateChecklistItemNotes(item.id, val)
                        item.notes = val
                      }
                    }}
                    className="w-full text-[11px] text-gray-500 bg-transparent border-none outline-none placeholder:text-gray-700 focus:text-gray-300 focus:placeholder:text-gray-600"
                  />
                </div>
              </div>
            ))}
          </div>
          {/* Add item */}
          <div className="flex gap-2 mt-3">
            <input value={newItem} onChange={e => setNewItem(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddItem() }}
              placeholder="Add checklist item..."
              className="flex-1 bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-green-500" />
            <button onClick={handleAddItem} disabled={!newItem.trim()}
              className="text-xs text-green-400 hover:text-green-300 px-3 py-1.5 disabled:text-gray-600">Add</button>
          </div>
        </div>

        {/* Notes + Time on Site */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-none" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Time on Site (minutes)</label>
            <input type="number" value={timeOnSite} onChange={e => setTimeOnSite(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500" />
            <button onClick={handleSaveNotes} disabled={saving}
              className="mt-2 text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg transition-colors">
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </div>

        {/* Customer Signature */}
        <div className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
          <div>
            <span className="text-sm text-gray-300 font-medium">Customer Signature</span>
            {wo.customer_signed_at && (
              <span className="text-xs text-gray-500 block">Signed {fmtDate(wo.customer_signed_at)}</span>
            )}
          </div>
          {wo.customer_signature ? (
            <span className="text-green-400 text-sm flex items-center gap-1"><Check className="w-4 h-4" /> Signed</span>
          ) : (
            <button onClick={handleSignature}
              className="text-xs bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg transition-colors">
              Collect Signature
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {nextStatus && (
            <button onClick={handleStatusAdvance}
              className="text-sm bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
              {nextStatus === 'assigned' ? 'Assign' : nextStatus === 'in_progress' ? 'Start Work' : 'Mark Complete'}
            </button>
          )}
          {transitions.includes('cancelled') && (
            <button onClick={handleCancel}
              className="text-sm text-gray-400 hover:text-red-400 px-4 py-2.5 rounded-lg border border-gray-700 hover:border-red-700 transition-colors">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function WorkOrdersPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [projectPanel, setProjectPanel] = useState<Project | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' } | null>(null)

  const showToast = useCallback((message: string, type?: 'success' | 'error') => {
    setToast({ message, type })
  }, [])

  const load = useCallback(async () => {
    const filters: WorkOrderFilters = {}
    if (statusFilter !== 'all') filters.status = statusFilter
    if (typeFilter !== 'all') filters.type = typeFilter
    const data = await loadWorkOrders(filters)
    setWorkOrders(data)
    setLoading(false)
  }, [statusFilter, typeFilter])

  useEffect(() => { load() }, [load])

  // Realtime subscription
  useRealtimeSubscription('work_orders', {
    onChange: useCallback(() => load(), [load]),
  })

  // Open project panel
  async function handleOpenProject(projectId: string) {
    const data = await loadProjectById(projectId)
    if (data) setProjectPanel(data)
  }

  // Filter + search
  const filtered = useMemo(() => {
    let result = workOrders
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(wo => {
        if (wo.wo_number.toLowerCase().includes(q)) return true
        if (wo.project_id.toLowerCase().includes(q)) return true
        if (wo.project?.name?.toLowerCase().includes(q)) return true
        if (wo.assigned_crew?.toLowerCase().includes(q)) return true
        if (wo.assigned_to?.toLowerCase().includes(q)) return true
        return false
      })
    }
    return result
  }, [workOrders, search])

  // Stats
  const stats = useMemo(() => ({
    open: workOrders.filter(wo => wo.status === 'draft' || wo.status === 'assigned').length,
    inProgress: workOrders.filter(wo => wo.status === 'in_progress').length,
    completedToday: workOrders.filter(wo => {
      if (wo.status !== 'complete' || !wo.completed_at) return false
      return wo.completed_at.slice(0, 10) === new Date().toISOString().slice(0, 10)
    }).length,
    total: workOrders.length,
  }), [workOrders])

  // ── CSV Export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = ['WO Number', 'Project ID', 'Type', 'Status', 'Assigned Crew', 'Assigned To', 'Scheduled Date', 'Priority', 'Started At', 'Completed At', 'Time On Site (min)']
    const rows = filtered.map(wo => [
      wo.wo_number,
      wo.project_id,
      TYPE_LABEL[wo.type] ?? wo.type,
      STATUS_LABEL[wo.status] ?? wo.status,
      wo.assigned_crew ?? '',
      wo.assigned_to ?? '',
      wo.scheduled_date ?? '',
      wo.priority ?? '',
      wo.started_at ? wo.started_at.slice(0, 19).replace('T', ' ') : '',
      wo.completed_at ? wo.completed_at.slice(0, 19).replace('T', ' ') : '',
      wo.time_on_site_minutes ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `work-orders-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (userLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-green-400 text-sm animate-pulse">Loading work orders...</div>
      </div>
    )
  }

  if (currentUser && !currentUser.isManager) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">You don&apos;t have permission to view this page.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Work Orders" />

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 sm:px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-green-400" />
              Work Orders
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Field work tracking and completion</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            aria-label="Create new work order"
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors">
            <Plus className="w-4 h-4" /> New Work Order
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          {[
            { label: 'Open', value: stats.open, color: 'text-blue-400' },
            { label: 'In Progress', value: stats.inProgress, color: 'text-amber-400' },
            { label: 'Completed Today', value: stats.completedToday, color: 'text-green-400' },
            { label: 'Total', value: stats.total, color: 'text-white' },
          ].map(card => (
            <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
              <div className={cn('text-2xl font-bold', card.color)}>{card.value}</div>
              <div className="text-xs text-gray-500">{card.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-gray-900 border-b border-gray-800 flex flex-wrap items-center gap-3 px-4 sm:px-6 py-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search WO#, project, crew..."
          className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-52 focus:outline-none focus:border-green-500 placeholder-gray-500"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Statuses</option>
          {WO_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Types</option>
          {WO_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <span className="text-xs text-gray-500 ml-auto">{filtered.length} work order{filtered.length !== 1 ? 's' : ''}</span>
        <button onClick={exportCSV} aria-label="Export work orders to CSV"
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors shrink-0">
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-3 sm:px-6 py-4">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 text-gray-700" />
            <div className="text-sm">
              {workOrders.length === 0
                ? 'No work orders yet. Create one to get started.'
                : 'No work orders found matching your filters.'}
            </div>
            {workOrders.length === 0 && (
              <button onClick={() => setShowCreate(true)}
                className="mt-3 text-sm text-green-400 hover:text-green-300">Create your first work order</button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(wo => (
              <div key={wo.id}>
                {/* Row */}
                <button
                  onClick={() => setExpandedId(expandedId === wo.id ? null : wo.id)}
                  aria-label={expandedId === wo.id ? `Collapse ${wo.wo_number}` : `Expand ${wo.wo_number}`}
                  className={cn(
                    'w-full text-left bg-gray-800 rounded-lg px-4 py-3 hover:bg-gray-750 transition-colors border',
                    expandedId === wo.id ? 'border-green-700' : 'border-gray-800'
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0 w-5">
                      {expandedId === wo.id ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </div>
                    <div className="w-32 flex-shrink-0">
                      <span className="text-sm font-medium text-white">{wo.wo_number}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-300 truncate block">
                        {wo.project?.name ?? wo.project_id}
                      </span>
                    </div>
                    <div className="w-24 flex-shrink-0">
                      <span className="text-xs text-gray-400">{TYPE_LABEL[wo.type] ?? wo.type}</span>
                    </div>
                    <div className="w-28 flex-shrink-0 hidden lg:block">
                      <span className="text-xs text-gray-400">{wo.assigned_crew ?? '---'}</span>
                    </div>
                    <div className="w-24 flex-shrink-0 hidden lg:block">
                      <span className="text-xs text-gray-400">{wo.scheduled_date ? fmtDate(wo.scheduled_date) : '---'}</span>
                    </div>
                    <div className="w-20 flex-shrink-0 hidden lg:block">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', PRIORITY_BADGE[wo.priority])}>
                        {wo.priority}
                      </span>
                    </div>
                    <div className="w-24 flex-shrink-0">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_BADGE[wo.status])}>
                        {STATUS_LABEL[wo.status]}
                      </span>
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {expandedId === wo.id && (
                  <div className="mt-2 mb-4">
                    <WODetail
                      woId={wo.id}
                      onClose={() => setExpandedId(null)}
                      onUpdated={load}
                      onOpenProject={handleOpenProject}
                      showToast={showToast}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <CreateWOModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}

      {/* ProjectPanel */}
      {projectPanel && (
        <ProjectPanel
          project={projectPanel}
          onClose={() => setProjectPanel(null)}
          onProjectUpdated={load}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}
