'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { searchVendors } from '@/lib/api/vendors'
import type { Vendor } from '@/lib/api/vendors'

const RECENT_KEY = 'mg_vendor_recent'
const MAX_RECENT = 5

function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function addRecentId(id: string) {
  try {
    const ids = getRecentIds().filter(i => i !== id)
    ids.unshift(id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)))
  } catch { /* ignore */ }
}

interface VendorAutocompleteProps {
  value: string
  onChange: (value: string, vendor?: Vendor) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function VendorAutocomplete({ value, onChange, placeholder, disabled, className }: VendorAutocompleteProps) {
  const [query, setQuery] = useState(value ?? '')
  const [results, setResults] = useState<Vendor[]>([])
  const [recentItems, setRecentItems] = useState<Vendor[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searched, setSearched] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Sync external value changes
  useEffect(() => {
    setQuery(value ?? '')
  }, [value])

  const loadRecents = useCallback(async () => {
    const ids = getRecentIds()
    if (ids.length === 0) { setRecentItems([]); return }
    const { loadVendors } = await import('@/lib/api/vendors')
    const all = await loadVendors(true)
    const items = ids.map(id => all.find(v => v.id === id)).filter(Boolean) as Vendor[]
    setRecentItems(items)
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) {
      setResults([])
      setSearched(false)
      return
    }
    const items = await searchVendors(q)
    setResults(items)
    setSearched(true)
    setOpen(true)
    setActiveIndex(-1)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    onChange(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (v.trim().length < 1) {
      setResults([])
      setSearched(false)
      return
    }
    debounceRef.current = setTimeout(() => doSearch(v), 200)
  }

  const handleSelect = (item: Vendor) => {
    setQuery(item.name)
    onChange(item.name, item)
    setOpen(false)
    setResults([])
    setSearched(false)
    addRecentId(item.id)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    const allItems = getDisplayItems()
    if (allItems.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(allItems[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const handleFocus = () => {
    if (query.trim().length >= 1) {
      if (results.length > 0 || searched) setOpen(true)
    } else {
      loadRecents().then(() => setOpen(true))
    }
  }

  // Click outside closes dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const getDisplayItems = (): Vendor[] => {
    if (results.length > 0) return results
    if (!searched && query.trim().length < 1 && recentItems.length > 0) return recentItems
    return []
  }

  const showRecentsHeader = !searched && query.trim().length < 1 && recentItems.length > 0
  const showNoResults = searched && results.length === 0
  const displayItems = getDisplayItems()
  const showDropdown = open && (displayItems.length > 0 || showNoResults)

  const CATEGORY_LABELS: Record<string, string> = {
    manufacturer: 'Mfr',
    distributor: 'Dist',
    subcontractor: 'Sub',
    other: 'Other',
  }

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        disabled={disabled}
        placeholder={placeholder ?? 'Search vendors...'}
        className={className ?? 'w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600'}
      />
      {showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded-md shadow-xl max-h-56 overflow-y-auto">
          {showRecentsHeader && (
            <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider font-semibold border-b border-gray-700">
              Recently used
            </div>
          )}
          {displayItems.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelect(item)}
              className={`w-full text-left px-3 py-2.5 text-xs transition-colors ${
                idx === activeIndex
                  ? 'bg-green-700/40 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{item.name}</span>
                <span className="text-gray-500 text-[10px] flex-shrink-0">
                  {item.category ? CATEGORY_LABELS[item.category] || item.category : ''}
                </span>
              </div>
              {(item.contact_name || item.contact_phone) && (
                <div className="text-[10px] text-gray-500 mt-0.5 truncate">
                  {item.contact_name}{item.contact_name && item.contact_phone ? ' \u00B7 ' : ''}{item.contact_phone}
                </div>
              )}
            </button>
          ))}
          {showNoResults && (
            <div className="px-3 py-3 text-xs text-gray-500 text-center">
              No vendors found — type to enter custom name
            </div>
          )}
        </div>
      )}
    </div>
  )
}
