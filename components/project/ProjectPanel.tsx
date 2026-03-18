'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt$, fmtDate, daysAgo, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import type { Project, Note } from '@/types/database'
import { BomTab } from './BomTab'

// ── TASK DEFINITIONS ──────────────────────────────────────────────────────────
const TASKS: Record<string, { id: string; name: string; pre: string[]; req: boolean }[]> = {
  evaluation: [
    { id: 'welcome',      name: 'Welcome Call',               pre: [],                req: true  },
    { id: 'ia',           name: 'IA Confirmation',            pre: [],                req: true  },
    { id: 'ub',           name: 'UB Confirmation',            pre: [],                req: true  },
    { id: 'sched_survey', name: 'Schedule Site Survey',       pre: [],                req: true  },
    { id: 'ntp',          name: 'NTP Procedure',              pre: [],                req: true  },
  ],
  survey: [
    { id: 'site_survey',  name: 'Site Survey',                pre: ['sched_survey'],  req: true  },
    { id: 'survey_review',name: 'Survey Review',              pre: ['site_survey'],   req: true  },
  ],
  design: [
    { id: 'build_design', name: 'Build Design',               pre: ['survey_review'], req: true  },
    { id: 'scope',        name: 'Scope of Work',              pre: ['build_design'],  req: true  },
    { id: 'monitoring',   name: 'Monitoring',                 pre: ['scope'],         req: true  },
    { id: 'build_eng',    name: 'Build Engineering',          pre: ['scope'],         req: true  },
    { id: 'eng_approval', name: 'Engineering Approval',       pre: ['build_eng'],     req: true  },
    { id: 'stamps',       name: 'Stamps Required',            pre: ['eng_approval'],  req: true  },
    { id: 'wp1',          name: 'WP1',                        pre: ['scope'],         req: false },
    { id: 'prod_add',     name: 'Production Addendum',        pre: ['scope'],         req: false },
    { id: 'new_ia',       name: 'Create New IA',              pre: ['scope'],         req: false },
    { id: 'reroof',       name: 'Reroof Procedure',           pre: ['scope'],         req: false },
  ],
  permit: [
    { id: 'hoa',          name: 'HOA Approval',               pre: ['eng_approval'],  req: true  },
    { id: 'om_review',    name: 'OM Project Review',          pre: ['eng_approval'],  req: true  },
    { id: 'city_permit',  name: 'City Permit Approval',       pre: ['eng_approval'],  req: true  },
    { id: 'util_permit',  name: 'Utility Permit Approval',    pre: ['eng_approval'],  req: true  },
    { id: 'checkpoint1',  name: 'Check Point 1',              pre: ['city_permit','util_permit','ntp'], req: false },
    { id: 'revise_ia',    name: 'Revise IA',                  pre: [],                req: false },
  ],
  install: [
    { id: 'sched_install',name: 'Schedule Installation',      pre: ['om_review'],     req: true  },
    { id: 'inventory',    name: 'Inventory Allocation',       pre: ['sched_install'], req: true  },
    { id: 'install_done', name: 'Installation Complete',      pre: ['sched_install'], req: true  },
    { id: 'elec_redesign',name: 'Electrical Onsite Redesign', pre: [],                req: false },
  ],
  inspection: [
    { id: 'insp_review',  name: 'Inspection Review',          pre: ['install_done'],  req: true  },
    { id: 'sched_city',   name: 'Schedule City Inspection',   pre: ['insp_review'],   req: true  },
    { id: 'sched_util',   name: 'Schedule Utility Inspection',pre: ['insp_review'],   req: true  },
    { id: 'city_insp',    name: 'City Inspection',            pre: ['sched_city'],    req: true  },
    { id: 'util_insp',    name: 'Utility Inspection',         pre: ['sched_util'],    req: true  },
    { id: 'city_upd',     name: 'City Permit Update',         pre: ['insp_review'],   req: false },
    { id: 'util_upd',     name: 'Utility Permit Update',      pre: ['insp_review'],   req: false },
    { id: 'wpi28',        name: 'WPI 2 & 8',                  pre: ['install_done'],  req: false },
  ],
  complete: [
    { id: 'pto',          name: 'Permission to Operate',      pre: ['util_insp'],     req: true  },
    { id: 'in_service',   name: 'In Service',                 pre: ['pto'],           req: true  },
  ],
}

