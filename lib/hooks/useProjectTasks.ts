'use client'

import { useState, useCallback, useEffect } from 'react'
import { db } from '@/lib/db'
import { TASKS, ALL_TASKS_MAP, ALL_TASKS_FLAT, TASK_TO_STAGE, TASK_DATE_FIELDS, getSameStageDownstream, isTaskRequired } from '@/lib/tasks'
import { STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import type { Project, Note } from '@/types/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TaskStateRaw {
  task_id: string
  status: string
  reason?: string
  completed_date?: string | null
  started_date?: string | null
  notes?: string | null
  follow_up_date?: string | null
}

interface TaskNoteEntry {
  id: string
  text: string
  time: string
  pm: string | null
}

interface CascadeConfirm {
  taskId: string
  taskName: string
  resets: { id: string; name: string; currentStatus: string }[]
  previousStatus?: string  // status before optimistic update, for rollback on cancel
}

interface ChangeOrderSuggest {
  taskName: string
  reason: string
  stage: string
}

interface NotificationRule {
  id: string
  task_id: string
  trigger_status: string
  trigger_reason: string | null
  action_type: string
  action_message: string
  notify_role: string | null
}

interface CurrentUserShape {
  id: string
  name: string
  isAdmin?: boolean
  isSuperAdmin?: boolean
  isSales?: boolean
}

interface EdgeSyncShape {
  notifyInstallComplete: (projectId: string, date: string) => void
  notifyPTOReceived: (projectId: string, date: string) => void
  notifyStageChanged: (projectId: string, from: string, to: string) => void
  notifyInService: (projectId: string) => void
}

export interface UseProjectTasksOptions {
  project: Project
  setProject: React.Dispatch<React.SetStateAction<Project>>
  setBlockerInput: React.Dispatch<React.SetStateAction<string>>
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  onProjectUpdated: () => void
  showToast: (msg: string) => void
  currentUser: CurrentUserShape | null
  userEmail: string
  edgeSync: EdgeSyncShape
}

