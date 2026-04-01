'use client'

import { useState, useEffect, useRef } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Search, X } from 'lucide-react'

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string; city: string | null; stage: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return }
    let stale = false
    const timer = setTimeout(async () => {
      const escaped = escapeIlike(query)
      const { data } = await db().from('projects')
        .select('id, name, city, stage')
        .or(`name.ilike.%${escaped}%,id.ilike.%${escaped}%,city.ilike.%${escaped}%`)
        .limit(8)
      if (!stale && data) setResults(data as any[])
    }, 200)
    return () => { stale = true; clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keyboard shortcut: Cmd+K or Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-gray-500 hover:text-white p-1.5 rounded-md hover:bg-gray-800 transition-colors" title="Search (⌘K)">
        <Search className="w-4 h-4" />
      </button>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center bg-gray-800 border border-gray-700 rounded-md">
        <Search className="w-3.5 h-3.5 text-gray-500 ml-2" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search projects... (⌘K)"
          className="bg-transparent text-xs text-white px-2 py-1.5 w-48 focus:outline-none placeholder-gray-500"
          onBlur={() => setTimeout(() => { if (!query) setOpen(false) }, 200)}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]) }} className="text-gray-500 hover:text-white mr-1.5">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[9999] max-h-64 overflow-y-auto">
          {results.map(p => (
            <a key={p.id} href={`/pipeline?open=${p.id}`}
              className="flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition-colors" onClick={() => setOpen(false)}>
              <div>
                <div className="text-xs font-medium text-white">{p.name}</div>
                <div className="text-[10px] text-gray-400">{p.id} · {p.city ?? '—'}</div>
              </div>
              <span className="text-[9px] text-gray-500 capitalize">{p.stage}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
