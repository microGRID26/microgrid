'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn } from '@/lib/utils'
import { db } from '@/lib/db'
import { Search, ExternalLink, Globe, Phone, Eye, EyeOff, ChevronDown, ChevronUp, Shield, Download, Clock } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────
interface AhjRecord {
  id: number
  name: string
  state: string | null
  city: string | null
  county: string | null
  permit_website: string | null
  permit_phone: string | null
  permit_notes: string | null
  username: string | null
  password: string | null
  max_duration: number | null
  how_to_request: string | null
  electric_code: string | null
  inspection_portal: string | null
  inspection_login: string | null
  inspection_password: string | null
  inspection_email: string | null
  inspection_notes: string | null
  plans_on_site: string | null
  host_type_required: string | null
  projectCount?: number
}

const PAGE_SIZE = 50

export default function PermitsPage() {
  const { user: authUser, loading: authLoading } = useCurrentUser()
  const [ahjs, setAhjs] = useState<AhjRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterHasPortal, setFilterHasPortal] = useState<'' | 'yes' | 'no'>('')
  const [filterMethod, setFilterMethod] = useState('')
  const [filterCounty, setFilterCounty] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [showCreds, setShowCreds] = useState<Record<number, boolean>>({})
  const [showInspCreds, setShowInspCreds] = useState<Record<number, boolean>>({})
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({})
  const [page, setPage] = useState(0)
  const [sortCol, setSortCol] = useState<'name' | 'county' | 'max_duration' | 'projects'>('name')
  const [sortAsc, setSortAsc] = useState(true)

  // ── Load AHJs ────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    const supabase = db()

    // Load all AHJs
    const { data: ahjData } = await supabase.from('ahjs').select('*').order('name').limit(5000)
    setAhjs(ahjData ?? [])

    // Load project counts per AHJ (only active projects)
    const { data: projects } = await supabase
      .from('projects')
      .select('ahj')
      .not('disposition', 'in', '("Cancelled","In Service")')
      .not('ahj', 'is', null)
      .limit(5000)

    const counts: Record<string, number> = {}
    for (const p of (projects ?? [])) {
      const ahj = (p as { ahj: string }).ahj
      if (ahj) counts[ahj] = (counts[ahj] || 0) + 1
    }
    setProjectCounts(counts)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setPage(0) }, [search, filterHasPortal, filterMethod, filterCounty])

  // ── Derived data ─────────────────────────────────────────────────────────
  const counties = useMemo(() => {
    const set = new Set<string>()
    for (const a of ahjs) {
      if (a.county) set.add(a.county)
    }
    return Array.from(set).sort()
  }, [ahjs])

  const methods = useMemo(() => {
    const set = new Set<string>()
    for (const a of ahjs) {
      if (a.how_to_request) set.add(a.how_to_request)
    }
    return Array.from(set).sort()
  }, [ahjs])

  // ── Filtering ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = ahjs

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a => {
        if (a.name.toLowerCase().includes(q)) return true
        if ((a.county ?? '').toLowerCase().includes(q)) return true
        if ((a.city ?? '').toLowerCase().includes(q)) return true
        return false
      })
    }

    if (filterHasPortal === 'yes') {
      list = list.filter(a => !!a.permit_website)
    } else if (filterHasPortal === 'no') {
      list = list.filter(a => !a.permit_website)
    }

    if (filterMethod) {
      list = list.filter(a => a.how_to_request === filterMethod)
    }

    if (filterCounty) {
      list = list.filter(a => a.county === filterCounty)
    }

    // Sort
    list = [...list].sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'county':
          cmp = (a.county ?? '').localeCompare(b.county ?? '')
          break
        case 'max_duration':
          cmp = (a.max_duration ?? 999) - (b.max_duration ?? 999)
          break
        case 'projects':
          cmp = (projectCounts[b.name] ?? 0) - (projectCounts[a.name] ?? 0)
          break
      }
      return sortAsc ? cmp : -cmp
    })

    return list
  }, [ahjs, search, filterHasPortal, filterMethod, filterCounty, sortCol, sortAsc, projectCounts])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // ── Summary stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const withPortal = ahjs.filter(a => !!a.permit_website).length
    const online = ahjs.filter(a => (a.how_to_request ?? '').toLowerCase().includes('online')).length
    const phoneOnly = ahjs.filter(a => (a.how_to_request ?? '').toLowerCase().includes('phone') && !a.permit_website).length
    const noInfo = ahjs.filter(a => !a.permit_website && !a.permit_phone && !a.how_to_request).length
    return { withPortal, online, phoneOnly, noInfo }
  }, [ahjs])

  // ── CSV Export ───────────────────────────────────────────────────────────
  function exportCsv() {
    const headers = ['Name', 'County', 'City', 'Portal URL', 'How to Request', 'Phone', 'Max Days', 'Has Credentials', 'Inspection Portal', 'Active Projects']
    const rows = filtered.map(a => [
      a.name,
      a.county ?? '',
      a.city ?? '',
      a.permit_website ?? '',
      a.how_to_request ?? '',
      a.permit_phone ?? '',
      String(a.max_duration ?? ''),
      a.username ? 'Yes' : 'No',
      a.inspection_portal ?? '',
      String(projectCounts[a.name] ?? 0),
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ahj-permit-portals-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // ── Sort toggle ──────────────────────────────────────────────────────────
  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }
  const sortIcon = (col: typeof sortCol) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : ''

  // ── Method badge color ───────────────────────────────────────────────────
  function methodColor(method: string | null) {
    if (!method) return 'bg-gray-800 text-gray-500'
    const m = method.toLowerCase()
    if (m.includes('online')) return 'bg-green-900/60 text-green-400'
    if (m.includes('email')) return 'bg-blue-900/60 text-blue-400'
    if (m.includes('phone')) return 'bg-amber-900/60 text-amber-400'
    return 'bg-gray-800 text-gray-400'
  }

  // ── Auth gate ────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <Nav active="Permits" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-lg font-semibold text-white mb-2">Please Sign In</h1>
            <a href="/login" className="text-xs text-blue-400 hover:text-blue-300">Go to login</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <Nav active="Permits" />

      <div className="flex-1 p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-400" />
              Permit Portal Hub
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              AHJ permit portals, credentials, and submission methods — {ahjs.length.toLocaleString()} AHJs
            </p>
          </div>
          <button
            onClick={exportCsv}
            aria-label="Export AHJ data to CSV"
            className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            className={cn('bg-gray-800 rounded-lg p-3 border cursor-pointer transition-colors text-left w-full',
              filterHasPortal === 'yes' ? 'border-green-500' : 'border-gray-700/50 hover:border-gray-600')}
            onClick={() => setFilterHasPortal(filterHasPortal === 'yes' ? '' : 'yes')}
            aria-label="Filter: AHJs with portal"
          >
            <div className="text-xl font-bold text-green-400">{stats.withPortal}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">With Portal</div>
          </button>
          <button
            className={cn('bg-gray-800 rounded-lg p-3 border cursor-pointer transition-colors text-left w-full',
              filterMethod.toLowerCase().includes('online') ? 'border-blue-500' : 'border-gray-700/50 hover:border-gray-600')}
            onClick={() => setFilterMethod(filterMethod ? '' : 'Online')}
            aria-label="Filter: online submission AHJs"
          >
            <div className="text-xl font-bold text-blue-400">{stats.online}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Online Submission</div>
          </button>
          <div className="bg-gray-800 rounded-lg p-3 border border-gray-700/50">
            <div className="text-xl font-bold text-amber-400">{stats.phoneOnly}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Phone Only</div>
          </div>
          <button
            className={cn('bg-gray-800 rounded-lg p-3 border cursor-pointer transition-colors text-left w-full',
              filterHasPortal === 'no' ? 'border-red-500' : 'border-gray-700/50 hover:border-gray-600')}
            onClick={() => setFilterHasPortal(filterHasPortal === 'no' ? '' : 'no')}
            aria-label="Filter: AHJs without portal info"
          >
            <div className="text-xl font-bold text-gray-500">{stats.noInfo}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">No Portal Info</div>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search AHJs by name, county, or city..."
              aria-label="Search AHJs"
              className="w-full bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-200 pl-8 pr-3 py-2 focus:outline-none focus:border-green-500"
            />
          </div>

          <select
            value={filterHasPortal}
            onChange={e => setFilterHasPortal(e.target.value as '' | 'yes' | 'no')}
            aria-label="Filter by portal availability"
            className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 px-2 py-2 focus:outline-none focus:border-green-500"
          >
            <option value="">All (Portal)</option>
            <option value="yes">Has Portal</option>
            <option value="no">No Portal</option>
          </select>

          {methods.length > 0 && (
            <select
              value={filterMethod}
              onChange={e => setFilterMethod(e.target.value)}
              aria-label="Filter by submission method"
              className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 px-2 py-2 focus:outline-none focus:border-green-500"
            >
              <option value="">All Methods</option>
              {methods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}

          {counties.length > 0 && (
            <select
              value={filterCounty}
              onChange={e => setFilterCounty(e.target.value)}
              aria-label="Filter by county"
              className="bg-gray-800 border border-gray-700 rounded-md text-xs text-gray-300 px-2 py-2 focus:outline-none focus:border-green-500 max-w-[180px]"
            >
              <option value="">All Counties</option>
              {counties.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          {(search || filterHasPortal || filterMethod || filterCounty) && (
            <button
              onClick={() => { setSearch(''); setFilterHasPortal(''); setFilterMethod(''); setFilterCounty('') }}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Clear All
            </button>
          )}

          <span className="text-xs text-gray-500 ml-auto">{filtered.length.toLocaleString()} results</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center text-gray-500 text-sm py-12 animate-pulse">Loading AHJ data...</div>
        ) : (
          <>
            <div className="border border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/80 border-b border-gray-700">
                  <tr>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort('name')}>
                      AHJ Name{sortIcon('name')}
                    </th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white transition-colors hidden md:table-cell" onClick={() => toggleSort('county')}>
                      County{sortIcon('county')}
                    </th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium hidden lg:table-cell">City</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Portal</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium hidden md:table-cell">Method</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white transition-colors hidden lg:table-cell" onClick={() => toggleSort('max_duration')}>
                      Max Days{sortIcon('max_duration')}
                    </th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium hidden lg:table-cell">Credentials</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium hidden xl:table-cell">Inspection</th>
                    <th className="text-right px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white transition-colors" onClick={() => toggleSort('projects')}>
                      Projects{sortIcon('projects')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((a, i) => {
                    const isExpanded = expandedId === a.id
                    const count = projectCounts[a.name] ?? 0
                    return (
                      <React.Fragment key={a.id}>
                        <tr
                          className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'} ${isExpanded ? 'bg-gray-800/40' : ''}`}
                          onClick={() => setExpandedId(isExpanded ? null : a.id)}
                        >
                          <td className="px-3 py-2.5 font-medium text-white max-w-[200px] truncate">
                            <div className="flex items-center gap-1.5">
                              {isExpanded ? <ChevronUp size={12} className="text-gray-500 flex-shrink-0" /> : <ChevronDown size={12} className="text-gray-500 flex-shrink-0" />}
                              {a.name}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 hidden md:table-cell">{a.county ?? '—'}</td>
                          <td className="px-3 py-2.5 text-gray-400 hidden lg:table-cell">{a.city ?? '—'}</td>
                          <td className="px-3 py-2.5">
                            {a.permit_website ? (
                              <a
                                href={a.permit_website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
                                onClick={e => e.stopPropagation()}
                              >
                                <Globe size={12} />
                                <span className="hidden sm:inline max-w-[120px] truncate">{a.permit_website.replace(/^https?:\/\//, '').slice(0, 25)}</span>
                                <ExternalLink size={9} />
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 hidden md:table-cell">
                            {a.how_to_request ? (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${methodColor(a.how_to_request)}`}>
                                {a.how_to_request}
                              </span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-gray-400 hidden lg:table-cell">
                            {a.max_duration ? (
                              <span className="inline-flex items-center gap-1">
                                <Clock size={10} className="text-gray-500" />
                                {a.max_duration}d
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 hidden lg:table-cell">
                            {a.username ? (
                              <span className="text-green-400 text-[10px] font-medium">Yes</span>
                            ) : (
                              <span className="text-gray-600 text-[10px]">No</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 hidden xl:table-cell">
                            {a.inspection_portal ? (
                              <a
                                href={a.inspection_portal}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-purple-400 hover:text-purple-300 inline-flex items-center gap-1"
                                onClick={e => e.stopPropagation()}
                              >
                                <Globe size={11} />
                                <ExternalLink size={9} />
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {count > 0 ? (
                              <span className="text-green-400 font-medium">{count}</span>
                            ) : (
                              <span className="text-gray-600">0</span>
                            )}
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <tr className="bg-gray-800/20">
                            <td colSpan={9} className="px-4 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Permit Portal section */}
                                <div className="space-y-2">
                                  <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wider">Permit Portal</h4>
                                  {a.permit_website && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-gray-500 w-16">URL:</span>
                                      <a href={a.permit_website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                                        {a.permit_website} <ExternalLink size={10} />
                                      </a>
                                    </div>
                                  )}
                                  {a.permit_phone && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-gray-500 w-16">Phone:</span>
                                      <a href={`tel:${a.permit_phone}`} className="text-xs text-gray-300 hover:text-white flex items-center gap-1">
                                        <Phone size={10} /> {a.permit_phone}
                                      </a>
                                    </div>
                                  )}
                                  {a.how_to_request && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-gray-500 w-16">Method:</span>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${methodColor(a.how_to_request)}`}>
                                        {a.how_to_request}
                                      </span>
                                    </div>
                                  )}
                                  {a.max_duration != null && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-gray-500 w-16">Max Days:</span>
                                      <span className="text-xs text-gray-300">{a.max_duration} days</span>
                                    </div>
                                  )}
                                  {a.electric_code && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-gray-500 w-16">Code:</span>
                                      <span className="text-xs text-gray-300">{a.electric_code}</span>
                                    </div>
                                  )}
                                  {a.plans_on_site != null && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-gray-500 w-16">Plans On-Site:</span>
                                      <span className="text-xs text-gray-300">{a.plans_on_site}</span>
                                    </div>
                                  )}
                                  {a.host_type_required != null && (
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-gray-500 w-16">Host Type:</span>
                                      <span className="text-xs text-gray-300">{a.host_type_required}</span>
                                    </div>
                                  )}

                                  {/* Permit credentials */}
                                  {a.username && (
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-[10px] text-gray-500 w-16">Login:</span>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setShowCreds(p => ({ ...p, [a.id]: !p[a.id] })) }}
                                        aria-label={showCreds[a.id] ? 'Hide permit credentials' : 'Reveal permit credentials'}
                                        className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
                                      >
                                        {showCreds[a.id] ? <EyeOff size={10} /> : <Eye size={10} />}
                                        {showCreds[a.id] ? 'Hide' : 'Reveal'}
                                      </button>
                                      {showCreds[a.id] ? (
                                        <div className="flex items-center gap-3 text-[11px]">
                                          <span className="text-gray-300"><span className="text-gray-500">User:</span> {a.username}</span>
                                          {a.password && <span className="text-gray-300"><span className="text-gray-500">Pass:</span> {a.password}</span>}
                                        </div>
                                      ) : (
                                        <span className="text-[11px] text-gray-600">••••••••</span>
                                      )}
                                    </div>
                                  )}

                                  {a.permit_notes && (
                                    <div className="mt-1.5 text-[11px] text-gray-500 bg-gray-800/50 rounded px-2 py-1.5">
                                      {a.permit_notes}
                                    </div>
                                  )}
                                </div>

                                {/* Inspection Portal section */}
                                <div className="space-y-2">
                                  <h4 className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Inspection Portal</h4>
                                  {a.inspection_portal ? (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-500 w-16">URL:</span>
                                        <a href={a.inspection_portal} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                                          {a.inspection_portal} <ExternalLink size={10} />
                                        </a>
                                      </div>
                                      {a.inspection_email && (
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-gray-500 w-16">Email:</span>
                                          <a href={`mailto:${a.inspection_email}`} className="text-xs text-gray-300 hover:text-white">
                                            {a.inspection_email}
                                          </a>
                                        </div>
                                      )}
                                      {(a.inspection_login || a.inspection_password) && (
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-gray-500 w-16">Login:</span>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setShowInspCreds(p => ({ ...p, [a.id]: !p[a.id] })) }}
                                            aria-label={showInspCreds[a.id] ? 'Hide inspection credentials' : 'Reveal inspection credentials'}
                                            className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
                                          >
                                            {showInspCreds[a.id] ? <EyeOff size={10} /> : <Eye size={10} />}
                                            {showInspCreds[a.id] ? 'Hide' : 'Reveal'}
                                          </button>
                                          {showInspCreds[a.id] ? (
                                            <div className="flex items-center gap-3 text-[11px]">
                                              {a.inspection_login && <span className="text-gray-300"><span className="text-gray-500">User:</span> {a.inspection_login}</span>}
                                              {a.inspection_password && <span className="text-gray-300"><span className="text-gray-500">Pass:</span> {a.inspection_password}</span>}
                                            </div>
                                          ) : (
                                            <span className="text-[11px] text-gray-600">••••••••</span>
                                          )}
                                        </div>
                                      )}
                                      {a.inspection_notes && (
                                        <div className="mt-1.5 text-[11px] text-gray-500 bg-gray-800/50 rounded px-2 py-1.5">
                                          {a.inspection_notes}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-[11px] text-gray-600 italic">No inspection portal info</div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                  {paged.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-12 text-center text-gray-600 text-sm">
                        No AHJs match your filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(0)} disabled={page === 0}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">First</button>
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">Prev</button>
                  <span className="text-xs text-gray-400 px-2">Page {page + 1} of {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">Last</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

