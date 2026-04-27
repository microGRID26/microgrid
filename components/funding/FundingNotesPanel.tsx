'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  loadFundingNotes, addFundingNote, softDeleteFundingNote,
  type FundingNote,
} from '@/lib/api/funding-notes'


import { MentionInput } from './MentionInput'
import { buildHandleIndex, type MentionableUser } from '@/lib/notes/mentions'
import { fmtDate } from '@/lib/utils'

interface FundingNotesPanelProps {
  projectId: string
  /** Legacy m1/m2/m3 notes — surfaced as a single "migrated note" entry per milestone if present. */
  legacyM1?: string | null
  legacyM2?: string | null
  legacyM3?: string | null
  users: MentionableUser[]
  /** Current authenticated user — required to attribute new comments. */
  currentUserId: string
  /** Callback after successful add — lets parent bump its summary cache. */
  onChanged?: () => void
}

const MILESTONES: Array<{ key: 'm1' | 'm2' | 'm3'; label: string; color: string }> = [
  { key: 'm1', label: 'M1 — Advance',  color: 'amber' },
  { key: 'm2', label: 'M2 — Install',  color: 'blue'  },
  { key: 'm3', label: 'M3 — PTO',      color: 'green' },
]

export function FundingNotesPanel({
  projectId, legacyM1, legacyM2, legacyM3, users, currentUserId, onChanged,
}: FundingNotesPanelProps) {
  const [notes, setNotes] = useState<FundingNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleIndex = useMemo(() => buildHandleIndex(users), [users])

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadFundingNotes(projectId).then(rows => { if (alive) { setNotes(rows); setLoading(false) } })
    return () => { alive = false }
  }, [projectId])

  const submit = async (milestone: 'm1' | 'm2' | 'm3', body: string) => {
    setError(null)
    const result = await addFundingNote(projectId, milestone, currentUserId, body)
    if (!result.ok) {
      setError(result.error)
      throw new Error(result.error) // bubble to MentionInput so the textarea isn't cleared
    }
    setNotes(prev => [...prev, result.note])
    if (body.includes('@')) {
      fetch('/api/notifications/note-mention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mg-csrf': '1' },
        body: JSON.stringify({
          sourceType: 'funding_note',
          sourceId: projectId,
          sourceMilestone: milestone,
          noteText: body,
        }),
      }).catch(err => console.error('note-mention notify failed:', err))
    }
    onChanged?.()
  }

  const remove = async (noteId: string) => {
    if (!confirm('Delete this comment?')) return
    const result = await softDeleteFundingNote(noteId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotes(prev => prev.filter(n => n.id !== noteId))
    onChanged?.()
  }

  const renderBody = (text: string) => {
    const parts: React.ReactNode[] = []
    let last = 0
    const re = /(^|\s)@([a-zA-Z0-9._+\-]+)/g
    let m
    let key = 0
    while ((m = re.exec(text)) !== null) {
      const start = m.index + m[1].length
      const end = start + 1 + m[2].length
      if (start > last) parts.push(text.slice(last, start))
      const cands = handleIndex.get(m[2].toLowerCase()) ?? []
      const displaySlug = `@${m[2]}`
      if (cands.length === 1) {
        const u = cands[0]
        parts.push(<span key={key++} className="text-green-400 bg-green-900/30 rounded px-0.5" title={u.email}>@{u.name ?? u.email}</span>)
      }
      else if (cands.length > 1) parts.push(<span key={key++} className="text-yellow-400 bg-yellow-900/30 rounded px-0.5" title="Ambiguous — will not notify">{displaySlug}</span>)
      else parts.push(<span key={key++}>{displaySlug}</span>)
      last = end
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts
  }

  const milestoneNotes = (key: 'm1' | 'm2' | 'm3') => notes.filter(n => n.milestone === key)
  const legacyFor = (key: 'm1' | 'm2' | 'm3') => key === 'm1' ? legacyM1 : key === 'm2' ? legacyM2 : legacyM3

  return (
    <div className="bg-gray-900 border-t border-gray-800 px-4 py-3">
      {error && (
        <div className="bg-red-950/50 border border-red-800 text-red-300 text-xs rounded px-3 py-2 mb-3">
          {error}
        </div>
      )}
      {loading ? (
        <div className="text-xs text-gray-500 py-3">Loading notes…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MILESTONES.map(({ key, label, color }) => {
            const items = milestoneNotes(key)
            const legacy = legacyFor(key)
            return (
              <div key={key} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 text-${color}-400`}>{label}</div>
                <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                  {legacy && items.length === 0 && (
                    <div className="bg-gray-900/50 border border-dashed border-gray-700 rounded p-2 text-[11px]">
                      <div className="text-gray-500 text-[9px] uppercase tracking-wider mb-1">Migrated note</div>
                      <div className="text-gray-400 whitespace-pre-wrap">{legacy}</div>
                    </div>
                  )}
                  {items.length === 0 && !legacy && (
                    <div className="text-gray-600 text-[11px] italic py-2">No comments yet.</div>
                  )}
                  {items.map(n => (
                    <div key={n.id} className="bg-gray-900/40 rounded p-2 text-[11px]">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-green-400 font-medium">{n.author}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-600 text-[10px]">{fmtDate(n.created_at)}</span>
                          {n.author_id === currentUserId && (
                            <button
                              onClick={() => remove(n.id)}
                              className="text-gray-600 hover:text-red-400 text-[10px]"
                              title="Delete"
                              aria-label="Delete comment"
                            >×</button>
                          )}
                        </div>
                      </div>
                      <div className="text-gray-300 whitespace-pre-wrap">{renderBody(n.body)}</div>
                    </div>
                  ))}
                </div>
                <MentionInput
                  users={users}
                  onSubmit={async (text) => submit(key, text)}
                  placeholder={`Comment on ${label.split(' — ')[0]}…`}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
