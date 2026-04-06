'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { cn, escapeIlike, STAGE_LABELS } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { upsertTaskState, insertTaskHistory } from '@/lib/api/tasks'
import { addNote } from '@/lib/api/notes'
import { useRealtimeSubscription } from '@/lib/hooks'
import { getOpenEntry, clockIn, clockOut } from '@/lib/api/time-entries'
import type { TimeEntry } from '@/lib/api/time-entries'
import type { Project, Schedule } from '@/types/database'

import { Toast, ProjectDetail, FieldJobCard, JSAForm, MRFForm } from './components'
import {
  JOB_LABELS,
  JOB_COMPLETE_TASK,
  JOB_COMPLETE_DATE,
  isoDate,
} from './components'
import type { FieldJob, SearchResult } from './components'

// ── Main Page ────────────────────────────────────────────────────────────────

export default function FieldPage() {
  const supabase = createClient()
  const supabaseDb = db()
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [jobs, setJobs] = useState<FieldJob[]>([])
  const jobsRef = useRef<FieldJob[]>([])
  useEffect(() => { jobsRef.current = jobs }, [jobs])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Search
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  // Project detail
  const [detailProject, setDetailProject] = useState<Project | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // JSA form — shown before starting a job
  const [jsaPending, setJsaPending] = useState<{ jobId: string; projectId: string; projectName: string; crewName: string | null } | null>(null)
  // MRF form
  const [mrfJob, setMrfJob] = useState<{ projectId: string; projectName: string; scheduleId: string; crewName: string | null } | null>(null)

  // Clock in/out
  const [openTimeEntry, setOpenTimeEntry] = useState<TimeEntry | null>(null)
  const [clockLoading, setClockLoading] = useState(false)
  const [clockElapsed, setClockElapsed] = useState('')

  // Crew info
  const [crewName, setCrewName] = useState<string | null>(null)
  const [crewMap, setCrewMap] = useState<Record<string, string>>({})

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const todayIso = useMemo(() => isoDate(today), [today])
  const todayFormatted = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Load crews
  useEffect(() => {
    async function loadCrews() {
      const { data, error } = await supabaseDb
        .from('crews')
        .select('id, name')
        .eq('active', 'TRUE')
      if (error) {
        setToast({ message: 'Failed to load crews', type: 'error' })
        return
      }
      if (data) {
        const map: Record<string, string> = {}
        ;(data as { id: string; name: string }[]).forEach(c => { map[c.id] = c.name })
        setCrewMap(map)

        // Try to find user's crew
        if (currentUser?.name) {
          const userCrew = (data as { id: string; name: string }[]).find(c =>
            c.name.toLowerCase().includes(currentUser.name.toLowerCase())
          )
          setCrewName(userCrew ? userCrew.name : currentUser.name)
        }
      }
    }
    if (!userLoading) loadCrews()
  }, [userLoading, currentUser?.name])

  // Load open time entry on mount
  useEffect(() => {
    if (currentUser?.id) {
      getOpenEntry(currentUser.id).then(entry => {
        if (entry) setOpenTimeEntry(entry)
      })
    }
  }, [currentUser?.id])

  // Elapsed time ticker
  useEffect(() => {
    if (!openTimeEntry) { setClockElapsed(''); return }
    const tick = () => {
      const mins = Math.floor((Date.now() - new Date(openTimeEntry.clock_in).getTime()) / 60000)
      const h = Math.floor(mins / 60)
      const m = mins % 60
      setClockElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`)
    }
    tick()
    const iv = setInterval(tick, 30000)
    return () => clearInterval(iv)
  }, [openTimeEntry])

  const handleClockIn = useCallback(async (jobProjectId?: string, jobType?: string) => {
    if (!currentUser?.id) return
    setClockLoading(true)
    // Get GPS location
    let lat: number | null = null
    let lng: number | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch { /* GPS optional */ }

    const entry = await clockIn({
      user_id: currentUser.id,
      user_name: currentUser.name,
      project_id: jobProjectId ?? null,
      clock_in_lat: lat,
      clock_in_lng: lng,
      job_type: jobType ?? null,
    })
    if (entry) {
      setOpenTimeEntry(entry)
      setToast({ message: 'Clocked in', type: 'success' })
    } else {
      setToast({ message: 'Clock-in failed', type: 'error' })
    }
    setClockLoading(false)
  }, [currentUser?.id, currentUser?.name])

  const handleClockOut = useCallback(async () => {
    if (!openTimeEntry) return
    setClockLoading(true)
    let lat: number | null = null
    let lng: number | null = null
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
      )
      lat = pos.coords.latitude
      lng = pos.coords.longitude
    } catch { /* GPS optional */ }

    const ok = await clockOut(openTimeEntry.id, { clock_out_lat: lat, clock_out_lng: lng })
    if (ok) {
      setOpenTimeEntry(null)
      setToast({ message: 'Clocked out', type: 'success' })
    } else {
      setToast({ message: 'Clock-out failed', type: 'error' })
    }
    setClockLoading(false)
  }, [openTimeEntry])

  // ── Geofence: auto-detect when crew arrives at job site ────────────────
  const [geofencePrompt, setGeofencePrompt] = useState<{ jobId: string; projectName: string; distance: string } | null>(null)

  useEffect(() => {
    if (openTimeEntry || !jobs.length) return // Already clocked in or no jobs

    // Check every 30 seconds
    const checkGeofence = async () => {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: true })
        )
        const userLat = pos.coords.latitude
        const userLng = pos.coords.longitude

        // Find next scheduled/in-progress job with an address
        const nextJob = jobs.find(j => j.status === 'scheduled' || j.status === 'in_progress')
        if (!nextJob?.customer_address) return

        // Geocode the address using Nominatim (free, no API key)
        const addr = [nextJob.customer_address, nextJob.customer_city, nextJob.customer_zip].filter(Boolean).join(', ')
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1`, {
          headers: { 'User-Agent': 'MicroGRID-CRM/1.0' },
        })
        const results = await res.json()
        if (!results?.[0]) return

        const jobLat = parseFloat(results[0].lat)
        const jobLng = parseFloat(results[0].lon)
        if (isNaN(jobLat) || isNaN(jobLng)) return

        // Haversine distance in miles
        const R = 3959
        const dLat = (jobLat - userLat) * Math.PI / 180
        const dLng = (jobLng - userLng) * Math.PI / 180
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLat * Math.PI / 180) * Math.cos(jobLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

        if (dist <= 0.5 && !geofencePrompt) {
          setGeofencePrompt({
            jobId: nextJob.id,
            projectName: nextJob.project_name ?? nextJob.project_id,
            distance: dist < 0.1 ? 'on site' : `${dist.toFixed(1)} mi away`,
          })
        }
      } catch (err) {
        // GPS timeout is normal — only log API/network failures
        if (err instanceof GeolocationPositionError) return
        console.warn('[Geofence] check failed:', err instanceof Error ? err.message : err)
      }
    }

    checkGeofence()
    const iv = setInterval(checkGeofence, 60000) // Check every 60s (was 30s — reduce API load)
    return () => clearInterval(iv)
  }, [openTimeEntry, jobs]) // Removed geofencePrompt from deps to prevent re-triggering

  // Load today's schedule
  const loadJobs = useCallback(async () => {
    const { data: schedData, error: schedError } = await supabaseDb
      .from('schedule')
      .select('id, crew_id, date, job_type, time, project_id, notes, status')
      .eq('date', todayIso)
      .neq('status', 'cancelled')
      .order('time')

    if (schedError) {
      console.error('Schedule load failed:', schedError.message)
      setToast({ message: 'Failed to load today\'s schedule', type: 'error' })
      setJobsLoading(false)
      return
    }

    if (schedData) {
      const rawJobs = schedData as Schedule[]

      // Fetch project details
      const pids = [...new Set(rawJobs.map((j: any) => j.project_id).filter(Boolean))]
      const projMap: Record<string, any> = {}
      if (pids.length > 0) {
        const { data: projData, error: projError } = await supabase
          .from('projects')
          .select('id, name, phone, email, address, city, zip, systemkw, module, module_qty, stage, stage_date, blocker, survey_date, install_complete_date, pto_date')
          .in('id', pids)
        if (projError) {
          setToast({ message: 'Failed to load project details', type: 'error' })
        }
        if (projData) {
          projData.forEach((p: any) => { projMap[p.id] = p })
        }
      }

      // Merge
      const merged: FieldJob[] = rawJobs.map((j: any) => {
        const p = projMap[j.project_id]
        return {
          id: j.id,
          project_id: j.project_id,
          crew_id: j.crew_id,
          job_type: j.job_type,
          date: j.date,
          time: j.time,
          notes: j.notes,
          status: j.status ?? 'scheduled',
          project_name: p?.name ?? null,
          customer_phone: p?.phone ?? null,
          customer_email: p?.email ?? null,
          customer_address: p?.address ?? null,
          customer_city: p?.city ?? null,
          customer_zip: p?.zip ?? null,
          systemkw: p?.systemkw ?? null,
          module: p?.module ?? null,
          module_qty: p?.module_qty ?? null,
          stage: p?.stage ?? null,
          stage_date: p?.stage_date ?? null,
          blocker: p?.blocker ?? null,
          survey_date: p?.survey_date ?? null,
          install_complete_date: p?.install_complete_date ?? null,
          pto_date: p?.pto_date ?? null,
          crew_name: crewMap[j.crew_id] ?? null,
        }
      })

      setJobs(merged)
    }

    setJobsLoading(false)
    setRefreshing(false)
  }, [todayIso, crewMap])

  const loadJobsRef = useRef(loadJobs)
  useEffect(() => { loadJobsRef.current = loadJobs }, [loadJobs])
  useEffect(() => { loadJobs() }, [loadJobs])

  // Realtime
  useRealtimeSubscription('schedule', {
    onChange: useCallback(() => loadJobsRef.current(), []),
  })

  // Pull to refresh
  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    loadJobs()
  }, [loadJobs])

  // Search projects
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([])
      return
    }
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      const escaped = escapeIlike(search.trim())
      const { data } = await supabase
        .from('projects')
        .select('id, name, city, address, phone, email, stage, systemkw')
        .or(`name.ilike.%${escaped}%,id.ilike.%${escaped}%,address.ilike.%${escaped}%`)
        .limit(10)
      setSearchResults((data ?? []) as SearchResult[])
      setSearching(false)
    }, 300)
    return () => clearTimeout(searchTimer.current)
  }, [search])

  // Open project detail
  async function openProject(projectId: string) {
    if (!navigator.onLine) {
      setToast({ message: 'No internet connection', type: 'error' })
      return
    }
    setDetailLoading(true)
    const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle()
    if (error || !data) {
      setToast({ message: error?.message ?? 'Project not found', type: 'error' })
    } else {
      setDetailProject(data as Project)
    }
    setDetailLoading(false)
    setSearch('')
    setSearchResults([])
  }

  // Status change handler — intercept "Start Job" to require JSA first
  async function handleStatusChange(jobId: string, newStatus: string) {
    if (!navigator.onLine) {
      setToast({ message: 'No internet connection', type: 'error' })
      return
    }

    // Require JSA before starting a job
    if (newStatus === 'in_progress') {
      const job = jobsRef.current.find(j => j.id === jobId)
      if (job) {
        setJsaPending({
          jobId,
          projectId: job.project_id,
          projectName: job.project_name ?? job.project_id,
          crewName: job.crew_name ?? null,
        })
        return // Don't transition yet — JSA form will call completeStartJob
      }
    }

    await completeStatusChange(jobId, newStatus)
  }

  async function completeStatusChange(jobId: string, newStatus: string) {
    const { error } = await supabaseDb
      .from('schedule')
      .update({ status: newStatus })
      .eq('id', jobId)

    if (error) {
      setToast({ message: 'Failed to update status', type: 'error' })
      return
    }

    // Auto-complete corresponding task when job is marked complete
    if (newStatus === 'complete') {
      const job = jobsRef.current.find(j => j.id === jobId)
      if (job) {
        const taskId = JOB_COMPLETE_TASK[job.job_type]
        if (taskId) {
          const todayStr = new Date().toISOString().slice(0, 10)
          try {
            await upsertTaskState({
              project_id: job.project_id,
              task_id: taskId,
              status: 'Complete',
              completed_date: todayStr,
              started_date: todayStr,
            })
            await insertTaskHistory({
              project_id: job.project_id,
              task_id: taskId,
              status: 'Complete',
              changed_by: currentUser?.name ?? 'Field Crew',
            })
            // Auto-populate project date
            const dateField = JOB_COMPLETE_DATE[taskId]
            if (dateField) {
              const { data: proj } = await supabase.from('projects').select(dateField).eq('id', job.project_id).maybeSingle()
              if (proj && !(proj as Record<string, unknown>)[dateField]) {
                await supabaseDb.from('projects').update({ [dateField]: todayStr }).eq('id', job.project_id)
              }
            }
          } catch (e) {
            console.error('Failed to auto-complete task:', e)
          }
        }
      }
    }

    setToast({ message: newStatus === 'in_progress' ? 'Job started' : 'Job marked complete', type: 'success' })
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j))
  }

  // Mark task complete
  async function handleMarkTaskComplete(job: FieldJob) {
    if (!navigator.onLine) {
      setToast({ message: 'No internet connection', type: 'error' })
      return
    }
    const taskId = JOB_COMPLETE_TASK[job.job_type]
    if (!taskId) return

    const todayStr = new Date().toISOString().slice(0, 10)
    const { error } = await upsertTaskState({
      project_id: job.project_id,
      task_id: taskId,
      status: 'Complete',
      completed_date: todayStr,
      started_date: todayStr,
    })

    if (error) {
      setToast({ message: 'Failed to mark task complete', type: 'error' })
      return
    }

    await insertTaskHistory({
      project_id: job.project_id,
      task_id: taskId,
      status: 'Complete',
      changed_by: currentUser?.name ?? 'Field Crew',
    })

    // Auto-populate project date
    const dateField = JOB_COMPLETE_DATE[taskId]
    if (dateField) {
      try {
        const { data: proj } = await supabase.from('projects').select(dateField).eq('id', job.project_id).maybeSingle()
        if (proj && !(proj as Record<string, unknown>)[dateField]) {
          await supabaseDb.from('projects').update({ [dateField]: todayStr }).eq('id', job.project_id)
        }
      } catch (e) {
        console.error('Failed to auto-populate date:', e)
      }
    }

    setToast({ message: `${JOB_LABELS[job.job_type]} task marked complete`, type: 'success' })
  }

  // Sort jobs: in_progress first, then scheduled, then complete
  const sortedJobs = useMemo(() => {
    const order: Record<string, number> = { in_progress: 0, scheduled: 1, complete: 2 }
    const timeToMin = (t: string | null) => {
      if (!t) return 9999
      const [h, m] = t.split(':').map(Number)
      return (h || 0) * 60 + (m || 0)
    }
    return [...jobs].sort((a, b) => {
      const ao = order[a.status] ?? 1
      const bo = order[b.status] ?? 1
      if (ao !== bo) return ao - bo
      // Then by time (numeric comparison)
      return timeToMin(a.time) - timeToMin(b.time)
    })
  }, [jobs])

  const loading = userLoading || jobsLoading

  if (loading) {
    return (
      <div className="min-h-dvh bg-gray-900 px-4 pt-16 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-4 animate-pulse">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-6 w-16 bg-gray-800 rounded-full" />
              <div className="h-4 w-20 bg-gray-800 rounded" />
            </div>
            <div className="h-5 w-48 bg-gray-800 rounded mb-2" />
            <div className="h-4 w-32 bg-gray-800 rounded" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-gray-900 flex flex-col pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex-shrink-0 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-green-400 font-bold text-lg">MicroGRID</span>
            <span className="text-gray-600">|</span>
            <span className="text-white font-medium">Field</span>
          </div>
          {crewName && (
            <span className="text-sm text-gray-400">{crewName}</span>
          )}
        </div>
        <div className="text-sm text-gray-400 mt-1">{todayFormatted}</div>
      </header>

      {/* Geofence prompt — auto-detected arrival at job site */}
      {geofencePrompt && !openTimeEntry && (
        <div className="px-4 py-3 bg-blue-900/30 border-b border-blue-700/40 flex items-center gap-3 flex-shrink-0">
          <div className="flex-1">
            <div className="text-sm font-medium text-blue-300">Near {geofencePrompt.projectName}</div>
            <div className="text-[10px] text-blue-400/70">{geofencePrompt.distance} — Clock in to start?</div>
          </div>
          <button
            onClick={() => {
              const job = jobs.find(j => j.id === geofencePrompt.jobId)
              handleClockIn(job?.project_id, job?.job_type)
              setGeofencePrompt(null)
            }}
            className="px-4 py-2 bg-green-700 active:bg-green-600 text-white text-sm font-medium rounded-xl"
          >
            Clock In
          </button>
          <button onClick={() => setGeofencePrompt(null)} className="text-gray-500 active:text-white min-w-[32px] min-h-[32px] flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      )}

      {/* Clock In/Out Bar */}
      <div className={cn(
        'px-4 py-3 flex items-center justify-between border-b flex-shrink-0',
        openTimeEntry ? 'bg-green-900/30 border-green-800' : 'bg-gray-900 border-gray-800'
      )}>
        {openTimeEntry ? (
          <>
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-green-300">Clocked In</span>
                <span className="text-sm text-green-400 font-mono">{clockElapsed}</span>
              </div>
              {openTimeEntry.project_id && (
                <div className="text-[11px] text-green-500/70 mt-0.5">{openTimeEntry.project_id}</div>
              )}
            </div>
            <button
              onClick={handleClockOut}
              disabled={clockLoading}
              className="min-h-[44px] px-5 bg-red-700 hover:bg-red-600 text-white text-sm font-semibold rounded-xl active:scale-95 transition-all disabled:opacity-50"
            >
              {clockLoading ? 'Saving...' : 'Clock Out'}
            </button>
          </>
        ) : (
          <>
            <div className="text-sm text-gray-400">Not clocked in</div>
            <button
              onClick={() => handleClockIn()}
              disabled={clockLoading}
              className="min-h-[44px] px-5 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold rounded-xl active:scale-95 transition-all disabled:opacity-50"
            >
              {clockLoading ? 'Saving...' : 'Clock In'}
            </button>
          </>
        )}
      </div>

      {/* Search bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex-shrink-0 relative">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search project name, ID, or address..."
          className="w-full min-h-[44px] bg-gray-900 text-white border border-gray-700 rounded-xl px-4 text-base placeholder-gray-600 focus:outline-none focus:border-green-500"
        />
        {/* Search results dropdown */}
        {search.trim() && (
          <div className="absolute left-4 right-4 top-full mt-1 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden z-50 max-h-[60vh] overflow-y-auto shadow-2xl">
            {searching ? (
              <div className="px-4 py-3 text-gray-400 text-sm animate-pulse">Searching...</div>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-3 text-gray-500 text-sm">No results</div>
            ) : (
              <>
              {searchResults.length >= 10 && (
                <div className="px-4 py-2 text-xs text-amber-400 bg-amber-950/50 border-b border-gray-800">
                  Showing first 10 results — refine your search
                </div>
              )}
              {searchResults.map(r => (
                <button
                  key={r.id}
                  onClick={() => openProject(r.id)}
                  className="w-full text-left px-4 py-3 border-b border-gray-800 last:border-b-0 active:bg-gray-800 transition-colors min-h-[48px]"
                >
                  <div className="text-white font-medium">{r.name}</div>
                  <div className="text-sm text-gray-400 flex items-center gap-2 mt-0.5">
                    <span>{r.id}</span>
                    {r.city && <><span className="text-gray-600">|</span><span>{r.city}</span></>}
                    {r.stage && (
                      <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-300">
                        {STAGE_LABELS[r.stage] ?? r.stage}
                      </span>
                    )}
                  </div>
                </button>
              ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="w-full min-h-[44px] bg-gray-900 border border-gray-800 rounded-xl text-sm text-gray-400 active:bg-gray-800 transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
          {refreshing ? 'Refreshing...' : 'Refresh Schedule'}
        </button>

        {/* Route All + Stats bar */}
        {(() => {
          const remaining = jobs.filter(j => j.status !== 'complete' && j.status !== 'cancelled')
          const addresses = remaining.map(j => [j.customer_address, j.customer_city].filter(Boolean).join(', ')).filter(Boolean)
          if (addresses.length >= 2) {
            const origin = encodeURIComponent(addresses[0])
            const dest = encodeURIComponent(addresses[addresses.length - 1])
            const waypoints = addresses.slice(1, -1).map(a => encodeURIComponent(a)).join('|')
            const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${waypoints ? `&waypoints=${waypoints}` : ''}&travelmode=driving`
            return (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="w-full min-h-[48px] bg-blue-900/30 border border-blue-700/40 rounded-xl text-sm text-blue-400 active:bg-blue-900/50 transition-colors flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                Route All {addresses.length} Jobs in Google Maps
              </a>
            )
          }
          if (addresses.length === 1) {
            return (
              <a href={`https://maps.google.com/?q=${encodeURIComponent(addresses[0])}`} target="_blank" rel="noopener noreferrer"
                className="w-full min-h-[48px] bg-blue-900/30 border border-blue-700/40 rounded-xl text-sm text-blue-400 active:bg-blue-900/50 transition-colors flex items-center justify-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                Navigate to Job
              </a>
            )
          }
          return null
        })()}

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
            <span className="text-gray-400">
              {jobs.filter(j => j.status === 'complete').length} complete
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-gray-400">
              {jobs.filter(j => j.status === 'in_progress').length} in progress
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
            <span className="text-gray-400">
              {jobs.filter(j => j.status === 'scheduled').length} scheduled
            </span>
          </div>
        </div>

        {/* Today's Jobs */}
        <div>
          <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
            Today&apos;s Jobs
            <span className="text-sm font-normal text-gray-500">({jobs.length})</span>
          </h2>

          {jobs.length === 0 ? (
            <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
              <div className="text-gray-500 text-base mb-2">No jobs scheduled for today</div>
              <div className="text-gray-600 text-sm">Use search above to look up a project</div>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedJobs.map(job => (
                <FieldJobCard
                  key={job.id}
                  job={job}
                  onTap={() => openProject(job.project_id)}
                  onStatusChange={handleStatusChange}
                  onMarkTaskComplete={handleMarkTaskComplete}
                  onRequestMaterials={(job) => setMrfJob({
                    projectId: job.project_id,
                    projectName: job.project_name ?? job.project_id,
                    scheduleId: job.id,
                    crewName: job.crew_name ?? null,
                  })}
                  onAddNote={async (projectId, text) => {
                    const { error } = await addNote({ project_id: projectId, text, time: new Date().toISOString(), pm: currentUser?.name ?? null, pm_id: currentUser?.id ?? null })
                    if (error) { setToast({ message: 'Note failed', type: 'error' }); return false }
                    setToast({ message: 'Note added', type: 'success' })
                    return true
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Bottom safe area */}
        <div className="h-8" />
      </div>

      {/* Detail loading overlay */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 bg-gray-900/90 flex items-center justify-center">
          <div className="text-green-400 text-base animate-pulse">Loading project...</div>
        </div>
      )}

      {/* JSA Form — appears before Start Job */}
      {jsaPending && (
        <JSAForm
          scheduleId={jsaPending.jobId}
          projectId={jsaPending.projectId}
          projectName={jsaPending.projectName}
          crewLead={currentUser?.name ?? 'Unknown'}
          crewName={jsaPending.crewName}
          onComplete={async () => {
            await completeStatusChange(jsaPending.jobId, 'in_progress')
            setJsaPending(null)
            setToast({ message: 'JSA completed — job started', type: 'success' })
          }}
          onCancel={() => setJsaPending(null)}
        />
      )}

      {/* MRF Form */}
      {mrfJob && (
        <MRFForm
          projectId={mrfJob.projectId}
          projectName={mrfJob.projectName}
          scheduleId={mrfJob.scheduleId}
          crewName={mrfJob.crewName}
          requestedBy={currentUser?.name ?? 'Unknown'}
          onComplete={() => { setMrfJob(null); setToast({ message: 'MRF submitted', type: 'success' }) }}
          onCancel={() => setMrfJob(null)}
        />
      )}

      {/* Project detail modal */}
      {detailProject && (
        <ProjectDetail
          project={detailProject}
          onClose={() => setDetailProject(null)}
          onNoteAdded={() => {}}
          userName={currentUser?.name ?? null}
          userId={currentUser?.id ?? null}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}
