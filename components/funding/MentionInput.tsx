'use client'

import { useState, useRef, useMemo } from 'react'
import { handleOf, type MentionableUser } from '@/lib/notes/mentions'

interface MentionInputProps {
  users: MentionableUser[]
  onSubmit: (text: string) => Promise<void>
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}

/**
 * Plain comment input with @-mention picker. Used inside thread drawers (funding notes,
 * future ticket/project comments). Submits via Cmd/Ctrl+Enter or the Send button.
 * Server-side parses mentions authoritatively; this component is UI sugar only.
 */
export function MentionInput({
  users, onSubmit, placeholder = 'Add a comment… type @ to tag', disabled, ariaLabel,
}: MentionInputProps) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerStart, setPickerStart] = useState(-1)
  const [pickerIndex, setPickerIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const filtered = useMemo(() => {
    if (!pickerOpen) return [] as MentionableUser[]
    const q = pickerQuery.toLowerCase()
    if (!q) return users.slice(0, 8)
    return users.filter(u => {
      const name = (u.name ?? '').toLowerCase()
      const email = u.email.toLowerCase()
      return name.includes(q) || email.includes(q) || handleOf(u).startsWith(q)
    }).slice(0, 8)
  }, [pickerOpen, pickerQuery, users])

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setDraft(next)
    const caret = e.target.selectionStart ?? next.length
    let i = caret - 1
    while (i >= 0 && /[a-zA-Z0-9._+\-]/.test(next[i])) i--
    if (i >= 0 && next[i] === '@' && (i === 0 || /\s/.test(next[i - 1]))) {
      setPickerStart(i)
      setPickerQuery(next.slice(i + 1, caret))
      setPickerOpen(true)
      setPickerIndex(0)
    } else {
      setPickerOpen(false)
    }
  }

  const insertMention = (u: MentionableUser) => {
    const h = handleOf(u)
    if (pickerStart < 0 || !h) { setPickerOpen(false); return }
    const before = draft.slice(0, pickerStart)
    const afterCaret = draft.slice(pickerStart + 1 + pickerQuery.length)
    const inserted = `@${h} `
    setDraft(`${before}${inserted}${afterCaret}`)
    setPickerOpen(false)
    setTimeout(() => {
      const pos = (before + inserted).length
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    }, 0)
  }

  const submit = async () => {
    const trimmed = draft.trim()
    if (!trimmed || submitting || disabled) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed)
      setDraft('')
      setPickerOpen(false)
    } catch (err) {
      // Parent surfaced an error via throw. Keep the draft so the user can retry.
      console.error('[MentionInput] submit failed:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && filtered.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickerIndex(i => (i + 1) % filtered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickerIndex(i => (i - 1 + filtered.length) % filtered.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filtered[pickerIndex]); return }
      if (e.key === 'Escape') { e.preventDefault(); setPickerOpen(false); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); return }
  }

  return (
    <div className="relative">
      <textarea
        ref={inputRef}
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled || submitting}
        aria-label={ariaLabel ?? 'Add comment with @-mention support'}
        rows={2}
        className="w-full bg-gray-800 text-white text-xs rounded-md border border-gray-700 focus:border-green-500 focus:outline-none px-3 py-2 resize-none"
      />
      <div className="flex items-center justify-between mt-1.5 text-[10px] text-gray-500">
        <span>Type <span className="font-mono text-gray-400">@</span> to tag — Cmd/Ctrl+Enter to send</span>
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || submitting || disabled}
          className="bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[11px] font-semibold px-3 py-1 rounded transition-colors"
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>
      {pickerOpen && filtered.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto">
            {filtered.map((u, i) => (
              <button
                key={u.id}
                type="button"
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