const TASK_STATUSES = ['Not Ready','Ready To Start','In Progress','Pending Resolution','Revision Required','Complete']
const STATUS_STYLE: Record<string, string> = {
  'Complete':           'bg-green-900 text-green-300',
  'In Progress':        'bg-blue-900 text-blue-300',
  'Pending Resolution': 'bg-red-900 text-red-300',
  'Revision Required':  'bg-amber-900 text-amber-300',
  'Ready To Start':     'bg-gray-700 text-gray-200',
  'Not Ready':          'bg-gray-800 text-gray-500',
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function Row({ label, value, small }: { label: string; value?: string | null; small?: boolean }) {
  if (!value) return null
  return (
    <div className="flex gap-2 py-0.5">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <span className={`text-gray-200 text-xs break-words ${small ? 'text-xs' : ''}`}>{value}</span>
    </div>
  )
}

function EditRow({ label, field, value, draft, editing, onChange, small, type = 'text' }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  small?: boolean
  type?: 'text' | 'date'
}) {
  const current = field in draft ? draft[field] : value
  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className={`text-gray-200 text-xs break-words ${small ? 'text-xs' : ''}`}>
          {type === 'date' && value ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : value}
        </span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <input
        type={type}
        value={current ?? ''}
        onChange={e => onChange((d: any) => ({ ...d, [field]: e.target.value || null }))}
        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
      />
    </div>
  )
}

