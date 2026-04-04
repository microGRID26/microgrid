'use client'

import { useState, useEffect } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { JOB_TYPES, JOB_SCHEDULE_TASK, JOB_COMPLETE_TASK, JOB_COMPLETE_DATE } from '@/lib/tasks'
import { clearQueryCache } from '@/lib/hooks'
import type { Crew, Project } from '@/types/database'

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
    wifi_info: '',
    msp_upgrade: '',
  })
  const [serviceDetail, setServiceDetail] = useState('')
  const [reinstallDate, setReinstallDate] = useState('')
  const [ahjInfo, setAhjInfo] = useState<{ name: string; phone: string | null; permit_required: boolean } | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [projectSearch, setProjectSearch] = useState('')
  const [projectResults, setProjectResults] = useState<Project[]>([])
  const [driveUrl, setDriveUrl] = useState<string | null>(null)
  const [plansetUrl, setPlansetUrl] = useState<string | null>(null)
  const [plansetName, setPlansetName] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Look up the planset file from project_files (Design/Planset folder)
  function lookupPlanset(projectId: string) {
    setPlansetUrl(null)
    setPlansetName(null)
    supabase.from('project_files')
      .select('file_name, file_url, folder_name')
      .eq('project_id', projectId)
      .or('folder_name.ilike.%planset%,folder_name.ilike.%design%')
      .order('file_name')
      .limit(10)
      .then(({ data }: any) => {
        if (!data || data.length === 0) return
        // Prefer files with "planset" in folder name, then in file name
        const plansetFile = data.find((f: any) => /planset/i.test(f.folder_name ?? ''))
          ?? data.find((f: any) => /planset/i.test(f.file_name ?? ''))
          ?? data[0]
        if (plansetFile?.file_url) {
          setPlansetUrl(plansetFile.file_url)
          setPlansetName(plansetFile.file_name)
        }
      })
  }

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function setInstall(field: string, value: string) {
    setInstallDetails(d => ({ ...d, [field]: value }))
  }

  // Load existing job if editing
  useEffect(() => {
    if (!scheduleId) return
    ;supabase.from('schedule').select('*').eq('id', scheduleId).single().then(({ data }: { data: Record<string, string | number | boolean | null> | null }) => {
      if (data) {
        setForm({
          crew_id: String(data.crew_id),
          date: String(data.date),
          end_date: data.end_date ? String(data.end_date) : '',
          job_type: String(data.job_type),
          time: data.time ? String(data.time) : '08:00',
          notes: data.notes ? String(data.notes) : '',
          project_id: String(data.project_id),
          status: String(data.status),
        })
        setInstallDetails({
          arrival_window: data.arrival_window ? String(data.arrival_window) : '',
          arrays: data.arrays != null ? String(data.arrays) : '',
          pitch: data.pitch ? String(data.pitch) : '',
          stories: data.stories ? String(data.stories) : '',
          special_equipment: data.special_equipment ? String(data.special_equipment) : '',
          electrical_notes: data.electrical_notes ? String(data.electrical_notes) : '',
          wifi_info: data.wifi_info ? String(data.wifi_info) : '',
          msp_upgrade: data.msp_upgrade ? String(data.msp_upgrade) : '',
        })
        if (data.job_type === 'install' || data.job_type === 'service') {
          const hasData = data.arrival_window || data.arrays || data.pitch || data.stories ||
            data.special_equipment || data.electrical_notes || data.wifi_info || data.msp_upgrade
          if (hasData) setInstallOpen(true)
        }
        if (data.project_id) {
          supabase.from('projects').select('id,name,city,pm,phone,address,zip,financier,financing_type,consultant,systemkw,module,module_qty,inverter,battery,battery_qty,utility,ahj,esid,org_id')
            .eq('id', data.project_id).single().then(({ data: proj }: { data: Project | null }) => {
              if (proj) {
                setSelectedProject(proj)
                if (proj.ahj) {
                  supabase.from('ahjs').select('name, permit_phone, permit_required').eq('name', proj.ahj).maybeSingle()
                    .then(({ data: ahjData }: { data: { name: string; permit_phone: string | null; permit_required: boolean } | null }) => { if (ahjData) setAhjInfo({ name: ahjData.name, phone: ahjData.permit_phone, permit_required: ahjData.permit_required ?? true }) })
                }
                supabase.from('project_folders').select('folder_url').eq('project_id', proj.id).maybeSingle()
                  .then(({ data: folderData }: { data: { folder_url: string | null } | null }) => { if (folderData?.folder_url) setDriveUrl(folderData.folder_url) })
                lookupPlanset(proj.id)
              }
            })
        }
      }
    })
  }, [scheduleId])

  // Load pre-filled project
  useEffect(() => {
    if (!projectId) return
    supabase.from('projects').select('id,name,city,pm,phone,address,zip,financier,financing_type,consultant,systemkw,module,module_qty,inverter,battery,battery_qty,utility,ahj,esid,org_id').eq('id', projectId).single().then(({ data }: { data: Project | null }) => {
      if (data) {
        setSelectedProject(data)
        if (data.ahj) {
          supabase.from('ahjs').select('name, permit_phone, permit_required').eq('name', data.ahj).maybeSingle()
            .then(({ data: ahjData }: { data: { name: string; permit_phone: string | null; permit_required: boolean } | null }) => { if (ahjData) setAhjInfo({ name: ahjData.name, phone: ahjData.permit_phone, permit_required: ahjData.permit_required ?? true }) })
        }
        supabase.from('project_folders').select('folder_url').eq('project_id', data.id).maybeSingle()
          .then(({ data: folderData }: { data: { folder_url: string | null } | null }) => { if (folderData?.folder_url) setDriveUrl(folderData.folder_url) })
        lookupPlanset(data.id)
      }
    })
  }, [projectId])

  // Project search — debounced with stale-check
  useEffect(() => {
    if (!projectSearch.trim() || projectSearch.length < 2) { setProjectResults([]); return }
    let stale = false
    const timer = setTimeout(() => {
      const q = projectSearch.toLowerCase()
      supabase.from('projects').select('id,name,city,pm,phone,address,zip,financier,financing_type,consultant,systemkw,module,module_qty,inverter,battery,battery_qty,utility,ahj,esid,org_id')
        .or(`name.ilike.%${escapeIlike(q)}%,id.ilike.%${escapeIlike(q)}%,city.ilike.%${escapeIlike(q)}%`)
        .neq('stage', 'complete')
        .limit(8)
        .then(({ data }: { data: Project[] | null }) => { if (data && !stale) setProjectResults(data) })
    }, 200)
    return () => { stale = true; clearTimeout(timer) }
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
      .then(({ data }: { data: { id: string; date: string; end_date?: string | null }[] | null }) => {
        if (!data) { setConflict(null); return }
        const others = data.filter(s => {
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
      setSaving(false)
      return
    }

    // WiFi reminder for install jobs
    if (form.job_type === 'install' && !installDetails.wifi_info) {
      if (!confirm('WiFi Info is not filled out. The crew will need WiFi access for monitoring setup.\n\nContinue without WiFi info?')) { setSaving(false); return }
    }

    const record: Record<string, string | number | boolean | null> = {
      crew_id: form.crew_id,
      project_id: pid,
      date: form.date,
      end_date: form.end_date || null,
      job_type: form.job_type,
      time: form.time || null,
      notes: form.notes || null,
      status: form.status,
      org_id: selectedProject?.org_id ?? null,
    }
    // Include install detail fields when job_type is install
    if (form.job_type === 'install') {
      record.arrival_window = installDetails.arrival_window || null
      record.arrays = installDetails.arrays ? Number(installDetails.arrays) : null
      record.pitch = installDetails.pitch || null
      record.stories = installDetails.stories || null
      record.special_equipment = installDetails.special_equipment || null
      record.electrical_notes = installDetails.electrical_notes || null
      record.wifi_info = installDetails.wifi_info || null
      record.msp_upgrade = installDetails.msp_upgrade || null
    }

    // R&R: auto-create reinstall schedule entry if Removal with reinstall date
    if (form.job_type === 'service' && serviceDetail === 'removal' && reinstallDate) {
      const reinstallId = crypto.randomUUID()
      const reinstallRecord: Record<string, string | number | boolean | null> = {
        id: reinstallId, project_id: pid, crew_id: form.crew_id,
        job_type: 'service', date: reinstallDate, status: 'scheduled',
        notes: `[Reinstall] Linked to removal on ${form.date}. ${form.notes ?? ''}`,
      }
      // Inherit org_id from the project
      if (selectedProject?.org_id) reinstallRecord.org_id = selectedProject.org_id
      await supabase.from('schedule').insert(reinstallRecord)
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
      const schedTaskId = JOB_SCHEDULE_TASK[form.job_type]
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
      const taskId = JOB_COMPLETE_TASK[form.job_type]
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
          const dateField = JOB_COMPLETE_DATE[taskId]
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
              <div className="bg-gray-800 rounded-lg px-3 py-2 border border-green-600 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-white">{selectedProject.name}</div>
                  <button onClick={() => { setSelectedProject(null); set('project_id', ''); setDriveUrl(null); setPlansetUrl(null); setPlansetName(null) }}
                    className="text-gray-500 hover:text-white text-xs">x</button>
                </div>
                <div className="text-[10px] text-gray-400">{selectedProject.id} · {selectedProject.city}{selectedProject.zip ? `, ${selectedProject.zip}` : ''}</div>
                {selectedProject.address && (
                  <div className="text-[10px] text-gray-300">
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedProject.address}, ${selectedProject.city} TX ${selectedProject.zip ?? ''}`)}`}
                      target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                      {selectedProject.address}
                    </a>
                  </div>
                )}
                {selectedProject.phone && (
                  <div className="text-[10px] text-gray-300">
                    <a href={`tel:${selectedProject.phone}`} className="text-blue-400 hover:text-blue-300">{selectedProject.phone}</a>
                  </div>
                )}
                {ahjInfo && (
                  <div className="text-[10px] text-gray-300">
                    AHJ: <span className="text-white font-medium">{ahjInfo.name}</span>
                    {ahjInfo.phone && <> · <a href={`tel:${ahjInfo.phone}`} className="text-blue-400 hover:text-blue-300">{ahjInfo.phone}</a></>}
                    <span className={`ml-1 ${ahjInfo.permit_required ? 'text-amber-400' : 'text-green-400'}`}>
                      ({ahjInfo.permit_required ? 'Permit required' : 'No permit'})
                    </span>
                  </div>
                )}
                <div className="flex gap-2 mt-1 flex-wrap">
                  {plansetUrl && (
                    <a href={plansetUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-green-400 hover:text-green-300 font-medium">
                      📄 {plansetName ?? 'Planset'} →
                    </a>
                  )}
                  {driveUrl && (
                    <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-green-400/70 hover:text-green-300">Project Folder →</a>
                  )}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selectedProject.address ?? ''}, ${selectedProject.city ?? ''} TX`)}`}
                    target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[10px] text-blue-400 hover:text-blue-300">Google Maps →</a>
                  <a href={`/pipeline?open=${selectedProject.id}`} target="_blank" className="text-[10px] text-purple-400 hover:text-purple-300">MicroGRID →</a>
                  <a href={`/tickets?project=${selectedProject.id}`} target="_blank" className="text-[10px] text-amber-400 hover:text-amber-300">Create Ticket →</a>
                  <a href={`/redesign?project=${selectedProject.id}`} target="_blank" className="text-[10px] text-cyan-400 hover:text-cyan-300">Redesign Tool →</a>
                </div>
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
                      <div key={p.id} onClick={() => {
                        setSelectedProject(p); setProjectSearch(''); setProjectResults([]); setDriveUrl(null); setPlansetUrl(null); setPlansetName(null); setAhjInfo(null)
                        const pid = p.id
                        // Load Google Drive folder URL
                        supabase.from('project_folders').select('folder_url').eq('project_id', pid).maybeSingle()
                          .then(({ data }: { data: { folder_url: string | null } | null }) => { if (data?.folder_url) setDriveUrl(data.folder_url) })
                        lookupPlanset(pid)
                        // Load AHJ info
                        if (p.ahj) {
                          supabase.from('ahjs').select('name, permit_phone, permit_required').eq('name', p.ahj).maybeSingle()
                            .then(({ data }: { data: { name: string; permit_phone: string | null; permit_required: boolean } | null }) => { if (data) setAhjInfo({ name: data.name, phone: data.permit_phone, permit_required: data.permit_required ?? true }) })
                        }
                      }}
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
              {form.job_type === 'service' && (
                <div className="mt-2">
                  <label className={labelCls}>Service Detail</label>
                  <select className={inputCls} value={serviceDetail} onChange={e => setServiceDetail(e.target.value)}>
                    <option value="">Regular Service</option>
                    <option value="removal">Removal (R&R)</option>
                    <option value="reinstall">Reinstall (R&R)</option>
                  </select>
                  {serviceDetail === 'removal' && (
                    <div className="mt-2">
                      <label className={labelCls}>Reinstall Date</label>
                      <input type="date" className={inputCls} value={reinstallDate} onChange={e => setReinstallDate(e.target.value)} />
                      <p className="text-[9px] text-gray-500 mt-0.5">Auto-creates a reinstall job on this date</p>
                    </div>
                  )}
                </div>
              )}
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
            <div className="flex items-center justify-between">
              <label className={labelCls}>Notes</label>
              {selectedProject && form.job_type === 'install' && (
                <button type="button" onClick={() => {
                  setInstallDetails(d => ({
                    ...d,
                    msp_upgrade: d.msp_upgrade || (selectedProject.msp_bus_rating ? `Yes - ${selectedProject.msp_bus_rating}` : ''),
                  }))
                  setInstallOpen(true)
                }}
                  className="text-[10px] px-2 py-0.5 bg-green-900/40 text-green-400 rounded hover:opacity-80 mb-1">
                  Auto-Fill Details
                </button>
              )}
            </div>
            <textarea className={inputCls} rows={4} placeholder="Optional notes..."
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
                        <option value="Split Level">Split Level</option>
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
