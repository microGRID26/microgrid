'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '@/lib/db'
import { daysAgo, STAGE_LABELS, STAGE_ORDER, escapeIlike } from '@/lib/utils'
import { TASKS, ALL_TASKS_MAP, ALL_TASKS_FLAT, TASK_TO_STAGE, TASK_DATE_FIELDS, getSameStageDownstream, isTaskRequired } from '@/lib/tasks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useEdgeSync } from '@/lib/hooks/useEdgeSync'
import type { Project, Note } from '@/types/database'
import { BomTab } from './BomTab'
import { TasksTab } from './TasksTab'
import { NotesTab } from './NotesTab'
import { InfoTab } from './InfoTab'
import { FilesTab } from './FilesTab'
import { MaterialsTab } from './MaterialsTab'
import { WarrantyTab } from './WarrantyTab'
import { ScheduleAssignModal } from './ScheduleAssignModal'
import { createWorkOrderFromProject } from '@/lib/api/work-orders'

// ── STAGE ADVANCE LOGIC ───────────────────────────────────────────────────────
function canAdvance(stage: string, taskStates: Record<string, string>, ahj?: string | null): { ok: boolean; missing: string[] } {
  const tasks = (TASKS[stage] ?? []).filter(t => isTaskRequired(t, ahj ?? null))
  const missing = tasks.filter(t => taskStates[t.id] !== 'Complete').map(t => t.name)
  return { ok: missing.length === 0, missing }
}

// ── MAIN PANEL ────────────────────────────────────────────────────────────────
interface ProjectPanelProps {
  project: Project
  onClose: () => void
  onProjectUpdated: () => void
  initialTab?: 'tasks' | 'notes' | 'info' | 'bom' | 'files' | 'materials' | 'warranty'
}