export interface UseProjectTasksReturn {
  taskStates: Record<string, string>
  taskReasons: Record<string, string>
  taskNotes: Record<string, TaskNoteEntry[]>
  taskFollowUps: Record<string, string>
  taskStatesRaw: TaskStateRaw[]
  taskHistory: any[]
  taskHistoryLoaded: boolean
  cascadeConfirm: CascadeConfirm | null
  setCascadeConfirm: React.Dispatch<React.SetStateAction<CascadeConfirm | null>>
  changeOrderSuggest: ChangeOrderSuggest | null
  setChangeOrderSuggest: React.Dispatch<React.SetStateAction<ChangeOrderSuggest | null>>
  coSaving: boolean
  setCoSaving: React.Dispatch<React.SetStateAction<boolean>>
  notificationRules: NotificationRule[]
  changeOrderCount: number
  setChangeOrderCount: React.Dispatch<React.SetStateAction<number>>
  cancelCascade: () => void
  loadTasks: () => Promise<void>
  loadTaskHistory: () => Promise<void>
  updateTaskStatus: (taskId: string, status: string) => Promise<void>
  applyTaskStatus: (taskId: string, status: string, cascadeResets?: string[]) => Promise<void>
  updateTaskReason: (taskId: string, reason: string) => Promise<void>
  addTaskNote: (taskId: string, text: string) => Promise<void>
  updateTaskFollowUp: (taskId: string, date: string | null) => Promise<void>
  isLocked: (task: { pre: string[] }) => boolean
  setTaskReasons: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

// ── Stage advance check ───────────────────────────────────────────────────────

function canAdvance(stage: string, taskStates: Record<string, string>, ahj?: string | null): { ok: boolean; missing: string[] } {
  const tasks = (TASKS[stage] ?? []).filter(t => isTaskRequired(t, ahj ?? null))
  const missing = tasks.filter(t => taskStates[t.id] !== 'Complete').map(t => t.name)
  return { ok: missing.length === 0, missing }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useProjectTasks(opts: UseProjectTasksOptions): UseProjectTasksReturn {
  const {
    project, setProject, setBlockerInput, setNotes,
    onProjectUpdated, showToast,
    currentUser, userEmail, edgeSync,
  } = opts

  const supabase = db()
  const pid = project.id

  // ── Task state ────────────────────────────────────────────────────────────
  const [taskStates, setTaskStates] = useState<Record<string, string>>({})
  const [taskReasons, setTaskReasons] = useState<Record<string, string>>({})
  const [taskNotes, setTaskNotes] = useState<Record<string, TaskNoteEntry[]>>({})
  const [taskFollowUps, setTaskFollowUps] = useState<Record<string, string>>({})
  const [taskStatesRaw, setTaskStatesRaw] = useState<TaskStateRaw[]>([])

  // ── Task history ──────────────────────────────────────────────────────────
  const [taskHistory, setTaskHistory] = useState<any[]>([])
  const [taskHistoryLoaded, setTaskHistoryLoaded] = useState(false)

  // ── Revision cascade confirmation ─────────────────────────────────────────
  const [cascadeConfirm, setCascadeConfirm] = useState<CascadeConfirm | null>(null)

  // ── Change order suggestion ───────────────────────────────────────────────
  const [changeOrderSuggest, setChangeOrderSuggest] = useState<ChangeOrderSuggest | null>(null)
  const [coSaving, setCoSaving] = useState(false)
  const [changeOrderCount, setChangeOrderCount] = useState(0)

  // ── Notification rules (loaded once per panel mount) ──────────────────────
  const [notificationRules, setNotificationRules] = useState<NotificationRule[]>([])

  // ── Data loading ──────────────────────────────────────────────────────────

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
      const notesMap: Record<string, TaskNoteEntry[]> = {}
      noteRes.data.forEach((n: any) => {
        if (!notesMap[n.task_id]) notesMap[n.task_id] = []
        notesMap[n.task_id].push({ id: n.id, text: n.text, time: n.time, pm: n.pm })
      })
      setTaskNotes(notesMap)
    }
  }, [pid])

  // Lazy — only called when user navigates to History view
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

  // Load notification rules and change order count on mount / project change
  useEffect(() => {
    let mounted = true
    setTaskHistory([])
    setTaskHistoryLoaded(false)

    // Load notification rules (cached for panel lifetime)
    supabase.from('notification_rules').select('id, task_id, trigger_status, trigger_reason, action_type, action_message, notify_role').eq('active', true).then(({ data: rulesData }: { data: NotificationRule[] | null }) => {
      if (mounted && rulesData) setNotificationRules(rulesData)
    }).catch(() => { /* non-critical */ })

    // Load change order count for this project
    supabase.from('change_orders')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', pid)
      .not('status', 'in', '("Complete","Cancelled")')
      .then(({ count }: any) => { if (mounted) setChangeOrderCount(count ?? 0) })
      .catch(() => { /* non-critical */ })

    return () => { mounted = false }
  }, [pid])

  // Eager-load task history for inline expansion in stage view
  useEffect(() => {
    if (!taskHistoryLoaded) {
      loadTaskHistory()
    }
  }, [taskHistoryLoaded, loadTaskHistory])

  // ── Task status change (with cascade check) ──────────────────────────────

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
        // Save previous status for rollback if user cancels the cascade dialog
        const previousStatus = taskStates[taskId] ?? 'Not Ready'
        // Show confirmation — don't save yet
        setCascadeConfirm({ taskId, taskName: ALL_TASKS_FLAT[taskId]?.name ?? taskId, resets, previousStatus })
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
    if (upsertErr) { console.error('task_state upsert failed:', upsertErr); showToast('Failed to save task status — please retry'); return }

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
      if (cascadeErr) { console.error('cascade reset upsert failed:', cascadeErr); showToast('Failed to reset downstream tasks') }

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
        const { error: autoReadyErr } = await supabase.from('task_state').upsert(autoReadyUpdates, { onConflict: 'project_id,task_id' })
        if (autoReadyErr) { console.error('auto-ready upsert failed:', autoReadyErr); showToast('Failed to update dependent tasks') }
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
        if (dateSetErr) { console.error('auto-populate date failed:', dateSetErr); showToast('Failed to set project date') }
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
    // Prefix auto-set blockers with pause icon so we can distinguish from manual blockers
    if (status === 'Pending Resolution') {
      const taskName = ALL_TASKS_MAP[taskId] ?? taskId
      const reason = needsReason ? (taskReasons[taskId] ?? '') : ''
      const blockerText = `⏸ ${taskName}${reason ? ': ' + reason : ''}`
      // Only auto-set if no blocker currently exists
      if (!project.blocker) {
        const { error: blockerSetErr } = await supabase.from('projects').update({ blocker: blockerText }).eq('id', pid)
        if (blockerSetErr) { console.error('auto-set blocker failed:', blockerSetErr); showToast('Failed to set blocker') }
        setProject(p => ({ ...p, blocker: blockerText }))
        setBlockerInput(blockerText)
        onProjectUpdated()
      }
    }

    // ── Email notification for stuck tasks ─────────────────────────────
    if (status === 'Pending Resolution' || status === 'Revision Required') {
      const taskName = ALL_TASKS_MAP[taskId] ?? taskId
      const reason = taskReasons[taskId] ?? ''
      fetch('/api/notifications/stuck-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: pid,
          projectName: project.name,
          taskName,
          status,
          reason,
          pmEmail: userEmail,
          pmName: currentUser,
        }),
      }).catch(err => console.error('stuck-task notification failed:', err))
    }

    // ── Auto-clear blocker when task resolves (only if auto-set) ─────────
    if (status !== 'Pending Resolution' && status !== 'Revision Required' && !cascadeResets) {
      // Only clear blockers that were auto-set (prefixed with pause icon)
      if (project.blocker && project.blocker.startsWith('⏸')) {
        // Check if any OTHER tasks in current stage are still stuck
        const otherStuck = (TASKS[project.stage] ?? []).some(t =>
          t.id !== taskId && (taskStates[t.id] === 'Pending Resolution' || taskStates[t.id] === 'Revision Required')
        )
        if (!otherStuck) {
          const { error: blockerClearErr } = await supabase.from('projects').update({ blocker: null }).eq('id', pid)
          if (blockerClearErr) { console.error('auto-clear blocker failed:', blockerClearErr); showToast('Failed to clear blocker') }
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
        showToast('Project marked In Service')
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
      // install_done -> M2 eligible, pto -> M3 eligible
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
          if (fundingErr) { console.error('funding milestone upsert failed:', fundingErr); showToast('Failed to update funding milestone') }
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
    const stageIdx = STAGE_ORDER.indexOf(project.stage)
    const nextStage = STAGE_ORDER[stageIdx + 1] ?? null
    if (status === 'Complete' && !cascadeResets) {
      const updatedStatesForAdvance = { ...taskStates, [taskId]: status }
      const { ok } = canAdvance(project.stage, updatedStatesForAdvance, project.ahj)
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

  // ── Cancel cascade — revert optimistic update without DB reload ───────────

  function cancelCascade() {
    if (cascadeConfirm?.previousStatus != null) {
      setTaskStates(prev => ({ ...prev, [cascadeConfirm.taskId]: cascadeConfirm.previousStatus! }))
    }
    setCascadeConfirm(null)
  }

  // ── Task reason update ────────────────────────────────────────────────────

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

  // ── Add task note ─────────────────────────────────────────────────────────

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

  // ── Update task follow-up date ────────────────────────────────────────────

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

  // ── Lock check ────────────────────────────────────────────────────────────

  function isLocked(task: { pre: string[] }): boolean {
    return task.pre.some(preId => taskStates[preId] !== 'Complete')
  }

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    taskStates,
    taskReasons,
    taskNotes,
    taskFollowUps,
    taskStatesRaw,
    taskHistory,
    taskHistoryLoaded,
    cascadeConfirm,
    setCascadeConfirm,
    cancelCascade,
    changeOrderSuggest,
    setChangeOrderSuggest,
    coSaving,
    setCoSaving,
    notificationRules,
    changeOrderCount,
    setChangeOrderCount,
    loadTasks,
    loadTaskHistory,
    updateTaskStatus,
    applyTaskStatus,
    updateTaskReason,
    addTaskNote,
    updateTaskFollowUp,
    isLocked,
    setTaskReasons,
  }
}
