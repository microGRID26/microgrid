'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn, fmtDate } from '@/lib/utils'
import type { Crew, Project } from '@/types/database'

// ── Constants ────────────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  survey: 'Survey', install: 'Install', inspection: 'Inspection', service: 'Service'
}

const JOB_BADGE: Record<string, string> = {
  survey: 'bg-blue-900 text-blue-200',
  install: 'bg-green-900 text-green-200',
  inspection: 'bg-amber-900 text-amber-200',
  service: 'bg-pink-900 text-pink-200',
}

const STATUS_DOT: Record<string, string> = {
  complete: 'bg-green-400',
  scheduled: 'bg-blue-400',
  in_progress: 'bg-amber-400',
  cancelled: 'bg-gray-500',
}

const STATUS_LABEL: Record<string, string> = {
  complete: 'Complete',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  cancelled: 'Cancelled',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function getEndOfWeek(today: Date): Date {
  const dow = today.getDay()
  const sat = new Date(today)
  sat.setDate(today.getDate() + (6 - dow))
  sat.setHours(23, 59, 59, 999)
  return sat
}

function mapsLink(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`
}

function formatDateHeader(iso: string, today: string, tomorrow: string): string {
  if (iso === today) return 'Today'
  if (iso === tomorrow) return 'Tomorrow'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

// ── Types ────────────────────────────────────────────────────────────────────

interface JobWithProject {
  id: string
  project_id: string
  crew_id: string
  job_type: string
  date: string
  time: string | null
  notes: string | null
  status: string
  pm: string | null
  pm_id: string | null
  arrival_window: string | null
  arrays: string | null
  pitch: string | null
  stories: string | null
  special_equipment: string | null
  electrical_notes: string | null
  wind_speed: string | null
  risk_category: string | null
  travel_adder: string | null
  wifi_info: string | null
  msp_upgrade: string | null
  // Merged project fields
  project_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  customer_city: string | null
  customer_zip: string | null
  systemkw: number | null
  module: string | null
  module_qty: number | null
  inverter: string | null
  inverter_qty: number | null
  battery: string | null
  battery_qty: number | null
  consultant: string | null
  advisor: string | null
  crew_name: string | null
}

// ── Row component (mobile-friendly) ─────────────────────────────────────────

function Row({ label, value, href }: { label: string; value?: string | number | null; href?: string }) {
  if (value == null || value === '') return null
  return (
    <div className="flex gap-2 py-1">
      <span className="text-gray-500 text-sm w-32 flex-shrink-0">{label}</span>
      {href ? (
        <a href={href} className="text-green-400 text-sm break-words underline" target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      ) : (
        <span className="text-gray-200 text-sm break-words">{value}</span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 pb-1 border-b border-gray-700">
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-green-800 text-green-100 text-sm px-5 py-3 rounded-xl shadow-xl animate-pulse">
      {message}
    </div>
  )
}

// ── Job Card ─────────────────────────────────────────────────────────────────

function JobCard({ job, onStatusChange }: { job: JobWithProject; onStatusChange: (id: string, status: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  const address = [job.customer_address, job.customer_city, job.customer_zip].filter(Boolean).join(', ')
  const status = job.status ?? 'scheduled'
  const jobType = job.job_type ?? 'survey'

  const nextStatus = status === 'scheduled' ? 'in_progress' : status === 'in_progress' ? 'complete' : null
  const nextLabel = status === 'scheduled' ? 'Start Job' : status === 'in_progress' ? 'Mark Complete' : null

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Tappable header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left p-4 active:bg-gray-700 transition-colors"
      >
        {/* Top row: time + badges */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {job.time && (
            <span className="text-xl font-bold text-white">{fmtTime(job.time)}</span>
          )}
          <span className={cn('text-sm px-2.5 py-0.5 rounded-full font-medium', JOB_BADGE[jobType] ?? 'bg-gray-700 text-gray-300')}>
            {JOB_LABELS[jobType] ?? jobType}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('w-2.5 h-2.5 rounded-full', STATUS_DOT[status] ?? 'bg-gray-500')} />
            <span className="text-sm text-gray-400">{STATUS_LABEL[status] ?? status}</span>
          </span>
        </div>

        {/* Project name */}
        <div className="text-lg font-semibold text-white mb-1">
          {job.project_name ?? job.project_id}
        </div>

        {/* City + Crew */}
        <div className="flex items-center gap-3 text-sm text-gray-400">
          {job.customer_city && <span>{job.customer_city}</span>}
          {job.crew_name && (
            <>
              <span className="text-gray-600">|</span>
              <span>{job.crew_name}</span>
            </>
          )}
        </div>

        {/* Expand indicator */}
        <div className="text-xs text-gray-600 mt-2">
          {expanded ? 'Tap to collapse' : 'Tap for details'}
        </div>
      </button>

      {/* Status action button (always visible) */}
      {nextStatus && (
        <div className="px-4 pb-3">
          <button
            onClick={(e) => { e.stopPropagation(); onStatusChange(job.id, nextStatus) }}
            className={cn(
              'w-full py-3 rounded-lg font-semibold text-base transition-colors',
              status === 'scheduled'
                ? 'bg-amber-700 hover:bg-amber-600 active:bg-amber-500 text-white'
                : 'bg-green-700 hover:bg-green-600 active:bg-green-500 text-white'
            )}
          >
            {nextLabel}
          </button>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-700 pt-4">
          {/* Customer */}
          <Section title="Customer">
            <Row label="Name" value={job.project_name} />
            {job.customer_phone && (
              <Row label="Phone" value={job.customer_phone} href={`tel:${job.customer_phone.replace(/\D/g, '')}`} />
            )}
            <Row label="Email" value={job.customer_email} />
            {address && (
              <Row label="Address" value={address} href={mapsLink(address)} />
            )}
          </Section>

          {/* System */}
          <Section title="System">
            <Row label="System Size" value={job.systemkw ? `${job.systemkw} kW` : null} />
            <Row label="Panels" value={job.module_qty && job.module ? `${job.module_qty}x ${job.module}` : (job.module ?? null)} />
            <Row label="Inverter" value={job.inverter_qty && job.inverter ? `${job.inverter_qty}x ${job.inverter}` : (job.inverter ?? null)} />
            <Row label="Battery" value={job.battery_qty && job.battery ? `${job.battery_qty}x ${job.battery}` : (job.battery ?? null)} />
          </Section>

          {/* Install Details */}
          {jobType === 'install' && (
            <Section title="Install Details">
              <Row label="Arrival Window" value={job.arrival_window} />
              <Row label="Arrays" value={job.arrays} />
              <Row label="Pitch" value={job.pitch} />
              <Row label="Stories" value={job.stories} />
              <Row label="Special Equip." value={job.special_equipment} />
              <Row label="MSP Upgrade" value={job.msp_upgrade} />
              <Row label="WiFi Info" value={job.wifi_info} />
              <Row label="Wind Speed" value={job.wind_speed} />
              <Row label="Risk Category" value={job.risk_category} />
              <Row label="Travel Adder" value={job.travel_adder} />
              {job.electrical_notes && (
                <div className="mt-1">
                  <div className="text-gray-500 text-sm mb-1">Electrical Notes</div>
                  <div className="text-gray-200 text-sm bg-gray-900 rounded-lg px-3 py-2 whitespace-pre-wrap">{job.electrical_notes}</div>
                </div>
              )}
            </Section>
          )}

          {/* PM & Team */}
          <Section title="PM & Team">
            <Row label="PM" value={job.pm} />
            <Row label="Consultant" value={job.consultant} />
            <Row label="Advisor" value={job.advisor} />
          </Section>

          {/* Notes */}
          {job.notes && (
            <Section title="Notes">
              <div className="text-gray-200 text-sm bg-gray-900 rounded-lg px-3 py-2 whitespace-pre-wrap">{job.notes}</div>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function CrewPage() {
  const supabase = createClient()
  const [jobs, setJobs] = useState<JobWithProject[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [crewFilter, setCrewFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const todayIso = useMemo(() => isoDate(today), [today])
  const tomorrowIso = useMemo(() => {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    return isoDate(d)
  }, [today])

  const saturdayIso = useMemo(() => isoDate(getEndOfWeek(today)), [today])

  const loadData = useCallback(async () => {
    const [crewRes, schedRes] = await Promise.all([
      supabase.from('crews').select('id, name, warehouse').eq('active', 'TRUE').order('name'),
      (supabase as any)
        .from('schedule')
        .select('id, crew_id, date, job_type, time, project_id, notes, status, pm, pm_id, arrival_window, arrays, pitch, stories, special_equipment, electrical_notes, wind_speed, risk_category, travel_adder, wifi_info, msp_upgrade')
        .gte('date', todayIso)
        .lte('date', saturdayIso)
        .neq('status', 'cancelled')
        .order('date')
        .order('time'),
    ])

    if (crewRes.data) setCrews(crewRes.data as Crew[])

    if (schedRes.data) {
      const rawJobs = schedRes.data as any[]

      // Fetch project details
      const pids = [...new Set(rawJobs.map((j: any) => j.project_id).filter(Boolean))]
      const projMap: Record<string, any> = {}
      if (pids.length > 0) {
        const { data: projData } = await supabase
          .from('projects')
          .select('id, name, phone, email, address, city, zip, systemkw, module, module_qty, inverter, inverter_qty, battery, battery_qty, pm, consultant, advisor')
          .in('id', pids)
        if (projData) {
          projData.forEach((p: any) => { projMap[p.id] = p })
        }
      }

      // Build crew name map
      const crewMap: Record<string, string> = {}
      if (crewRes.data) {
        (crewRes.data as Crew[]).forEach(c => { crewMap[c.id] = c.name })
      }

      // Merge
      const merged: JobWithProject[] = rawJobs.map((j: any) => {
        const p = projMap[j.project_id]
        return {
          ...j,
          project_name: p?.name ?? null,
          customer_phone: p?.phone ?? null,
          customer_email: p?.email ?? null,
          customer_address: p?.address ?? null,
          customer_city: p?.city ?? null,
          customer_zip: p?.zip ?? null,
          systemkw: p?.systemkw ?? null,
          module: p?.module ?? null,
          module_qty: p?.module_qty ?? null,
          inverter: p?.inverter ?? null,
          inverter_qty: p?.inverter_qty ?? null,
          battery: p?.battery ?? null,
          battery_qty: p?.battery_qty ?? null,
          consultant: p?.consultant ?? null,
          advisor: p?.advisor ?? null,
          pm: p?.pm ?? j.pm,
          crew_name: crewMap[j.crew_id] ?? null,
        }
      })

      setJobs(merged)
    }

    setLoading(false)
  }, [todayIso, saturdayIso])

  const loadDataRef = useRef(loadData)
  useEffect(() => { loadDataRef.current = loadData }, [loadData])

  useEffect(() => { loadData() }, [loadData])

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('crew-jobs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule' }, () => loadDataRef.current())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

  // Filter jobs by crew
  const filteredJobs = useMemo(() => {
    if (crewFilter === 'all') return jobs
    return jobs.filter(j => j.crew_id === crewFilter)
  }, [jobs, crewFilter])

  // Group by date
  const todayJobs = useMemo(() => filteredJobs.filter(j => j.date === todayIso), [filteredJobs, todayIso])
  const tomorrowJobs = useMemo(() => filteredJobs.filter(j => j.date === tomorrowIso), [filteredJobs, tomorrowIso])
  const weekJobs = useMemo(
    () => filteredJobs.filter(j => j.date > tomorrowIso),
    [filteredJobs, tomorrowIso]
  )

  // Group remaining week jobs by date
  const weekJobsByDate = useMemo(() => {
    const grouped: Record<string, JobWithProject[]> = {}
    weekJobs.forEach(j => {
      if (!grouped[j.date]) grouped[j.date] = []
      grouped[j.date].push(j)
    })
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
  }, [weekJobs])

  const [weekExpanded, setWeekExpanded] = useState(false)

  // Status update handler
  async function handleStatusChange(jobId: string, newStatus: string) {
    const { error } = await (supabase as any)
      .from('schedule')
      .update({ status: newStatus })
      .eq('id', jobId)

    if (error) {
      setToast('Failed to update status')
      return
    }

    // Auto-complete corresponding task when job is marked complete
    if (newStatus === 'complete') {
      const job = jobs.find(j => j.id === jobId)
      if (job) {
        const JOB_TO_TASK: Record<string, string> = {
          install: 'install_done',
          survey: 'site_survey',
          inspection: 'city_insp',
        }
        const taskId = JOB_TO_TASK[job.job_type]
        if (taskId) {
          const today = new Date().toISOString().slice(0, 10)
          try {
            await (supabase as any).from('task_state').upsert({
              project_id: job.project_id,
              task_id: taskId,
              status: 'Complete',
              completed_date: today,
              started_date: today,
            }, { onConflict: 'project_id,task_id' })

            await (supabase as any).from('task_history').insert({
              project_id: job.project_id,
              task_id: taskId,
              status: 'Complete',
              changed_by: 'Crew (schedule)',
            })

            // Auto-populate project date field if empty
            const TASK_DATE: Record<string, string> = {
              install_done: 'install_complete_date',
              site_survey: 'survey_date',
              city_insp: 'city_inspection_date',
            }
            const dateField = TASK_DATE[taskId]
            if (dateField) {
              const { data: proj } = await supabase.from('projects').select(dateField).eq('id', job.project_id).single()
              if (proj && !(proj as any)[dateField]) {
                await (supabase as any).from('projects').update({ [dateField]: today }).eq('id', job.project_id)
              }
            }
          } catch (e) {
            // Task update is best-effort — don't block the status change
            console.error('Failed to auto-complete task:', e)
          }
        }
      }
    }

    setToast(newStatus === 'in_progress' ? 'Job started' : 'Job marked complete')
    // Optimistically update local state
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j))
  }

  const todayFormatted = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  if (loading) {
    return (
      <div className="min-h-dvh bg-gray-950 flex items-center justify-center">
        <div className="text-green-400 text-base animate-pulse">Loading jobs...</div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-gray-950 flex flex-col" style={{ fontSize: '14px' }}>
      {/* Simple mobile header */}
      <header className="bg-gray-950 border-b border-gray-800 px-4 py-3 flex-shrink-0 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <span className="text-green-400 font-bold text-lg">MicroGRID</span>
          <a href="/schedule" className="text-sm text-gray-400 hover:text-white active:text-white px-3 py-1.5 rounded-lg">
            Schedule
          </a>
        </div>
        <div className="text-sm text-gray-400 mt-1">{todayFormatted}</div>
      </header>

      {/* Crew filter */}
      <div className="bg-gray-950 border-b border-gray-800 px-4 py-2 flex-shrink-0">
        <select
          value={crewFilter}
          onChange={e => setCrewFilter(e.target.value)}
          className="w-full text-base bg-gray-800 text-gray-200 border border-gray-700 rounded-lg px-3 py-2.5"
        >
          <option value="all">All Crews ({filteredJobs.length} jobs)</option>
          {crews.map(c => {
            const count = jobs.filter(j => j.crew_id === c.id).length
            return (
              <option key={c.id} value={c.id}>
                {c.name} ({count} jobs)
              </option>
            )
          })}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

        {/* Today's Jobs */}
        <div>
          <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
            Today
            <span className="text-sm font-normal text-gray-500">({todayJobs.length})</span>
          </h2>
          {todayJobs.length === 0 ? (
            <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-500 text-base">
              No jobs scheduled for today
            </div>
          ) : (
            <div className="space-y-3">
              {todayJobs.map(job => (
                <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} />
              ))}
            </div>
          )}
        </div>

        {/* Tomorrow's Jobs */}
        <div>
          <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
            Tomorrow
            <span className="text-sm font-normal text-gray-500">({tomorrowJobs.length})</span>
          </h2>
          {tomorrowJobs.length === 0 ? (
            <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-500 text-base">
              No jobs scheduled for tomorrow
            </div>
          ) : (
            <div className="space-y-3">
              {tomorrowJobs.map(job => (
                <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} />
              ))}
            </div>
          )}
        </div>

        {/* This Week (collapsible) */}
        {weekJobs.length > 0 && (
          <div>
            <button
              onClick={() => setWeekExpanded(!weekExpanded)}
              className="flex items-center gap-2 mb-3 active:opacity-70"
            >
              <span className="text-base font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                This Week
                <span className="text-sm font-normal text-gray-500">({weekJobs.length})</span>
              </span>
              <span className="text-gray-500 text-sm ml-1">{weekExpanded ? '▾' : '▸'}</span>
            </button>
            {weekExpanded && (
              <div className="space-y-4">
                {weekJobsByDate.map(([date, dateJobs]) => (
                  <div key={date}>
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">
                      {formatDateHeader(date, todayIso, tomorrowIso)}
                    </h3>
                    <div className="space-y-3">
                      {dateJobs.map(job => (
                        <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bottom padding for mobile safe area */}
        <div className="h-8" />
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
