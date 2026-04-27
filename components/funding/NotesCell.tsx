'use client'

import { useState, useRef, useMemo } from 'react'
import { handleApiError } from '@/lib/errors'
import {
  handleOf, buildHandleIndex,
  type MentionableUser as Mentionable,
} from '@/lib/notes/mentions'

export type MentionableUser = Mentionable

interface NotesCellProps {
  value: string | null
  /**
   * Called with the new full text on save. Server-side handlers re-parse the text
   * to compute authoritative mentions; the UI does not pass mention IDs to avoid
   * making the client load-bearing for security decisions.
   */
  onSave: (val: string | null) => Promise<void>
  users: MentionableUser[]
  placeholder?: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}

/**
 * Notes cell with @mention picker. Type "@" to open the picker; selecting a user
 * inserts "@<handle>" inline. Handle = local-part of email (lowercased, +tag stripped).
 * Ambiguous handles (multiple active users with same local-part) render with a yellow
 * warning highlight; the server will not notify on ambiguity (see lib/notes/mentions.ts).
 */
export function NotesCell({
  value,
  onSave,
  users,
  placeholder = '—',
  className = '',
  disabled = false,
  ariaLabel,
}: NotesCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerStart, setPickerStart] = useState(-1)
  const [pickerIndex, setPickerIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleIndex = useMemo(() => buildHandleIndex(users), [users])

  const startEdit = (e: React.MouseEvent) => {
    if (disabled) return
    e.stopPropagation()
    setDraft(value ?? '')
    setEditing(true)
    setPickerOpen(false)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const save = async () => {
    const newVal = draft.trim() || null
    const oldVal = value ?? null
    if (newVal === oldVal) {
      setEditing(false)
      setPickerOpen(false)
      return
    }
    setSaving(true)
    try {
      await onSave(newVal)
    } catch (err) {
      handleApiError(err, '[NotesCell] save')
    }
    setSaving(false)
    setEditing(false)
    setPickerOpen(false)
  }

  const cancel = () => {
    setEditing(false)
    setPickerOpen(false)
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setDraft(next)
    const caret = e.target.selectionStart ?? next.length
    let i = caret - 1
    while (i >= 0 && /[a-zA-Z0-9._+\-]/.test(next[i])) i--
    if (i >= 0 && next[i] === '@' && (i === 0 || /\s/.test(next[i - 1]))) {
      const q = next.slice(i + 1, caret)
      setPickerStart(i)
      setPickerQuery(q)
      setPickerOpen(true)
      setPickerIndex(0)
    } else {
      setPickerOpen(false)
    }
  }

  const filtered = useMemo(() => {
    if (!pickerOpen) return [] as MentionableUser[]
    const q = pickerQuery.toLowerCase()
    if (!q) return users.slice(0, 8)
    return users
      .filter(u => {
        const name = (u.name ?? '').toLowerCase()
        const email = u.email.toLowerCase()
        return name.includes(q) || email.includes(q) || handleOf(u).startsWith(q)
      })
      .slice(0, 8)
  }, [pickerOpen, pickerQuery, users])

  const insertMention = (u: MentionableUser) => {
    const h = handleOf(u)
    if (pickerStart < 0 || !h) {
      setPickerOpen(false)
      return
    }
    const before = draft.slice(0, pickerStart)
    const afterCaret = draft.slice(pickerStart + 1 + pickerQuery.length)
    const inserted = `@${h} `
    const next = `${before}${inserted}${afterCaret}`
    setDraft(next)
    setPickerOpen(false)
    setTimeout(() => {
      const pos = (before + inserted).length
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    }, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => (i + 1) % filtered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex(i => (i - 1 + filtered.length) % filtered.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filtered[pickerIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setPickerOpen(false); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); return }
    if (e.key === 'Escape') { cancel(); return }
  }

  if (editing) {
    return (
      <div className="relative w-full" onClick={e => e.stopPropagation()}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={() => { if (!pickerOpen || filtered.length === 0) save() }}
          aria-label={ariaLabel ?? 'Edit note (use @ to tag a teammate)'}
          rows={2}
          className={`bg-gray-700 text-white text-xs rounded px-2 py-1 border border-green-500 focus:outline-none w-full resize-none ${className}`}
        />
        {pickerOpen && filtered.length > 0 && (
          <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl overflow-hidden">
            <div className="max-h-60 overflow-y-auto">
              {filtered.map((u, i) => (
                <button
                  key={u.id}
                  onMouseDown={e => { e.preventDefault(); insertMention(u) }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 ${i === pickerIndex ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
                >
                  <span className="text-green-400 truncate">@{u.name ?? u.email}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Read-mode rendering — mark @handles green if unique, yellow if ambiguous, plain if unknown.
  const renderText = (text: string) => {
    const parts: React.ReactNode[] = []
    let last = 0
    const re = /(^|\s)@([a-zA-Z0-9._+\-]+)/g
    let m
    let key = 0
    while ((m = re.exec(text)) !== null) {
      const start = m.index + m[1].length
      const end = start + 1 + m[2].length
      if (start > last) parts.push(text.slice(last, start))
      const candidates = handleIndex.get(m[2].toLowerCase()) ?? []
      const displaySlug = `@${m[2]}`
      if (candidates.length === 1) {
        const u = candidates[0]
        const displayName = `@${u.name ?? u.email}`
        parts.push(
          <span key={key++} className="text-green-400 bg-green-900/30 rounded px-0.5"
            title={u.email}>{displayName}</span>,
        )
      } else if (candidates.length > 1) {
        parts.push(
          <span key={key++} className="text-yellow-400 bg-yellow-900/30 rounded px-0.5"
            title={`Ambiguous (matches ${candidates.length} users) — will not notify`}>{displaySlug}</span>,
        )
      } else {
        parts.push(<span key={key++}>{displaySlug}</span>)
      }
      last = end
    }
    if (last < text.length) parts.push(text.slice(last))
    return parts
  }

  const display = value ? renderText(value) : placeholder

  return (
    <div
      role={disabled ? undefined : 'button'}
      tabIndex={disabled ? undefined : 0}
      onClick={startEdit}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startEdit(e as unknown as React.MouseEvent) } }}
      aria-label={ariaLabel ?? (disabled ? undefined : 'Edit note')}
      className={`rounded px-1 py-0.5 -mx-1 -my-1 min-h-[24px] flex items-center transition-colors w-full text-gray-300 ${saving ? 'opacity-50' : ''} ${disabled ? '' : 'cursor-pointer hover:bg-gray-700 hover:text-white'} ${className}`}
      title={disabled ? undefined : 'Click to edit; type @ to tag a teammate'}
    >
      {display}
    </div>
  )
}
