'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { cn, daysAgo, fmtDate, escapeIlike, STAGE_LABELS } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { addNote } from '@/lib/api/notes'
import { upsertTaskState, insertTaskHistory } from '@/lib/api/tasks'
import { useRealtimeSubscription } from '@/lib/hooks'
import type { Project, Schedule } from '@/types/database'

// ── Constants ────────────────────────────────────────────────────────────────

const JOB_LABELS: Record<string, string> = {
  survey: 'Survey', install: 'Install', inspection: 'Inspection', service: 'Service'
}

const JOB_BADGE: Record<string, string> = {
  survey: 'bg-blue-900 text-blue-200 border-blue-700',
  install: 'bg-green-900 text-green-200 border-green-700',
  inspection: 'bg-amber-900 text-amber-200 border-amber-700',
  service: 'bg-purple-900 text-purple-200 border-purple-700',
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

const JOB_TO_TASK: Record<string, string> = {
  install: 'install_done',
  survey: 'site_survey',
  inspection: 'city_insp',
}

const TASK_DATE: Record<string, string> = {
  install_done: 'install_complete_date',
  site_survey: 'survey_date',
  city_insp: 'city_inspection_date',
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

function mapsLink(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`
}

function telLink(phone: string): string {
  return `tel:${phone.replace(/\D/g, '')}`
}

// ── Types ────────────────────────────────────────────────────────────────────

interface FieldJob {
  id: string
  project_id: string
  crew_id: string
  job_type: string
  date: string
  time: string | null
  notes: string | null
  status: string
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
  stage: string | null
  stage_date: string | null
  blocker: string | null
  survey_date: string | null
  install_complete_date: string | null
  pto_date: string | null
  crew_name: string | null
}

interface SearchResult {
  id: string
  name: string
  city: string | null
  address: string | null
  phone: string | null
  email: string | null
  stage: string | null
  systemkw: number | null
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'success', onDone }: { message: string; type?: 'success' | 'error'; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 5000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className={cn(
      'fixed bottom-20 left-1/2 -translate-x-1/2 z-50 text-sm px-5 py-3 rounded-xl shadow-xl max-w-[90vw] text-center',
      type === 'success' ? 'bg-green-800 text-green-100' : 'bg-red-800 text-red-100'
    )}>
      {message}
    </div>
  )
}

// ── Project Detail Modal ─────────────────────────────────────────────────────

function ProjectDetail({
  project,
  onClose,
  onNoteAdded,
  userName,
  userId,
}: {
  project: Project
  onClose: () => void
  onNoteAdded: () => void
  userName: string | null
  userId: string | null
}) {
  const [noteText, setNoteText] = useState('')
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const address = [project.address, project.city, project.zip].filter(Boolean).join(', ')

  async function handleSendNote() {
    if (!noteText.trim() || !project.id) return
    setSending(true)
    const { error } = await addNote({
      project_id: project.id,
      text: noteText.trim(),
      time: new Date().toISOString(),
      pm: userName,
      pm_id: userId,
    })
    setSending(false)
    if (error) {
      setToast('Failed to add note')
    } else {
      setNoteText('')
      setToast('Note added')
      onNoteAdded()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/95 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white truncate mr-4">{project.name}</h2>
        <button
          onClick={onClose}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-gray-400 active:text-white"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* Customer */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Customer</h3>
          <div className="space-y-2">
            <div className="text-white font-medium">{project.name}</div>
            <div className="text-sm text-gray-400">{project.id}</div>
            {project.phone && (
              <a href={telLink(project.phone)} className="flex items-center gap-3 min-h-[44px] text-green-400 active:text-green-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <span className="text-base">{project.phone}</span>
              </a>
            )}
            {project.email && (
              <a href={`mailto:${project.email}`} className="flex items-center gap-3 min-h-[44px] text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                <span className="text-base">{project.email}</span>
              </a>
            )}
            {address && (
              <a href={mapsLink(address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 min-h-[44px] text-green-400 active:text-green-300">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                <span className="text-base">{address}</span>
              </a>
            )}
          </div>
        </section>

        {/* System */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">System</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {project.systemkw && (
              <div>
                <span className="text-gray-500">Size</span>
                <div className="text-white font-medium">{project.systemkw} kW</div>
              </div>
            )}
            {project.module && (
              <div>
                <span className="text-gray-500">Panels</span>
                <div className="text-white">{project.module_qty ? `${project.module_qty}x ` : ''}{project.module}</div>
              </div>
            )}
          </div>
        </section>

        {/* Status */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Status</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Stage</span>
              <span className="text-white font-medium">{STAGE_LABELS[project.stage] ?? project.stage}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Days in Stage</span>
              <span className="text-white">{daysAgo(project.stage_date)}</span>
            </div>
            {project.blocker && (
              <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-300 text-sm mt-2">
                Blocker: {project.blocker}
              </div>
            )}
          </div>
        </section>

        {/* Key Dates */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Key Dates</h3>
          <div className="space-y-1 text-sm">
            {project.survey_date && (
              <div className="flex justify-between">
                <span className="text-gray-500">Survey</span>
                <span className="text-white">{fmtDate(project.survey_date)}</span>
              </div>
            )}
            {project.install_complete_date && (
              <div className="flex justify-between">
                <span className="text-gray-500">Install</span>
                <span className="text-white">{fmtDate(project.install_complete_date)}</span>
              </div>
            )}
            {project.pto_date && (
              <div className="flex justify-between">
                <span className="text-gray-500">PTO</span>
                <span className="text-white">{fmtDate(project.pto_date)}</span>
              </div>
            )}
          </div>
        </section>

        {/* Add Note */}
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 pb-1 border-b border-gray-800">Add Note</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendNote() }}
              placeholder="Type a note..."
              className="flex-1 min-h-[44px] bg-gray-900 text-white border border-gray-700 rounded-xl px-4 text-base placeholder-gray-600 focus:outline-none focus:border-green-500"
            />
            <button
              onClick={handleSendNote}
              disabled={!noteText.trim() || sending}
              className={cn(
                'min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center transition-colors',
                noteText.trim() && !sending
                  ? 'bg-green-700 text-white active:bg-green-600'
                  : 'bg-gray-800 text-gray-600'
              )}
              aria-label="Send note"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
        </section>
      </div>

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

// ── Job Card ─────────────────────────────────────────────────────────────────

function FieldJobCard({
  job,
  onTap,
  onStatusChange,
  onMarkTaskComplete,
}: {
  job: FieldJob
  onTap: () => void
  onStatusChange: (id: string, status: string) => void
  onMarkTaskComplete: (job: FieldJob) => void
}) {
  const address = [job.customer_address, job.customer_city, job.customer_zip].filter(Boolean).join(', ')
  const status = job.status ?? 'scheduled'
  const jobType = job.job_type ?? 'survey'
  const taskId = JOB_TO_TASK[jobType]

  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
      {/* Card body — tappable for detail */}
      <button onClick={onTap} className="w-full text-left p-4 active:bg-gray-800 transition-colors">
        {/* Top row: badges */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={cn('text-sm px-3 py-1 rounded-full font-medium border', JOB_BADGE[jobType] ?? 'bg-gray-800 text-gray-300 border-gray-700')}>
            {JOB_LABELS[jobType] ?? jobType}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn('w-2.5 h-2.5 rounded-full', STATUS_DOT[status] ?? 'bg-gray-500')} />
            <span className="text-sm text-gray-400">{STATUS_LABEL[status] ?? status}</span>
          </span>
          {job.time && (
            <span className="text-sm text-gray-400 ml-auto">{fmtTime(job.time)}</span>
          )}
        </div>

        {/* Project name — large */}
        <div className="text-xl font-bold text-white mb-1 leading-tight">
          {job.project_name ?? job.project_id}
        </div>

        {/* Address */}
        {address && (
          <div className="text-sm text-gray-400 mb-2">{address}</div>
        )}

        {/* Crew */}
        {job.crew_name && (
          <div className="text-xs text-gray-500">Crew: {job.crew_name}</div>
        )}
      </button>

      {/* Quick actions row */}
      <div className="flex items-center border-t border-gray-800 divide-x divide-gray-800">
        {/* Call */}
        {job.customer_phone ? (
          <a
            href={telLink(job.customer_phone)}
            className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-green-400 active:bg-gray-800 transition-colors"
            aria-label="Call customer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span className="text-sm">Call</span>
          </a>
        ) : (
          <div className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span className="text-sm">Call</span>
          </div>
        )}

        {/* Navigate */}
        {address ? (
          <a
            href={mapsLink(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-blue-400 active:bg-gray-800 transition-colors"
            aria-label="Navigate to address"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span className="text-sm">Navigate</span>
          </a>
        ) : (
          <div className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            <span className="text-sm">Navigate</span>
          </div>
        )}

        {/* Notes (opens detail) */}
        <button
          onClick={onTap}
          className="flex-1 flex items-center justify-center gap-2 min-h-[48px] text-amber-400 active:bg-gray-800 transition-colors"
          aria-label="View details and notes"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
          <span className="text-sm">Notes</span>
        </button>
      </div>

      {/* Status action + Mark Task Complete */}
      {status !== 'complete' && status !== 'cancelled' && (
        <div className="px-4 pb-4 pt-2 space-y-2">
          {/* Job status toggle */}
          {status === 'scheduled' && (
            <button
              onClick={() => onStatusChange(job.id, 'in_progress')}
              className="w-full py-3 rounded-xl font-semibold text-base bg-amber-700 active:bg-amber-500 text-white transition-colors"
            >
              Start Job
            </button>
          )}
          {status === 'in_progress' && (
            <button
              onClick={() => onStatusChange(job.id, 'complete')}
              className="w-full py-3 rounded-xl font-semibold text-base bg-green-700 active:bg-green-500 text-white transition-colors"
            >
              Mark Job Complete
            </button>
          )}
          {/* Mark task complete (if mappable) */}
          {taskId && status === 'in_progress' && (
            <button
              onClick={() => onMarkTaskComplete(job)}
              className="w-full py-3 rounded-xl font-semibold text-base bg-green-900 border border-green-700 active:bg-green-800 text-green-300 transition-colors"
            >
              Mark Task Complete ({JOB_LABELS[jobType]})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

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
      const { data, error } = await (supabaseDb as any)
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

  // Load today's schedule
  const loadJobs = useCallback(async () => {
    const { data: schedData } = await (supabaseDb as any)
      .from('schedule')
      .select('id, crew_id, date, job_type, time, project_id, notes, status')
      .eq('date', todayIso)
      .neq('status', 'cancelled')
      .order('time')

    if (schedData) {
      const rawJobs = schedData as Schedule[]

      // Fetch project details
      const pids = [...new Set(rawJobs.map((j: any) => j.project_id).filter(Boolean))]
      const projMap: Record<string, any> = {}
      if (pids.length > 0) {
        const { data: projData, error: projError } = await (supabase as any)
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
      const { data } = await (supabase as any)
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

  // Status change handler
  async function handleStatusChange(jobId: string, newStatus: string) {
    if (!navigator.onLine) {
      setToast({ message: 'No internet connection', type: 'error' })
      return
    }
    const { error } = await (supabaseDb as any)
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
        const taskId = JOB_TO_TASK[job.job_type]
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
            const dateField = TASK_DATE[taskId]
            if (dateField) {
              const { data: proj } = await (supabase as any).from('projects').select(dateField).eq('id', job.project_id).single()
              if (proj && !(proj as any)[dateField]) {
                await (supabaseDb as any).from('projects').update({ [dateField]: todayStr }).eq('id', job.project_id)
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
    const taskId = JOB_TO_TASK[job.job_type]
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
    const dateField = TASK_DATE[taskId]
    if (dateField) {
      try {
        const { data: proj } = await (supabase as any).from('projects').select(dateField).eq('id', job.project_id).single()
        if (proj && !(proj as any)[dateField]) {
          await (supabaseDb as any).from('projects').update({ [dateField]: todayStr }).eq('id', job.project_id)
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
      <div className="min-h-dvh bg-gray-950 px-4 pt-16 space-y-4">
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
    <div className="min-h-dvh bg-gray-950 flex flex-col pb-[env(safe-area-inset-bottom)]">
      {/* Header */}
      <header className="bg-gray-950 border-b border-gray-800 px-4 py-3 flex-shrink-0 sticky top-0 z-40">
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

      {/* Search bar */}
      <div className="bg-gray-950 border-b border-gray-800 px-4 py-3 flex-shrink-0 relative">
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

        {/* Stats bar */}
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
        <div className="fixed inset-0 z-50 bg-gray-950/90 flex items-center justify-center">
          <div className="text-green-400 text-base animate-pulse">Loading project...</div>
        </div>
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
