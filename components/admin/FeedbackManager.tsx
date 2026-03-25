'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import type { Feedback } from '@/types/database'

type FeedbackEntry = Feedback

const FEEDBACK_STATUSES = ['New', 'Reviewing', 'In Progress', 'Addressed', "Won't Fix"] as const
const FEEDBACK_TYPES_LIST = ['Bug', 'Feature Request', 'Improvement', 'Question'] as const

const TYPE_COLORS: Record<string, string> = {
  'Bug': 'bg-red-900/40 text-red-400 border-red-800',
  'Feature Request': 'bg-blue-900/40 text-blue-400 border-blue-800',
  'Improvement': 'bg-green-900/40 text-green-400 border-green-800',
  'Question': 'bg-purple-900/40 text-purple-400 border-purple-800',
}

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-amber-900/40 text-amber-400 border-amber-800',
  'Reviewing': 'bg-blue-900/40 text-blue-400 border-blue-800',
  'In Progress': 'bg-purple-900/40 text-purple-400 border-purple-800',
  'Addressed': 'bg-green-900/40 text-green-400 border-green-800',
  "Won't Fix": 'bg-gray-800 text-gray-400 border-gray-700',
}

export function FeedbackManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [toast, setToast] = useState('')

  const [allEntries, setAllEntries] = useState<FeedbackEntry[]>([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(500)
    setAllEntries(data ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  // Filter client-side from all entries
  const entries = allEntries.filter(e => {
    if (filterType && e.type !== filterType) return false
    if (filterStatus && e.status !== filterStatus) return false
    return true
  })

  const EDITABLE_FIELDS = ['status', 'admin_notes'] as const
  type EditableField = typeof EDITABLE_FIELDS[number]

  const updateField = async (id: number, field: string, value: string) => {
    if (!EDITABLE_FIELDS.includes(field as EditableField)) {
      console.error(`feedback update blocked: "${field}" is not an editable field`)
      setToast('Update blocked: invalid field')
      setTimeout(() => setToast(''), 2000)
      return
    }
    const { error } = await supabase.from('feedback').update({ [field]: value }).eq('id', id)
    if (error) {
      console.error('feedback update failed:', error)
      setToast('Update failed')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setAllEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
    setToast('Updated')
    setTimeout(() => setToast(''), 2000)
  }

  const deleteFeedback = async (id: number) => {
    if (!confirm('Delete this feedback entry? This cannot be undone.')) return
    const { error } = await supabase.from('feedback').delete().eq('id', id)
    if (error) {
      console.error('feedback delete failed:', error)
      setToast('Delete failed')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setAllEntries(prev => prev.filter(e => e.id !== id))
    setToast('Deleted')
    setTimeout(() => setToast(''), 2000)
  }

  // Counts from ALL entries (unfiltered)
  const typeCounts: Record<string, number> = {}
  const statusCounts: Record<string, number> = {}
  allEntries.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1
  })

  return (
    <div className="flex flex-col h-full overflow-auto">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Feedback</h2>
          <p className="text-xs text-gray-500 mt-0.5">{entries.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Types</option>
            {FEEDBACK_TYPES_LIST.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Statuses</option>
            {FEEDBACK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Summary counts — clickable to filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FEEDBACK_TYPES_LIST.map(t => (
          <button key={t} onClick={() => setFilterType(filterType === t ? '' : t)}
            className={`text-[10px] px-2 py-1 border rounded transition-colors ${TYPE_COLORS[t]} ${filterType === t ? 'ring-1 ring-white' : 'opacity-70 hover:opacity-100'}`}>
            {t}: {typeCounts[t] || 0}
          </button>
        ))}
        <span className="text-gray-700 mx-1">|</span>
        {FEEDBACK_STATUSES.map(s => (
          <button key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
            className={`text-[10px] px-2 py-1 border rounded transition-colors ${STATUS_COLORS[s]} ${filterStatus === s ? 'ring-1 ring-white' : 'opacity-70 hover:opacity-100'}`}>
            {s}: {statusCounts[s] || 0}
          </button>
        ))}
      </div>

      {/* Entries */}
      <div className="space-y-3">
        {entries.map(entry => (
          <div key={entry.id} className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 border rounded ${TYPE_COLORS[entry.type] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                  {entry.type}
                </span>
                <span className={`text-[10px] px-2 py-0.5 border rounded ${STATUS_COLORS[entry.status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                  {entry.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600">
                  {entry.created_at ? new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </span>
                {isSuperAdmin && (
                  <button onClick={() => deleteFeedback(entry.id)}
                    className="text-[10px] text-gray-600 hover:text-red-400 transition-colors" title="Delete feedback">
                    ×
                  </button>
                )}
              </div>
            </div>

            <p className="text-sm text-white mb-2 whitespace-pre-wrap">{entry.message}</p>

            <div className="flex items-center gap-4 text-[10px] text-gray-500 mb-3">
              <span>{entry.user_name ?? 'Unknown'}</span>
              {entry.user_email && <span>{entry.user_email}</span>}
              {entry.page && <span>Page: {entry.page}</span>}
            </div>

            <div className="flex items-center gap-3 border-t border-gray-700/50 pt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500">Status</label>
                <select
                  value={entry.status}
                  onChange={e => updateField(entry.id, 'status', e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-white
                             focus:outline-none focus:border-blue-500 transition-colors"
                >
                  {FEEDBACK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[10px] text-gray-500">Admin Notes</label>
                <textarea
                  defaultValue={entry.admin_notes ?? ''}
                  onBlur={e => {
                    if (e.target.value !== (entry.admin_notes ?? '')) {
                      updateField(entry.id, 'admin_notes', e.target.value)
                    }
                  }}
                  rows={1}
                  placeholder="Add notes..."
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-white
                             placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                />
              </div>
            </div>
          </div>
        ))}

        {entries.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">No feedback entries found</div>
        )}
      </div>
    </div>
  )
}
