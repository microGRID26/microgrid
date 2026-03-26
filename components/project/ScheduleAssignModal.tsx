'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { clearQueryCache } from '@/lib/hooks'
import type { Crew, Project, Schedule } from '@/types/database'

const JOB_TYPES = [
  { value: 'survey',     label: 'Site Survey'    },
  { value: 'install',    label: 'Installation'   },
  { value: 'inspection', label: 'Inspection'     },
  { value: 'service',    label: 'Service Call'   },
]

interface Props {
  crewId: string | null
  date: string
  scheduleId: string | null   // null = new, string = edit
  projectId: string | null    // pre-fill project
  jobType: string
  crews: Crew[]
  onClose: () => void
  onSaved: () => void
}

export function ScheduleAssignModal({ crewId, date, scheduleId, projectId, jobType, crews, onClose, onSaved }: Props) {
  const supabase = db()

  // Lock background scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const [form, setForm] = useState({
    crew_id: crewId ?? (crews[0]?.id ?? ''),
    date,
    end_date: '',
    job_type: jobType,
    time: '08:00',
    notes: '',
    project_id: projectId ?? '',
    status: 'scheduled',
  })
  const [installDetails, setInstallDetails] = useState({
    arrival_window: '',
    arrays: '',
    pitch: '',
    stories: '',
    special_equipment: '',
    electrical_notes: '',
    wind_speed: '',
    risk_category: '',
    travel_adder: '',
    wifi_info: '',
    msp_upgrade: '',
  })
  const [installOpen, setInstallOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [projectResults, setProjectResults] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [existingJob, setExistingJob] = useState<Schedule | null>(null)
  const [error, setError] = useState<string | null>(null)

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function setInstall(field: string, value: string) {
    setInstallDetails(d => ({ ...d, [field]: value }))
  }

  // Load existing job if editing
  useEffect(() => {
    if (!scheduleId) return
    ;supabase.from('schedule').select('*').eq('id', scheduleId).single().then(({ data }: any) => {
      if (data) {
        setExistingJob(data)
        setForm({
          crew_id: data.crew_id,
          date: data.date,
          end_date: data.end_date ?? '',
          job_type: data.job_type,
          time: data.time ?? '08:00',
          notes: data.notes ?? '',
          project_id: data.project_id,
          status: data.status,
        })
        // Populate install detail fields from existing record
        setInstallDetails({
          arrival_window: data.arrival_window ?? '',
          arrays: data.arrays != null ? String(data.arrays) : '',
          pitch: data.pitch ?? '',
          stories: data.stories ?? '',
          special_equipment: data.special_equipment ?? '',
          electrical_notes: data.electrical_notes ?? '',
          wind_speed: data.wind_speed ?? '',
          risk_category: data.risk_category ?? '',
          travel_adder: data.travel_adder ?? '',
          wifi_info: data.wifi_info ?? '',
          msp_upgrade: data.msp_upgrade ?? '',
        })
        // Auto-expand install details if any field has data
        if (data.job_type === 'install') {
          const hasData = data.arrival_window || data.arrays || data.pitch || data.stories ||
            data.special_equipment || data.electrical_notes || data.wind_speed ||
            data.risk_category || data.travel_adder || data.wifi_info || data.msp_upgrade
          if (hasData) setInstallOpen(true)
        }
      }
    })
  }, [scheduleId])

  // Load pre-filled project
  useEffect(() => {
    if (!projectId) return
    supabase.from('projects').select('id,name,city,pm').eq('id', projectId).single().then(({ data }: any) => {
      if (data) setSelectedProject(data as Project)
    })
  }, [projectId])

  // Project search
  useEffect(() => {
    if (!projectSearch.trim() || projectSearch.length < 2) { setProjectResults([]); return }
    const q = projectSearch.toLowerCase()
    supabase.from('projects').select('id,name,city,pm')
      .or(`name.ilike.%${escapeIlike(q)}%,id.ilike.%${escapeIlike(q)}%,city.ilike.%${escapeIlike(q)}%`)
      .neq('stage', 'complete')
      .limit(8)
      .then(({ data }: any) => { if (data) setProjectResults(data as Project[]) })
  }, [projectSearch])

  // Check conflict — handles multi-day ranges
  useEffect(() => {
    if (!form.crew_id || !form.date) { setConflict(null); return }
    const rangeEnd = form.end_date || form.date
    // Find jobs that overlap with the date range [form.date, rangeEnd]
    // A job overlaps if: job.date <= rangeEnd AND (job.end_date >= form.date OR (job.end_date IS NULL AND job.date >= form.date))
    ;supabase.from('schedule')
      .select('id,project_id,date,end_date')
      .eq('crew_id', form.crew_id)
      .lte('date', rangeEnd)
      .neq('status', 'cancelled')
      .then(({ data }: any) => {
        if (!data) { setConflict(null); return }
        const others = data.filter((s: any) => {
          if (s.id === scheduleId) return false
          const jobEnd = s.end_date || s.date
          // Overlap: job starts <= our end AND job ends >= our start
          return jobEnd >= form.date
        })
        if (others.length > 0) {
          setConflict(`${others.length} job${others.length > 1 ? 's' : ''} already scheduled for this crew in this date range`)
        } else {
          setConflict(null)
        }
      })
  }, [form.crew_id, form.date, form.end_date, scheduleId])

  async function save() {
    if (!form.project_id && !selectedProject?.id) return
    setSaving(true)
    setError(null)
    const pid = selectedProject?.id ?? form.project_id
    // Validate end_date >= date if set
    if (form.end_date && form.end_date < form.date) {
      setError('End date cannot be before start date')
      return
    }

    const record: Record<string, any> = {
      crew_id: form.crew_id,
      project_id: pid,
      date: form.date,
      end_date: form.end_date || null,
      job_type: form.job_type,
      time: form.time || null,
      notes: form.notes || null,
      status: form.status,
    }
    // Include install detail fields when job_type is install
    if (form.job_type === 'install') {
      record.arrival_window = installDetails.arrival_window || null
      record.arrays = installDetails.arrays ? Number(installDetails.arrays) : null
      record.pitch = installDetails.pitch || null
      record.stories = installDetails.stories || null
      record.special_equipment = installDetails.special_equipment || null
      record.electrical_notes = installDetails.electrical_notes || null
      record.wind_speed = installDetails.wind_speed || null
      record.risk_category = installDetails.risk_category || null
      record.travel_adder = installDetails.travel_adder || null
      record.wifi_info = installDetails.wifi_info || null
      record.msp_upgrade = installDetails.msp_upgrade || null
    }
    // Auto-populate PM from the project if not already set
    if (!scheduleId) {
      try {
        const { data: projPm } = await supabase.from('projects').select('pm, pm_id').eq('id', pid).single()
        if (projPm) {
          record.pm = projPm.pm
          record.pm_id = projPm.pm_id
        }
      } catch (e) {
        // Best-effort — don't block the save
      }
    }

    let result
    if (scheduleId) {
      result = await supabase.from('schedule').update(record).eq('id', scheduleId)
    } else {
      result = await supabase.from('schedule').insert({ id: crypto.randomUUID(), ...record })
    }
    setSaving(false)
    if (result.error) {
      setError(result.error.message ?? 'Failed to save job. Please try again.')
      return
    }

    // Fix 2: When creating a NEW schedule entry, mark the scheduling task as "Scheduled"
    if (!scheduleId) {
      const JOB_TO_SCHED_TASK: Record<string, string> = {
        install: 'sched_install',
        survey: 'sched_survey',
        inspection: 'sched_city',
      }
      const schedTaskId = JOB_TO_SCHED_TASK[form.job_type]
      if (schedTaskId) {
        try {
          await supabase.from('task_state').upsert({
            project_id: pid,
            task_id: schedTaskId,
            status: 'Scheduled',
          }, { onConflict: 'project_id,task_id' })
        } catch (e) {
          // Best-effort — don't block the save callback
          console.error('Failed to mark scheduling task:', e)
        }
      }
    }

    // Clear query cache so useSupabaseQuery hooks refetch fresh data
    clearQueryCache()

    // When saving with status 'complete' (edit or new), auto-complete the job task
    if (form.status === 'complete') {
      const JOB_TO_TASK: Record<string, string> = {
        install: 'install_done',
        survey: 'site_survey',
        inspection: 'city_insp',
      }
      const taskId = JOB_TO_TASK[form.job_type]
      if (taskId) {
        const today = new Date().toISOString().slice(0, 10)
        try {
          await supabase.from('task_state').upsert({
            project_id: pid,
            task_id: taskId,
            status: 'Complete',
            completed_date: today,
            started_date: today,
          }, { onConflict: 'project_id,task_id' })

          await supabase.from('task_history').insert({
            project_id: pid,
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
            const { data: proj } = await supabase.from('projects').select(dateField).eq('id', pid).single()
            if (proj && !(proj as Record<string, unknown>)[dateField]) {
              const { error: dateErr } = await supabase.from('projects').update({ [dateField]: today }).eq('id', pid)
              if (dateErr) console.error('date field update failed:', dateErr)
            }
          }
        } catch (e) {
          console.error('Failed to auto-complete task:', e)
        }
      }
    }

    onSaved()
  }

  async function deleteJob() {
    if (!scheduleId) return
    setDeleting(true)
    setError(null)
    const result = await supabase.from('schedule').update({ status: 'cancelled' }).eq('id', scheduleId)
    setDeleting(false)
    if (result.error) {
      setError(result.error.message ?? 'Failed to cancel job. Please try again.')
      return
    }
    clearQueryCache()
    onSaved()
  }

  const inputCls = "w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none placeholder-gray-500"
  const labelCls = "text-xs text-gray-400 mb-1 block"
  const canSave = !!(selectedProject?.id ?? form.project_id) && form.crew_id && form.date

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-sm font-bold text-white">{scheduleId ? 'Edit Scheduled Job' : 'Schedule Job'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Project search */}
          <div>
            <label className={labelCls}>Project *</label>
            {selectedProject ? (
              <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-green-600">
                <div className="flex-1">
                  <div className="text-xs font-medium text-white">{selectedProject.name}</div>
                  <div className="text-xs text-gray-400">{selectedProject.id} - {selectedProject.city}</div>
                </div>
                <button onClick={() => { setSelectedProject(null); set('project_id', '') }}
                  className="text-gray-500 hover:text-white text-xs">x</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  className={inputCls}
                  placeholder="Search by name, ID, or city..."
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  autoFocus={!projectId}
                />
                {projectResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg mt-1 z-10 overflow-hidden">
                    {projectResults.map(p => (
                      <div key={p.id} onClick={() => { setSelectedProject(p); setProjectSearch(''); setProjectResults([]) }}
                        className="px-3 py-2 hover:bg-gray-700 cursor-pointer">
                        <div className="text-xs font-medium text-white">{p.name}</div>
                        <div className="text-xs text-gray-400">{p.id} - {p.city}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Crew */}
          <div>
            <label className={labelCls}>Crew *</label>
            <select className={inputCls} value={form.crew_id} onChange={e => set('crew_id', e.target.value)}>
              {crews.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.warehouse ? ` - ${c.warehouse}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Date */}
            <div>
              <label className={labelCls}>Date *</label>
              <input className={inputCls} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            {/* End Date (multi-day) */}
            <div>
              <label className={labelCls}>End Date</label>
              <input className={inputCls} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                min={form.date} placeholder="Single day" />
            </div>
            {/* Time */}
            <div>
              <label className={labelCls}>Time</label>
              <input className={inputCls} type="time" value={form.time} onChange={e => set('time', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Job type */}
            <div>
              <label className={labelCls}>Job Type</label>
              <select className={inputCls} value={form.job_type} onChange={e => set('job_type', e.target.value)}>
                {JOB_TYPES.map(j => <option key={j.value} value={j.value}>{j.label}</option>)}
              </select>
            </div>
            {/* Status */}
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In Progress</option>
                <option value="complete">Complete</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}>Notes</label>
            <textarea className={inputCls} rows={2} placeholder="Optional notes..."
              value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          {/* Install Details — collapsible, only visible for install job type */}
          {form.job_type === 'install' && (
            <div className="border border-gray-700 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setInstallOpen(o => !o)}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-750 text-xs font-medium text-gray-300 transition-colors"
              >
                <span>Install Details</span>
                <span className="text-gray-500">{installOpen ? '▲' : '▼'}</span>
              </button>
              {installOpen && (
                <div className="p-3 space-y-3 bg-gray-850">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Arrival Window</label>
                      <input className={inputCls} placeholder="e.g. 7-9"
                        value={installDetails.arrival_window} onChange={e => setInstall('arrival_window', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Arrays</label>
                      <input className={inputCls} type="number" placeholder="e.g. 2"
                        value={installDetails.arrays} onChange={e => setInstall('arrays', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Pitch</label>
                      <input className={inputCls} placeholder="e.g. 26,27"
                        value={installDetails.pitch} onChange={e => setInstall('pitch', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Stories</label>
                      <select className={inputCls} value={installDetails.stories} onChange={e => setInstall('stories', e.target.value)}>
                        <option value="">Select...</option>
                        <option value="Single Story">Single Story</option>
                        <option value="Two Story">Two Story</option>
                        <option value="Three Story">Three Story</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Special Equipment</label>
                    <input className={inputCls} placeholder="e.g. Crane, lift..."
                      value={installDetails.special_equipment} onChange={e => setInstall('special_equipment', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>MSP Upgrade</label>
                      <select className={inputCls} value={installDetails.msp_upgrade} onChange={e => setInstall('msp_upgrade', e.target.value)}>
                        <option value="">Select...</option>
                        <option value="No">No</option>
                        <option value="Yes - 100A to 200A">Yes - 100A to 200A</option>
                        <option value="Yes - 200A to 400A">Yes - 200A to 400A</option>
                        <option value="Yes - Other">Yes - Other</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>WiFi Info</label>
                      <input className={inputCls} placeholder="e.g. Customer will provide"
                        value={installDetails.wifi_info} onChange={e => setInstall('wifi_info', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Wind Speed</label>
                      <input className={inputCls} placeholder="e.g. 126 VMPH"
                        value={installDetails.wind_speed} onChange={e => setInstall('wind_speed', e.target.value)} />
                    </div>
                    <div>
                      <label className={labelCls}>Risk Category</label>
                      <select className={inputCls} value={installDetails.risk_category} onChange={e => setInstall('risk_category', e.target.value)}>
                        <option value="">Select...</option>
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Travel Adder</label>
                    <select className={inputCls} value={installDetails.travel_adder} onChange={e => setInstall('travel_adder', e.target.value)}>
                      <option value="">Select...</option>
                      <option value="0-60 miles">0-60 miles</option>
                      <option value="61-120 miles">61-120 miles</option>
                      <option value="121-180 miles">121-180 miles</option>
                      <option value="180+ miles">180+ miles</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Electrical Notes</label>
                    <textarea className={inputCls} rows={3} placeholder="Electrical notes for the crew..."
                      value={installDetails.electrical_notes} onChange={e => setInstall('electrical_notes', e.target.value)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Conflict warning */}
          {conflict && (
            <div className="text-xs text-amber-400 bg-amber-950 rounded-lg px-3 py-2">Warning: {conflict}</div>
          )}

          {/* Error message */}
          {error && (
            <div className="text-xs text-red-400 bg-red-950 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-800 flex-shrink-0">
          {scheduleId && (
            <button onClick={deleteJob} disabled={deleting}
              className="text-xs px-3 py-2 bg-red-900 hover:bg-red-800 text-red-300 rounded-lg transition-colors disabled:opacity-50">
              {deleting ? 'Cancelling...' : 'Cancel Job'}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-xs px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving || !canSave}
            className="text-xs px-5 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-medium rounded-lg transition-colors">
            {saving ? 'Saving...' : scheduleId ? 'Update Job' : 'Schedule Job'}
          </button>
        </div>
      </div>
    </div>
  )
}
