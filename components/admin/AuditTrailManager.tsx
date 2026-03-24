'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { cn, escapeIlike } from '@/lib/utils'
import type { UserSession } from '@/types/database'
import { AuditChange, AuditTab, DateRange, formatDuration, isOnline, getDateRangeStart } from './shared'

type AuditSession = UserSession

function SessionsTab() {
  const supabase = db()
  const [sessions, setSessions] = useState<AuditSession[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>('today')
  const [userNames, setUserNames] = useState<string[]>([])

  const load = useCallback(async () => {
    let q = supabase
      .from('user_sessions')
      .select('*')
      .order('logged_in_at', { ascending: false })
      .limit(500)

    if (userFilter) {
      q = q.eq('user_name', userFilter)
    }

    const rangeStart = getDateRangeStart(dateRange)
    if (rangeStart) {
      q = q.gte('logged_in_at', rangeStart)
    }

    const { data } = await q
    setSessions(data ?? [])
  }, [userFilter, dateRange])

  useEffect(() => { load() }, [load])

  // Load distinct user names
  useEffect(() => {
    ;supabase
      .from('user_sessions')
      .select('user_name')
      .then(({ data }: { data: { user_name: string }[] | null }) => {
        if (data) {
          const unique = [...new Set(data.map(d => d.user_name))].sort()
          setUserNames(unique)
        }
      })
  }, [])

  const onlineCount = sessions.filter(s => isOnline(s.last_active_at)).length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-green-900/30 border border-green-800 rounded-md px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-medium">{onlineCount} Online</span>
          </div>
          <span className="text-xs text-gray-500">{sessions.length} sessions</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Users</option>
            {userNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Status', 'User', 'Email', 'Logged In', 'Last Active', 'Duration', 'Page'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr key={s.id} className={cn(
                'border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors',
                i % 2 !== 0 && 'bg-gray-900/20'
              )}>
                <td className="px-3 py-2">
                  <span className={cn(
                    'w-2.5 h-2.5 rounded-full inline-block',
                    isOnline(s.last_active_at) ? 'bg-green-400' : 'bg-gray-600'
                  )} />
                </td>
                <td className="px-3 py-2 text-white font-medium">{s.user_name}</td>
                <td className="px-3 py-2 text-gray-400">{s.user_email}</td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                  {new Date(s.logged_in_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                  {new Date(s.last_active_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2 text-gray-400">{formatDuration(s.logged_in_at, s.last_active_at)}</td>
                <td className="px-3 py-2 text-gray-500 font-mono">{s.page || '—'}</td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-600 text-sm">No sessions found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChangesTab() {
  const supabase = db()
  const [changes, setChanges] = useState<AuditChange[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [fieldFilter, setFieldFilter] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>('7days')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(200)
  const [hasMore, setHasMore] = useState(false)
  const [userNames, setUserNames] = useState<string[]>([])
  const [fieldNames, setFieldNames] = useState<string[]>([])

  const load = useCallback(async () => {
    let q = supabase
      .from('audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit + 1)

    if (userFilter) q = q.eq('changed_by', userFilter)
    if (fieldFilter) q = q.eq('field', fieldFilter)
    if (search.trim()) q = q.ilike('project_id', `%${escapeIlike(search.trim())}%`)

    const rangeStart = getDateRangeStart(dateRange)
    if (rangeStart) q = q.gte('changed_at', rangeStart)

    const { data } = await q
    const rows: AuditChange[] = data ?? []
    setHasMore(rows.length > limit)
    setChanges(rows.slice(0, limit))
  }, [userFilter, fieldFilter, dateRange, search, limit])

  useEffect(() => { load() }, [load])

  // Load distinct values for filters
  useEffect(() => {
    ;supabase
      .from('audit_log')
      .select('changed_by, field')
      .limit(2000)
      .then(({ data }: { data: { changed_by: string; field: string }[] | null }) => {
        if (data) {
          setUserNames([...new Set(data.map(d => d.changed_by))].sort())
          setFieldNames([...new Set(data.map(d => d.field))].sort())
        }
      })
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">{changes.length} changes</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Project ID…"
              className="w-36 pl-8 pr-2 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-white
                         placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Users</option>
            {userNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            value={fieldFilter}
            onChange={e => setFieldFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Fields</option>
            {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Project', 'Field', 'Old Value', '', 'New Value', 'Changed By', 'Time'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {changes.map((c, i) => (
              <tr key={c.id} className={cn(
                'border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors',
                i % 2 !== 0 && 'bg-gray-900/20'
              )}>
                <td className="px-3 py-2">
                  <a href={`/queue?search=${c.project_id}`}
                    className="text-blue-400 hover:text-blue-300 font-mono transition-colors">
                    {c.project_id}
                  </a>
                </td>
                <td className="px-3 py-2 text-white font-medium">{c.field}</td>
                <td className="px-3 py-2 text-red-400 max-w-[150px] truncate" title={c.old_value ?? ''}>
                  {c.old_value || '—'}
                </td>
                <td className="px-1 py-2 text-gray-600">&rarr;</td>
                <td className="px-3 py-2 text-green-400 max-w-[150px] truncate" title={c.new_value ?? ''}>
                  {c.new_value || '—'}
                </td>
                <td className="px-3 py-2 text-gray-400">{c.changed_by}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                  {new Date(c.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
              </tr>
            ))}
            {changes.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-600 text-sm">No changes found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-3 text-center">
          <button
            onClick={() => setLimit(prev => prev + 200)}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-xs font-medium rounded-md transition-colors">
            Load More
          </button>
        </div>
      )}
    </div>
  )
}

export function AuditTrailManager() {
  const [tab, setTab] = useState<AuditTab>('sessions')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-base font-semibold text-white">Audit Trail</h2>
        <div className="flex bg-gray-800 rounded-lg p-0.5">
          <button
            onClick={() => setTab('sessions')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              tab === 'sessions' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            )}>
            Sessions
          </button>
          <button
            onClick={() => setTab('changes')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              tab === 'changes' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            )}>
            Changes
          </button>
        </div>
      </div>
      {tab === 'sessions' ? <SessionsTab /> : <ChangesTab />}
    </div>
  )
}