export function ProjectPanel({ project: initialProject, onClose, onProjectUpdated, initialTab }: ProjectPanelProps) {
  const supabase = db()
  const { user: currentUser } = useCurrentUser()
  const edgeSync = useEdgeSync()
  const [project, setProject] = useState<Project>(initialProject)
  const [tab, setTab] = useState<'tasks' | 'notes' | 'info' | 'bom' | 'files' | 'materials' | 'warranty'>(initialTab ?? 'tasks')
  useEffect(() => { if (initialTab) setTab(initialTab) }, [initialTab])
  const [taskStates, setTaskStates] = useState<Record<string, string>>({})
  const [taskReasons, setTaskReasons] = useState<Record<string, string>>({})
  const [taskNotes, setTaskNotes] = useState<Record<string, { id: string; text: string; time: string; pm: string | null }[]>>({})
  const [taskFollowUps, setTaskFollowUps] = useState<Record<string, string>>({})
  const [taskStatesRaw, setTaskStatesRaw] = useState<{task_id: string; status: string; reason?: string; completed_date?: string | null; started_date?: string | null; notes?: string | null; follow_up_date?: string | null}[]>([])
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
  const [hoaInfo, setHoaInfo] = useState<any>(null)
  const [financierInfo, setFinancierInfo] = useState<any>(null)
  const [ahjEdit, setAhjEdit] = useState<any>(null)
  const [utilEdit, setUtilEdit] = useState<any>(null)
  const [hoaEdit, setHoaEdit] = useState<any>(null)
  const [financierEdit, setFinancierEdit] = useState<any>(null)
  const [refSaving, setRefSaving] = useState(false)
  const [serviceCalls, setServiceCalls] = useState<any[]>([])
  const [stageHistory, setStageHistory] = useState<any[]>([])
  const [adders, setAdders] = useState<any[]>([])
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
  const [changeOrderSuggest, setChangeOrderSuggest] = useState<{
    taskName: string; reason: string; stage: string
  } | null>(null)
  const [coSaving, setCoSaving] = useState(false)
  const [scheduleModal, setScheduleModal] = useState<{ jobType: string; crews: any[] } | null>(null)
  const [showWOCreate, setShowWOCreate] = useState(false)
  const [woType, setWoType] = useState('install')
  const [woCreating, setWoCreating] = useState(false)
  // ── Notification rules (loaded once per panel mount) ──────────────────────
  const [notificationRules, setNotificationRules] = useState<{ id: string; task_id: string; trigger_status: string; trigger_reason: string | null; action_type: string; action_message: string; notify_role: string | null }[]>([])

  // Lock background scroll when panel is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const pid = project.id
  const stageTasks = TASKS[project.stage] ?? []
  const stageIdx = STAGE_ORDER.indexOf(project.stage)
  const nextStage = STAGE_ORDER[stageIdx + 1] ?? null

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const loadTasks = useCallback(async () => {
    const [taskRes, noteRes] = await Promise.all([
      supabase.from('task_state').select('task_id, status, reason, completed_date, started_date, follow_up_date').eq('project_id', pid),
      supabase.from('notes').select('id, task_id, text, time, pm').eq('project_id', pid).not('task_id', 'is', null).order('time', { ascending: true }),
    ])
    if (taskRes.error) console.error('loadTasks: task_state query failed', taskRes.error)
    if (noteRes.error) console.error('loadTasks: notes query failed', noteRes.error)
    if (taskRes.data) {
      const statusMap: Record<string, string> = {}
      const reasonMap: Record<string, string> = {}
      const followUpMap: Record<string, string> = {}
      taskRes.data.forEach((t: any) => {
        statusMap[t.task_id] = t.status
        if (t.reason) reasonMap[t.task_id] = t.reason
        if (t.follow_up_date) followUpMap[t.task_id] = t.follow_up_date
      })
      setTaskStates(statusMap)
      setTaskReasons(reasonMap)
      setTaskFollowUps(followUpMap)
      setTaskStatesRaw(taskRes.data)
    }
    if (noteRes.data) {
      const notesMap: Record<string, { id: string; text: string; time: string; pm: string | null }[]> = {}
      noteRes.data.forEach((n: any) => {
        if (!notesMap[n.task_id]) notesMap[n.task_id] = []
        notesMap[n.task_id].push({ id: n.id, text: n.text, time: n.time, pm: n.pm })
      })
      setTaskNotes(notesMap)
    }
  }, [pid])

  const loadNotes = useCallback(async () => {
    const { data, error } = await supabase.from('notes').select('*').eq('project_id', pid).is('task_id', null).order('time', { ascending: false })
    if (error) console.error('loadNotes: query failed', error)
    if (data) setNotes(data as Note[])
  }, [pid])

  const loadStageHistory = useCallback(async () => {
    const { data, error } = await supabase.from('stage_history').select('*').eq('project_id', pid).order('entered', { ascending: false })
    if (error) console.error('loadStageHistory: query failed', error)
    if (data) setStageHistory(data)
  }, [pid])

  // Lazy — only called when user navigates to History view
  // Indexes on project_id + changed_at keep this fast at 20k+ projects
  const loadTaskHistory = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_history')
      .select('task_id, status, reason, changed_by, changed_at')
      .eq('project_id', pid)
      .order('changed_at', { ascending: false })
      .limit(200)
    if (error) console.error('loadTaskHistory: query failed', error)
    if (data) {
      setTaskHistory(data)
      setTaskHistoryLoaded(true)
    }
  }, [pid])

  const loadServiceCalls = useCallback(async () => {
    const { data, error } = await supabase.from('service_calls').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(5)
    if (error) console.error('loadServiceCalls: query failed', error)
    if (data) setServiceCalls(data)
  }, [pid])

  const loadAdders = useCallback(async () => {
    const { data, error } = await supabase.from('project_adders').select('*').eq('project_id', pid).order('created_at', { ascending: true })
    if (error) console.error('loadAdders: query failed', error)
    if (data) setAdders(data)
  }, [pid])

  const addAdder = async (adder: { adder_name: string; price: number; quantity: number; total_amount: number }) => {
    await supabase.from('project_adders').insert({ project_id: pid, ...adder })
    await loadAdders()
  }

  const deleteAdder = async (adderId: string) => {
    await supabase.from('project_adders').delete().eq('id', adderId)
    await loadAdders()
  }

  const loadAhjUtil = useCallback(async () => {
    if (project.ahj) {
      const { data } = await supabase.from('ahjs').select('permit_phone,permit_website,max_duration,electric_code,permit_notes').ilike('name', `%${escapeIlike(project.ahj)}%`).limit(1).maybeSingle()
      setAhjInfo(data ?? null)
    }
    if (project.utility) {
      const { data } = await supabase.from('utilities').select('phone,website,notes').ilike('name', `%${escapeIlike(project.utility)}%`).limit(1).maybeSingle()
      setUtilityInfo(data ?? null)
    }
    if (project.hoa) {
      const { data } = await supabase.from('hoas').select('phone,website,contact_name,contact_email,notes').ilike('name', `%${escapeIlike(project.hoa)}%`).limit(1).maybeSingle()
      setHoaInfo(data ?? null)
    }
    if (project.financier) {
      const { data } = await supabase.from('financiers').select('phone,website,contact_name,contact_email,notes').ilike('name', `%${escapeIlike(project.financier)}%`).limit(1).maybeSingle()
      setFinancierInfo(data ?? null)
    }
  }, [pid, project.ahj, project.utility, project.hoa, project.financier])

  const openAhjEdit = async () => {
    if (!project.ahj) return
    const { data } = await supabase.from('ahjs').select('*').ilike('name', `%${escapeIlike(project.ahj)}%`).limit(1).maybeSingle()
    if (data) setAhjEdit({ ...data })
  }

  const saveAhjEdit = async () => {
    if (!ahjEdit) return
    setRefSaving(true)
    const { error } = await supabase.from('ahjs').update({
      permit_phone: ahjEdit.permit_phone,
      permit_website: ahjEdit.permit_website,
      max_duration: ahjEdit.max_duration,
      electric_code: ahjEdit.electric_code,
      permit_notes: ahjEdit.permit_notes,
    }).eq('id', ahjEdit.id)
    if (error) { showToast('Save failed'); setRefSaving(false); return }
    setRefSaving(false)
    setAhjEdit(null)
    loadAhjUtil()
  }

  const openUtilEdit = async () => {
    if (!project.utility) return
    const { data } = await supabase.from('utilities').select('*').ilike('name', `%${escapeIlike(project.utility)}%`).limit(1).maybeSingle()
    if (data) setUtilEdit({ ...data })
  }

  const saveUtilEdit = async () => {
    if (!utilEdit) return
    setRefSaving(true)
    const { error } = await supabase.from('utilities').update({
      phone: utilEdit.phone,
      website: utilEdit.website,
      notes: utilEdit.notes,
    }).eq('id', utilEdit.id)
    if (error) { showToast('Save failed'); setRefSaving(false); return }
    setRefSaving(false)
    setUtilEdit(null)
    loadAhjUtil()
  }

  const openHoaEdit = async () => {
    if (!project.hoa) return
    const { data } = await supabase.from('hoas').select('*').ilike('name', `%${escapeIlike(project.hoa)}%`).limit(1).maybeSingle()
    if (data) setHoaEdit({ ...data })
  }

  const saveHoaEdit = async () => {
    if (!hoaEdit) return
    setRefSaving(true)
    const { error } = await supabase.from('hoas').update({
      phone: hoaEdit.phone,
      website: hoaEdit.website,
      contact_name: hoaEdit.contact_name,
      contact_email: hoaEdit.contact_email,
      notes: hoaEdit.notes,
    }).eq('id', hoaEdit.id)
    if (error) { showToast('Save failed'); setRefSaving(false); return }
    setRefSaving(false)
    setHoaEdit(null)
    loadAhjUtil()
  }

  const openFinancierEdit = async () => {
    if (!project.financier) return
    const { data } = await supabase.from('financiers').select('*').ilike('name', `%${escapeIlike(project.financier)}%`).limit(1).maybeSingle()
    if (data) setFinancierEdit({ ...data })
  }

  const saveFinancierEdit = async () => {
    if (!financierEdit) return
    setRefSaving(true)
    const { error } = await supabase.from('financiers').update({
      phone: financierEdit.phone,
      website: financierEdit.website,
      contact_name: financierEdit.contact_name,
      contact_email: financierEdit.contact_email,
      notes: financierEdit.notes,
    }).eq('id', financierEdit.id)
    if (error) { showToast('Save failed'); setRefSaving(false); return }
    setRefSaving(false)
    setFinancierEdit(null)
    loadAhjUtil()
  }

  const loadFolder = useCallback(async () => {
    const { data } = await supabase.from('project_folders').select('folder_url').eq('project_id', pid).maybeSingle()
    setFolderUrl(data?.folder_url ?? null)
  }, [pid])

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data }: any) => {
      if (mounted) setUserEmail(data.user?.email ?? '')
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    let mounted = true
    setProject(initialProject)
    setBlockerInput(initialProject.blocker ?? '')
    // Fetch full project data (parent pages may pass trimmed columns from optimized queries)
    supabase.from('projects').select('*').eq('id', initialProject.id).single().then(({ data }: any) => {
      if (mounted && data) {
        setProject(data as Project)
        setBlockerInput((data as Project).blocker ?? '')
      }
    })
    return () => { mounted = false }
  }, [initialProject.id])

  useEffect(() => {
    let mounted = true
    setAhjInfo(null)
    setUtilityInfo(null)
    setHoaInfo(null)
    setTaskHistory([])
    setTaskHistoryLoaded(false)
    // Parallelize all data loading
    Promise.all([
      loadTasks(),
      loadNotes(),
      loadFolder(),
      loadAhjUtil(),
      loadServiceCalls(),
      loadStageHistory(),
      loadAdders(),
    ]).catch(() => { /* individual loaders handle errors */ })
    // Load notification rules (cached for panel lifetime)
    ;supabase.from('notification_rules').select('id, task_id, trigger_status, trigger_reason, action_type, action_message, notify_role').eq('active', true).then(({ data: rulesData }: { data: { id: string; task_id: string; trigger_status: string; trigger_reason: string | null; action_type: string; action_message: string; notify_role: string | null }[] | null }) => {
      if (mounted && rulesData) setNotificationRules(rulesData)
    }).catch(() => { /* non-critical */ })
    // Load change order count for this project
    ;supabase.from('change_orders')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', initialProject.id)
      .not('status', 'in', '("Complete","Cancelled")')
      .then(({ count }: any) => { if (mounted) setChangeOrderCount(count ?? 0) })
      .catch(() => { /* non-critical */ })
    return () => { mounted = false }
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
    const startedDate = status === 'In Progress' && !existingRaw?.started_date
      ? today : undefined

    const upsertPayload: Record<string, any> = {
      project_id: pid,
      task_id: taskId,
      status,
      reason: needsReason ? (taskReasons[taskId] ?? null) : null,
      completed_date: status === 'Complete' ? today : null,
    }
    if (startedDate) upsertPayload.started_date = startedDate

    const { error: upsertErr } = await supabase.from('task_state').upsert(upsertPayload, { onConflict: 'project_id,task_id' })
    if (upsertErr) console.error('task_state upsert failed:', upsertErr)

    const changedBy = currentUser?.name
      ?? userEmail.split('@')[0]
      ?? 'unknown'
    // Log to task_history — await to ensure it completes
    const { error: histError } = await supabase.from('task_history').insert({
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
      const { error: cascadeErr } = await supabase.from('task_state').upsert(resetUpdates, { onConflict: 'project_id,task_id' })
      if (cascadeErr) console.error('cascade reset upsert failed:', cascadeErr)

      // Log each reset to history
      const historyInserts = cascadeResets.map(id => ({
        project_id: pid,
        task_id: id,
        status: 'Not Ready',
        reason: null,
        changed_by: `${changedBy} (cascade)`,
      }))
      const { error: cascadeHistErr } = await supabase.from('task_history').insert(historyInserts)
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
        if (df && (project as unknown as Record<string, unknown>)[df]) dateClearUpdates[df] = null
      }
      if (Object.keys(dateClearUpdates).length > 0) {
        const { error: dateClearErr } = await supabase.from('projects').update(dateClearUpdates).eq('id', pid)
        if (dateClearErr) console.error('cascade date clear failed:', dateClearErr)
        setProject(p => ({ ...p, ...dateClearUpdates }))
      }

      showToast(`Reset ${cascadeResets.length} downstream task${cascadeResets.length > 1 ? 's' : ''}`)
    }

    // ── Auto-set dependent tasks to Ready To Start ─────────────────────
    if (status === 'Complete') {
      const updatedStates = { ...taskStates, [taskId]: 'Complete' }
      if (cascadeResets) cascadeResets.forEach(id => { updatedStates[id] = 'Not Ready' })
      const autoReadyUpdates: { project_id: string; task_id: string; status: string }[] = []
      for (const stageTasks of Object.values(TASKS)) {
        for (const t of stageTasks) {
          if (updatedStates[t.id] && updatedStates[t.id] !== 'Not Ready') continue
          if (t.pre.length === 0) continue
          const allPresMet = t.pre.every(preId => updatedStates[preId] === 'Complete')
          if (allPresMet) {
            autoReadyUpdates.push({ project_id: pid, task_id: t.id, status: 'Ready To Start' })
            updatedStates[t.id] = 'Ready To Start'
          }
        }
      }
      if (autoReadyUpdates.length > 0) {
        for (const u of autoReadyUpdates) {
          await supabase.from('task_state').upsert(u, { onConflict: 'project_id,task_id' })
        }
        setTaskStates(prev => {
          const next = { ...prev }
          autoReadyUpdates.forEach(u => { next[u.task_id] = 'Ready To Start' })
          return next
        })
      }
    }

    // Invalidate cache so History view reloads fresh on next open
    setTaskHistoryLoaded(false)

    // ── Suggest change order after Revision Required ────────────────────
    if (status === 'Revision Required') {
      const reason = taskReasons[taskId] ?? ''
      const stage = TASK_TO_STAGE[taskId] ?? project.stage
      const taskName = ALL_TASKS_MAP[taskId] ?? taskId
      setChangeOrderSuggest({ taskName, reason, stage })
    }

    // ── Auto-populate project date when task is marked Complete ────────────
    // Only set if the field is currently empty — never overwrite manual entries
    if (status === 'Complete') {
      const dateField = TASK_DATE_FIELDS[taskId]
      if (dateField && !(project as unknown as Record<string, unknown>)[dateField]) {
        const { error: dateSetErr } = await supabase.from('projects').update({ [dateField]: today }).eq('id', pid)
        if (dateSetErr) console.error('auto-populate date failed:', dateSetErr)
        setProject(p => ({ ...p, [dateField]: today }))
      }
    }

    // ── Auto-clear project date when task is un-completed ────────────────
    if (status !== 'Complete' && !cascadeResets) {
      const dateField = TASK_DATE_FIELDS[taskId]
      if (dateField && (project as unknown as Record<string, unknown>)[dateField]) {
        const { error: dateClearErr2 } = await supabase.from('projects').update({ [dateField]: null }).eq('id', pid)
        if (dateClearErr2) console.error('auto-clear date failed:', dateClearErr2)
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
        const { error: blockerSetErr } = await supabase.from('projects').update({ blocker: blockerText }).eq('id', pid)
        if (blockerSetErr) console.error('auto-set blocker failed:', blockerSetErr)
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
          const { error: blockerClearErr } = await supabase.from('projects').update({ blocker: null }).eq('id', pid)
          if (blockerClearErr) console.error('auto-clear blocker failed:', blockerClearErr)
          setProject(p => ({ ...p, blocker: null }))
          setBlockerInput('')
          onProjectUpdated()
        }
      }
    }

    // ── Database-driven notification rules ──────────────────────────────
    const currentReason = taskReasons[taskId] ?? ''
    const matchingRules = notificationRules.filter(r =>
      r.task_id === taskId &&
      r.trigger_status === status &&
      (!r.trigger_reason || r.trigger_reason === currentReason)
    )
    for (const rule of matchingRules) {
      if (rule.action_type === 'note') {
        const { error: noteErr } = await supabase.from('notes').insert({
          project_id: pid,
          text: rule.action_message,
          time: new Date().toISOString(),
          pm: 'System',
          pm_id: null,
        })
        if (noteErr) console.error('notification rule note insert failed:', noteErr)
        else setNotes(prev => [{ id: crypto.randomUUID(), project_id: pid, task_id: null, text: rule.action_message, time: new Date().toISOString(), pm: 'System', pm_id: null }, ...prev])
      }
      showToast(rule.action_message.slice(0, 80))
    }

    // ── Auto-flip disposition when In Service task status changes ─────────
    if (taskId === 'in_service') {
      if (status === 'Complete') {
        const { error: dispErr } = await supabase.from('projects').update({ disposition: 'In Service' }).eq('id', pid)
        if (dispErr) { console.error('disposition update failed:', dispErr); showToast('Update failed'); return }
        setProject(p => ({ ...p, disposition: 'In Service' }))
        onProjectUpdated()
        edgeSync.notifyInService(pid)
        showToast('Project marked In Service ✓')
        return // skip auto-advance toast below
      } else if (project.disposition === 'In Service') {
        const { error: dispErr2 } = await supabase.from('projects').update({ disposition: 'Sale' }).eq('id', pid)
        if (dispErr2) { console.error('disposition revert failed:', dispErr2); showToast('Update failed'); return }
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
        const { data: fundingRow } = await supabase
          .from('project_funding')
          .select(milestoneField)
          .eq('project_id', pid)
          .maybeSingle()
        const currentMsStatus = fundingRow?.[milestoneField]
        if (!currentMsStatus || currentMsStatus === 'Not Submitted') {
          const { error: fundingErr } = await supabase.from('project_funding').upsert(
            { project_id: pid, [milestoneField]: 'Eligible' },
            { onConflict: 'project_id' }
          )
          if (fundingErr) console.error('funding milestone upsert failed:', fundingErr)
          const msLabel = taskId === 'install_done' ? 'M2' : 'M3'
          showToast(`${msLabel} milestone now Eligible`)
          // ── Notify EDGE of funding milestone + install/PTO events ──
          if (taskId === 'install_done') {
            edgeSync.notifyInstallComplete(pid, today)
          } else if (taskId === 'pto') {
            edgeSync.notifyPTOReceived(pid, today)
          }
        }
      }
    }

    // ── Auto-advance stage when all required tasks are Complete ───────────
    if (status === 'Complete' && !cascadeResets) {
      const updatedStates = { ...taskStates, [taskId]: status }
      const { ok } = canAdvance(project.stage, updatedStates, project.ahj)
      if (ok && nextStage) {
        const { error: advErr } = await supabase.from('projects').update({ stage: nextStage, stage_date: today }).eq('id', pid)
        if (advErr) { console.error('auto stage advance failed:', advErr); showToast('Failed to auto-advance stage'); return }
        const { error: histErr } = await supabase.from('stage_history').insert({ project_id: pid, stage: nextStage, entered: today })
        if (histErr) { console.error('stage_history insert failed:', histErr); showToast('Failed to log stage history') }
        const { error: auditErr } = await supabase.from('audit_log').insert({
          project_id: pid, field: 'stage',
          old_value: project.stage, new_value: nextStage,
          changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
        })
        if (auditErr) console.error('audit_log insert failed:', auditErr)
        setProject(p => ({ ...p, stage: nextStage as Project['stage'], stage_date: today }))
        onProjectUpdated()
        edgeSync.notifyStageChanged(pid, project.stage, nextStage)
        showToast(`All tasks done — advanced to ${STAGE_LABELS[nextStage]}`)
      }
    }
  }

  async function updateTaskReason(taskId: string, reason: string) {
    setTaskReasons(prev => ({ ...prev, [taskId]: reason }))
    await supabase.from('task_state').upsert({
      project_id: pid,
      task_id: taskId,
      status: taskStates[taskId] ?? 'Not Ready',
      reason: reason || null,
    }, { onConflict: 'project_id,task_id' })

    const changedBy = currentUser?.name
      ?? userEmail.split('@')[0]
      ?? 'unknown'
    const { error: histError2 } = await supabase.from('task_history').insert({
      project_id: pid,
      task_id: taskId,
      status: taskStates[taskId] ?? 'Not Ready',
      reason: reason || null,
      changed_by: changedBy,
    })
    if (histError2) console.error('task_history reason insert failed:', histError2)
    setTaskHistoryLoaded(false)
  }

  async function addTaskNote(taskId: string, text: string) {
    const note = {
      project_id: pid,
      task_id: taskId,
      text,
      time: new Date().toISOString(),
      pm: currentUser?.name ?? null,
      pm_id: currentUser?.id ?? null,
    }
    const { data } = await supabase.from('notes').insert(note).select('id, task_id, text, time, pm').single()
    if (data) {
      setTaskNotes(prev => {
        const next = { ...prev }
        if (!next[taskId]) next[taskId] = []
        next[taskId] = [...next[taskId], { id: data.id, text: data.text, time: data.time, pm: data.pm }]
        return next
      })
    }
  }

  async function updateTaskFollowUp(taskId: string, date: string | null) {
    setTaskFollowUps(prev => {
      const next = { ...prev }
      if (date) next[taskId] = date; else delete next[taskId]
      return next
    })
    const { error } = await supabase.from('task_state').upsert({
      project_id: pid,
      task_id: taskId,
      status: taskStates[taskId] ?? 'Not Ready',
      follow_up_date: date,
    }, { onConflict: 'project_id,task_id' })
    if (error) showToast('Failed to save follow-up date')
  }

  function isLocked(task: { pre: string[] }): boolean {
    return task.pre.some(preId => taskStates[preId] !== 'Complete')
  }

  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    const pm = currentUser?.name ?? userEmail.split('@')[0] ?? 'PM'
    const { error: noteErr } = await supabase.from('notes').insert({
      project_id: pid, text: newNote.trim(),
      time: new Date().toISOString(), pm,
      pm_id: currentUser?.id ?? null,
    })
    if (noteErr) { console.error('note insert failed:', noteErr); showToast('Failed to add note'); setSaving(false); return }
    setNewNote('')
    await loadNotes()
    setSaving(false)
    showToast('Note added')
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase.from('notes').delete().eq('id', noteId)
    if (error) { showToast('Failed to delete note'); return }
    await loadNotes()
    showToast('Note deleted')
  }

  async function setBlocker() {
    const text = blockerInput.trim()
    const { error: blockerErr } = await supabase.from('projects').update({ blocker: text || null }).eq('id', pid)
    if (blockerErr) {
      console.error('blocker update failed:', blockerErr)
      showToast('Failed to update blocker')
      return
    }
    setProject(p => ({ ...p, blocker: text || null }))
    setShowBlockerForm(false)
    onProjectUpdated()
    showToast(text ? 'Blocker set' : 'Blocker cleared')
  }

  async function saveEdits() {
    // Validate phone if changed
    if (editDraft.phone) {
      const phoneDigits = String(editDraft.phone).replace(/[\s\-().+]/g, '')
      if (!/^\d{10,}$/.test(phoneDigits)) {
        showToast('Phone must be a valid number (at least 10 digits)')
        return
      }
    }
    // Validate email if changed
    if (editDraft.email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(editDraft.email).trim())) {
        showToast('Email must be a valid email address')
        return
      }
    }
    // Validate consultant email if changed
    if (editDraft.consultant_email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(editDraft.consultant_email).trim())) {
        showToast('Consultant email must be a valid email address')
        return
      }
    }

    setEditSaving(true)
    const { error: updateErr } = await supabase.from('projects').update(editDraft).eq('id', pid)
    if (updateErr) {
      console.error('project update failed:', updateErr)
      showToast('Save failed')
      setEditSaving(false)
      return
    }

    // Audit log: record each changed field
    const auditEntries = Object.entries(editDraft)
      .filter(([key, val]) => String(val ?? '') !== String((project as unknown as Record<string, unknown>)[key] ?? ''))
      .map(([key, val]) => ({
        project_id: pid,
        field: key,
        old_value: (project as unknown as Record<string, unknown>)[key] != null ? String((project as unknown as Record<string, unknown>)[key]) : null,
        new_value: val != null ? String(val) : null,
        changed_by: currentUser?.name ?? null,
        changed_by_id: currentUser?.id ?? null,
      }))
    if (auditEntries.length > 0) {
      const { error: auditErr2 } = await supabase.from('audit_log').insert(auditEntries)
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
      follow_up_date: project.follow_up_date,
    })
    setEditMode(true)
    setTab('info')
  }

  async function advanceStage() {
    if (!nextStage) return
    const { ok, missing } = canAdvance(project.stage, taskStates, project.ahj)
    if (!ok) {
      showToast(`Complete required tasks first: ${missing.slice(0,2).join(', ')}${missing.length > 2 ? '...' : ''}`)
      return
    }
    setAdvancing(true)
    const today = new Date().toISOString().slice(0, 10)
    const { error: stageErr } = await supabase.from('projects').update({ stage: nextStage, stage_date: today }).eq('id', pid)
    if (stageErr) {
      console.error('stage advance failed:', stageErr)
      showToast('Failed to advance stage')
      setAdvancing(false)
      return
    }
    const { error: histErr } = await supabase.from('stage_history').insert({ project_id: pid, stage: nextStage, entered: today })
    if (histErr) console.error('stage_history insert failed:', histErr)
    const { error: auditErr3 } = await supabase.from('audit_log').insert({
      project_id: pid, field: 'stage',
      old_value: project.stage, new_value: nextStage,
      changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
    })
    if (auditErr3) console.error('audit_log insert failed:', auditErr3)
    setProject(p => ({ ...p, stage: nextStage as Project['stage'], stage_date: today }))
    setAdvancing(false)
    onProjectUpdated()
    edgeSync.notifyStageChanged(pid, project.stage, nextStage)
    showToast(`Moved to ${STAGE_LABELS[nextStage]}`)
  }

  const stuckCount = stageTasks.filter(t => {
    const s = taskStates[t.id] ?? 'Not Ready'
    return s === 'Pending Resolution' || s === 'Revision Required'
  }).length

  const days = daysAgo(project.stage_date)
  const cycle = daysAgo(project.sale_date) || days
  const advance = canAdvance(project.stage, taskStates, project.ahj)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="hidden md:flex flex-1 bg-black/50" onClick={onClose} />
      <div className="w-full md:max-w-4xl bg-gray-900 flex flex-col shadow-2xl overflow-hidden">

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
                {project.follow_up_date && (() => {
                  const today = new Date().toISOString().split('T')[0]
                  const isOverdueOrToday = project.follow_up_date! <= today
                  return (
                    <>
                      <span>·</span>
                      <span className={`flex items-center gap-1 ${isOverdueOrToday ? 'text-amber-400' : 'text-gray-500'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
                        Follow-up {new Date(project.follow_up_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </>
                  )
                })()}
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
            {currentUser?.isSales ? (
              /* Sales users see blocker status read-only */
              project.blocker ? (
                <span className="text-xs px-3 py-1.5 rounded-lg font-medium bg-red-900 text-red-300">
                  🚫 {project.blocker}
                </span>
              ) : null
            ) : !showBlockerForm ? (
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
            {!showBlockerForm && !editMode && currentUser && !currentUser.isSales && (
              <>
                <button onClick={startEdit} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  ✏ Edit
                </button>
                <button onClick={() => setShowWOCreate(true)} className="text-xs px-3 py-1.5 rounded-lg font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                  + Work Order
                </button>
              </>
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
            {nextStage && !showBlockerForm && !currentUser?.isSales && (
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
                    const { error: reactErr } = await supabase.from('projects').update({ disposition: 'Sale' }).eq('id', project.id)
                    if (reactErr) { console.error('reactivate failed:', reactErr); showToast('Reactivate failed'); return }
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
                    const { error: cancelErr } = await supabase.from('projects').update({ disposition: 'Cancelled' }).eq('id', project.id)
                    if (cancelErr) { console.error('cancel failed:', cancelErr); showToast('Cancel failed'); return }
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
                    const { error: delAuditErr } = await supabase.from('audit_log').insert({
                      project_id: project.id, field: 'project_deleted',
                      old_value: project.name, new_value: null,
                      changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
                    })
                    if (delAuditErr) console.error('audit_log delete insert failed:', delAuditErr)
                    const { error: delErr1 } = await supabase.from('task_state').delete().eq('project_id', project.id)
                    if (delErr1) console.error('task_state delete failed:', delErr1)
                    const { error: delErr2 } = await supabase.from('notes').delete().eq('project_id', project.id)
                    if (delErr2) console.error('notes delete failed:', delErr2)
                    const { error: delErr3 } = await supabase.from('stage_history').delete().eq('project_id', project.id)
                    if (delErr3) console.error('stage_history delete failed:', delErr3)
                    const { error: delErr4 } = await supabase.from('task_history').delete().eq('project_id', project.id)
                    if (delErr4) console.error('task_history delete failed:', delErr4)
                    const { error: delErr5 } = await supabase.from('schedule').delete().eq('project_id', project.id)
                    if (delErr5) console.error('schedule delete failed:', delErr5)
                    const { error: delErr6 } = await supabase.from('service_calls').delete().eq('project_id', project.id)
                    if (delErr6) console.error('service_calls delete failed:', delErr6)
                    const { error: delErr7 } = await supabase.from('project_funding').delete().eq('project_id', project.id)
                    if (delErr7) console.error('project_funding delete failed:', delErr7)
                    const { error: delErr8 } = await supabase.from('project_folders').delete().eq('project_id', project.id)
                    if (delErr8) console.error('project_folders delete failed:', delErr8)
                    const { error: delErr9 } = await supabase.from('change_orders').delete().eq('project_id', project.id)
                    if (delErr9) console.error('change_orders delete failed:', delErr9)
                    const { error: delErr10 } = await supabase.from('projects').delete().eq('id', project.id)
                    if (delErr10) console.error('projects delete failed:', delErr10)
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
            { id: 'materials', label: 'Materials', stuck: false },
            { id: 'warranty', label: 'Warranty', stuck: false },
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
              taskNotes={taskNotes}
              taskFollowUps={taskFollowUps}
              taskStatesRaw={taskStatesRaw}
              taskHistory={taskHistory}
              taskHistoryLoaded={taskHistoryLoaded}
              stageHistory={stageHistory}
              updateTaskStatus={updateTaskStatus}
              updateTaskReason={updateTaskReason}
              addTaskNote={addTaskNote}
              updateTaskFollowUp={updateTaskFollowUp}
              onScheduleTask={async (jobType) => {
                const { data } = await supabase.from('crews').select('id, name, warehouse').eq('active', 'TRUE').order('name')
                setScheduleModal({ jobType, crews: data ?? [] })
              }}
              folderUrl={folderUrl}
            />
          )}


          {/* NOTES */}
          {tab === 'notes' && (
            <NotesTab notes={notes} newNote={newNote} setNewNote={setNewNote} addNote={addNote} deleteNote={deleteNote} saving={saving} folderUrl={folderUrl} projectId={pid} currentUserName={currentUser?.name} />
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
              hoaInfo={hoaInfo}
              financierInfo={financierInfo}
              openAhjEdit={openAhjEdit}
              openUtilEdit={openUtilEdit}
              openHoaEdit={openHoaEdit}
              openFinancierEdit={openFinancierEdit}
              stageHistory={stageHistory}
              serviceCalls={serviceCalls}
              adders={adders}
              onAddAdder={addAdder}
              onDeleteAdder={deleteAdder}
              isSales={currentUser?.isSales ?? false}
            />
          )}

          {/* BOM */}
          {tab === 'bom' && <BomTab project={project} />}

          {/* MATERIALS */}
          {tab === 'materials' && <MaterialsTab project={project} />}

          {/* WARRANTY */}
          {tab === 'warranty' && <WarrantyTab project={project} />}

          {/* FILES */}
          {tab === 'files' && <FilesTab folderUrl={folderUrl} projectId={pid} currentStage={project.stage} />}
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

      {/* Change Order Suggestion — after Revision Required */}
      {changeOrderSuggest && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setChangeOrderSuggest(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-blue-400 text-lg">📋</span>
              <h3 className="text-sm font-semibold text-white">Create Change Order?</h3>
            </div>
            <p className="text-xs text-gray-300 mb-4">
              <span className="text-white font-medium">{changeOrderSuggest.taskName}</span> was set to Revision Required
              {changeOrderSuggest.reason ? ` for "${changeOrderSuggest.reason}"` : ''}.
              Would you like to create a change order to track this?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setChangeOrderSuggest(null)}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md"
              >
                Skip
              </button>
              <button
                disabled={coSaving}
                onClick={async () => {
                  setCoSaving(true)
                  const now = new Date().toISOString()
                  const userName = currentUser?.name ?? userEmail.split('@')[0] ?? 'unknown'
                  const p = project
                  const { data, error } = await supabase
                    .from('change_orders')
                    .insert({
                      project_id: project.id,
                      title: `${changeOrderSuggest.reason || changeOrderSuggest.taskName} - ${project.name}`,
                      status: 'Open',
                      priority: 'Medium',
                      type: 'HCO Change Order',
                      reason: changeOrderSuggest.reason || null,
                      origin: `Revision Required: ${changeOrderSuggest.taskName}`,
                      created_by: userName,
                      created_at: now,
                      updated_at: now,
                      original_panel_count: p.module_qty ?? null,
                      original_panel_type: p.module ?? null,
                      original_system_size: p.systemkw ?? null,
                    })
                    .select('id')
                    .single()
                  setCoSaving(false)
                  setChangeOrderSuggest(null)
                  if (data) {
                    setChangeOrderCount(prev => prev + 1)
                    showToast('Change order created')
                  } else {
                    console.error('Failed to create change order:', error)
                    showToast('Failed to create change order')
                  }
                }}
                className="px-4 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded-md font-medium"
              >
                {coSaving ? 'Creating...' : 'Create Change Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Job Modal — opened from TasksTab quick schedule button */}
      {scheduleModal && (
        <ScheduleAssignModal
          crewId={null}
          date={new Date().toISOString().slice(0, 10)}
          scheduleId={null}
          projectId={project.id}
          jobType={scheduleModal.jobType}
          crews={scheduleModal.crews}
          onClose={() => setScheduleModal(null)}
          onSaved={() => { setScheduleModal(null); loadTasks(); showToast('Job scheduled') }}
        />
      )}

      {/* Create Work Order Modal */}
      {showWOCreate && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setShowWOCreate(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Create Work Order</h3>
              <button onClick={() => setShowWOCreate(false)} className="text-gray-500 hover:text-white text-lg">&times;</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Project</label>
                <div className="text-sm text-white">{project.name} ({project.id})</div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Type</label>
                <select value={woType} onChange={e => setWoType(e.target.value)}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none">
                  <option value="install">Installation</option>
                  <option value="service">Service</option>
                  <option value="inspection">Inspection</option>
                  <option value="repair">Repair</option>
                  <option value="survey">Survey</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowWOCreate(false)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <button
                onClick={async () => {
                  setWoCreating(true)
                  const result = await createWorkOrderFromProject(project.id, woType, {
                    name: project.name,
                    address: project.address,
                    city: project.city,
                  }, { createdBy: currentUser?.name ?? undefined })
                  setWoCreating(false)
                  setShowWOCreate(false)
                  if (result) {
                    showToast(`Work order ${result.wo_number} created`)
                  } else {
                    showToast('Failed to create work order')
                  }
                }}
                disabled={woCreating}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50"
              >
                {woCreating ? 'Creating...' : 'Create'}
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

      {/* HOA Edit Popup */}
      {hoaEdit && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setHoaEdit(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Edit HOA — {hoaEdit.name}</h3>
              <button onClick={() => setHoaEdit(null)} className="text-gray-500 hover:text-white text-lg">×</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Contact Name</label>
                  <input value={hoaEdit.contact_name ?? ''} onChange={e => setHoaEdit((d: any) => ({ ...d, contact_name: e.target.value || null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Phone</label>
                  <input value={hoaEdit.phone ?? ''} onChange={e => setHoaEdit((d: any) => ({ ...d, phone: e.target.value || null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Contact Email</label>
                <input value={hoaEdit.contact_email ?? ''} onChange={e => setHoaEdit((d: any) => ({ ...d, contact_email: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Website</label>
                <input value={hoaEdit.website ?? ''} onChange={e => setHoaEdit((d: any) => ({ ...d, website: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <textarea rows={3} value={hoaEdit.notes ?? ''} onChange={e => setHoaEdit((d: any) => ({ ...d, notes: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setHoaEdit(null)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <button onClick={saveHoaEdit} disabled={refSaving}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50">
                {refSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Financier Edit Popup */}
      {financierEdit && (
        <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center" onClick={() => setFinancierEdit(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Edit Financier — {financierEdit.name}</h3>
              <button onClick={() => setFinancierEdit(null)} className="text-gray-500 hover:text-white text-lg">x</button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Contact Name</label>
                  <input value={financierEdit.contact_name ?? ''} onChange={e => setFinancierEdit((d: any) => ({ ...d, contact_name: e.target.value || null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Phone</label>
                  <input value={financierEdit.phone ?? ''} onChange={e => setFinancierEdit((d: any) => ({ ...d, phone: e.target.value || null }))}
                    className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Contact Email</label>
                <input value={financierEdit.contact_email ?? ''} onChange={e => setFinancierEdit((d: any) => ({ ...d, contact_email: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Website</label>
                <input value={financierEdit.website ?? ''} onChange={e => setFinancierEdit((d: any) => ({ ...d, website: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Notes</label>
                <textarea rows={3} value={financierEdit.notes ?? ''} onChange={e => setFinancierEdit((d: any) => ({ ...d, notes: e.target.value || null }))}
                  className="w-full bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setFinancierEdit(null)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <button onClick={saveFinancierEdit} disabled={refSaving}
                className="px-4 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md font-medium disabled:opacity-50">
                {refSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