// ── AHJ EDIT MODAL ────────────────────────────────────────────────────────────
function AHJEditModal({ ahjName, onClose, onSaved }: {
  ahjName: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [ahj, setAhj] = useState<any>(null)
  const [draft, setDraft] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showPw, setShowPw] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data } = await (supabase as any)
        .from('ahjs').select('*').ilike('name', ahjName).limit(1).single()
      if (data) { setAhj(data); setDraft({ ...data }) }
      setLoading(false)
    }
    load()
  }, [ahjName])

  const save = async () => {
    if (!ahj) return
    setSaving(true)
    await (supabase as any).from('ahjs').update({
      name: draft.name,
      permit_phone: draft.permit_phone,
      permit_website: draft.permit_website,
      max_duration: draft.max_duration,
      electric_code: draft.electric_code,
      permit_notes: draft.permit_notes,
      username: draft.username,
      password: draft.password,
    }).eq('id', ahj.id)
    setSaving(false)
    setToast('AHJ saved')
    setTimeout(() => { setToast(''); onSaved() }, 1500)
  }

  const inputCls = "w-full bg-gray-700 text-white text-xs rounded px-2 py-1.5 border border-gray-600 focus:border-green-500 focus:outline-none"
  const labelCls = "text-xs text-gray-400 mb-1 block"

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-white">Edit AHJ</h2>
            {ahj && <p className="text-xs text-gray-500 mt-0.5">{ahj.name}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-gray-500 text-sm">Loading...</span>
          </div>
        ) : !ahj ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-gray-500 text-sm">AHJ "{ahjName}" not found in database.</span>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
            {toast && (
              <div className="bg-green-700 text-white text-xs px-3 py-2 rounded-md">{toast}</div>
            )}
            <div>
              <label className={labelCls}>Name</label>
              <input className={inputCls} value={draft.name ?? ''} onChange={e => setDraft((d: any) => ({ ...d, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Permit Phone</label>
                <input className={inputCls} value={draft.permit_phone ?? ''} onChange={e => setDraft((d: any) => ({ ...d, permit_phone: e.target.value }))} />
              </div>
              <div>
                <label className={labelCls}>Max Duration (days)</label>
                <input className={inputCls} type="number" value={draft.max_duration ?? ''} onChange={e => setDraft((d: any) => ({ ...d, max_duration: e.target.value ? Number(e.target.value) : null }))} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Permit Website</label>
              <input className={inputCls} value={draft.permit_website ?? ''} onChange={e => setDraft((d: any) => ({ ...d, permit_website: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Electric Code</label>
              <input className={inputCls} value={draft.electric_code ?? ''} onChange={e => setDraft((d: any) => ({ ...d, electric_code: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Permit Notes</label>
              <textarea className={inputCls + " resize-none"} rows={3} value={draft.permit_notes ?? ''} onChange={e => setDraft((d: any) => ({ ...d, permit_notes: e.target.value }))} />
            </div>
            <div className="border-t border-gray-800 pt-3">
              <p className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-wide">Portal Login</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Username</label>
                  <input className={inputCls} value={draft.username ?? ''} onChange={e => setDraft((d: any) => ({ ...d, username: e.target.value }))} />
                </div>
                <div>
                  <label className={labelCls}>Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      className={inputCls + " pr-8"}
                      value={draft.password ?? ''}
                      onChange={e => setDraft((d: any) => ({ ...d, password: e.target.value }))}
                    />
                    <button type="button" onClick={() => setShowPw(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showPw
                        ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      }
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800">
          <button onClick={onClose}
            className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors">
            Cancel
          </button>
          {ahj && (
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


function AutocompleteRow({ label, field, value, draft, editing, onChange, table, searchCol = 'name' }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  table: 'ahjs' | 'utilities'
  searchCol?: string
}) {
  const supabase = createClient()
  const current = field in draft ? draft[field] : value
  const [query, setQuery] = useState(current ?? '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Sync query when draft changes externally
  useEffect(() => { setQuery(current ?? '') }, [current])

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Search DB as user types
  useEffect(() => {
    if (!focused || query.length < 2) { setSuggestions([]); setOpen(false); return }
    const timer = setTimeout(async () => {
      const { data } = await (supabase as any).from(table).select(searchCol).ilike(searchCol, `%${query}%`).order(searchCol).limit(8)
      const names = (data ?? []).map((r: any) => r[searchCol])
      setSuggestions(names)
      setOpen(names.length > 0)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, focused])

  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className="text-gray-200 text-xs break-words">{value}</span>
      </div>
    )
  }

  return (
    <div className="flex gap-2 py-0.5 items-start" ref={ref}>
      <span className="text-gray-500 text-xs w-28 flex-shrink-0 mt-1">{label}</span>
      <div className="flex-1 relative">
        <input
          type="text"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onChange={e => {
            setQuery(e.target.value)
            onChange((d: any) => ({ ...d, [field]: e.target.value || null }))
          }}
          className="w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
          placeholder={`Search ${label}…`}
        />
        {open && suggestions.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-gray-800 border border-gray-600 rounded-md shadow-xl overflow-hidden max-h-48 overflow-y-auto">
            {suggestions.map(s => (
              <button
                key={s}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 hover:text-white transition-colors"
                onMouseDown={() => {
                  setQuery(s)
                  onChange((d: any) => ({ ...d, [field]: s }))
                  setOpen(false)
                }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 pb-1 border-b border-gray-800">{title}</div>
      {children}
    </div>
  )
}

function TaskRow({ task, status, locked, onStatusChange }: {
  task: { id: string; name: string; req: boolean }
  status: string
  locked: boolean
  onStatusChange: (taskId: string, status: string) => void
}) {
  return (
    <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg mb-1 ${status === 'Complete' ? 'opacity-50' : ''} ${locked ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        status === 'Complete' ? 'bg-green-500' :
        status === 'Pending Resolution' ? 'bg-red-500' :
        status === 'Revision Required' ? 'bg-amber-500' :
        status === 'In Progress' ? 'bg-blue-500' :
        status === 'Ready To Start' ? 'bg-gray-400' : 'bg-gray-700'
      }`} />
      <span className={`flex-1 text-xs ${task.req ? 'text-white' : 'text-gray-400'}`}>
        {task.name}{!task.req && <span className="text-gray-600 ml-1">(opt)</span>}
      </span>
      <select
        value={status}
        disabled={locked}
        onChange={e => onStatusChange(task.id, e.target.value)}
        className={`text-xs rounded px-1.5 py-0.5 border-0 cursor-pointer ${STATUS_STYLE[status] ?? 'bg-gray-800 text-gray-400'}`}
      >
        {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  )
}

// ── STAGE ADVANCE LOGIC ───────────────────────────────────────────────────────
function canAdvance(stage: string, taskStates: Record<string, string>): { ok: boolean; missing: string[] } {
  const tasks = (TASKS[stage] ?? []).filter(t => t.req)
  const missing = tasks.filter(t => taskStates[t.id] !== 'Complete').map(t => t.name)
  return { ok: missing.length === 0, missing }
}

// ── MAIN PANEL ────────────────────────────────────────────────────────────────
interface ProjectPanelProps {
  project: Project
  onClose: () => void
  onProjectUpdated: () => void
}

export function ProjectPanel({ project: initialProject, onClose, onProjectUpdated }: ProjectPanelProps) {
  const supabase = createClient()
  const [project, setProject] = useState<Project>(initialProject)
  const [tab, setTab] = useState<'tasks' | 'notes' | 'info' | 'bom' | 'files'>('tasks')
  const [taskStates, setTaskStates] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Note[]>([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [folderUrl, setFolderUrl] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')
  const [blockerInput, setBlockerInput] = useState('')
  const [showBlockerForm, setShowBlockerForm] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editDraft, setEditDraft] = useState<Partial<Project>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [ahjInfo, setAhjInfo] = useState<any>(null)
  const [utilityInfo, setUtilityInfo] = useState<any>(null)
  const [serviceCalls, setServiceCalls] = useState<any[]>([])
  const [stageHistory, setStageHistory] = useState<any[]>([])
  const [showAhjModal, setShowAhjModal] = useState(false)

  const pid = project.id
  const stageTasks = TASKS[project.stage] ?? []
  const stageIdx = STAGE_ORDER.indexOf(project.stage)
  const nextStage = STAGE_ORDER[stageIdx + 1] ?? null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // Load task states
  const loadTasks = useCallback(async () => {
    const { data } = await supabase.from('task_state').select('task_id, status').eq('project_id', pid)
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((t: any) => { map[t.task_id] = t.status })
      setTaskStates(map)
    }
  }, [pid])

  const loadNotes = useCallback(async () => {
    const { data } = await supabase.from('notes').select('*').eq('project_id', pid).order('time', { ascending: false })
    if (data) setNotes(data as Note[])
  }, [pid])

  const loadStageHistory = useCallback(async () => {
    const { data } = await (supabase as any).from('stage_history').select('*').eq('project_id', pid).order('entered', { ascending: false })
    if (data) setStageHistory(data)
  }, [pid])

  const loadServiceCalls = useCallback(async () => {
    const { data } = await (supabase as any).from('service_calls').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(5)
    if (data) setServiceCalls(data)
  }, [pid])

  const loadAhjUtil = useCallback(async () => {
    if (project.ahj) {
      const { data } = await (supabase as any).from('ahjs').select('permit_phone,permit_website,max_duration,electric_code,permit_notes').ilike('name', project.ahj).limit(1).single()
      if (data) setAhjInfo(data)
    }
    if (project.utility) {
      const { data } = await (supabase as any).from('utilities').select('phone,website,notes').ilike('name', '%' + project.utility + '%').limit(1).single()
      if (data) setUtilityInfo(data)
    }
  }, [project.ahj, project.utility])

  const loadFolder = useCallback(async () => {
    const { data } = await supabase.from('project_folders').select('folder_url').eq('project_id', pid).single()
    if (data && 'folder_url' in data) setFolderUrl((data as any).folder_url)
  }, [pid])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ''))
  }, [])

  useEffect(() => {
    setProject(initialProject)
    setBlockerInput(initialProject.blocker ?? '')
    setAhjInfo(null)
    setUtilityInfo(null)
    loadTasks()
    loadNotes()
    loadFolder()
    loadAhjUtil()
    loadServiceCalls()
    loadStageHistory()
  }, [initialProject.id])

  // Update task status
  async function updateTaskStatus(taskId: string, status: string) {
    setTaskStates(prev => ({ ...prev, [taskId]: status }))
    await (supabase as any).from('task_state').upsert({
      project_id: pid, task_id: taskId, status,
      completed_date: status === 'Complete' ? new Date().toISOString().slice(0, 10) : null,
    }, { onConflict: 'project_id,task_id' })
  }

  function isLocked(task: { pre: string[] }): boolean {
    return task.pre.some(preId => taskStates[preId] !== 'Complete')
  }

  // Add note
  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    const pm = (typeof window !== 'undefined' ? localStorage.getItem('mg_display_name') : null) ?? userEmail.split('@')[0] ?? 'PM'
    await (supabase as any).from('notes').insert({
      project_id: pid, text: newNote.trim(),
      time: new Date().toISOString(), pm,
    })
    setNewNote('')
    await loadNotes()
    setSaving(false)
    showToast('Note added')
  }

  // Set blocker
  async function setBlocker() {
    const text = blockerInput.trim()
    await (supabase as any).from('projects').update({ blocker: text || null }).eq('id', pid)
    setProject(p => ({ ...p, blocker: text || null }))
    setShowBlockerForm(false)
    onProjectUpdated()
    showToast(text ? 'Blocker set' : 'Blocker cleared')
  }

  // Save edits
  async function saveEdits() {
    setEditSaving(true)
    await (supabase as any).from('projects').update(editDraft).eq('id', pid)
    const updated = { ...project, ...editDraft }
    setProject(updated)
    setEditMode(false)
    setEditDraft({})
    setEditSaving(false)
    onProjectUpdated()
    showToast('Project updated')
    // Reload AHJ/utility info if those fields changed
    if (editDraft.ahj !== project.ahj || editDraft.utility !== project.utility) {
      setAhjInfo(null)
      setUtilityInfo(null)
      if (editDraft.ahj) {
        const { data } = await (supabase as any).from('ahjs').select('permit_phone,permit_website,max_duration,electric_code,permit_notes').ilike('name', editDraft.ahj).limit(1).single()
        if (data) setAhjInfo(data)
      }
      if (editDraft.utility) {
        const { data } = await (supabase as any).from('utilities').select('phone,website,notes').ilike('name', '%' + editDraft.utility + '%').limit(1).single()
        if (data) setUtilityInfo(data)
      }
    }
  }

  function startEdit() {
    setEditDraft({
      name: project.name,
      city: project.city,
      address: project.address,
      phone: project.phone,
      email: project.email,
      pm: project.pm,
      advisor: project.advisor,
      consultant: project.consultant,
      consultant_email: project.consultant_email,
      ahj: project.ahj,
      utility: project.utility,
      permit_number: project.permit_number,
      utility_app_number: project.utility_app_number,
      permit_fee: project.permit_fee,
      city_permit_date: project.city_permit_date,
      utility_permit_date: project.utility_permit_date,
      ntp_date: project.ntp_date,
      survey_scheduled_date: project.survey_scheduled_date,
      survey_date: project.survey_date,
      install_scheduled_date: project.install_scheduled_date,
      install_complete_date: project.install_complete_date,
      city_inspection_date: project.city_inspection_date,
      utility_inspection_date: project.utility_inspection_date,
      pto_date: project.pto_date,
      in_service_date: project.in_service_date,
      hoa: project.hoa,
      esid: project.esid,
      financing_type: project.financing_type,
      disposition: project.disposition,
      site_surveyor: project.site_surveyor,
    })
    setEditMode(true)
    setTab('info')
  }

  // Advance stage
  async function advanceStage() {
    if (!nextStage) return
    const { ok, missing } = canAdvance(project.stage, taskStates)
    if (!ok) {
      showToast(`Complete required tasks first: ${missing.slice(0,2).join(', ')}${missing.length > 2 ? '...' : ''}`)
      return
    }
    setAdvancing(true)
    const today = new Date().toISOString().slice(0, 10)
    await (supabase as any).from('projects').update({ stage: nextStage, stage_date: today }).eq('id', pid)
    await (supabase as any).from('stage_history').insert({ project_id: pid, stage: nextStage, entered: today })
    setProject(p => ({ ...p, stage: nextStage as Project['stage'], stage_date: today }))
    setAdvancing(false)
    onProjectUpdated()
    showToast(`Moved to ${STAGE_LABELS[nextStage]}`)
  }

  const stuckCount = stageTasks.filter(t => {
    const s = taskStates[t.id] ?? 'Not Ready'
    return s === 'Pending Resolution' || s === 'Revision Required'
  }).length

  const days = daysAgo(project.stage_date)
  const cycle = daysAgo(project.sale_date) || days
  const advance = canAdvance(project.stage, taskStates)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full max-w-4xl bg-gray-900 flex flex-col shadow-2xl overflow-hidden">

        {/* Toast */}
        {toast && (
          <div className="absolute top-4 right-4 bg-gray-700 text-white text-xs px-4 py-2 rounded-lg shadow-lg z-10">
            {toast}
          </div>
        )}

        {/* Header */}
        <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{project.name}</h2>
              <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>{project.id}</span>
                <span>·</span><span>{project.city}</span>
                <span>·</span><span className="text-green-400">{STAGE_LABELS[project.stage]}</span>
                <span>·</span><span>{days}d in stage</span>
                <span>·</span><span>{cycle}d total</span>
                <span>·</span><span>{project.pm}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl ml-4 flex-shrink-0">×</button>
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {/* Blocker button */}
            {!showBlockerForm ? (
              <button
                onClick={() => setShowBlockerForm(true)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  project.blocker
                    ? 'bg-red-900 text-red-300 hover:bg-red-800'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {project.blocker ? `🚫 ${project.blocker}` : '+ Set Blocker'}
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <input
                  autoFocus
                  value={blockerInput}
                  onChange={e => setBlockerInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') setBlocker(); if (e.key === 'Escape') setShowBlockerForm(false) }}
                  placeholder="Describe the blocker..."
                  className="flex-1 bg-gray-800 text-white text-xs rounded-lg px-3 py-1.5 border border-gray-600 focus:border-red-500 focus:outline-none"
                />
                <button onClick={setBlocker} className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg">Save</button>
                {project.blocker && (
                  <button onClick={() => { setBlockerInput(''); setBlocker() }} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg">Clear</button>
                )}
                <button onClick={() => setShowBlockerForm(false)} className="text-xs text-gray-500 hover:text-white px-2">Cancel</button>
              </div>
            )}

            {/* Edit button */}
            {!showBlockerForm && !editMode && (
              <button onClick={startEdit}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                ✏ Edit
              </button>
            )}
            {editMode && (
              <div className="flex items-center gap-2">
                <button onClick={saveEdits} disabled={editSaving}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 transition-colors">
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
                <button onClick={() => { setEditMode(false); setEditDraft({}) }}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-400 hover:text-white transition-colors">
                  Cancel
                </button>
              </div>
            )}
            {/* Stage advance */}
            {nextStage && !showBlockerForm && (
              <button
                onClick={advanceStage}
                disabled={advancing}
                title={!advance.ok ? `Complete required tasks: ${advance.missing.join(', ')}` : ''}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ml-auto ${
                  advance.ok
                    ? 'bg-green-700 hover:bg-green-600 text-white'
                    : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}
              >
                {advancing ? 'Moving...' : `→ ${STAGE_LABELS[nextStage]}`}
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 flex-shrink-0 bg-gray-950">
          {([
            { id: 'tasks', label: `Tasks${stuckCount ? ` (${stuckCount} stuck)` : ''}`, stuck: stuckCount > 0 },
            { id: 'notes', label: `Notes${notes.length ? ` (${notes.length})` : ''}`, stuck: false },
            { id: 'info',  label: 'Info', stuck: false },
            { id: 'bom',   label: 'BOM', stuck: false },
            { id: 'files', label: 'Files', stuck: false },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t.id ? 'border-b-2 border-green-400 text-green-400' :
                t.stuck ? 'text-red-400 hover:text-red-300' : 'text-gray-400 hover:text-white'
              }`}
            >{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* TASKS */}
          {tab === 'tasks' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-2xl">
                <div className="text-xs text-gray-500 mb-4">
                  Current stage: <span className="text-white">{STAGE_LABELS[project.stage]}</span>
                  {' · '}Required tasks must be complete to advance stage.
                </div>
                {stageTasks.map(task => (
                  <TaskRow key={task.id} task={task}
                    status={taskStates[task.id] ?? 'Not Ready'}
                    locked={isLocked(task)}
                    onStatusChange={updateTaskStatus}
                  />
                ))}
                {stageTasks.length === 0 && <div className="text-gray-500 text-xs">No tasks defined for this stage.</div>}

                {/* Prior stage summaries */}
                <div className="mt-6 space-y-1">
                  {STAGE_ORDER.filter(s => s !== project.stage && TASKS[s]).map(stageId => {
                    const tasks = TASKS[stageId] ?? []
                    const done = tasks.filter(t => taskStates[t.id] === 'Complete').length
                    const stuck = tasks.filter(t => ['Pending Resolution','Revision Required'].includes(taskStates[t.id] ?? '')).length
                    if (done === 0 && stuck === 0) return null
                    return (
                      <div key={stageId} className="text-xs text-gray-600 flex gap-2">
                        <span>{STAGE_LABELS[stageId]}</span>
                        <span>—</span>
                        <span>{done}/{tasks.length} complete</span>
                        {stuck > 0 && <span className="text-red-500">{stuck} stuck</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* NOTES */}
          {tab === 'notes' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-gray-800 flex-shrink-0">
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addNote() }}
                  placeholder="Add a note… (⌘+Enter to save)"
                  rows={3}
                  className="w-full bg-gray-800 text-white text-sm rounded-lg p-3 border border-gray-700 focus:border-green-500 focus:outline-none resize-none placeholder-gray-500"
                />
                <div className="flex justify-end mt-2">
                  <button onClick={addNote} disabled={saving || !newNote.trim()}
                    className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors">
                    {saving ? 'Saving…' : 'Add Note'}
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {notes.length === 0 && <div className="text-gray-500 text-xs text-center py-8">No notes yet.</div>}
                {notes.map(note => (
                  <div key={note.id} className="bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-green-400">{note.pm}</span>
                      <span className="text-xs text-gray-500">
                        {note.time ? new Date(note.time).toLocaleDateString('en-US', { month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit' }) : ''}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{note.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* INFO */}
          {tab === 'info' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-8 max-w-3xl">
                <div>
                  <Section title="Contact">
                    <EditRow label="Name" field="name" value={project.name} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <EditRow label="Address" field="address" value={project.address} draft={editDraft} editing={editMode} onChange={setEditDraft} small />
                    <EditRow label="Phone" field="phone" value={project.phone} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <EditRow label="Email" field="email" value={project.email} draft={editDraft} editing={editMode} onChange={setEditDraft} small />
                  </Section>
                  <Section title="Contract">
                    <Row label="Amount" value={fmt$(project.contract)} />
                    <Row label="System" value={project.systemkw ? `${project.systemkw} kW` : null} />
                    <Row label="Financier" value={project.financier} />
                    <EditRow label="Financing" field="financing_type" value={project.financing_type} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <Row label="Down payment" value={project.down_payment ? `$${Number(project.down_payment).toLocaleString()}` : null} />
                    <Row label="TPO escalator" value={project.tpo_escalator?.toString()} />
                    <Row label="Adv pmt sched" value={project.financier_adv_pmt} />
                    <EditRow label="Disposition" field="disposition" value={project.disposition} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <Row label="Dealer" value={project.dealer} />
                  </Section>
                  <Section title="Equipment">
                    <Row label="Module" value={project.module ? `${project.module}${project.module_qty ? ` × ${project.module_qty}` : ''}` : null} />
                    <Row label="Inverter" value={project.inverter ? `${project.inverter}${project.inverter_qty ? ` × ${project.inverter_qty}` : ''}` : null} />
                    <Row label="Battery" value={project.battery ? `${project.battery}${project.battery_qty ? ` × ${project.battery_qty}` : ''}` : null} />
                    <Row label="Optimizer" value={project.optimizer ? `${project.optimizer}${project.optimizer_qty ? ` × ${project.optimizer_qty}` : ''}` : null} />
                  </Section>
                  <Section title="Site & Electrical">
                    <Row label="Meter location" value={project.meter_location} />
                    <Row label="Panel location" value={project.panel_location} />
                    <Row label="Voltage" value={project.voltage} />
                    <Row label="MSP bus rating" value={project.msp_bus_rating} />
                    <Row label="MPU" value={project.mpu} />
                    <Row label="Shutdown" value={project.shutdown} />
                    <Row label="Perf meter" value={project.performance_meter} />
                    <Row label="Interconnect" value={project.interconnection_breaker} />
                    <Row label="Main breaker" value={project.main_breaker} />
                    <EditRow label="HOA" field="hoa" value={project.hoa} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <Row label="ESID" value={project.esid ? String(project.esid).replace(/e\+?\d+$/i, v => '') : null} />
                  </Section>
                </div>
                <div>
                  <Section title="Team">
                    <EditRow label="PM" field="pm" value={project.pm} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <EditRow label="Advisor" field="advisor" value={project.advisor} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <EditRow label="Consultant" field="consultant" value={project.consultant} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <EditRow label="Consultant email" field="consultant_email" value={project.consultant_email} draft={editDraft} editing={editMode} onChange={setEditDraft} small />
                    <EditRow label="Site surveyor" field="site_surveyor" value={project.site_surveyor} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                  </Section>
                  <Section title="Permitting">
                    {!editMode && project.ahj ? (
                      <div className="flex gap-2 py-0.5">
                        <span className="text-gray-500 text-xs w-28 flex-shrink-0">AHJ</span>
                        <button
                          onClick={() => setShowAhjModal(true)}
                          className="text-xs text-green-400 hover:text-green-300 hover:underline text-left transition-colors">
                          {project.ahj}
                        </button>
                      </div>
                    ) : (
                      <AutocompleteRow label="AHJ" field="ahj" value={project.ahj} draft={editDraft} editing={editMode} onChange={setEditDraft} table="ahjs" />
                    )}
                    {!editMode && ahjInfo && (
                      <div className="ml-0 mt-1 mb-2 pl-28 space-y-0.5">
                        {ahjInfo.permit_phone && <div className="text-xs text-green-400">{ahjInfo.permit_phone}</div>}
                        {ahjInfo.permit_website && <a href={ahjInfo.permit_website.startsWith('http') ? ahjInfo.permit_website : 'https://'+ahjInfo.permit_website} target="_blank" rel="noopener" className="text-xs text-green-400 hover:underline block">{ahjInfo.permit_website} ↗</a>}
                        {ahjInfo.max_duration && <div className="text-xs text-gray-500">{ahjInfo.max_duration}d turnaround</div>}
                        {ahjInfo.electric_code && <div className="text-xs text-gray-500">{ahjInfo.electric_code}</div>}
                        {ahjInfo.permit_notes && <div className="text-xs text-gray-400 mt-1 bg-gray-800 rounded p-2">{ahjInfo.permit_notes.slice(0,200)}</div>}
                      </div>
                    )}
                    <AutocompleteRow label="Utility" field="utility" value={project.utility} draft={editDraft} editing={editMode} onChange={setEditDraft} table="utilities" />
                    {!editMode && utilityInfo && (
                      <div className="ml-0 mt-1 mb-2 pl-28 space-y-0.5">
                        {utilityInfo.phone && <div className="text-xs text-green-400">{utilityInfo.phone}</div>}
                        {utilityInfo.website && <a href={utilityInfo.website.startsWith('http') ? utilityInfo.website : 'https://'+utilityInfo.website} target="_blank" rel="noopener" className="text-xs text-green-400 hover:underline block">{utilityInfo.website} ↗</a>}
                        {utilityInfo.notes && <div className="text-xs text-gray-400 mt-1 bg-gray-800 rounded p-2">{utilityInfo.notes.slice(0,150)}</div>}
                      </div>
                    )}
                    <EditRow label="Permit #" field="permit_number" value={project.permit_number} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <EditRow label="Utility app #" field="utility_app_number" value={project.utility_app_number} draft={editDraft} editing={editMode} onChange={setEditDraft} />
                    <Row label="Permit fee" value={project.permit_fee ? `$${Number(project.permit_fee).toLocaleString()}` : null} />
                    <EditRow label="City permit" field="city_permit_date" value={project.city_permit_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="Utility permit" field="utility_permit_date" value={project.utility_permit_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                  </Section>
                  <Section title="Milestones">
                    <EditRow label="Sale date" field="sale_date" value={project.sale_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="NTP" field="ntp_date" value={project.ntp_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="Survey scheduled" field="survey_scheduled_date" value={project.survey_scheduled_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="Survey complete" field="survey_date" value={project.survey_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="Install scheduled" field="install_scheduled_date" value={project.install_scheduled_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="Install complete" field="install_complete_date" value={project.install_complete_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="City inspection" field="city_inspection_date" value={project.city_inspection_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="Utility inspection" field="utility_inspection_date" value={project.utility_inspection_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="PTO" field="pto_date" value={project.pto_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                    <EditRow label="In service" field="in_service_date" value={project.in_service_date} draft={editDraft} editing={editMode} onChange={setEditDraft} type="date" />
                  </Section>
                  {stageHistory.length > 0 && (
                    <Section title="Stage History">
                      {stageHistory.map((h: any, i: number) => (
                        <div key={i} className="flex gap-2 py-0.5 text-xs">
                          <span className="text-gray-500 w-28 flex-shrink-0">{h.entered ? new Date(h.entered + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>
                          <span className="text-gray-300">{h.stage}</span>
                        </div>
                      ))}
                    </Section>
                  )}
                  {serviceCalls.length > 0 && (
                    <Section title="Service Calls">
                      {serviceCalls.map((sc: any) => (
                        <div key={sc.id} className="flex items-start gap-2 py-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                            sc.status === 'open' ? 'bg-red-900 text-red-300' :
                            sc.status === 'closed' ? 'bg-green-900 text-green-300' :
                            'bg-amber-900 text-amber-300'
                          }`}>{sc.status}</span>
                          <div className="min-w-0">
                            {sc.issue_type && <div className="text-xs text-gray-300">{sc.issue_type}</div>}
                            {sc.description && <div className="text-xs text-gray-500 truncate">{sc.description}</div>}
                          </div>
                        </div>
                      ))}
                    </Section>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* BOM */}
          {tab === 'bom' && <BomTab project={project} />}

          {/* FILES */}
          {tab === 'files' && (
            <div className="flex-1 flex items-center justify-center">
              {folderUrl ? (
                <a href={folderUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-6 py-4 transition-colors">
                  <img src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png" alt="Drive" className="w-8 h-8" />
                  <span className="text-sm font-semibold text-white">Open in Google Drive ↗</span>
                </a>
              ) : (
                <div className="text-gray-500 text-sm text-center">
                  <div className="text-2xl mb-2">📁</div>
                  No Drive folder linked to this project.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showAhjModal && project.ahj && (
        <AHJEditModal
          ahjName={project.ahj}
          onClose={() => setShowAhjModal(false)}
          onSaved={() => { setShowAhjModal(false); loadAhjUtil() }}
        />
      )}
    </div>
  )
}
