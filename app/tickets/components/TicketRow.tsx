import React, { useState } from 'react'
import { fmtDate, cn } from '@/lib/utils'
import {
  getSLAStatus, getValidTransitions,
  TICKET_STATUS_LABELS, TICKET_STATUS_COLORS,
  TICKET_PRIORITY_COLORS, TICKET_CATEGORY_COLORS,
  TICKET_CATEGORIES, TICKET_PRIORITIES,
  loadTicketComments, addTicketComment, deleteTicketComment, loadDeletedComments,
} from '@/lib/api/tickets'
import type { Ticket, TicketComment, TicketHistory } from '@/lib/api/tickets'
import { MentionNoteInput } from '@/components/project/MentionNoteInput'
import TicketCommentAttachment from '@/components/storage/TicketCommentAttachment'
import { Pencil } from 'lucide-react'

interface TicketRowProps {
  t: Ticket
  isExpanded: boolean
  onExpand: (id: string) => void
  onOpenProject: (projectId: string) => void
  onStatusChange: (ticketId: string, newStatus: string) => void
  onStartEdit: (t: Ticket) => void
  editingId: string | null
  editDraft: Partial<Ticket>
  setEditDraft: React.Dispatch<React.SetStateAction<Partial<Ticket>>>
  onSaveEdit: () => void
  onCancelEdit: () => void
  comments: TicketComment[]
  setComments: React.Dispatch<React.SetStateAction<TicketComment[]>>
  history: TicketHistory[]
  detailTab: 'comments' | 'history' | 'details'
  setDetailTab: React.Dispatch<React.SetStateAction<'comments' | 'history' | 'details'>>
  users: { id: string; name: string }[]
  userName: string | null
  user: { id: string; name: string; isAdmin: boolean; isSuperAdmin: boolean } | null
}

