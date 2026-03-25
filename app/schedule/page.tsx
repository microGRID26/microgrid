'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { loadScheduleByDateRange } from '@/lib/api'
import { Nav } from '@/components/Nav'
import { ScheduleAssignModal } from '@/components/project/ScheduleAssignModal'
import { JobBriefPanel } from '@/components/project/JobBriefPanel'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { cn } from '@/lib/utils'
import { useSupabaseQuery, useRealtimeSubscription } from '@/lib/hooks'
import type { Schedule, Crew, Project } from '@/types/database'

/** Schedule row with joined project data from Supabase */
type ScheduleWithProject = Schedule & { project?: { name: string; city: string } | null }

const JOB_COLORS: Record<string, { bg: string; text: string }> = {
  survey:     { bg: 'bg-blue-900',   text: 'text-blue-200'   },
  install:    { bg: 'bg-green-900',  text: 'text-green-200'  },
  inspection: { bg: 'bg-amber-900',  text: 'text-amber-200'  },
  service:    { bg: 'bg-pink-900',   text: 'text-pink-200'   },
}

const JOB_LABELS: Record<string, string> = {
  survey: 'Site Survey', install: 'Installation', inspection: 'Inspection', service: 'Service Call'
}

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

  // Crews via useSupabaseQuery — active is STRING 'TRUE', see CLAUDE.md "Crews Table Quirk"
  const { data: crews, loading: crewsLoading } = useSupabaseQuery('crews', {
    select: 'id, name, warehouse',
    filters: { active: 'TRUE' },
    order: { column: 'name', ascending: true },
  })

  // Schedule query with project join — kept manual since useSupabaseQuery can't handle joins
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset])
  const weekStartDate = useMemo(() => isoDate(weekDates[0]), [weekDates])
  const weekEndDate = useMemo(() => isoDate(weekDates[5]), [weekDates])

  const loadSchedule = useCallback(async () => {
    const { data } = await loadScheduleByDateRange(weekStartDate, weekEndDate)
    if (data) setSchedule(data as ScheduleWithProject[])
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

  // Memoize schedule map: crewId|date -> jobs[]
  const schedMap = useMemo(() => {
    const map: Record<string, Schedule[]> = {}
    schedule.forEach(s => {
      if (!s.crew_id || !s.date) return
      const key = `${s.crew_id}|${s.date}`
      if (!map[key]) map[key] = []
      map[key].push(s)
    })
    Object.keys(map).forEach(key => { map[key] = [...map[key]].sort((a, b) => (a.time ?? '99:99') > (b.time ?? '99:99') ? 1 : -1) })
    return map
  }, [schedule])

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
    setCompleting(date)

    const JOB_TO_TASK: Record<string, string> = {
      install: 'install_done', survey: 'site_survey', inspection: 'city_insp',
    }
    const TASK_DATE: Record<string, string> = {
      install_done: 'install_complete_date', site_survey: 'survey_date', city_insp: 'city_inspection_date',
    }
    const today = new Date().toISOString().slice(0, 10)

    for (const job of dayJobs) {
      // Update schedule status
      const { error: schedErr } = await db().from('schedule').update({ status: 'complete' }).eq('id', job.id)
      if (schedErr) { console.error('batch schedule update failed:', schedErr); continue }

      // Task sync
      const taskId = JOB_TO_TASK[job.job_type]
      if (taskId && job.project_id) {
        try {
          // Preserve existing started_date if already set (#27)
          const { data: existingTask } = await supabase.from('task_state')
            .select('started_date').eq('project_id', job.project_id).eq('task_id', taskId).single()
          const startDate = (existingTask as Record<string, unknown> | null)?.started_date ?? today

          await db().from('task_state').upsert({
            project_id: job.project_id, task_id: taskId,
            status: 'Complete', completed_date: today, started_date: startDate,
          }, { onConflict: 'project_id,task_id' })

          await db().from('task_history').insert({
            project_id: job.project_id, task_id: taskId,
            status: 'Complete', changed_by: 'Crew (batch complete)',
          })

          const dateField = TASK_DATE[taskId]
          if (dateField) {
            const { data: proj, error: projErr } = await supabase.from('projects').select(dateField).eq('id', job.project_id).single()
            if (projErr || !proj) return
            if (!(proj as Record<string, unknown>)[dateField]) {
              await db().from('projects').update({ [dateField]: today }).eq('id', job.project_id)
            }
          }
        } catch (e) {
          console.error('Batch complete task sync failed:', e)
        }
      }
    }

    setCompleting(null)
    // Guard against calling loadSchedule after unmount (#15)
    if (mountedRef.current) loadSchedule()
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Schedule" right={
          <span className="text-xs text-gray-500">{totalJobs} jobs this week</span>
        } />

      {/* Controls */}
      <div className="no-print bg-gray-950 border-b border-gray-800 flex items-center gap-3 px-4 py-2 flex-shrink-0">
        <button onClick={() => setWeekOffset(w => w - 1)} className="text-gray-400 hover:text-white text-sm px-2">◀</button>
        <span className="text-xs text-white font-medium">{weekLabel}</span>
        <button onClick={() => setWeekOffset(w => w + 1)} className="text-gray-400 hover:text-white text-sm px-2">▶</button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="text-xs text-green-400 hover:text-green-300">Today</button>
        )}
        <div className="ml-4 flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded-md px-3 py-1.5 w-40 focus:outline-none focus:border-green-500 placeholder-gray-500"
          />
          <select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            <option value="all">All Warehouses</option>
            {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <select value={jobFilter} onChange={e => setJobFilter(e.target.value)}
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
        <button onClick={() => window.print()} className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-md px-3 py-1.5 transition-colors flex items-center gap-1.5">
          Print
        </button>
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
            <tr className="bg-gray-950 sticky top-0 z-10">
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
                        return (
                          <div
                            key={job.id}
                            onClick={e => { e.stopPropagation(); setBriefScheduleId(job.id) }}
                            className={cn(
                              colors.bg, colors.text,
                              'rounded px-2 py-1.5 mb-1 cursor-pointer hover:opacity-80 transition-opacity',
                              isCancelled && 'opacity-50 line-through'
                            )}
                          >
                            <div className="flex items-center gap-1.5">
                              <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusInfo.dot)} title={statusInfo.label} />
                              {job.time && <span className="text-xs font-bold opacity-90">{fmtTime(job.time)}</span>}
                            </div>
                            <div className="text-xs font-semibold truncate max-w-32">{projectData?.name ?? job.project_id}</div>
                            <div className="text-xs opacity-70 uppercase tracking-wide">{JOB_LABELS[job.job_type] ?? job.job_type}</div>
                            {projectData?.city && <div className="text-xs opacity-60">{projectData.city}</div>}
                            {pmName && <div className="text-xs opacity-50 truncate">{pmName}</div>}
                            {job.notes && <div className="text-xs opacity-60 truncate">{job.notes}</div>}
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
