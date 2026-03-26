'use client'

import { useState, useMemo, useCallback } from 'react'
import { loadProjectById } from '@/lib/api'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { fmtDate, daysAgo } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useSupabaseQuery } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import type { Project, ServiceCall } from '@/types/database'
import { ChevronUp, ChevronDown, Download, RefreshCw } from 'lucide-react'

// ── Status styles (standardized with other pages) ────────────────────────────
const STATUS_STYLE: Record<string, string> = {
  'Open':        'bg-red-900/60 text-red-300',
  'Scheduled':   'bg-blue-900/60 text-blue-300',
  'In Progress': 'bg-amber-900/60 text-amber-300',
  'Escalated':   'bg-red-900/80 text-red-200 font-semibold',
  'Re-Opened':   'bg-red-900/60 text-red-300',
  'Closed':      'bg-green-900/60 text-green-300',
}

const PRIORITY_STYLE: Record<string, string> = {
  'high':   'bg-red-900/60 text-red-300',
  'medium': 'bg-amber-900/60 text-amber-300',
  'low':    'bg-gray-800 text-gray-400',
}

// ── Sortable columns ─────────────────────────────────────────────────────────
type SortColumn = 'status' | 'project' | 'issue' | 'pm' | 'created' | 'date' | 'priority'

const COLUMN_DEFS: { key: SortColumn; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'project', label: 'Project' },
  { key: 'issue', label: 'Issue' },
  { key: 'pm', label: 'PM' },
  { key: 'created', label: 'Created' },
  { key: 'date', label: 'Scheduled' },
  { key: 'priority', label: 'Priority' },
]

function getSortValue(call: ServiceCall, col: SortColumn): string {
  switch (col) {
    case 'status':   return call.status ?? ''
    case 'project':  return call.project?.name ?? call.project_id ?? ''
    case 'issue':    return call.issue ?? ''
    case 'pm':       return call.pm ?? ''
    case 'created':  return call.created ?? ''
    case 'date':     return call.date ?? ''
    case 'priority': return call.priority === 'high' ? 'a' : call.priority === 'medium' ? 'b' : 'c'
  }
}

// ── Date range helpers ───────────────────────────────────────────────────────
type DateRange = 'all' | 'today' | '7d' | '30d'

function dateRangeDays(range: DateRange): number | null {
  switch (range) {
    case 'today': return 0
    case '7d': return 7
    case '30d': return 30
    default: return null
  }
}

