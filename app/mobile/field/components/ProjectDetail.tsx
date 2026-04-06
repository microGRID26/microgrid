import { useEffect, useState } from 'react'
import { cn, daysAgo, fmtDate, STAGE_LABELS } from '@/lib/utils'
import { addNote } from '@/lib/api/notes'
import { loadProjectWorkOrders, updateWorkOrderStatus, toggleChecklistItem, uploadChecklistPhoto, updateWorkOrder, loadWorkOrder } from '@/lib/api/work-orders'
import type { Project } from '@/types/database'
import type { WorkOrder, WOChecklistItem } from '@/lib/api/work-orders'
import { Toast } from './Toast'
import { telLink, mapsLink } from './constants'

export function ProjectDetail({
  project,
  onClose,
  onNoteAdded,
  userName,
  userId,
}: {
  project: Project
  onClose: () => void
  onNoteAdded: () => void
  userName: string | null
  userId: string | null
}) {
  const [noteText, setNoteText] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' } | null>(null)
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [woLoading, setWoLoading] = useState(true)
  const [expandedWO, setExpandedWO] = useState<string | null>(null)
  const [woChecklist, setWoChecklist] = useState<WOChecklistItem[]>([])
  const [woNotes, setWoNotes] = useState('')
  const [woTimeOnSite, setWoTimeOnSite] = useState('')

  useEffect(() => {
    async function loadWOs() {
      const data = await loadProjectWorkOrders(project.id)
      setWorkOrders(data)
      setWoLoading(false)
    }
    loadWOs()
  }, [project.id])

  async function expandWO(woId: string) {
    if (expandedWO === woId) { setExpandedWO(null); return }
    const result = await loadWorkOrder(woId)
    if (result) {
      setWoChecklist(result.checklist)
      setWoNotes(result.wo.notes ?? '')
      setWoTimeOnSite(result.wo.time_on_site_minutes?.toString() ?? '')
    }
    setExpandedWO(woId)
  }

  async function handleWOStatusChange(woId: string, status: string) {
    const ok = await updateWorkOrderStatus(woId, status)
    if (ok) {
      setWorkOrders(prev => prev.map(wo => wo.id === woId ? { ...wo, status } : wo))
      setToast({ message: status === 'complete' ? 'Work order completed' : 'Status updated', type: 'success' })
    } else {
      setToast({ message: 'Failed to update status', type: 'error' })
    }
  }

  async function handleToggleChecklist(item: WOChecklistItem) {
    const ok = await toggleChecklistItem(item.id, !item.completed, userName ?? 'Field Crew')
    if (ok) {
      setWoChecklist(prev => prev.map(c => c.id === item.id ? { ...c, completed: !c.completed, completed_by: !item.completed ? (userName ?? 'Field Crew') : null } : c))
    } else {
      setToast({ message: 'Failed to update checklist item', type: 'error' })
    }
  }

  async function handleSaveWONotes(woId: string) {
    const ok = await updateWorkOrder(woId, {
      notes: woNotes || null,
      time_on_site_minutes: woTimeOnSite ? (parseInt(woTimeOnSite, 10) || null) : null,
    })
    if (ok) {
      setToast({ message: 'Work order notes saved', type: 'success' })
    } else {
      setToast({ message: 'Failed to save work order notes', type: 'error' })
    }
  }

  const address = [project.address, project.city, project.zip].filter(Boolean).join(', ')

  async function handleSendNote() {
    if (!noteText.trim() || !project.id) return
    setSending(true)
    const { error } = await addNote({
      project_id: project.id,
      text: noteText.trim(),
      time: new Date().toISOString(),
      pm: userName,
      pm_id: userId,
    })
    setSending(false)
    if (error) {
      setToast({ message: 'Failed to add note', type: 'error' })
    } else {
      setNoteText('')
      setToast({ message: 'Note added', type: 'success' })
      onNoteAdded()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/95 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white truncate mr-4">{project.name}</h2>
        <button
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 active:text-white"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* Customer */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Customer</h3>
          <div className="space-y-2">
            <div className="text-white font-medium">{project.name}</div>
            <div className="text-sm text-gray-400">{project.id}</div>
            {project.phone && (
              <a href={telLink(project.phone)} className="flex items-center gap-3 min-h-[44px] text-green-400 active:text-green-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span className="text-base">{project.phone}</span>
              </a>
            )}
            {project.email && (
              <a href={`mailto:${project.email}`} className="flex items-center gap-3 min-h-[44px] text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                <span className="text-base">{project.email}</span>
              </a>
            )}
            {address && (
              <a href={mapsLink(address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 min-h-[44px] text-green-400 active:text-green-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                <span className="text-base">{address}</span>
              </a>
            )}
          </div>
        </section>

        {/* System */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">System</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {project.systemkw && (
              <div>
                <span className="text-gray-500">Size</span>
                <div className="text-white font-medium">{project.systemkw} kW</div>
              </div>
            )}
            {project.module && (
              <div>
                <span className="text-gray-500">Panels</span>
                <div className="text-white">{project.module_qty ? `${project.module_qty}x ` : ''}{project.module}</div>
              </div>
            )}
          </div>
        </section>

        {/* Status */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Status</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Stage</span>
              <span className="text-white font-medium">{STAGE_LABELS[project.stage] ?? project.stage}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Days in Stage</span>
              <span className="text-white">{daysAgo(project.stage_date)}</span>
            </div>
            {project.blocker && (
              <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-300 text-sm mt-2">
                Blocker: {project.blocker}
              </div>
            )}
          </div>
        </section>

        {/* Key Dates */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Key Dates</h3>
          <div className="space-y-1 text-sm">
            {project.survey_date && (
              <div className="flex justify-between">
                <span className="text-gray-500">Survey</span>
                <span className="text-white">{fmtDate(project.survey_date)}</span>
              </div>
            )}
            {project.install_complete_date && (
              <div className="flex justify-between">
                <span className="text-gray-500">Install</span>
                <span className="text-white">{fmtDate(project.install_complete_date)}</span>
              </div>
            )}
            {project.pto_date && (
              <div className="flex justify-between">
                <span className="text-gray-500">PTO</span>
                <span className="text-white">{fmtDate(project.pto_date)}</span>
              </div>
            )}
          </div>
        </section>

        {/* Add Note */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Add Note</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendNote() }}
              placeholder="Type a note..."
              className="flex-1 min-h-[44px] bg-gray-900 text-white border border-gray-700 rounded-xl px-4 text-base placeholder-gray-600 focus:outline-none focus:border-green-500"
            />
            <button
              onClick={handleSendNote}
              disabled={!noteText.trim() || sending}
              className={cn(
                'min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center transition-colors',
                noteText.trim() && !sending
                  ? 'bg-green-700 text-white active:bg-green-600'
                  : 'bg-gray-800 text-gray-600'
              )}
              aria-label="Send note"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
        </section>

        {/* Work Orders */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Work Orders</h3>
          {woLoading ? (
            <div className="text-sm text-gray-500 animate-pulse">Loading...</div>
          ) : workOrders.length === 0 ? (
            <div className="text-sm text-gray-600">No work orders for this project</div>
          ) : (
            <div className="space-y-3">
              {workOrders.map(wo => {
                const isExpanded = expandedWO === wo.id
                const statusColor: Record<string, string> = {
                  draft: 'bg-gray-700 text-gray-300',
                  assigned: 'bg-blue-900 text-blue-300',
                  in_progress: 'bg-amber-900 text-amber-300',
                  complete: 'bg-green-900 text-green-300',
                  cancelled: 'bg-red-900 text-red-300',
                }
                return (
                  <div key={wo.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <button
                      onClick={() => expandWO(wo.id)}
                      aria-label={isExpanded ? `Collapse ${wo.wo_number}` : `Expand ${wo.wo_number}`}
                      className="w-full text-left px-4 py-3 active:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white">{wo.wo_number}</span>
                        <span className={cn('text-xs px-2 py-0.5 rounded-full', statusColor[wo.status] ?? 'bg-gray-700 text-gray-300')}>
                          {wo.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {wo.type.charAt(0).toUpperCase() + wo.type.slice(1)}
                        {wo.scheduled_date && <> &middot; {fmtDate(wo.scheduled_date)}</>}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3 border-t border-gray-800 pt-3">
                        {/* Checklist */}
                        {woChecklist.length > 0 && (
                          <div>
                            <div className="text-xs text-gray-500 font-medium mb-2">
                              Checklist ({woChecklist.filter(c => c.completed).length}/{woChecklist.length})
                            </div>
                            <div className="space-y-2">
                              {woChecklist.map(item => (
                                <div key={item.id} className="space-y-1">
                                  <button
                                    onClick={() => handleToggleChecklist(item)}
                                    className="w-full flex items-center gap-3 text-left min-h-[44px] active:bg-gray-800 rounded-lg px-2 -mx-2 transition-colors"
                                  >
                                    <div className={cn(
                                      'w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0',
                                      item.completed ? 'bg-green-600 border-green-500' : 'border-gray-600'
                                    )}>
                                      {item.completed && (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                                      )}
                                    </div>
                                    <div className="flex-1">
                                      <span className={cn('text-sm', item.completed ? 'text-gray-500 line-through' : 'text-gray-200')}>
                                        {item.description}
                                      </span>
                                      {item.notes && (
                                        <div className="text-[10px] text-gray-600 mt-0.5">{item.notes}</div>
                                      )}
                                    </div>
                                  </button>
                                  {/* Photo: show thumbnail + capture button */}
                                  <div className="flex items-center gap-2 ml-9">
                                    {item.photo_url && (
                                      <a href={item.photo_url} target="_blank" rel="noopener noreferrer">
                                        <img src={item.photo_url} alt="" className="w-12 h-12 object-cover rounded border border-gray-700" />
                                      </a>
                                    )}
                                    <label className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-500 active:text-blue-400 cursor-pointer">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
                                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
                                        const file = e.target.files?.[0]
                                        if (!file) return
                                        const url = await uploadChecklistPhoto(item.id, file)
                                        if (url) {
                                          item.photo_url = url
                                          setWoChecklist([...woChecklist])
                                          setToast({ message: 'Photo uploaded', type: 'success' })
                                        } else {
                                          setToast({ message: 'Photo upload failed', type: 'error' })
                                        }
                                      }} />
                                    </label>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Notes + Time */}
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Notes</label>
                          <input
                            type="text"
                            value={woNotes}
                            onChange={e => setWoNotes(e.target.value)}
                            placeholder="Add notes..."
                            className="w-full min-h-[44px] bg-gray-800 text-white border border-gray-700 rounded-xl px-4 text-sm placeholder-gray-600 focus:outline-none focus:border-green-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 block mb-1">Time on Site (minutes)</label>
                          <input
                            type="number"
                            value={woTimeOnSite}
                            onChange={e => setWoTimeOnSite(e.target.value)}
                            placeholder="0"
                            className="w-full min-h-[44px] bg-gray-800 text-white border border-gray-700 rounded-xl px-4 text-sm placeholder-gray-600 focus:outline-none focus:border-green-500"
                          />
                        </div>
                        <button
                          onClick={() => handleSaveWONotes(wo.id)}
                          className="w-full py-3 rounded-xl font-semibold text-sm bg-gray-800 border border-gray-700 active:bg-gray-700 text-gray-300 transition-colors"
                        >
                          Save Notes
                        </button>

                        {/* Status actions */}
                        {wo.status === 'assigned' && (
                          <button
                            onClick={() => handleWOStatusChange(wo.id, 'in_progress')}
                            className="w-full py-3 rounded-xl font-semibold text-base bg-amber-700 active:bg-amber-500 text-white transition-colors"
                          >
                            Start Work Order
                          </button>
                        )}
                        {wo.status === 'in_progress' && (
                          <button
                            onClick={() => handleWOStatusChange(wo.id, 'complete')}
                            className="w-full py-3 rounded-xl font-semibold text-base bg-green-700 active:bg-green-500 text-white transition-colors"
                          >
                            Complete Work Order
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}
