'use client'

import { useState, useEffect, useRef } from 'react'
import type { NonfundedCode } from '@/types/database'

interface NfCodePickerProps {
  value: string | null
  onSave: (val: string | null) => Promise<void>
  codes: NonfundedCode[]
  slot: number
  disabled?: boolean
}

export function NfCodePicker({ value, onSave, codes, slot, disabled = false }: NfCodePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = query.trim()
    ? codes.filter(c => c.code.toLowerCase().includes(query.toLowerCase()) || c.description.toLowerCase().includes(query.toLowerCase()) || c.master_code.toLowerCase().includes(query.toLowerCase()))
    : codes

  const groups: Record<string, NonfundedCode[]> = {}
  filtered.forEach(c => { (groups[c.master_code] ??= []).push(c) })

  const select = async (code: string | null) => {
    setSaving(true)
    await onSave(code)
    setSaving(false)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative inline-block" ref={ref}>
      {value ? (
        <span className="inline-flex items-center gap-0.5">
          <span
            className={`bg-red-900/50 text-red-300 text-[10px] px-1 py-0.5 rounded ${disabled ? '' : 'cursor-pointer hover:bg-red-800'}`}
            onClick={e => { e.stopPropagation(); if (!disabled) setOpen(!open) }}
            onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setOpen(!open) } }}
            role={disabled ? undefined : 'button'}
            tabIndex={disabled ? undefined : 0}
            title={codes.find(c => c.code === value)?.description ?? value}
            aria-label={`NF code ${slot}: ${value}`}
          >{value}</span>
          {!disabled && <button onClick={e => { e.stopPropagation(); select(null) }} className="text-gray-600 hover:text-red-400 text-[10px]" title="Remove" aria-label={`Remove NF code ${slot}`}>x</button>}
        </span>
      ) : (
        !disabled && <button onClick={e => { e.stopPropagation(); setOpen(!open) }} className="text-gray-600 hover:text-gray-300 text-xs" title={`Add NF code ${slot}`} aria-label={`Add NF code ${slot}`}>+</button>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search codes..." autoFocus
            aria-label="Search nonfunded codes"
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); setQuery('') } }}
            className="w-full bg-gray-900 text-white text-xs px-3 py-2 border-b border-gray-700 focus:outline-none" />
          <div className="max-h-64 overflow-y-auto">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div className="px-3 py-1.5 text-xs font-bold text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-900">{group}</div>
                {items.map(c => (
                  <button key={c.code} onClick={() => select(c.code)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors flex items-start gap-3">
                    <span className="text-amber-400 font-mono font-bold flex-shrink-0 min-w-[5.5rem] whitespace-nowrap">{c.code}</span>
                    <span className="text-gray-300 flex-1">{c.description}</span>
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-gray-500 text-xs">No codes match &ldquo;{query}&rdquo;</div>}
          </div>
        </div>
      )}
    </div>
  )
}