// ── CSV export for service calls ─────────────────────────────────────────────
function escapeCell(val: string | number | null | undefined): string {
  const s = val == null ? '' : String(val)
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function exportServiceCSV(calls: ServiceCall[]) {
  const headers = ['Status', 'Project ID', 'Project Name', 'City', 'Type', 'Issue', 'PM', 'Priority', 'Created', 'Scheduled', 'Resolution']
  const rows = calls.map(c => [
    c.status, c.project_id, c.project?.name ?? '', c.project?.city ?? '',
    c.type ?? '', c.issue ?? '', c.pm ?? '', c.priority ?? '',
    c.created?.slice(0, 10) ?? '', c.date ?? '', c.resolution ?? '',
  ].map(escapeCell))

  const csv = [headers.map(escapeCell), ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `service-calls-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function ServicePage() {
  const { user: serviceUser, loading: serviceUserLoading } = useCurrentUser()

  // Role gate: Manager+ only
  if (!serviceUserLoading && serviceUser && !serviceUser.isManager) {
    return (
      <>
        <Nav active="Service" />
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">Service is available to Managers and above.</p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              &larr; Back to Command Center
            </a>
          </div>
        </div>
      </>
    )
  }

  const [selected, setSelected] = useState<Project | null>(null)
  const [loadingProject, setLoadingProject] = useState(false)

  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [pmFilter, setPmFilter] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)

  // Sort state
  const [sortCol, setSortCol] = useState<SortColumn>('created')
  const [sortAsc, setSortAsc] = useState(false)

  const { data: calls, loading, refresh, totalCount, hasMore, currentPage, nextPage, prevPage, setPage } = useSupabaseQuery('service_calls', {
    select: 'id, project_id, status, type, issue, created, date, resolution, pm, pm_id, priority, project:projects(name, city)',
    order: { column: 'created', ascending: false },
    page: 1,
    pageSize: 100,
  })

  const openProject = async (projectId: string) => {
    setLoadingProject(true)
    const data = await loadProjectById(projectId)
    if (!data) {
      alert(`Failed to load project ${projectId}`)
      setLoadingProject(false)
      return
    }
    setSelected(data)
    setLoadingProject(false)
  }

  const typedCalls = calls as unknown as ServiceCall[]

  // Extract unique PMs for dropdown
  const pmOptions = useMemo(() => {
    const pms = new Set<string>()
    typedCalls.forEach(c => { if (c.pm) pms.add(c.pm) })
    return Array.from(pms).sort()
  }, [typedCalls])

  // Extract unique priorities for dropdown
  const priorityOptions = useMemo(() => {
    const p = new Set<string>()
    typedCalls.forEach(c => { if (c.priority) p.add(c.priority) })
    return Array.from(p).sort()
  }, [typedCalls])

  // Filtered + sorted data
  const filtered = useMemo(() => {
    const rangeDays = dateRangeDays(dateRange)

    const result = typedCalls.filter(c => {
      // Status tab filter
      if (statusFilter !== 'all' && c.status !== statusFilter) return false

      // Priority filter
      if (priorityFilter !== 'all' && c.priority !== priorityFilter) return false

      // PM filter
      if (pmFilter !== 'all' && c.pm !== pmFilter) return false

      // Date range filter (based on created date)
      if (rangeDays !== null && c.created) {
        const age = daysAgo(c.created.slice(0, 10))
        if (rangeDays === 0 && age > 0) return false
        if (rangeDays > 0 && age > rangeDays) return false
      }

      // Search filter (does NOT bypass other filters)
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !c.project?.name?.toLowerCase().includes(q) &&
          !c.project_id?.toLowerCase().includes(q) &&
          !c.issue?.toLowerCase().includes(q) &&
          !c.pm?.toLowerCase().includes(q)
        ) return false
      }

      return true
    })

    // Sort
    result.sort((a, b) => {
      const va = getSortValue(a, sortCol)
      const vb = getSortValue(b, sortCol)
      const cmp = va.localeCompare(vb)
      return sortAsc ? cmp : -cmp
    })

    return result
  }, [typedCalls, statusFilter, priorityFilter, pmFilter, dateRange, search, sortCol, sortAsc])

  // Status counts across ALL loaded data (not filtered)
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: typedCalls.length }
    typedCalls.forEach(call => { c[call.status] = (c[call.status] || 0) + 1 })
    return c
  }, [typedCalls])

  const handleSort = useCallback((col: SortColumn) => {
    if (sortCol === col) {
      setSortAsc(prev => !prev)
    } else {
      setSortCol(col)
      setSortAsc(true)
    }
  }, [sortCol])

  const handleRefresh = useCallback(() => {
    refresh()
  }, [refresh])

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading service calls...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Service" />

      {/* Stats bar */}
      <div className="bg-gray-950 border-b border-gray-800 px-4 py-2 flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Cases:</span>
          {[
            { label: 'Open', count: counts['Open'] ?? 0, color: 'text-red-400' },
            { label: 'In Progress', count: counts['In Progress'] ?? 0, color: 'text-amber-400' },
            { label: 'Escalated', count: counts['Escalated'] ?? 0, color: 'text-red-300' },
            { label: 'Scheduled', count: counts['Scheduled'] ?? 0, color: 'text-blue-400' },
            { label: 'Closed', count: counts['Closed'] ?? 0, color: 'text-green-400' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-1">
              <span className={`text-sm font-semibold ${s.color}`}>{s.count}</span>
              <span className="text-xs text-gray-500">{s.label}</span>
            </div>
          ))}
          <div className="ml-2 pl-2 border-l border-gray-700">
            <span className="text-sm font-semibold text-white">{counts.all}</span>
            <span className="text-xs text-gray-500 ml-1">Total</span>
          </div>
        </div>
      </div>

      {/* Status tabs + filters */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-1 px-4 py-2 flex-shrink-0 flex-wrap">
        {/* Status tabs */}
        {[
          { key: 'all', label: `All (${counts.all})` },
          { key: 'Open', label: `Open (${counts['Open'] ?? 0})` },
          { key: 'In Progress', label: `In Progress (${counts['In Progress'] ?? 0})` },
          { key: 'Escalated', label: `Escalated (${counts['Escalated'] ?? 0})` },
          { key: 'Closed', label: `Closed (${counts['Closed'] ?? 0})` },
        ].map(t => (
          <button key={t.key} onClick={() => { setStatusFilter(t.key); setPage(1) }}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${statusFilter === t.key ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-white'}`}>
            {t.label}
          </button>
        ))}

        {/* Divider */}
        <div className="w-px h-5 bg-gray-700 mx-1" />

        {/* Priority filter */}
        <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1) }}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:border-green-500">
          <option value="all">All Priorities</option>
          {priorityOptions.map(p => (
            <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
          ))}
        </select>

        {/* PM filter */}
        <select value={pmFilter} onChange={e => { setPmFilter(e.target.value); setPage(1) }}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:border-green-500">
          <option value="all">All PMs</option>
          {pmOptions.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {/* Date range filter */}
        <select value={dateRange} onChange={e => { setDateRange(e.target.value as DateRange); setPage(1) }}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:border-green-500">
          <option value="all">All Dates</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>

        {/* Search */}
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name, ID, issue, PM..."
          className="ml-auto text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-52 focus:outline-none focus:border-green-500 placeholder-gray-500" />

        {/* Action buttons */}
        <button onClick={handleRefresh} title="Refresh"
          className="text-xs text-gray-400 hover:text-green-400 transition-colors p-1.5 rounded hover:bg-gray-800">
          <RefreshCw size={14} />
        </button>
        <button onClick={() => exportServiceCSV(filtered)} title="Export CSV"
          className="text-xs text-gray-400 hover:text-green-400 transition-colors p-1.5 rounded hover:bg-gray-800">
          <Download size={14} />
        </button>

        {/* Pagination */}
        {totalCount != null && (
          <div className="flex items-center gap-2 ml-1">
            <span className="text-xs text-gray-500">{filtered.length} shown</span>
            <Pagination
              currentPage={currentPage}
              totalCount={totalCount}
              pageSize={100}
              hasMore={hasMore}
              onPrevPage={prevPage}
              onNextPage={nextPage}
            />
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <div className="text-3xl mb-3">&#10003;</div>
            <div>{calls.length === 0 ? 'No service calls in database.' : 'No service calls match your filters.'}</div>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="bg-gray-950 sticky top-0">
              <tr>
                {COLUMN_DEFS.map(col => (
                  <th key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-left text-gray-400 font-medium px-3 py-2 border-b border-gray-800 cursor-pointer select-none hover:text-white transition-colors">
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortCol === col.key ? (
                        sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                      ) : (
                        <span className="w-3" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(call => {
                const isExpanded = expandedIssue === call.id
                return (
                  <tr key={call.id}
                    className="border-b border-gray-800 cursor-pointer hover:bg-gray-800/60 transition-colors">
                    <td className="px-3 py-2" onClick={() => openProject(call.project_id)}>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[call.status] ?? 'bg-gray-800 text-gray-400'}`}>
                        {call.status}
                      </span>
                    </td>
                    <td className="px-3 py-2" onClick={() => openProject(call.project_id)}>
                      <div className="font-medium text-white">{call.project?.name ?? call.project_id}</div>
                      <div className="text-gray-500">{call.project_id} {call.project?.city ? `\u00B7 ${call.project.city}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 max-w-md" onClick={() => setExpandedIssue(isExpanded ? null : call.id)}>
                      {call.type && call.type !== 'NetSuite Import' && <div className="text-gray-300 font-medium">{call.type}</div>}
                      {call.issue && (
                        <div className={`text-gray-400 ${isExpanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`} title={isExpanded ? undefined : call.issue}>
                          {call.issue}
                        </div>
                      )}
                      {call.resolution && isExpanded && (
                        <div className="text-green-400/70 mt-1 text-[11px]">
                          <span className="font-medium">Resolution:</span> {call.resolution}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400" onClick={() => openProject(call.project_id)}>{call.pm ?? '\u2014'}</td>
                    <td className="px-3 py-2 text-gray-400" onClick={() => openProject(call.project_id)}>{fmtDate(call.created?.slice(0, 10))}</td>
                    <td className="px-3 py-2 text-gray-400" onClick={() => openProject(call.project_id)}>{fmtDate(call.date)}</td>
                    <td className="px-3 py-2" onClick={() => openProject(call.project_id)}>
                      {call.priority ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLE[call.priority] ?? 'bg-gray-800 text-gray-400'}`}>
                          {call.priority.charAt(0).toUpperCase() + call.priority.slice(1)}
                        </span>
                      ) : (
                        <span className="text-gray-600">&mdash;</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Loading overlay for project panel */}
      {loadingProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="text-green-400 text-sm animate-pulse">Loading project...</div>
        </div>
      )}

      {selected && (
        <ProjectPanel project={selected} onClose={() => setSelected(null)} onProjectUpdated={refresh} />
      )}
    </div>
  )
}
