'use client'

import { useState, useEffect, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { db } from '@/lib/db'
import { cn, escapeIlike, fmtDate, fmt$ } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { Search, X, ChevronUp, ChevronDown, Archive, ChevronLeft, ChevronRight, Send } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

interface LegacyProject {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  systemkw: number | null
  module: string | null
  module_qty: number | null
  inverter: string | null
  inverter_qty: number | null
  battery: string | null
  battery_qty: number | null
  voltage: string | null
  msp_bus_rating: string | null
  main_breaker: string | null
  contract: number | null
  financier: string | null
  financing_type: string | null
  dealer: string | null
  advisor: string | null
  consultant: string | null
  pm: string | null
  sale_date: string | null
  survey_date: string | null
  install_date: string | null
  pto_date: string | null
  in_service_date: string | null
  disposition: string | null
  ahj: string | null
  utility: string | null
  hoa: string | null
  permit_number: string | null
  utility_app_number: string | null
  crew: string | null
  m2_amount: number | null
  m2_date: string | null
  m3_amount: number | null
  m3_date: string | null
}

interface LegacyNote {
  id: string
  project_id: string
  content: string
  author: string
  created_at: string
}

type SortCol = 'id' | 'name' | 'city' | 'systemkw' | 'financier' | 'install_date' | 'disposition'

const PAGE_SIZE = 50

// ── Main Page ────────────────────────────────────────────────────────────────

export default function LegacyPage() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [results, setResults] = useState<LegacyProject[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [sortCol, setSortCol] = useState<SortCol>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<LegacyProject | null>(null)

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const fetchResults = useCallback(async () => {
    setLoading(true)
    const supabase = db()
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('legacy_projects')
      .select('*', { count: 'exact' })

    if (debouncedSearch.trim()) {
      const q = escapeIlike(debouncedSearch.trim())
      query = query.or(
        `name.ilike.%${q}%,id.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,city.ilike.%${q}%,address.ilike.%${q}%`
      )
    }

    query = query
      .order(sortCol, { ascending: sortAsc })
      .range(from, to)

    const { data, count, error } = await query

    if (error) {
      console.error('Legacy query error:', error)
      setResults([])
      setTotalCount(0)
    } else {
      setResults((data ?? []) as LegacyProject[])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [debouncedSearch, page, sortCol, sortAsc])

  useEffect(() => {
    fetchResults()
  }, [fetchResults])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(col)
      setSortAsc(true)
    }
    setPage(1)
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <ChevronUp className="w-3 h-3 text-gray-600 inline ml-1" />
    return sortAsc
      ? <ChevronUp className="w-3 h-3 text-green-400 inline ml-1" />
      : <ChevronDown className="w-3 h-3 text-green-400 inline ml-1" />
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Legacy" />

      {/* Header + Search */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <Archive className="w-6 h-6 text-green-400" />
          <h1 className="text-2xl font-bold text-white">Legacy Projects</h1>
        </div>
        <p className="text-gray-400 text-sm mb-4">
          TriSMART historical projects — read-only archive
        </p>

        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, address, city, or project ID..."
            className="w-full pl-10 pr-10 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Result count + pagination */}
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-500">
            {loading ? 'Searching...' : `${totalCount.toLocaleString()} projects found`}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs text-gray-400">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Results Table */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-850 border-b border-gray-700">
                {([
                  ['id', 'ID'],
                  ['name', 'Name'],
                  ['city', 'City'],
                  ['systemkw', 'System (kW)'],
                  ['financier', 'Financier'],
                  ['install_date', 'Install Date'],
                  ['disposition', 'Status'],
                ] as [SortCol, string][]).map(([col, label]) => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="text-left px-4 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white select-none"
                  >
                    {label}
                    <SortIcon col={col} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading && results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-green-400 animate-pulse">
                    Loading...
                  </td>
                </tr>
              ) : results.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-500">
                    {debouncedSearch ? 'No projects match your search' : 'Enter a search term to find legacy projects'}
                  </td>
                </tr>
              ) : (
                results.map(p => (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className={cn(
                      'cursor-pointer transition-colors hover:bg-gray-750',
                      selected?.id === p.id && 'bg-gray-700/50'
                    )}
                  >
                    <td className="px-4 py-3 text-green-400 font-mono text-xs">{p.id}</td>
                    <td className="px-4 py-3 text-white font-medium">{p.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.city ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.systemkw ? `${p.systemkw} kW` : '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{p.financier ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-300">{fmtDate(p.install_date)}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full',
                        p.disposition === 'In Service' ? 'bg-green-900 text-green-300' :
                        p.disposition === 'Complete' ? 'bg-blue-900 text-blue-300' :
                        'bg-gray-700 text-gray-300'
                      )}>
                        {p.disposition ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Slide-out Panel */}
      {selected && (
        <DetailPanel project={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ project: p, onClose }: { project: LegacyProject; onClose: () => void }) {
  const { user } = useCurrentUser()
  const [notes, setNotes] = useState<LegacyNote[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [adding, setAdding] = useState(false)
  const [noteError, setNoteError] = useState('')
  const NOTE_PAGE_SIZE = 50
  const [noteLimit, setNoteLimit] = useState(NOTE_PAGE_SIZE)

  // Escape key to close panel
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fetchNotes = useCallback(async () => {
    setNotesLoading(true)
    const { data, error } = await db()
      .from('legacy_notes')
      .select('*')
      .eq('project_id', p.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Failed to load legacy notes:', error)
    } else {
      setNotes((data ?? []) as LegacyNote[])
    }
    setNotesLoading(false)
  }, [p.id])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  async function handleAddNote() {
    const content = noteText.trim()
    if (!content || !user) return
    setAdding(true)

    const { error } = await db()
      .from('legacy_notes')
      .insert({
        project_id: p.id,
        content,
        author: user.name,
      })

    if (error) {
      console.error('Failed to add legacy note:', error)
      setNoteError('Failed to save note. Please try again.')
      setTimeout(() => setNoteError(''), 4000)
    } else {
      setNoteText('')
      setNoteError('')
      await fetchNotes()
    }
    setAdding(false)
  }

  function formatTimeAgo(dateStr: string | null): string {
    if (!dateStr) return ''
    const date = new Date(dateStr.replace(' ', 'T'))
    if (isNaN(date.getTime())) return fmtDate(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHrs = Math.floor(diffMin / 60)
    if (diffHrs < 24) return `${diffHrs}h ago`
    const diffDays = Math.floor(diffHrs / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-gray-900 border-l border-gray-700 z-50 overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-white">{p.name ?? 'Unknown'}</h2>
            <p className="text-xs text-green-400 font-mono">{p.id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-6">
          {/* Customer Info */}
          <Section title="Customer Info">
            <Field label="Name" value={p.name} />
            <Field label="Phone" value={p.phone} />
            <Field label="Email" value={p.email} />
            <Field label="Address" value={[p.address, p.city, p.state, p.zip].filter(Boolean).join(', ') || null} />
          </Section>

          {/* System Specs */}
          <Section title="System Specs">
            <Field label="Module" value={p.module} />
            <Field label="Inverter" value={p.inverter} />
            <Field label="Battery" value={p.battery} />
            <Field label="System Size" value={p.systemkw ? `${p.systemkw} kW` : null} />
            <Field label="Voltage" value={p.voltage ? `${p.voltage}V` : null} />
            <Field label="MSP Bus Rating" value={p.msp_bus_rating} />
            <Field label="Main Breaker" value={p.main_breaker} />
          </Section>

          {/* Financial */}
          <Section title="Financial">
            <Field label="Contract Value" value={p.contract ? fmt$(p.contract) : null} />
            <Field label="Financier" value={p.financier} />
            <Field label="Financing Type" value={p.financing_type} />
            <Field label="Dealer" value={p.dealer} />
          </Section>

          {/* Dates */}
          <Section title="Dates">
            <Field label="Sale" value={fmtDate(p.sale_date)} />
            <Field label="Survey" value={fmtDate(p.survey_date)} />
            <Field label="Install" value={fmtDate(p.install_date)} />
            <Field label="PTO" value={fmtDate(p.pto_date)} />
            <Field label="In Service" value={fmtDate(p.in_service_date)} />
          </Section>

          {/* Permit */}
          <Section title="Permit">
            <Field label="AHJ" value={p.ahj} />
            <Field label="Utility" value={p.utility} />
            <Field label="Permit #" value={p.permit_number} />
            <Field label="Utility App #" value={p.utility_app_number} />
          </Section>

          {/* Funding */}
          <Section title="Funding">
            <Field label="M2 Amount" value={p.m2_amount ? fmt$(p.m2_amount) : null} />
            <Field label="M2 Date" value={fmtDate(p.m2_date)} />
            <Field label="M3 Amount" value={p.m3_amount ? fmt$(p.m3_amount) : null} />
            <Field label="M3 Date" value={fmtDate(p.m3_date)} />
          </Section>

          {/* Notes */}
          <div>
            <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">Notes</h3>

            {/* Add note input */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote() } }}
                placeholder={user ? 'Add a note...' : 'Loading user...'}
                disabled={!user || adding}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 disabled:opacity-50"
              />
              <button
                onClick={handleAddNote}
                disabled={!noteText.trim() || !user || adding}
                className="px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                {adding ? 'Sending...' : 'Add'}
              </button>
            </div>

            {/* Error toast */}
            {noteError && <p className="text-xs text-red-400 mb-2">{noteError}</p>}

            {/* Notes list */}
            {notesLoading ? (
              <p className="text-xs text-green-400 animate-pulse py-3 text-center">Loading notes...</p>
            ) : notes.length === 0 ? (
              <p className="text-xs text-gray-500 py-3 text-center">No notes yet</p>
            ) : (
              <div className="space-y-2">
                {notes.slice(0, noteLimit).map(n => (
                  <div key={n.id} className="bg-gray-800 rounded-lg border border-gray-700 px-4 py-3">
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{n.content}</p>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {n.author} &middot; {formatTimeAgo(n.created_at)}
                    </p>
                  </div>
                ))}
                {notes.length > noteLimit && (
                  <button
                    onClick={() => setNoteLimit(l => l + NOTE_PAGE_SIZE)}
                    className="w-full text-xs text-green-400 hover:text-green-300 py-2 text-center"
                  >
                    Show more ({notes.length - noteLimit} remaining)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Shared components ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">{title}</h3>
      <div className="bg-gray-800 rounded-lg border border-gray-700 divide-y divide-gray-700/50">
        {children}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-sm text-white">{value || '—'}</span>
    </div>
  )
}
