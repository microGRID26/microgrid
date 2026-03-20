'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { escapeIlike } from '@/lib/utils'
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
  const supabase = createClient()
  const [form, setForm] = useState({
    crew_id: crewId ?? (crews[0]?.id ?? ''),
    date,
    job_type: jobType,
    time: '08:00',
    notes: '',
    project_id: projectId ?? '',
    status: 'scheduled',
  })
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

  // Load existing job if editing
  useEffect(() => {
    if (!scheduleId) return
    ;(supabase as any).from('schedule').select('*').eq('id', scheduleId).single().then(({ data }: any) => {
      if (data) {
        setExistingJob(data)
        setForm({
          crew_id: data.crew_id,
          date: data.date,
          job_type: data.job_type,
          time: data.time ?? '08:00',
          notes: data.notes ?? '',
          project_id: data.project_id,
          status: data.status,
        })
      }
    })
  }, [scheduleId])

  // Load pre-filled project
  useEffect(() => {
    if (!projectId) return
    supabase.from('projects').select('id,name,city,pm').eq('id', projectId).single().then(({ data }) => {
      if (data) setSelectedProject(data as any)
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
      .then(({ data }) => { if (data) setProjectResults(data as any) })
  }, [projectSearch])

  // Check conflict
  useEffect(() => {
    if (!form.crew_id || !form.date) { setConflict(null); return }
    ;(supabase as any).from('schedule')
      .select('id,project_id')
      .eq('crew_id', form.crew_id)
      .eq('date', form.date)
      .neq('status', 'cancelled')
      .then(({ data }: any) => {
        if (!data) { setConflict(null); return }
        const others = data.filter((s: any) => s.id !== scheduleId)
        if (others.length > 0) {
          setConflict(`${others.length} job${others.length > 1 ? 's' : ''} already scheduled for this crew on this day`)
        } else {
          setConflict(null)
        }
      })
  }, [form.crew_id, form.date, scheduleId])

  async function save() {
    if (!form.project_id && !selectedProject?.id) return
    setSaving(true)
    setError(null)
    const pid = selectedProject?.id ?? form.project_id
    const record = {
      crew_id: form.crew_id,
      project_id: pid,
      date: form.date,
      job_type: form.job_type,
      time: form.time || null,
      notes: form.notes || null,
      status: form.status,
    }
    let result
    if (scheduleId) {
      result = await (supabase as any).from('schedule').update(record).eq('id', scheduleId)
    } else {
      result = await (supabase as any).from('schedule').insert(record)
    }
    setSaving(false)
    if (result.error) {
      setError(result.error.message ?? 'Failed to save job. Please try again.')
      return
    }
    onSaved()
  }

  async function deleteJob() {
    if (!scheduleId) return
    setDeleting(true)
    setError(null)
    const result = await (supabase as any).from('schedule').update({ status: 'cancelled' }).eq('id', scheduleId)
    setDeleting(false)
    if (result.error) {
      setError(result.error.message ?? 'Failed to cancel job. Please try again.')
      return
    }
    onSaved()
  }

  const inputCls = "w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none placeholder-gray-500"
  const labelCls = "text-xs text-gray-400 mb-1 block"
  const canSave = !!(selectedProject?.id ?? form.project_id) && form.crew_id && form.date

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-bold text-white">{scheduleId ? 'Edit Scheduled Job' : 'Schedule Job'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Project search */}
          <div>
            <label className={labelCls}>Project *</label>
            {selectedProject ? (
              <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 border border-green-600">
                <div className="flex-1">
                  <div className="text-xs font-medium text-white">{selectedProject.name}</div>
                  <div className="text-xs text-gray-400">{selectedProject.id} · {(selectedProject as any).city}</div>
                </div>
                <button onClick={() => { setSelectedProject(null); set('project_id', '') }}
                  className="text-gray-500 hover:text-white text-xs">✕</button>
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
                        <div className="text-xs text-gray-400">{p.id} · {(p as any).city}</div>
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
                <option key={c.id} value={c.id}>{c.name}{c.warehouse ? ` · ${c.warehouse}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Date */}
            <div>
              <label className={labelCls}>Date *</label>
              <input className={inputCls} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
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

          {/* Conflict warning */}
          {conflict && (
            <div className="text-xs text-amber-400 bg-amber-950 rounded-lg px-3 py-2">⚠ {conflict}</div>
          )}

          {/* Error message */}
          {error && (
            <div className="text-xs text-red-400 bg-red-950 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-800">
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
