'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { loadScheduleByDateRange, loadCalendarSettings, loadSyncStatus } from '@/lib/api'
import type { CalendarSettings, CalendarSyncEntry } from '@/lib/api/calendar'
import { Nav } from '@/components/Nav'
import { ScheduleAssignModal } from '@/components/project/ScheduleAssignModal'
import { JobBriefPanel } from '@/components/project/JobBriefPanel'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { SuggestionPanel } from './components/SuggestionPanel'
import { cn } from '@/lib/utils'
import { handleApiError } from '@/lib/errors'
import { useSupabaseQuery, useRealtimeSubscription } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import type { Schedule, Project } from '@/types/database'

/** Schedule row with joined project data from Supabase */
type ScheduleWithProject = Schedule & { project?: { name: string; city: string; address?: string | null; zip?: string | null; phone?: string | null; systemkw?: number | null } | null }

import { JOB_COLORS, JOB_LABELS, JOB_COMPLETE_TASK, JOB_COMPLETE_DATE } from '@/lib/tasks'

const STATUS_COLORS: Record<string, { dot: string; label: string }> = {
  complete:    { dot: 'bg-green-400',  label: 'Complete'    },
  scheduled:   { dot: 'bg-blue-400',   label: 'Scheduled'   },
  in_progress: { dot: 'bg-amber-400',  label: 'In Progress' },
  cancelled:   { dot: 'bg-gray-500',   label: 'Cancelled'   },
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat']

function getWeekDates(offset: number): Date[] {
  const base = new Date()
  const dow = base.getDay()
  const monday = new Date(base)
  monday.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtTime(t: string | null): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (isNaN(h)) return ''
  const ampm = h >= 12 ? 'pm' : 'am'
  const hr = h % 12 || 12
  return m ? `${hr}:${String(m).padStart(2, '0')}${ampm}` : `${hr}${ampm}`
}

export default function SchedulePage() {
  const supabase = createClient()
  const { user: currentUser } = useCurrentUser()
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const [schedule, setSchedule] = useState<ScheduleWithProject[]>([])
  const [weekOffset, setWeekOffset] = useState(0)
  const [warehouseFilter, setWarehouseFilter] = useState('all')
  const [jobFilter, setJobFilter] = useState('all')
  const [showCancelled, setShowCancelled] = useState(false)
  const [search, setSearch] = useState('')
  const [schedLoading, setSchedLoading] = useState(true)

  const [assignModal, setAssignModal] = useState<{
    crewId: string | null
    date: string
    scheduleId: string | null
    projectId: string | null
    jobType: string
  } | null>(null)

  // Job Brief panel state
  const [briefScheduleId, setBriefScheduleId] = useState<string | null>(null)

  // ProjectPanel state (opened from Job Brief)
  const [projectPanelProject, setProjectPanelProject] = useState<Project | null>(null)

  // Calendar sync state
  const [calSettings, setCalSettings] = useState<CalendarSettings[]>([])
  const [syncEntries, setSyncEntries] = useState<CalendarSyncEntry[]>([])
  const [calSyncing, setCalSyncing] = useState(false)
  const syncedIds = useMemo(() => new Set(syncEntries.filter(s => s.sync_status === 'synced').map(s => s.schedule_id)), [syncEntries])
  const hasAnySyncEnabled = useMemo(() => calSettings.some(s => s.enabled), [calSettings])

  // Load calendar settings on mount
  useEffect(() => {
    loadCalendarSettings().then(setCalSettings)
  }, [])

  // Load sync status when schedule changes
  useEffect(() => {
    if (schedule.length === 0) return
    const ids = schedule.map(s => s.id)
    loadSyncStatus(ids).then(setSyncEntries)
  }, [schedule])

  // Sync visible week to Google Calendar
  async function handleCalendarSync() {
    const ids = schedule.filter(s => s.status !== 'cancelled').map(s => s.id)
    if (ids.length === 0) return
    setCalSyncing(true)
    try {
      const res = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_ids: ids }),
      })
      if (res.ok) {
        // Reload sync status
        const updated = await loadSyncStatus(ids)
        setSyncEntries(updated)
      }
    } catch (err) {
      handleApiError(err, '[schedule] calendar sync')
    }
    setCalSyncing(false)
  }

  // Crews via useSupabaseQuery — active is STRING 'TRUE', see CLAUDE.md "Crews Table Quirk"
  const { data: crews, loading: crewsLoading } = useSupabaseQuery('crews', {
    select: 'id, name, warehouse',
    filters: { active: 'TRUE' },
    order: { column: 'name', ascending: true },
  })

  // Sales role: load project IDs to filter schedule
  const { data: salesProjectsRaw } = useSupabaseQuery('projects', {
    select: 'id, consultant, advisor',
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled', 'Legal', 'On Hold'] } },
    limit: 5000,
  })
  const salesProjectIds = useMemo(() => {
    if (!currentUser?.isSales || !currentUser.name || !salesProjectsRaw) return null
    const salesName = currentUser.name.toLowerCase()
    return new Set(
      (salesProjectsRaw as unknown as { id: string; consultant: string | null; advisor: string | null }[])
        .filter(p => p.consultant?.toLowerCase() === salesName || p.advisor?.toLowerCase() === salesName)
        .map(p => p.id)
    )
  }, [salesProjectsRaw, currentUser])

  // Schedule query with project join — kept manual since useSupabaseQuery can't handle joins
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const weekStartDate = useMemo(() => isoDate(weekDates[0]), [weekDates])
  const weekEndDate = useMemo(() => isoDate(weekDates[5]), [weekDates])

  const loadSchedule = useCallback(async () => {
    const { data } = await loadScheduleByDateRange(weekStartDate, weekEndDate)
    if (data) setSchedule(data as unknown as ScheduleWithProject[])
    setSchedLoading(false)
  }, [weekStartDate, weekEndDate])

  // Keep a stable ref for realtime callbacks
  const loadScheduleRef = useRef(loadSchedule)
  useEffect(() => { loadScheduleRef.current = loadSchedule }, [loadSchedule])

  useEffect(() => { loadSchedule() }, [loadSchedule])

  // Realtime subscription for schedule changes via hook
  useRealtimeSubscription('schedule', {
    onChange: useCallback(() => loadScheduleRef.current(), []),
  })

  const loading = crewsLoading || schedLoading

  // weekDates already memoized above — alias for template use
  const days = weekDates
  const todayIso = useMemo(() => isoDate(new Date()), [])
  const weekLabel = `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[5].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  // Memoize warehouses list
  const warehouses = useMemo(
    () => [...new Set(crews.map(c => c.warehouse).filter(Boolean))].sort() as string[],
    [crews]
  )

  // Memoize filtered crews
  const filteredCrews = useMemo(
    () => warehouseFilter === 'all' ? crews : crews.filter(c => c.warehouse === warehouseFilter),
    [crews, warehouseFilter]
  )

  // Filter schedule for sales users
  const filteredSchedule = useMemo(() => {
    if (!salesProjectIds) return schedule
    return schedule.filter(s => salesProjectIds.has(s.project_id ?? ''))
  }, [schedule, salesProjectIds])

  // Memoize schedule map: crewId|date -> jobs[]
  // Multi-day jobs (with end_date) appear in every day column they span
  const schedMap = useMemo(() => {
    const map: Record<string, Schedule[]> = {}
    filteredSchedule.forEach(s => {
      if (!s.crew_id || !s.date) return
      const startDate = s.date
      const endDate = (s as ScheduleWithProject).end_date || s.date
      // Add this job to every day column it spans within the visible week
      days.forEach(d => {
        const dayIso = isoDate(d)
        if (dayIso >= startDate && dayIso <= endDate) {
          const key = `${s.crew_id}|${dayIso}`
          if (!map[key]) map[key] = []
          // Avoid duplicate entries for the same job on the same day
          if (!map[key].some(existing => existing.id === s.id)) {
            map[key].push(s)
          }
        }
      })
    })
    Object.keys(map).forEach(key => { map[key] = [...map[key]].sort((a, b) => (a.time ?? '99:99') > (b.time ?? '99:99') ? 1 : -1) })
    return map
  }, [filteredSchedule, days])

  function jobsFor(crewId: string, date: string): ScheduleWithProject[] {
    const all = schedMap[`${crewId}|${date}`] ?? []
    let filtered = all
    // Hide cancelled jobs unless toggled on
    if (!showCancelled) {
      filtered = filtered.filter(j => j.status !== 'cancelled')
    }
    if (jobFilter !== 'all') {
      filtered = filtered.filter(j => j.job_type === jobFilter)
    }
    // Search narrows results — does not bypass other filters (see CLAUDE.md filter pattern)
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      filtered = filtered.filter(j => {
        const proj = (j as ScheduleWithProject).project
        const projName = (proj?.name ?? '').toLowerCase()
        const projId = (j.project_id ?? '').toLowerCase()
        return projName.includes(q) || projId.includes(q)
      })
    }
    return filtered
  }

  // Memoize crew job counts for utilization display
  const crewJobCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    filteredCrews.forEach(crew => {
      let count = 0
      days.forEach(d => {
        const all = schedMap[`${crew.id}|${isoDate(d)}`] ?? []
        // Count non-cancelled jobs for utilization
        count += all.filter(j => j.status !== 'cancelled').length
      })
      counts[crew.id] = count
    })
    return counts
  }, [filteredCrews, days, schedMap])

  // Memoize total jobs
  const totalJobs = useMemo(
    () => filteredCrews.reduce((sum, crew) =>
      sum + days.reduce((s, d) => {
        const all = schedMap[`${crew.id}|${isoDate(d)}`] ?? []
        return s + all.filter(j => j.status !== 'cancelled').length
      }, 0), 0),
    [filteredCrews, days, schedMap]
  )

  // Batch complete: mark all non-complete, non-cancelled jobs for a day as complete
  const [completing, setCompleting] = useState<string | null>(null) // date ISO string

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading schedule...</div>
    </div>
  )
  async function batchComplete(date: string) {
    const dayJobs = schedule.filter(j =>
      j.date === date && j.status !== 'complete' && j.status !== 'cancelled'
    )
    if (dayJobs.length === 0) return
    if (!window.confirm(`Complete all ${dayJobs.length} job${dayJobs.length > 1 ? 's' : ''} for ${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}? This will update tasks and advance pipelines.`)) return
    setCompleting(date)

    const today = new Date().toISOString().slice(0, 10)

    // Build task-sync pairs: which jobs map to a task + project
    const taskJobs = dayJobs
      .filter(j => j.project_id && JOB_COMPLETE_TASK[j.job_type])
      .map(j => ({ job: j, taskId: JOB_COMPLETE_TASK[j.job_type]!, projectId: j.project_id! }))

    // Batch 1: mark all schedule entries complete in parallel
    await Promise.all(dayJobs.map(j =>
      db().from('schedule').update({ status: 'complete' }).eq('id', j.id)
    ))

    if (taskJobs.length > 0) {
      // Batch 2: fetch existing task_state for all (project, task) pairs at once
      const projectIds = [...new Set(taskJobs.map(tj => tj.projectId))]
      const taskIds = [...new Set(taskJobs.map(tj => tj.taskId))]

      const { data: existingTasks } = await supabase.from('task_state')
        .select('project_id, task_id, started_date')
        .in('project_id', projectIds)
        .in('task_id', taskIds)
        .limit(5000)
      const taskMap = new Map(
        ((existingTasks ?? []) as { project_id: string; task_id: string; started_date: string | null }[])
          .map(t => [`${t.project_id}:${t.task_id}`, t.started_date])
      )

      // Batch 3: upsert all task_state + insert all task_history in parallel
      const upsertRows = taskJobs.map(({ projectId, taskId }) => ({
        project_id: projectId, task_id: taskId,
        status: 'Complete', completed_date: today,
        started_date: taskMap.get(`${projectId}:${taskId}`) ?? today,
      }))
      const historyRows = taskJobs.map(({ projectId, taskId }) => ({
        project_id: projectId, task_id: taskId,
        status: 'Complete', changed_by: 'Crew (batch complete)',
      }))

      await Promise.all([
        db().from('task_state').upsert(upsertRows, { onConflict: 'project_id,task_id' }),
        db().from('task_history').insert(historyRows),
      ])

      // Batch 4: fetch projects that need date fields set, then batch update
      const dateJobs = taskJobs
        .filter(({ taskId }) => JOB_COMPLETE_DATE[taskId])
        .map(({ projectId, taskId }) => ({ projectId, dateField: JOB_COMPLETE_DATE[taskId]! }))

      if (dateJobs.length > 0) {
        const dateProjectIds = [...new Set(dateJobs.map(d => d.projectId))]
        const dateFields = [...new Set(dateJobs.map(d => d.dateField))]
        const selectFields = ['id', ...dateFields].join(', ')

        const { data: projects } = await supabase.from('projects')
          .select(selectFields).in('id', dateProjectIds).limit(2000)
        const projMap = new Map(
          ((projects ?? []) as Record<string, unknown>[]).map(p => [p.id as string, p])
        )

        // Only update projects where the date field is not yet set
        const updates = dateJobs
          .filter(({ projectId, dateField }) => {
            const proj = projMap.get(projectId)
            return proj && !proj[dateField]
          })
          .map(({ projectId, dateField }) => ({ projectId, dateField }))

        if (updates.length > 0) {
          await Promise.all(updates.map(({ projectId, dateField }) =>
            db().from('projects').update({ [dateField]: today }).eq('id', projectId)
          ))
        }
      }
    }

    setCompleting(null)
    if (mountedRef.current) loadSchedule()
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Schedule" right={
          <span className="text-xs text-gray-500">{totalJobs} jobs this week</span>
        } />

      {/* Schedule Suggestions */}
      <SuggestionPanel onScheduled={loadSchedule} />

      {/* Controls */}
      <div className="no-print bg-gray-900 border-b border-gray-800 flex items-center gap-3 px-4 py-2 flex-shrink-0">
        <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white text-sm px-2" aria-label="Previous week">◀</button>
        <span className="text-xs text-white font-medium">{weekLabel}</span>
        <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white text-sm px-2" aria-label="Next week">▶</button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="text-xs text-green-400 hover:text-green-300">Today</button>
        )}
        <div className="ml-4 flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects..."
            aria-label="Search projects"
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-40 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}
            aria-label="Filter by warehouse"
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All Warehouses</option>
            {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <select value={jobFilter} onChange={e => setJobFilter(e.target.value)}
            aria-label="Filter by job type"
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All Job Types</option>
            {Object.entries(JOB_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="flex items-center gap-1.5 ml-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={e => setShowCancelled(e.target.checked)}
              className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500 focus:ring-offset-0"
            />
            <span className="text-xs text-gray-500">Show cancelled</span>
          </label>
        </div>
        <button onClick={() => window.print()} className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5" aria-label="Print schedule">
          Print
        </button>
        {hasAnySyncEnabled && (
          <button
            onClick={handleCalendarSync}
            disabled={calSyncing}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-green-600 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            title="Sync visible week to Google Calendar"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {calSyncing ? 'Syncing...' : 'Sync Calendar'}
          </button>
        )}
        {/* Legend */}
        <div className="ml-auto flex items-center gap-3">
          {Object.entries(JOB_LABELS).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1">
              <div className={cn('w-2 h-2 rounded-sm', JOB_COLORS[k]?.bg)} />
              <span className="text-xs text-gray-400">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse min-w-max">
          <thead>
            <tr className="bg-gray-900 sticky top-0 z-10">
              <th className="text-xs text-gray-400 font-medium text-left px-3 py-2 border-b border-r border-gray-800 w-32">Crew</th>
              {days.map((d, i) => {
                const iso = isoDate(d)
                const isToday = iso === todayIso
                return (
                  <th key={i} className={cn(
                    'text-xs font-medium text-left px-3 py-2 border-b border-r border-gray-800 min-w-36',
                    isToday ? 'text-green-300 bg-green-950/40' : 'text-gray-400'
                  )}>
                    <div className="flex items-center justify-between">
                      <span>{DAYS[i]}</span>
                      {(() => {
                        const pending = schedule.filter(j => j.date === iso && j.status !== 'complete' && j.status !== 'cancelled')
                        return pending.length > 0 ? (
                          <button
                            onClick={() => batchComplete(iso)}
                            disabled={completing === iso}
                            className="text-[10px] text-green-500 hover:text-green-300 font-normal"
                          >
                            {completing === iso ? '...' : `Complete ${pending.length}`}
                          </button>
                        ) : null
                      })()}
                    </div>
                    <div className={cn('text-xs font-normal', isToday ? 'text-green-300' : 'text-gray-500')}>
                      {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filteredCrews.map(crew => (
              <tr key={crew.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                <td className="px-3 py-2 border-r border-gray-800 align-top">
                  <div className="text-xs font-medium text-white">{crew.name}</div>
                  {crew.warehouse && <div className="text-xs text-gray-500">{crew.warehouse}</div>}
                  <div className="text-xs text-gray-600 mt-0.5">
                    {crewJobCounts[crew.id] || 0} job{crewJobCounts[crew.id] !== 1 ? 's' : ''}
                  </div>
                </td>
                {days.map((d, i) => {
                  const iso = isoDate(d)
                  const isToday = iso === todayIso
                  const jobs = jobsFor(crew.id, iso)
                  return (
                    <td key={i}
                      onClick={() => setAssignModal({ crewId: crew.id, date: iso, scheduleId: null, projectId: null, jobType: 'survey' })}
                      className={cn(
                        'px-2 py-2 border-r border-gray-800 align-top min-h-16 cursor-pointer hover:bg-gray-800/50 transition-colors',
                        isToday && 'bg-green-950/30 border-l border-l-green-800/40 border-r-green-800/40'
                      )}>
                      {jobs.map(job => {
                        const colors = JOB_COLORS[job.job_type] ?? { bg: 'bg-gray-800', text: 'text-gray-300' }
                        const statusInfo = STATUS_COLORS[job.status] ?? STATUS_COLORS.scheduled
                        const isCancelled = job.status === 'cancelled'
                        const projectData = job.project
                        const pmName = job.pm
                        const isMultiDay = !!(job as ScheduleWithProject).end_date && (job as ScheduleWithProject).end_date !== job.date
                        const multiDayLabel = isMultiDay ? (() => {
                          const start = new Date(job.date + 'T00:00:00')
                          const end = new Date(((job as ScheduleWithProject).end_date ?? job.date) + 'T00:00:00')
                          const current = new Date(iso + 'T00:00:00')
                          const totalDays = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1
                          const dayNum = Math.floor((current.getTime() - start.getTime()) / 86400000) + 1
                          return `Day ${dayNum}/${totalDays}`
                        })() : null
                        return (
                          <div
                            key={job.id}
                            onClick={e => { e.stopPropagation(); setBriefScheduleId(job.id) }}
                            className={cn(
                              colors.bg, colors.text,
                              'rounded px-2 py-1.5 mb-1 cursor-pointer hover:opacity-80 transition-opacity',
                              isCancelled && 'opacity-50 line-through',
                              isMultiDay && 'border-l-2 border-l-white/30'
                            )}
                          >
                            <div className="flex items-center gap-1.5">
                              <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusInfo.dot)} title={statusInfo.label} />
                              {syncedIds.has(job.id) && (
                                <span title="Synced to Google Calendar">
                                  <svg className="w-2.5 h-2.5 text-blue-400 flex-shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </span>
                              )}
                              {job.time && <span className="text-xs font-bold opacity-90">{fmtTime(job.time)}</span>}
                              {multiDayLabel && <span className="text-[10px] opacity-60 ml-auto">{multiDayLabel}</span>}
                            </div>
                            <div className="text-xs font-semibold truncate max-w-32">{projectData?.name ?? job.project_id}</div>
                            <div className="text-xs opacity-70 uppercase tracking-wide">{JOB_LABELS[job.job_type] ?? job.job_type}</div>
                            {projectData?.city && (
                              <div className="text-xs opacity-60">
                                {projectData.address ? (
                                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${projectData.address}, ${projectData.city} TX ${projectData.zip ?? ''}`)}`}
                                    target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                    className="hover:underline">{projectData.city}</a>
                                ) : projectData.city}
                              </div>
                            )}
                            {projectData?.phone && (
                              <a href={`tel:${projectData.phone}`} onClick={e => e.stopPropagation()}
                                className="text-[10px] opacity-60 hover:opacity-100 hover:underline block">{projectData.phone}</a>
                            )}
                            {projectData?.systemkw && <div className="text-[10px] opacity-50">{projectData.systemkw} kW</div>}
                            {pmName && <div className="text-[10px] opacity-50 truncate">{pmName}</div>}
                            {job.notes && <div className="text-[10px] opacity-60 truncate italic">{job.notes}</div>}
                          </div>
                        )
                      })}
                      {(() => {
                        const activeJobs = jobs.filter(j => j.status !== 'cancelled')
                        const n = activeJobs.length
                        if (n === 0) return <div className="text-[10px] text-green-500 opacity-60 mt-1">Available</div>
                        if (n === 1) return <div className="text-[10px] text-amber-500 opacity-60 mt-1">1 job</div>
                        return <div className="text-[10px] text-red-400 opacity-60 mt-1">{n} jobs</div>
                      })()}
                    </td>
                  )
                })}
              </tr>
            ))}
            {filteredCrews.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-500 text-sm">No crews found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Job Brief Panel — slide-out when clicking a job card */}
      {briefScheduleId && (
        <JobBriefPanel
          scheduleId={briefScheduleId}
          onClose={() => setBriefScheduleId(null)}
          onEdit={() => {
            // Find the job to get crew/date/project info for the modal
            const job = schedule.find(s => s.id === briefScheduleId)
            setBriefScheduleId(null)
            if (job) {
              setAssignModal({
                crewId: job.crew_id,
                date: job.date,
                scheduleId: job.id,
                projectId: job.project_id,
                jobType: job.job_type,
              })
            }
          }}
          onOpenProject={(project) => {
            setBriefScheduleId(null)
            setProjectPanelProject(project)
          }}
        />
      )}

      {/* ProjectPanel — opened from Job Brief */}
      {projectPanelProject && (
        <ProjectPanel
          project={projectPanelProject}
          onClose={() => setProjectPanelProject(null)}
          onProjectUpdated={() => loadSchedule()}
        />
      )}

      {assignModal && (
        <ScheduleAssignModal
          crewId={assignModal.crewId}
          date={assignModal.date}
          scheduleId={assignModal.scheduleId}
          projectId={assignModal.projectId}
          jobType={assignModal.jobType}
          crews={filteredCrews}
          onClose={() => setAssignModal(null)}
          onSaved={() => { setAssignModal(null); loadSchedule() }}
        />
      )}
    </div>
  )
}
