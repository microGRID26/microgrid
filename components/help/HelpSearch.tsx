'use client'

import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'

interface HelpSearchProps {
  query: string
  onChange: (q: string) => void
}

export function HelpSearch({ query, onChange }: HelpSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function handleChange(val: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(val), 200)
  }

  return (
    <div className="relative max-w-xl mx-auto">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
      <input
        ref={inputRef}
        type="text"
        defaultValue={query}
        onChange={e => handleChange(e.target.value)}
        placeholder="Search help topics..."
        aria-label="Search help topics"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-12 pr-4 py-3 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-green-600 focus:ring-1 focus:ring-green-600"
      />
    </div>
  )
}
