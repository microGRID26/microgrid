'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt$, fmtDate, daysAgo, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import { TASKS, TASK_STATUSES, STATUS_STYLE, PENDING_REASONS, REVISION_REASONS, ALL_TASKS_MAP, ALL_TASKS_FLAT, TASK_DATE_FIELDS, getSameStageDownstream } from '@/lib/tasks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import type { Project, Note } from '@/types/database'
import { BomTab } from './BomTab'
import { TasksTab } from './TasksTab'
import { NotesTab } from './NotesTab'
import { InfoTab } from './InfoTab'

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
  type?: 'text' | 'date' | 'number' | 'currency'
}) {
  const current = field in draft ? draft[field] : value
  const inputType = type === 'currency' ? 'number' : type
  if (!editing) {
    if (!value) return null
    const display = type === 'date' && value
      ? new Date(value + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : type === 'currency' && value
      ? fmt$(Number(value))
      : value
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className={`text-gray-200 text-xs break-words ${small ? 'text-xs' : ''}`}>{display}</span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 relative">
        {type === 'currency' && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>}
        <input
          type={inputType}
          value={current ?? ''}
          onChange={e => onChange((d: any) => ({ ...d, [field]: e.target.value || null }))}
          className={`w-full bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none ${type === 'currency' ? 'pl-5' : ''}`}
        />
      </div>
    </div>
  )
}

function SelectEditRow({ label, field, value, draft, editing, onChange, options }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  options: string[]
}) {
  const current = field in draft ? draft[field] : value
  if (!editing) {
    if (!value) return null
    return (
      <div className="flex gap-2 py-0.5">
        <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
        <span className="text-gray-200 text-xs">{value}</span>
      </div>
    )
  }
  return (
    <div className="flex gap-2 py-0.5 items-center">
      <span className="text-gray-500 text-xs w-28 flex-shrink-0">{label}</span>
      <select
        value={current ?? ''}
        onChange={e => onChange((d: any) => ({ ...d, [field]: e.target.value || null }))}
        className="flex-1 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600 focus:border-green-500 focus:outline-none"
      >
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function AutocompleteRow({ label, field, value, draft, editing, onChange, table, searchCol = 'name', onClickValue }: {
  label: string
  field: string
  value?: string | null
  draft: Record<string, any>
  editing: boolean
  onChange: (d: any) => void
  table: 'ahjs' | 'utilities'
  searchCol?: string
  onClickValue?: () => void
}) {
  const supabase = createClient()
  const current = field in draft ? draft[field] : value
  const [query, setQuery] = useState(current ?? '')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(current ?? '') }, [current])

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

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
        {onClickValue ? (
          <button onClick={onClickValue} className="text-green-400 hover:text-green-300 text-xs break-words text-left hover:underline cursor-pointer">
            {value}
          </button>
        ) : (
          <span className="text-gray-200 text-xs break-words">{value}</span>
        )}
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
              <button key={s} type="button"
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

function TaskRow({ task, status, reason, pendingReasons, revisionReasons, locked, onStatusChange, onReasonChange }: {
  task: { id: string; name: string; req: boolean }
  status: string
  reason: string
  pendingReasons: string[]
  revisionReasons: string[]
  locked: boolean
  onStatusChange: (taskId: string, status: string) => void
  onReasonChange: (taskId: string, reason: string) => void
}) {
  const showReason = status === 'Pending Resolution' || status === 'Revision Required'
  const reasonOptions = status === 'Pending Resolution' ? pendingReasons : revisionReasons

  return (
    <div className={`py-1.5 px-2 rounded-lg mb-1 ${status === 'Complete' ? 'opacity-50' : ''} ${locked ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
          status === 'Complete'           ? 'bg-green-500'  :
          status === 'Pending Resolution' ? 'bg-red-500'    :
          status === 'Revision Required'  ? 'bg-amber-500'  :
          status === 'In Progress'        ? 'bg-blue-500'   :
          status === 'Scheduled'          ? 'bg-indigo-400' :
          status === 'Ready To Start'     ? 'bg-gray-400'   : 'bg-gray-700'
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

      {/* Reason dropdown — shown when Pending Resolution or Revision Required */}
      {showReason && reasonOptions.length > 0 && (
        <div className="mt-1.5 ml-4 flex items-center gap-2">
          <span className="text-xs text-gray-500 flex-shrink-0 w-10">Reason</span>
          <select
            value={reason}
            onChange={e => onReasonChange(task.id, e.target.value)}
            className={`flex-1 text-xs rounded px-2 py-0.5 border-0 cursor-pointer ${
              status === 'Pending Resolution' ? 'bg-red-950 text-red-300' : 'bg-amber-950 text-amber-300'
            }`}
          >
            <option value="">Select reason...</option>
            {reasonOptions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      {/* Show saved reason as dim context when status is something else */}
      {!showReason && reason && (
        <div className="mt-0.5 ml-4 text-xs text-gray-600 italic">{reason}</div>
      )}
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
  const { user: currentUser } = useCurrentUser()
  const [project, setProject] = useState<Project>(initialProject)
  const [tab, setTab] = useState<'tasks' | 'notes' | 'info' | 'bom' | 'files'>('tasks')
  const [taskStates, setTaskStates] = useState<Record<string, string>>({})
  const [taskReasons, setTaskReasons] = useState<Record<string, string>>({})
  const [taskStatesRaw, setTaskStatesRaw] = useState<{task_id: string; status: string; reason?: string; completed_date?: string | null; started_date?: string | null}[]>([])
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
  // taskView state removed — TasksTab manages its own view state now
  const [ahjInfo, setAhjInfo] = useState<any>(null)
  const [utilityInfo, setUtilityInfo] = useState<any>(null)
  const [ahjEdit, setAhjEdit] = useState<any>(null)
  const [utilEdit, setUtilEdit] = useState<any>(null)
  const [refSaving, setRefSaving] = useState(false)
  const [serviceCalls, setServiceCalls] = useState<any[]>([])
  const [stageHistory, setStageHistory] = useState<any[]>([])
  // ── task_history ─────────────────────────────────────────────────────────────
  const [taskHistory, setTaskHistory] = useState<any[]>([])
  const [taskHistoryLoaded, setTaskHistoryLoaded] = useState(false)
  // ── revision cascade confirmation ──────────────────────────────────────────
  const [cascadeConfirm, setCascadeConfirm] = useState<{
    taskId: string
    taskName: string
    resets: { id: string; name: string; currentStatus: string }[]
  } | null>(null)
  const [changeOrderCount, setChangeOrderCount] = useState(0)

  const pid = project.id
  const stageTasks = TASKS[project.stage] ?? []
  const stageIdx = STAGE_ORDER.indexOf(project.stage)
  const nextStage = STAGE_ORDER[stageIdx + 1] ?? null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const loadTasks = useCallback(async () => {
    const { data } = await supabase.from('task_state').select('task_id, status, reason, completed_date, started_date').eq('project_id', pid)
    if (data) {
      const statusMap: Record<string, string> = {}
      const reasonMap: Record<string, string> = {}
      data.forEach((t: any) => {
        statusMap[t.task_id] = t.status
        if (t.reason) reasonMap[t.task_id] = t.reason
      })
      setTaskStates(statusMap)
      setTaskReasons(reasonMap)
      setTaskStatesRaw(data)
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

  // Lazy — only called when user navigates to History view
  // Indexes on project_id + changed_at keep this fast at 20k+ projects
  const loadTaskHistory = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('task_history')
      .select('task_id, status, reason, changed_by, changed_at')
      .eq('project_id', pid)
      .order('changed_at', { ascending: false })
      .limit(200)
    if (data) {
      setTaskHistory(data)
      setTaskHistoryLoaded(true)
    }
  }, [pid])

  const loadServiceCalls = useCallback(async () => {
    const { data } = await (supabase as any).from('service_calls').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(5)
    if (data) setServiceCalls(data)
  }, [pid])

  const loadAhjUtil = useCallback(async () => {
    if (project.ahj) {
      const { data } = await (supabase as any).from('ahjs').select('permit_phone,permit_website,max_duration,electric_code,permit_notes').ilike('name', `%${project.ahj}%`).limit(1).maybeSingle()
      setAhjInfo(data ?? null)
    }
    if (project.utility) {
      const { data } = await (supabase as any).from('utilities').select('phone,website,notes').ilike('name', `%${project.utility}%`).limit(1).maybeSingle()
      setUtilityInfo(data ?? null)
    }
  }, [pid, project.ahj, project.utility])

  const openAhjEdit = async () => {
    if (!project.ahj) return
    const { data } = await (supabase as any).from('ahjs').select('*').ilike('name', `%${project.ahj}%`).limit(1).maybeSingle()
    if (data) setAhjEdit({ ...data })
  }

  const saveAhjEdit = async () => {
    if (!ahjEdit) return
    setRefSaving(true)
    await (supabase as any).from('ahjs').update({
      permit_phone: ahjEdit.permit_phone,
      permit_website: ahjEdit.permit_website,
      max_duration: ahjEdit.max_duration,
      electric_code: ahjEdit.electric_code,
      permit_notes: ahjEdit.permit_notes,
    }).eq('id', ahjEdit.id)
    setRefSaving(false)
    setAhjEdit(null)
    loadAhjUtil()
  }

  const openUtilEdit = async () => {
    if (!project.utility) return
    const { data } = await (supabase as any).from('utilities').select('*').ilike('name', `%${project.utility}%`).limit(1).maybeSingle()
    if (data) setUtilEdit({ ...data })
  }

  const saveUtilEdit = async () => {
    if (!utilEdit) return
    setRefSaving(true)
    await (supabase as any).from('utilities').update({
      phone: utilEdit.phone,
      website: utilEdit.website,
      notes: utilEdit.notes,
    }).eq('id', utilEdit.id)
    setRefSaving(false)
    setUtilEdit(null)
    loadAhjUtil()
  }

  const loadFolder = useCallback(async () => {
    const { data } = await (supabase as any).from('project_folders').select('folder_url').eq('project_id', pid).maybeSingle()
    setFolderUrl(data?.folder_url ?? null)
  }, [pid])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ''))
  }, [])

  useEffect(() => {
    setProject(initialProject)
    setBlockerInput(initialProject.blocker ?? '')
    // Fetch full project data (parent pages may pass trimmed columns from optimized queries)
    supabase.from('projects').select('*').eq('id', initialProject.id).single().then(({ data }) => {
      if (data) {
        setProject(data as Project)
        setBlockerInput((data as Project).blocker ?? '')
      }
    })
  }, [initialProject.id])

  useEffect(() => {
    setAhjInfo(null)
    setUtilityInfo(null)
    // Reset history cache when project changes
    setTaskHistory([])
    setTaskHistoryLoaded(false)
    loadTasks()
    loadNotes()
    loadFolder()
    loadAhjUtil()
    loadServiceCalls()
    loadStageHistory()
    // Load change order count for this project
    ;(supabase as any).from('change_orders')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', initialProject.id)
      .not('status', 'in', '("Complete","Cancelled")')
      .then(({ count }: any) => setChangeOrderCount(count ?? 0))
  }, [initialProject.id])

  // Eager-load task history for inline expansion in stage view
  useEffect(() => {
    if (!taskHistoryLoaded) {
      loadTaskHistory()
    }
  }, [taskHistoryLoaded, loadTaskHistory])

  async function updateTaskStatus(taskId: string, status: string) {
    // ── Revision Required cascade check ──────────────────────────────────────
    if (status === 'Revision Required') {
      const downstream = getSameStageDownstream(taskId)
      const resets = downstream
        .filter(id => {
          const s = taskStates[id] ?? 'Not Ready'
          return s !== 'Not Ready'
        })
        .map(id => ({
          id,
          name: ALL_TASKS_FLAT[id]?.name ?? id,
          currentStatus: taskStates[id] ?? 'Not Ready',
        }))

      if (resets.length > 0) {
        // Show confirmation — don't save yet
        setCascadeConfirm({ taskId, taskName: ALL_TASKS_FLAT[taskId]?.name ?? taskId, resets })
        // Optimistically update UI for the revised task only
        setTaskStates(prev => ({ ...prev, [taskId]: status }))
        return
      }
    }

    await applyTaskStatus(taskId, status)
  }

  // Executes the actual save + optional cascade resets
  async function applyTaskStatus(taskId: string, status: string, cascadeResets?: string[]) {
    setTaskStates(prev => ({ ...prev, [taskId]: status }))
    const needsReason = status === 'Pending Resolution' || status === 'Revision Required'
    if (!needsReason) {
      setTaskReasons(prev => { const n = { ...prev }; delete n[taskId]; return n })
    }
    const today = new Date().toISOString().slice(0, 10)
    // Set started_date when task first moves to In Progress (don't overwrite if already set)
    const existingRaw = taskStatesRaw.find(t => t.task_id === taskId)
    const startedDate = status === 'In Progress' && !(existingRaw as any)?.started_date
      ? today : undefined

    const upsertPayload: Record<string, any> = {
      project_id: pid,
      task_id: taskId,
      status,
      reason: needsReason ? (taskReasons[taskId] ?? null) : null,
      completed_date: status === 'Complete' ? today : null,
    }
    if (startedDate) upsertPayload.started_date = startedDate

    await (supabase as any).from('task_state').upsert(upsertPayload, { onConflict: 'project_id,task_id' })

    const changedBy = currentUser?.name
      ?? userEmail.split('@')[0]
      ?? 'unknown'
    // Log to task_history — await to ensure it completes
    const { error: histError } = await (supabase as any).from('task_history').insert({
      project_id: pid,
      task_id: taskId,
      status,
      reason: needsReason ? (taskReasons[taskId] ?? null) : null,
      changed_by: changedBy,
    })
    if (histError) console.error('task_history insert failed:', histError)

    // ── Cascade resets — reset downstream tasks to Not Ready ────────────────
    if (cascadeResets && cascadeResets.length > 0) {
      const resetUpdates = cascadeResets.map(id => ({
        project_id: pid,
        task_id: id,
        status: 'Not Ready',
        reason: null,
        completed_date: null,
        started_date: null,
      }))
      await (supabase as any).from('task_state').upsert(resetUpdates, { onConflict: 'project_id,task_id' })

      // Log each reset to history
      const historyInserts = cascadeResets.map(id => ({
        project_id: pid,
        task_id: id,
        status: 'Not Ready',
        reason: null,
        changed_by: `${changedBy} (cascade)`,
      }))
      const { error: cascadeHistErr } = await (supabase as any).from('task_history').insert(historyInserts)
      if (cascadeHistErr) console.error('cascade history insert failed:', cascadeHistErr)

      // Update local state
      setTaskStates(prev => {
        const next = { ...prev }
        for (const id of cascadeResets) next[id] = 'Not Ready'
        return next
      })
      setTaskReasons(prev => {
        const next = { ...prev }
        for (const id of cascadeResets) delete next[id]
        return next
      })

      // ── Cascade: also clear project dates for reset tasks ──────────────
      const dateClearUpdates: Record<string, null> = {}
      for (const id of cascadeResets) {
        const df = TASK_DATE_FIELDS[id]
        if (df && (project as any)[df]) dateClearUpdates[df] = null
      }
      if (Object.keys(dateClearUpdates).length > 0) {
        await (supabase as any).from('projects').update(dateClearUpdates).eq('id', pid)
        setProject(p => ({ ...p, ...dateClearUpdates }))
      }

      showToast(`Reset ${cascadeResets.length} downstream task${cascadeResets.length > 1 ? 's' : ''}`)
    }

    // Invalidate cache so History view reloads fresh on next open
    setTaskHistoryLoaded(false)

    // ── Auto-populate project date when task is marked Complete ────────────
    // Only set if the field is currently empty — never overwrite manual entries
    if (status === 'Complete') {
      const dateField = TASK_DATE_FIELDS[taskId]
      if (dateField && !(project as any)[dateField]) {
        await (supabase as any).from('projects').update({ [dateField]: today }).eq('id', pid)
        setProject(p => ({ ...p, [dateField]: today }))
      }
    }

    // ── Auto-clear project date when task is un-completed ────────────────
    if (status !== 'Complete' && !cascadeResets) {
      const dateField = TASK_DATE_FIELDS[taskId]
      if (dateField && (project as any)[dateField]) {
        await (supabase as any).from('projects').update({ [dateField]: null }).eq('id', pid)
        setProject(p => ({ ...p, [dateField]: null }))
      }
    }

    // ── Auto-detect blocker from Pending Resolution ─────────────────────
    // Prefix auto-set blockers with ⏸ so we can distinguish from manual blockers
    if (status === 'Pending Resolution') {
      const taskName = ALL_TASKS_MAP[taskId] ?? taskId
      const reason = needsReason ? (taskReasons[taskId] ?? '') : ''
      const blockerText = `⏸ ${taskName}${reason ? ': ' + reason : ''}`
      // Only auto-set if no blocker currently exists
      if (!project.blocker) {
        await (supabase as any).from('projects').update({ blocker: blockerText }).eq('id', pid)
        setProject(p => ({ ...p, blocker: blockerText }))
        setBlockerInput(blockerText)
        onProjectUpdated()
      }
    }

    // ── Auto-clear blocker when task resolves (only if auto-set) ─────────
    if (status !== 'Pending Resolution' && status !== 'Revision Required' && !cascadeResets) {
      // Only clear blockers that were auto-set (prefixed with ⏸)
      if (project.blocker && project.blocker.startsWith('⏸')) {
        // Check if any OTHER tasks in current stage are still stuck
        const otherStuck = (TASKS[project.stage] ?? []).some(t =>
          t.id !== taskId && (taskStates[t.id] === 'Pending Resolution' || taskStates[t.id] === 'Revision Required')
        )
        if (!otherStuck) {
          await (supabase as any).from('projects').update({ blocker: null }).eq('id', pid)
          setProject(p => ({ ...p, blocker: null }))
          setBlockerInput('')
          onProjectUpdated()
        }
      }
    }

    // ── Auto-flip disposition when In Service task status changes ─────────
    if (taskId === 'in_service') {
      if (status === 'Complete') {
        await (supabase as any).from('projects').update({ disposition: 'In Service' }).eq('id', pid)
        setProject(p => ({ ...p, disposition: 'In Service' }))
        onProjectUpdated()
        showToast('Project marked In Service ✓')
        return // skip auto-advance toast below
      } else if (project.disposition === 'In Service') {
        await (supabase as any).from('projects').update({ disposition: 'Sale' }).eq('id', pid)
        setProject(p => ({ ...p, disposition: 'Sale' }))
        onProjectUpdated()
        showToast('Disposition reverted to Sale')
      }
    }

    // ── Auto-trigger funding milestone eligibility ───────────────────────
    if (status === 'Complete') {
      // install_done → M2 eligible, pto → M3 eligible
      const milestoneField = taskId === 'install_done' ? 'm2_status' : taskId === 'pto' ? 'm3_status' : null
      if (milestoneField) {
        // Only update if status is currently null/empty (not already submitted/funded)
        const { data: fundingRow } = await (supabase as any)
          .from('project_funding')
          .select(milestoneField)
          .eq('project_id', pid)
          .maybeSingle()
        const currentMsStatus = fundingRow?.[milestoneField]
        if (!currentMsStatus || currentMsStatus === 'Not Submitted') {
          await (supabase as any).from('project_funding').upsert(
            { project_id: pid, [milestoneField]: 'Eligible' },
            { onConflict: 'project_id' }
          )
          const msLabel = taskId === 'install_done' ? 'M2' : 'M3'
          showToast(`${msLabel} milestone now Eligible`)
        }
      }
    }

    // ── Auto-advance stage when all required tasks are Complete ───────────
    if (status === 'Complete' && !cascadeResets) {
      const updatedStates = { ...taskStates, [taskId]: status }
      const { ok } = canAdvance(project.stage, updatedStates)
      if (ok && nextStage) {
        await (supabase as any).from('projects').update({ stage: nextStage, stage_date: today }).eq('id', pid)
        await (supabase as any).from('stage_history').insert({ project_id: pid, stage: nextStage, entered: today })
        const { error: auditErr } = await (supabase as any).from('audit_log').insert({
          project_id: pid, field: 'stage',
          old_value: project.stage, new_value: nextStage,
          changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
        })
        if (auditErr) console.error('audit_log insert failed:', auditErr)
        setProject(p => ({ ...p, stage: nextStage as Project['stage'], stage_date: today }))
        onProjectUpdated()
        showToast(`All tasks done — advanced to ${STAGE_LABELS[nextStage]}`)
      }
    }
  }

  async function updateTaskReason(taskId: string, reason: string) {
    setTaskReasons(prev => ({ ...prev, [taskId]: reason }))
    await (supabase as any).from('task_state').upsert({
      project_id: pid,
      task_id: taskId,
      status: taskStates[taskId] ?? 'Not Ready',
      reason: reason || null,
    }, { onConflict: 'project_id,task_id' })

    const changedBy = currentUser?.name
      ?? userEmail.split('@')[0]
      ?? 'unknown'
    const { error: histError2 } = await (supabase as any).from('task_history').insert({
      project_id: pid,
      task_id: taskId,
      status: taskStates[taskId] ?? 'Not Ready',
      reason: reason || null,
      changed_by: changedBy,
    })
    if (histError2) console.error('task_history reason insert failed:', histError2)
    setTaskHistoryLoaded(false)
  }

  function isLocked(task: { pre: string[] }): boolean {
    return task.pre.some(preId => taskStates[preId] !== 'Complete')
  }

  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    const pm = currentUser?.name ?? userEmail.split('@')[0] ?? 'PM'
    await (supabase as any).from('notes').insert({
      project_id: pid, text: newNote.trim(),
      time: new Date().toISOString(), pm,
      pm_id: currentUser?.id ?? null,
    })
    setNewNote('')
    await loadNotes()
    setSaving(false)
    showToast('Note added')
  }

  async function setBlocker() {
    const text = blockerInput.trim()
    await (supabase as any).from('projects').update({ blocker: text || null }).eq('id', pid)
    setProject(p => ({ ...p, blocker: text || null }))
    setShowBlockerForm(false)
    onProjectUpdated()
    showToast(text ? 'Blocker set' : 'Blocker cleared')
  }

  async function saveEdits() {
    setEditSaving(true)
    await (supabase as any).from('projects').update(editDraft).eq('id', pid)

    // Audit log: record each changed field
    const auditEntries = Object.entries(editDraft)
      .filter(([key, val]) => String(val ?? '') !== String((project as any)[key] ?? ''))
      .map(([key, val]) => ({
        project_id: pid,
        field: key,
        old_value: (project as any)[key] != null ? String((project as any)[key]) : null,
        new_value: val != null ? String(val) : null,
        changed_by: currentUser?.name ?? null,
        changed_by_id: currentUser?.id ?? null,
      }))
    if (auditEntries.length > 0) {
      const { error: auditErr2 } = await (supabase as any).from('audit_log').insert(auditEntries)
      if (auditErr2) console.error('audit_log insert failed:', auditErr2)
    }

    setProject(p => ({ ...p, ...editDraft }))
    setEditMode(false)
    setEditDraft({})
    setEditSaving(false)
    onProjectUpdated()
    showToast('Project updated')
  }

  function startEdit() {
    setEditDraft({
      name: project.name, city: project.city, address: project.address,
      phone: project.phone, email: project.email,
      contract: project.contract, systemkw: project.systemkw,
      financier: project.financier, financing_type: project.financing_type,
      down_payment: project.down_payment, tpo_escalator: project.tpo_escalator,
      financier_adv_pmt: project.financier_adv_pmt, disposition: project.disposition,
      dealer: project.dealer, module: project.module, module_qty: project.module_qty,
      inverter: project.inverter, inverter_qty: project.inverter_qty,
      battery: project.battery, battery_qty: project.battery_qty,
      optimizer: project.optimizer, optimizer_qty: project.optimizer_qty,
      meter_location: project.meter_location, panel_location: project.panel_location,
      voltage: project.voltage, msp_bus_rating: project.msp_bus_rating,
      mpu: project.mpu, shutdown: project.shutdown,
      performance_meter: project.performance_meter,
      interconnection_breaker: project.interconnection_breaker,
      main_breaker: project.main_breaker, hoa: project.hoa, esid: project.esid,
      pm: project.pm, advisor: project.advisor, consultant: project.consultant,
      consultant_email: project.consultant_email, site_surveyor: project.site_surveyor,
      ahj: project.ahj, utility: project.utility,
      permit_number: project.permit_number, utility_app_number: project.utility_app_number,
      permit_fee: project.permit_fee,
      city_permit_date: project.city_permit_date, utility_permit_date: project.utility_permit_date,
      sale_date: project.sale_date, ntp_date: project.ntp_date,
      survey_scheduled_date: project.survey_scheduled_date, survey_date: project.survey_date,
      install_scheduled_date: project.install_scheduled_date, install_complete_date: project.install_complete_date,
      city_inspection_date: project.city_inspection_date, utility_inspection_date: project.utility_inspection_date,
      pto_date: project.pto_date, in_service_date: project.in_service_date,
    })
    setEditMode(true)
    setTab('info')
  }

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
    const { error: auditErr3 } = await (supabase as any).from('audit_log').insert({
      project_id: pid, field: 'stage',
      old_value: project.stage, new_value: nextStage,
      changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
    })
    if (auditErr3) console.error('audit_log insert failed:', auditErr3)
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
                {changeOrderCount > 0 && (
                  <>
                    <span>·</span>
                    <a href={`/change-orders?project=${project.id}`}
                      className="text-amber-400 hover:text-amber-300 hover:underline">
                      {changeOrderCount} Change Order{changeOrderCount !== 1 ? 's' : ''}
                    </a>
                  </>
                )}
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl ml-4 flex-shrink-0">×</button>
          </div>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {!showBlockerForm ? (
              <button onClick={() => setShowBlockerForm(true)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  project.blocker ? 'bg-red-900 text-red-300 hover:bg-red-800' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}>
                {project.blocker ? `🚫 ${project.blocker}` : '+ Set Blocker'}
              </button>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <input autoFocus value={blockerInput}
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
            {!showBlockerForm && !editMode && (currentUser?.isManager || currentUser?.id === project.pm_id) && (
              <button onClick={startEdit} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
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
            {nextStage && !showBlockerForm && (
              <button onClick={advanceStage} disabled={advancing}
                title={!advance.ok ? `Complete required tasks: ${advance.missing.join(', ')}` : ''}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  advance.ok ? 'bg-green-700 hover:bg-green-600 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                }`}>
                {advancing ? 'Moving...' : `→ ${STAGE_LABELS[nextStage]}`}
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {currentUser?.isAdmin && (
              project.disposition === 'Cancelled' ? (
                <button
                  onClick={async () => {
                    if (!confirm('Reactivate this project? It will return to the active pipeline.')) return
                    await (supabase as any).from('projects').update({ disposition: 'Sale' }).eq('id', project.id)
                    setProject(p => ({ ...p, disposition: 'Sale' }))
                    if (onProjectUpdated) onProjectUpdated()
                  }}
                  className="text-[10px] px-2 py-1 rounded text-green-400 hover:bg-green-900/30 transition-colors"
                >
                  Reactivate
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!confirm(`Cancel ${project.name}? It will be removed from the active pipeline.`)) return
                    await (supabase as any).from('projects').update({ disposition: 'Cancelled' }).eq('id', project.id)
                    setProject(p => ({ ...p, disposition: 'Cancelled' }))
                    if (onProjectUpdated) onProjectUpdated()
                  }}
                  className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-amber-400 hover:bg-amber-900/20 transition-colors"
                >
                  Cancel Project
                </button>
              )
            )}
              {currentUser?.isSuperAdmin && (
                <button
                  onClick={async () => {
                    if (!confirm(`DELETE ${project.name} (${project.id})? This cannot be undone.`)) return
                    if (!confirm('Are you absolutely sure? All project data will be permanently deleted.')) return
                    // Log deletion to audit trail before deleting
                    const { error: delAuditErr } = await (supabase as any).from('audit_log').insert({
                      project_id: project.id, field: 'project_deleted',
                      old_value: project.name, new_value: null,
                      changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
                    })
                    if (delAuditErr) console.error('audit_log delete insert failed:', delAuditErr)
                    await supabase.from('task_state').delete().eq('project_id', project.id)
                    await supabase.from('notes').delete().eq('project_id', project.id)
                    await (supabase as any).from('stage_history').delete().eq('project_id', project.id)
                    await (supabase as any).from('task_history').delete().eq('project_id', project.id)
                    await (supabase as any).from('schedule').delete().eq('project_id', project.id)
                    await (supabase as any).from('service_calls').delete().eq('project_id', project.id)
                    await (supabase as any).from('project_funding').delete().eq('project_id', project.id)
                    await (supabase as any).from('project_folders').delete().eq('project_id', project.id)
                    await (supabase as any).from('change_orders').delete().eq('project_id', project.id)
                    await supabase.from('projects').delete().eq('id', project.id)
                    onClose()
                    if (onProjectUpdated) onProjectUpdated()
                  }}
                  className="text-[10px] px-2 py-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                  title="Super admin only — permanently delete project and all related data"
                >
                  Delete
                </button>
              )}
            </div>
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
              }`}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* TASKS */}
          {tab === 'tasks' && (
            <TasksTab
              project={project}
              taskStates={taskStates}
              taskReasons={taskReasons}
              taskStatesRaw={taskStatesRaw}
              taskHistory={taskHistory}
              taskHistoryLoaded={taskHistoryLoaded}
              stageHistory={stageHistory}
              updateTaskStatus={updateTaskStatus}
              updateTaskReason={updateTaskReason}
            />
          )}


          {/* NOTES */}
          {tab === 'notes' && (
            <NotesTab notes={notes} newNote={newNote} setNewNote={setNewNote} addNote={addNote} saving={saving} />
          )}

          {/* INFO */}
          {tab === 'info' && (
            <InfoTab
              project={project}
              editMode={editMode}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              ahjInfo={ahjInfo}
              utilityInfo={utilityInfo}
              openAhjEdit={openAhjEdit}
              openUtilEdit={openUtilEdit}
              stageHistory={stageHistory}
              serviceCalls={serviceCalls}
            />
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

      {/* AHJ Edit Popup */}
      {ahjEdit && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setAhjEdit(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Edit AHJ — {ahjEdit.name}</h3>
              <button onClick={() => setAhjEdit(null)} className="text-gray-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Permit Phone</label>
                <input value={ahjEdit.permit_phone ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, permit_phone: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Permit Website</label>
                <input value={ahjEdit.permit_website ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, permit_website: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Max Duration (days)</label>
                  <input type="number" value={ahjEdit.max_duration ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, max_duration: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Electric Code</label>
                  <input value={ahjEdit.electric_code ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, electric_code: e.target.value || null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Permit Notes</label>
                <textarea rows={3} value={ahjEdit.permit_notes ?? ''} onChange={e => setAhjEdit((d: any) => ({ ...d, permit_notes: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setAhjEdit(null)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <button onClick={saveAhjEdit} disabled={refSaving}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50">
                {refSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revision Cascade Confirmation */}
      {cascadeConfirm && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => {
          // Cancel — reload task states from DB to ensure clean state
          setCascadeConfirm(null)
          loadTasks()
        }}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-400 text-lg">↩</span>
              <h3 className="text-sm font-semibold text-white">Revision Required</h3>
            </div>
            <p className="text-xs text-gray-300 mb-3">
              Setting <span className="text-white font-medium">{cascadeConfirm.taskName}</span> to Revision Required
              will reset {cascadeConfirm.resets.length} downstream task{cascadeConfirm.resets.length > 1 ? 's' : ''} to Not Ready:
            </p>
            <div className="bg-gray-800 rounded-lg p-3 mb-4 max-h-48 overflow-y-auto space-y-1.5">
              {cascadeConfirm.resets.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-200">{r.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    r.currentStatus === 'Complete' ? 'bg-green-900 text-green-300' :
                    r.currentStatus === 'In Progress' ? 'bg-blue-900 text-blue-300' :
                    r.currentStatus === 'Scheduled' ? 'bg-indigo-900 text-indigo-300' :
                    'bg-gray-700 text-gray-300'
                  }`}>{r.currentStatus} → Not Ready</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  // Cancel — reload task states from DB to ensure clean state
                  setCascadeConfirm(null)
                  loadTasks()
                }}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const { taskId, resets } = cascadeConfirm
                  setCascadeConfirm(null)
                  applyTaskStatus(taskId, 'Revision Required', resets.map(r => r.id))
                }}
                className="px-4 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded-md font-medium"
              >
                Reset {cascadeConfirm.resets.length} task{cascadeConfirm.resets.length > 1 ? 's' : ''} & continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Utility Edit Popup */}
      {utilEdit && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setUtilEdit(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Edit Utility — {utilEdit.name}</h3>
              <button onClick={() => setUtilEdit(null)} className="text-gray-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Phone</label>
                <input value={utilEdit.phone ?? ''} onChange={e => setUtilEdit((d: any) => ({ ...d, phone: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Website</label>
                <input value={utilEdit.website ?? ''} onChange={e => setUtilEdit((d: any) => ({ ...d, website: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <textarea rows={3} value={utilEdit.notes ?? ''} onChange={e => setUtilEdit((d: any) => ({ ...d, notes: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setUtilEdit(null)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <button onClick={saveUtilEdit} disabled={refSaving}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50">
                {refSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