export function TicketRow({
  t, isExpanded, onExpand, onOpenProject, onStatusChange,
  onStartEdit, editingId, editDraft, setEditDraft, onSaveEdit, onCancelEdit,
  comments, setComments, history, detailTab, setDetailTab,
  users, userName, user,
}: TicketRowProps) {
  const sla = getSLAStatus(t)
  const ageHours = Math.round((Date.now() - new Date(t.created_at).getTime()) / 3600000)
  const ageDays = Math.floor(ageHours / 24)
  const ageStr = ageDays > 0 ? `${ageDays}d` : `${ageHours}h`

  const [commentInternal, setCommentInternal] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const [deletedComments, setDeletedComments] = useState<(TicketComment & { deleted_by?: string; deleted_at?: string })[]>([])

  return (
    <React.Fragment>
      <tr className={cn('border-b border-gray-700/50 hover:bg-gray-750 cursor-pointer transition-colors', isExpanded && 'bg-gray-750')}
        onClick={() => onExpand(t.id)}>
        <td className="px-4 py-2.5">
          <span className="text-blue-400 font-mono font-medium">{t.ticket_number}</span>
        </td>
        <td className="px-4 py-2.5 text-white font-medium max-w-[250px] truncate">{t.title}</td>
        <td className="px-4 py-2.5">
          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', TICKET_CATEGORY_COLORS[t.category])}>
            {t.category}
          </span>
          {t.subcategory && <span className="text-gray-500 text-[10px] ml-1">{t.subcategory.replace(/_/g, ' ')}</span>}
        </td>
        <td className="px-4 py-2.5">
          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', TICKET_PRIORITY_COLORS[t.priority])}>
            {t.priority}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className={cn('px-2 py-0.5 rounded text-[10px] font-medium', TICKET_STATUS_COLORS[t.status])}>
            {TICKET_STATUS_LABELS[t.status]}
          </span>
        </td>
        <td className="px-4 py-2.5">
          {t.project_id ? (
            <button onClick={e => { e.stopPropagation(); onOpenProject(t.project_id!) }} className="text-green-400 hover:text-green-300 font-mono text-[11px]">
              {t.project_id}
            </button>
          ) : <span className="text-gray-600">&mdash;</span>}
        </td>
        <td className="px-4 py-2.5 text-gray-300 truncate max-w-[100px]">{t.assigned_to ?? <span className="text-gray-600">&mdash;</span>}</td>
        <td className="px-4 py-2.5">
          <div className="flex gap-1" title={`Response: ${sla.response} (${t.sla_response_hours}h target)\nResolution: ${sla.resolution} (${t.sla_resolution_hours}h target)`}>
            <span className={cn('w-2.5 h-2.5 rounded-full', sla.response === 'ok' ? 'bg-green-500' : sla.response === 'warning' ? 'bg-amber-500' : 'bg-red-500')} />
            <span className={cn('w-2.5 h-2.5 rounded-full', sla.resolution === 'ok' ? 'bg-green-500' : sla.resolution === 'warning' ? 'bg-amber-500' : 'bg-red-500')} />
          </div>
        </td>
        <td className="px-4 py-2.5 text-gray-400">{ageStr}</td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr>
          <td colSpan={9} className="px-4 py-4 bg-gray-900/50 border-b border-gray-700">
            <div className="space-y-4">
              {/* Description */}
              {t.description && (
                <div className="bg-gray-800 rounded-lg p-3">
                  <div className="text-[10px] text-gray-500 uppercase font-medium mb-1">Description</div>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{t.description}</p>
                </div>
              )}

              {/* Quick info row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <div><span className="text-gray-500 block text-[10px]">Source</span><span className="text-gray-300 capitalize">{t.source?.replace(/_/g, ' ') ?? '\u2014'}</span></div>
                <div><span className="text-gray-500 block text-[10px]">Reported By</span><span className="text-gray-300">{t.reported_by ?? t.created_by ?? '\u2014'}</span></div>
                <div><span className="text-gray-500 block text-[10px]">Created</span><span className="text-gray-300">{fmtDate(t.created_at)}</span></div>
                <div><span className="text-gray-500 block text-[10px]">SLA Response</span><span className={cn(sla.response === 'breached' ? 'text-red-400 font-medium' : 'text-gray-300')}>{t.sla_response_hours}h target</span></div>
                <div><span className="text-gray-500 block text-[10px]">SLA Resolution</span><span className={cn(sla.resolution === 'breached' ? 'text-red-400 font-medium' : 'text-gray-300')}>{t.sla_resolution_hours}h target</span></div>
              </div>

              {/* Resolution info */}
              {t.resolution_category && (
                <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3">
                  <div className="text-[10px] text-green-400 uppercase font-medium mb-1">Resolution</div>
                  <span className="text-xs text-green-300 capitalize">{t.resolution_category.replace(/_/g, ' ')}</span>
                  {t.resolution_notes && <p className="text-xs text-gray-400 mt-1">{t.resolution_notes}</p>}
                </div>
              )}

              {/* Status actions + edit */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-gray-500 uppercase font-medium mr-1">Actions:</span>
                {getValidTransitions(t.status).map(s => (
                  <button key={s} onClick={() => onStatusChange(t.id, s)}
                    className={cn('px-2.5 py-1 rounded text-[11px] font-medium transition-colors', TICKET_STATUS_COLORS[s], 'hover:opacity-80')}>
                    → {TICKET_STATUS_LABELS[s]}
                  </button>
                ))}
                <button onClick={() => onStartEdit(t)} className="px-2.5 py-1 rounded text-[11px] font-medium bg-gray-700 text-gray-300 hover:text-white ml-auto">
                  <Pencil className="w-3 h-3 inline mr-1" />Edit
                </button>
              </div>

              {/* Inline edit form */}
              {editingId === t.id && (
                <div className="bg-gray-800 rounded-lg p-3 space-y-2" onClick={e => e.stopPropagation()}>
                  <div className="text-[10px] text-gray-500 uppercase font-medium">Edit Ticket</div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div className="col-span-full">
                      <label className="text-[10px] text-gray-500">Title</label>
                      <input value={editDraft.title ?? ''} onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Priority</label>
                      <select value={editDraft.priority ?? ''} onChange={e => setEditDraft(d => ({ ...d, priority: e.target.value }))}
                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white">
                        {TICKET_PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Category</label>
                      <select value={editDraft.category ?? ''} onChange={e => setEditDraft(d => ({ ...d, category: e.target.value }))}
                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white">
                        {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Assigned To</label>
                      <select value={editDraft.assigned_to ?? ''} onChange={e => setEditDraft(d => ({ ...d, assigned_to: e.target.value }))}
                        className="w-full mt-0.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white">
                        <option value="">Unassigned</option>
                        {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={onSaveEdit} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-[10px] text-white font-medium">Save</button>
                    <button onClick={onCancelEdit} className="px-3 py-1 text-gray-400 hover:text-white text-[10px]">Cancel</button>
                  </div>
                </div>
              )}

              {/* Tab bar */}
              <div className="flex gap-4 border-b border-gray-700 pb-0">
                {(['comments', 'history', 'details'] as const).map(tab => (
                  <button key={tab} onClick={() => setDetailTab(tab)}
                    className={cn('text-xs pb-2 border-b-2 transition-colors capitalize',
                      detailTab === tab ? 'text-white border-green-500' : 'text-gray-500 border-transparent hover:text-gray-300')}>
                    {tab === 'comments' ? `Comments (${comments.length})` : tab === 'history' ? `History (${history.length})` : 'Details'}
                  </button>
                ))}
              </div>

              {/* Comments */}
              {detailTab === 'comments' && (
                <div className="space-y-2">
                  {comments.length === 0 && <p className="text-[11px] text-gray-500">No comments yet.</p>}
                  {comments.map(c => (
                    <div key={c.id} className={cn('rounded-lg p-2.5 text-xs group relative', c.is_internal ? 'bg-amber-900/20 border border-amber-700/30' : 'bg-gray-800')}>
                      <div className="flex justify-between mb-1">
                        <span className="text-white font-medium">{c.author}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 text-[10px]">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                          {user?.isSuperAdmin && (
                            <button
                              onClick={async () => {
                                if (!confirm('Delete this comment? It will be hidden but preserved in audit history.')) return
                                await deleteTicketComment(c.id, userName ?? 'Admin')
                                const updated = await loadTicketComments(t.id)
                                setComments(updated)
                              }}
                              className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      {(c.image_path || c.image_url) ? (
                        <TicketCommentAttachment
                          imagePath={c.image_path}
                          imageUrl={c.image_url}
                          message={c.message}
                        />
                      ) : (
                        <p className="text-gray-300 whitespace-pre-wrap">{c.message.split(/(@[A-Z][a-z]+ [A-Z][a-z]+)/g).map((part, i) =>
                          part.startsWith('@') ? <span key={i} className="text-green-400 font-medium">{part}</span> : <React.Fragment key={i}>{part}</React.Fragment>
                        )}</p>
                      )}
                      {c.is_internal && <span className="text-[9px] text-amber-400 font-medium mt-1 block">INTERNAL NOTE — not visible to customer</span>}
                    </div>
                  ))}
                  <div className="mt-2">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <MentionNoteInput
                          compact
                          placeholder={commentInternal ? "Internal note (hidden from customer)..." : "Reply to customer... Type @ to mention someone"}
                          projectId={t.project_id ?? ''}
                          currentUserName={userName ?? 'Unknown'}
                          onSubmit={async (text) => {
                            await addTicketComment(t.id, userName ?? 'Unknown', user?.id, text, commentInternal)
                            const c = await loadTicketComments(t.id)
                            setComments(c)
                          }}
                        />
                      </div>
                      <label className="flex items-center gap-1 px-2 py-1.5 rounded text-[10px] font-medium bg-gray-800 text-gray-400 hover:text-white cursor-pointer transition-colors mb-[1px]">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        Attach
                        <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const ext = file.name.split('.').pop() ?? 'file'
                          const fileName = `${t.id}/${Date.now()}.${ext}`
                          const supabaseClient = (await import('@/lib/supabase/client')).createClient()
                          const { error: uploadErr } = await supabaseClient.storage
                            .from('ticket-attachments')
                            .upload(fileName, file, { contentType: file.type })
                          if (uploadErr) { console.error('[upload]', uploadErr); return }
                          // Bucket is private post-flip; image_url is dead. Render via image_path.
                          const isImage = file.type.startsWith('image/')
                          const label = isImage ? '\u{1F4F7} Photo' : `\u{1F4CE} ${file.name}`
                          await addTicketComment(t.id, userName ?? 'Unknown', user?.id, label, commentInternal, null, fileName)
                          const c = await loadTicketComments(t.id)
                          setComments(c)
                          e.target.value = ''
                        }} />
                      </label>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        onClick={() => setCommentInternal(!commentInternal)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                          commentInternal
                            ? 'bg-amber-900/30 text-amber-400 border border-amber-700/50'
                            : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                        }`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={commentInternal ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" : "M15 12a3 3 0 11-6 0 3 3 0 016 0z"} />
                          {!commentInternal && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />}
                        </svg>
                        {commentInternal ? 'Internal (hidden from customer)' : 'Visible to customer'}
                      </button>
                      {user?.isAdmin && (
                        <button
                          onClick={async () => {
                            if (showDeleted) {
                              setShowDeleted(false)
                              setDeletedComments([])
                            } else {
                              const del = await loadDeletedComments(t.id)
                              setDeletedComments(del)
                              setShowDeleted(true)
                            }
                          }}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                            showDeleted
                              ? 'bg-red-900/30 text-red-400 border border-red-700/50'
                              : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                          }`}>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          {showDeleted ? 'Hide audit history' : 'Show deleted'}
                        </button>
                      )}
                    </div>
                    {/* Deleted comments audit trail */}
                    {showDeleted && deletedComments.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-red-800/30">
                        <p className="text-[10px] text-red-400 font-medium uppercase tracking-wider mb-2">Deleted Comments (Audit Trail)</p>
                        <div className="space-y-2">
                          {deletedComments.map((c) => (
                            <div key={c.id} className="rounded-lg p-2.5 text-xs bg-red-900/10 border border-red-800/20 opacity-70">
                              <div className="flex justify-between mb-1">
                                <span className="text-gray-400 font-medium">{c.author}</span>
                                <span className="text-gray-600 text-[10px]">{new Date(c.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                              </div>
                              <p className="text-gray-500 whitespace-pre-wrap line-through">{c.message}</p>
                              <span className="text-[9px] text-red-400 mt-1 block">
                                Deleted by {c.deleted_by} on {c.deleted_at ? new Date(c.deleted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {showDeleted && deletedComments.length === 0 && (
                      <p className="mt-2 text-[10px] text-gray-600">No deleted comments for this ticket.</p>
                    )}
                  </div>
                </div>
              )}

              {/* History */}
              {detailTab === 'history' && (
                <div className="space-y-1">
                  {history.length === 0 && <p className="text-[11px] text-gray-500">No history yet.</p>}
                  {history.map(h => (
                    <div key={h.id} className="flex items-center gap-3 text-[11px] py-1.5 border-b border-gray-800/50">
                      <span className="text-gray-500 w-24 flex-shrink-0">{fmtDate(h.created_at)}</span>
                      <span className="text-gray-400">{h.changed_by}</span>
                      <span className="text-gray-500">changed</span>
                      <span className="text-white font-medium">{h.field}</span>
                      {h.old_value && <><span className="text-gray-500">from</span><span className="text-red-400">{h.old_value}</span></>}
                      <span className="text-gray-500">to</span>
                      <span className="text-green-400">{h.new_value}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Details */}
              {detailTab === 'details' && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <div><span className="text-gray-500 block text-[10px]">Ticket #</span><span className="text-gray-300 font-mono">{t.ticket_number}</span></div>
                  <div><span className="text-gray-500 block text-[10px]">Category</span><span className="text-gray-300 capitalize">{t.category}</span></div>
                  <div><span className="text-gray-500 block text-[10px]">Subcategory</span><span className="text-gray-300 capitalize">{t.subcategory?.replace(/_/g, ' ') ?? '\u2014'}</span></div>
                  <div><span className="text-gray-500 block text-[10px]">Assigned Team</span><span className="text-gray-300">{t.assigned_team ?? '\u2014'}</span></div>
                  <div><span className="text-gray-500 block text-[10px]">First Response</span><span className="text-gray-300">{t.first_response_at ? fmtDate(t.first_response_at) : '\u2014'}</span></div>
                  <div><span className="text-gray-500 block text-[10px]">Resolved</span><span className="text-gray-300">{t.resolved_at ? fmtDate(t.resolved_at) : 'Open'}</span></div>
                  {t.tags && t.tags.length > 0 && (
                    <div className="col-span-full">
                      <span className="text-gray-500 block text-[10px] mb-1">Tags</span>
                      <div className="flex gap-1">{t.tags.map(tag => <span key={tag} className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded text-[10px]">{tag}</span>)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}
