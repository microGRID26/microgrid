'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useSupabaseQuery } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn, fmtDate, escapeIlike } from '@/lib/utils'
import { loadProjectById } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'
import type { Project, AuditLog } from '@/types/database'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────

type DateRange = 'today' | '7days' | '30days' | 'all'
type SortField = 'changed_at' | 'project_id' | 'field' | 'changed_by'
type SortDir = 'asc' | 'desc'

function getDateRangeStart(range: DateRange): string | null {
  if (range === 'all') return null
  const now = new Date()
  if (range === 'today') {
    now.setHours(0, 0, 0, 0)
    return now.toISOString()
  }
  if (range === '7days') {
    now.setDate(now.getDate() - 7)
    return now.toISOString()
  }
  now.setDate(now.getDate() - 30)
  return now.toISOString()
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function AuditTrailPage() {
  const { user, loading: userLoading } = useCurrentUser()

  // Filters
  const [dateRange, setDateRange] = useState<DateRange>('7days')
  const [projectSearch, setProjectSearch] = useState('')
  const [fieldFilter, setFieldFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')

  // Sort
  const [sortField, setSortField] = useState<SortField>('changed_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // ProjectPanel
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)

  // Filter dropdown options (loaded once)
  const [fieldNames, setFieldNames] = useState<string[]>([])
  const [userNames, setUserNames] = useState<string[]>([])

  // Load distinct field names and user names for dropdown filters
  useEffect(() => {
    const supabase = createClient()
    ;(supabase as any)
      .from('audit_log')
      .select('changed_by, field')
      .limit(5000)
      .then(({ data }: { data: { changed_by: string | null; field: string }[] | null }) => {
        if (data) {
          setFieldNames([...new Set(data.map(d => d.field).filter(Boolean))].sort())
          setUserNames(
            [...new Set(data.map(d => d.changed_by).filter((v): v is string => !!v))].sort()
          )
        }
      })
  }, [])

  // Build query filters
  const queryFilters = useMemo(() => {
    const f: Record<string, any> = {}

    if (projectSearch.trim()) {
      f.project_id = { ilike: `%${escapeIlike(projectSearch.trim())}%` }
    }
    if (fieldFilter) {
      f.field = fieldFilter
    }
    if (userFilter) {
      f.changed_by = userFilter
    }
    const rangeStart = getDateRangeStart(dateRange)
    if (rangeStart) {
      f.changed_at = { gte: rangeStart }
    }

    return f
  }, [projectSearch, fieldFilter, userFilter, dateRange])

  const {
    data: logs,
    loading,
    totalCount,
    hasMore,
    currentPage,
    nextPage,
    prevPage,
    refresh,
  } = useSupabaseQuery('audit_log', {
    page: 1,
    pageSize: PAGE_SIZE,
    filters: queryFilters,
    order: { column: sortField, ascending: sortDir === 'asc' },
  })

  // Sort column click handler
  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        return prev
      }
      setSortDir(field === 'changed_at' ? 'desc' : 'asc')
      return field
    })
  }, [])

  // Open project in ProjectPanel
  const handleOpenProject = useCallback(async (projectId: string) => {
    const project = await loadProjectById(projectId)
    if (project) setSelectedProject(project)
  }, [])

  // Sort icon helper
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="text-gray-600 ml-1 inline" />
    return sortDir === 'asc'
      ? <ArrowUp size={12} className="text-green-400 ml-1 inline" />
      : <ArrowDown size={12} className="text-green-400 ml-1 inline" />
  }

  // Access guard
  if (!userLoading && (!user || !user.isAdmin)) {
    return (
      <>
        <Nav active="Audit Trail" />
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <p className="text-gray-400 text-sm">Access restricted to administrators.</p>
        </div>
      </>
    )
  }

  const filterBar = (
    <div className="flex items-center gap-2">
      <Pagination
        currentPage={currentPage}
        totalCount={totalCount ?? 0}
        pageSize={PAGE_SIZE}
        hasMore={hasMore}
        onPrevPage={prevPage}
        onNextPage={nextPage}
      />
      <span className="text-xs text-gray-500 tabular-nums">
        {totalCount !== null ? `${totalCount.toLocaleString()} records` : ''}
      </span>
    </div>
  )

  return (
    <>
      <Nav active="Audit Trail" right={filterBar} />
      <main className="min-h-screen bg-gray-900 p-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            value={projectSearch}
            onChange={e => setProjectSearch(e.target.value)}
            placeholder="Search project ID..."
            className="w-44 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-white
                       placeholder-gray-500 focus:outline-none focus:border-green-600 transition-colors"
          />
          <select
            value={fieldFilter}
            onChange={e => setFieldFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-green-600 transition-colors"
          >
            <option value="">All Fields</option>
            {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-green-600 transition-colors"
          >
            <option value="">All Users</option>
            {userNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-green-600 transition-colors"
          >
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-auto rounded-lg border border-gray-800 bg-gray-800/30">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
              <tr>
                <th
                  onClick={() => handleSort('changed_at')}
                  className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition-colors"
                >
                  Timestamp <SortIcon field="changed_at" />
                </th>
                <th
                  onClick={() => handleSort('project_id')}
                  className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition-colors"
                >
                  Project <SortIcon field="project_id" />
                </th>
                <th
                  onClick={() => handleSort('field')}
                  className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition-colors"
                >
                  Field <SortIcon field="field" />
                </th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">
                  Old Value
                </th>
                <th className="px-1 py-2.5" />
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">
                  New Value
                </th>
                <th
                  onClick={() => handleSort('changed_by')}
                  className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap cursor-pointer select-none hover:text-white transition-colors"
                >
                  Changed By <SortIcon field="changed_by" />
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-gray-500 text-sm">
                    Loading audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-gray-600 text-sm">
                    No audit records found
                  </td>
                </tr>
              ) : (
                logs.map((log, i) => {
                  const isDeleted = log.field === 'project_deleted'
                  return (
                    <tr
                      key={log.id}
                      className={cn(
                        'border-b border-gray-800/50 transition-colors',
                        isDeleted
                          ? 'bg-red-950/40 hover:bg-red-950/60'
                          : i % 2 !== 0
                            ? 'bg-gray-900/20 hover:bg-gray-800/30'
                            : 'hover:bg-gray-800/30'
                      )}
                    >
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                        {formatTimestamp(log.changed_at)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleOpenProject(log.project_id)}
                          className="text-blue-400 hover:text-blue-300 font-mono transition-colors text-left"
                        >
                          {log.project_id}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-white font-medium">
                        {isDeleted ? (
                          <span className="text-red-400 font-semibold">PROJECT DELETED</span>
                        ) : (
                          log.field
                        )}
                      </td>
                      <td className="px-3 py-2 text-red-400 max-w-[200px] truncate" title={log.old_value ?? ''}>
                        {log.old_value || '\u2014'}
                      </td>
                      <td className="px-1 py-2 text-gray-600">&rarr;</td>
                      <td className="px-3 py-2 text-green-400 max-w-[200px] truncate" title={log.new_value ?? ''}>
                        {log.new_value || '\u2014'}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        {log.changed_by || '\u2014'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom pagination */}
        {(totalCount ?? 0) > PAGE_SIZE && (
          <div className="flex justify-center mt-4">
            <Pagination
              currentPage={currentPage}
              totalCount={totalCount ?? 0}
              pageSize={PAGE_SIZE}
              hasMore={hasMore}
              onPrevPage={prevPage}
              onNextPage={nextPage}
            />
          </div>
        )}
      </main>

      {/* Project Panel */}
      {selectedProject && (
        <ProjectPanel
          project={selectedProject}
          onClose={() => setSelectedProject(null)}
          onProjectUpdated={refresh}
        />
      )}
    </>
  )
}
