'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { STAGE_LABELS, STAGE_ORDER, SLA_THRESHOLDS, daysAgo } from '@/lib/utils'
import { TASKS, TASK_STATUSES, STATUS_STYLE, PENDING_REASONS, REVISION_REASONS, ALL_TASKS_MAP, TASK_TO_STAGE, isTaskRequired } from '@/lib/tasks'
import type { Project } from '@/types/database'
import { MessageSquare } from 'lucide-react'

// ── isLocked helper ──────────────────────────────────────────────────────────
function isLocked(task: { pre: string[] }, taskStates: Record<string, string>): boolean {
  return task.pre.some(preId => taskStates[preId] !== 'Complete')
}

// ── ROW BORDER / BG STYLES ──────────────────────────────────────────────────
function rowStyle(status: string): string {
  switch (status) {
    case 'Complete':           return 'border-l-2 border-l-green-500 bg-green-950/20'
    case 'Pending Resolution': return 'border-l-2 border-l-red-500 bg-red-950/20'
    case 'Revision Required':  return 'border-l-2 border-l-amber-500 bg-amber-950/20'
    case 'In Progress':        return 'border-l-2 border-l-blue-500 bg-blue-950/10'
    case 'Scheduled':          return 'border-l-2 border-l-indigo-400'
    default:                   return 'border-l-2 border-l-transparent'
  }
}

// ── SLA color helper ────────────────────────────────────────────────────────
function slaColor(stage: string, days: number): string {
  const t = SLA_THRESHOLDS[stage]
  if (!t) return 'text-gray-500'
  if (days >= t.crit) return 'text-red-400'
  if (days >= t.risk) return 'text-amber-400'
  return 'text-green-400'
}

// ── PROPS ────────────────────────────────────────────────────────────────────
interface TaskNote {
  id: string
  text: string
  time: string
  pm: string | null
}

interface TasksTabProps {
  project: Project
  taskStates: Record<string, string>
  taskReasons: Record<string, string>
  taskNotes: Record<string, TaskNote[]>
  taskFollowUps: Record<string, string>
  taskStatesRaw: { task_id: string; status: string; reason?: string; completed_date?: string | null; started_date?: string | null; notes?: string | null; follow_up_date?: string | null }[]
  taskHistory: any[]
  taskHistoryLoaded: boolean
  stageHistory: any[]
  updateTaskStatus: (taskId: string, status: string) => void
  updateTaskReason: (taskId: string, reason: string) => void
  addTaskNote: (taskId: string, text: string) => void
  updateTaskFollowUp: (taskId: string, date: string | null) => void
  onScheduleTask?: (jobType: string) => void
}

// Tasks that can be scheduled — maps task_id to schedule job_type
const SCHEDULABLE_TASKS: Record<string, string> = {
  sched_survey: 'survey',
  sched_install: 'install',
  sched_city: 'inspection',
  sched_util: 'inspection',
}

// ── Task note input (add new note) ──────────────────────────────────────────
function TaskNoteInput({ taskId, onAdd }: { taskId: string; onAdd: (taskId: string, text: string) => void }) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const submit = () => { if (draft.trim()) { onAdd(taskId, draft.trim()); setDraft('') } }
  return (
    <div className="px-3 py-1.5 pl-10 border-b border-gray-800/60 bg-gray-800/30 flex gap-2">
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        className="flex-1 bg-gray-700 text-gray-200 text-[11px] rounded px-2 py-1.5 border-0 focus:outline-none focus:ring-1 focus:ring-green-500/50"
        placeholder="Add a note for this task..."
      />
      <button onClick={submit} disabled={!draft.trim()} className="text-[10px] bg-green-900 text-green-400 px-2 py-1 rounded hover:bg-green-800 transition-colors disabled:opacity-30">Add</button>
    </div>
  )
}

// ── Format relative time ────────────────────────────────────────────────────
function fmtNoteTime(t: string) {
  const d = new Date(t)
  if (isNaN(d.getTime())) return t
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ── COMPONENT ────────────────────────────────────────────────────────────────
export function TasksTab({
  project,
  taskStates,
  taskReasons,
  taskNotes,
  taskFollowUps,
  taskStatesRaw,
  taskHistory,
  taskHistoryLoaded,
  stageHistory,
  updateTaskStatus,
  updateTaskReason,
  addTaskNote,
  updateTaskFollowUp,
  onScheduleTask,
}: TasksTabProps) {
  const [viewStage, setViewStage] = useState<string>(project.stage)
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'stages' | 'history'>('stages')
  const [editingNoteTask, setEditingNoteTask] = useState<string | null>(null)

  // ── Computed: stage completion counts ──────────────────────────────────────
  const stageCounts = useMemo(() => {
    const counts: Record<string, { done: number; total: number; stuck: number }> = {}
    for (const stageId of STAGE_ORDER) {
      const tasks = TASKS[stageId] ?? []
      const done = tasks.filter(t => taskStates[t.id] === 'Complete').length
      const stuck = tasks.filter(t =>
        taskStates[t.id] === 'Pending Resolution' || taskStates[t.id] === 'Revision Required'
      ).length
      counts[stageId] = { done, total: tasks.length, stuck }
    }
    return counts
  }, [taskStates])

  // ── Computed: revision counts per task from history ────────────────────────
  const revisionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const entry of taskHistory) {
      if (entry.status === 'Revision Required') {
        counts[entry.task_id] = (counts[entry.task_id] ?? 0) + 1
      }
    }
    return counts
  }, [taskHistory])

  // ── Computed: task-level history lookup ────────────────────────────────────
  const taskHistoryByTask = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const entry of taskHistory) {
      if (!map[entry.task_id]) map[entry.task_id] = []
      map[entry.task_id].push(entry)
    }
    return map
  }, [taskHistory])

  // ── Days in the viewed stage ──────────────────────────────────────────────
  const viewedStageDays = useMemo(() => {
    if (viewStage === project.stage) return daysAgo(project.stage_date)
    const entry = stageHistory.find((h: any) => h.stage === viewStage)
    if (!entry) return 0
    const sorted = [...stageHistory].sort((a: any, b: any) =>
      new Date(a.entered).getTime() - new Date(b.entered).getTime()
    )
    const idx = sorted.findIndex((h: any) => h.stage === viewStage)
    if (idx >= 0 && idx < sorted.length - 1) {
      const entered = new Date(sorted[idx].entered + 'T00:00:00').getTime()
      const exited = new Date(sorted[idx + 1].entered + 'T00:00:00').getTime()
      return Math.max(0, Math.floor((exited - entered) / 86400000))
    }
    return daysAgo(entry.entered)
  }, [viewStage, project.stage, project.stage_date, stageHistory])

  const viewedTasks = TASKS[viewStage] ?? []
  const isCurrent = viewStage === project.stage
  const sc = stageCounts[viewStage] ?? { done: 0, total: 0, stuck: 0 }
  const pct = sc.total > 0 ? Math.round((sc.done / sc.total) * 100) : 0

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl">

        {/* ── View Mode Toggle ─────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('stages')}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewMode === 'stages' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Stage View
            </button>
            <button
              onClick={() => setViewMode('history')}
              className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                viewMode === 'history' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Full History
            </button>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════ */}
        {/* STAGE VIEW                                                  */}
        {/* ════════════════════════════════════════════════════════════ */}
        {viewMode === 'stages' && (
          <>
            {/* ── Stage Navigation Bar ───────────────────────────────── */}
            <div className="flex flex-wrap gap-1 mb-4">
              {STAGE_ORDER.filter(s => TASKS[s]).map(stageId => {
                const c = stageCounts[stageId] ?? { done: 0, total: 0, stuck: 0 }
                const active = stageId === viewStage
                const isCur = stageId === project.stage
                return (
                  <button
                    key={stageId}
                    onClick={() => setViewStage(stageId)}
                    className={`text-xs px-2.5 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                      active
                        ? 'bg-gray-700 text-white ring-1 ring-gray-600'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    {isCur && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
                    <span>{STAGE_LABELS[stageId]}</span>
                    <span className={`text-[10px] ${
                      c.done === c.total && c.total > 0 ? 'text-green-400' :
                      c.stuck > 0 ? 'text-red-400' : 'text-gray-500'
                    }`}>
                      {c.done}/{c.total}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* ── Stage Progress Header ──────────────────────────────── */}
            <div className="bg-gray-800/50 rounded-lg px-4 py-3 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-bold text-white uppercase tracking-wider">
                  {STAGE_LABELS[viewStage]}
                </span>
                {isCurrent && (
                  <span className="text-[10px] bg-green-900 text-green-300 px-1.5 py-0.5 rounded font-medium uppercase">
                    Current
                  </span>
                )}
                <span className={`text-xs ${slaColor(viewStage, viewedStageDays)}`}>
                  {viewedStageDays}d in stage
                </span>
                {sc.stuck > 0 && (
                  <span className="text-xs text-red-400 font-medium">{sc.stuck} stuck</span>
                )}
                <span className="text-xs text-gray-500 ml-auto">{pct}%</span>
              </div>
              {/* Progress bar */}
              <div className="mt-2 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct === 100 ? 'bg-green-500' :
                    isCurrent && SLA_THRESHOLDS[viewStage] && viewedStageDays >= SLA_THRESHOLDS[viewStage].crit ? 'bg-red-500' :
                    isCurrent && SLA_THRESHOLDS[viewStage] && viewedStageDays >= SLA_THRESHOLDS[viewStage].risk ? 'bg-amber-500' :
                    'bg-blue-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* ── Task Table ──────────────────────────────────────────── */}
            {viewedTasks.length === 0 ? (
              <div className="text-gray-500 text-xs text-center py-8">No tasks defined for this stage.</div>
            ) : (
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                {/* Task rows */}
                {viewedTasks.map(task => {
                  const status = taskStates[task.id] ?? 'Not Ready'
                  const reason = taskReasons[task.id] ?? ''
                  const tNotes = taskNotes[task.id] ?? []
                  const followUp = taskFollowUps[task.id] ?? null
                  const locked = isLocked(task, taskStates)
                  const rawEntry = taskStatesRaw.find(t => t.task_id === task.id)
                  const completedDate = rawEntry?.completed_date ?? null
                  const startedDate = (rawEntry as any)?.started_date ?? null
                  const revCount = revisionCounts[task.id] ?? 0
                  const isExpanded = expandedTask === task.id
                  const history = taskHistoryByTask[task.id] ?? []
                  const showReason = status === 'Pending Resolution' || status === 'Revision Required'
                  const pendingReasons = PENDING_REASONS[task.id] ?? []
                  const revisionReasonsList = REVISION_REASONS[viewStage] ?? []
                  const reasonOptions = status === 'Pending Resolution' ? pendingReasons : revisionReasonsList
                  const isEditingNote = editingNoteTask === task.id

                  return (
                    <div key={task.id}>
                      {/* Main row */}
                      <div
                        className={`flex items-center gap-2 px-3 py-2 border-b border-gray-800/60 ${
                          rowStyle(status)
                        } ${locked ? 'opacity-40' : ''}`}
                      >
                        {/* Required indicator */}
                        <div className="w-3 flex-shrink-0 text-center">
                          {isTaskRequired(task, project.ahj) && <span className="text-green-500 text-xs font-bold">*</span>}
                        </div>

                        {/* Expand chevron */}
                        <div className="w-4 flex-shrink-0 text-center">
                          {history.length > 0 ? (
                            <button
                              onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                              className="text-gray-500 hover:text-white text-xs transition-colors"
                            >
                              {isExpanded ? '▾' : '▸'}
                            </button>
                          ) : null}
                        </div>

                        {/* Task name + note icon */}
                        <span className={`flex-1 text-xs truncate min-w-0 flex items-center gap-1 ${
                          locked ? 'text-gray-600' :
                          isTaskRequired(task, project.ahj) ? 'text-gray-100' : 'text-gray-400'
                        }`}>
                          <span className="truncate">
                            {locked && '🔒 '}{task.name}
                            {!isTaskRequired(task, project.ahj) && <span className="text-gray-600 ml-1">(opt)</span>}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingNoteTask(isEditingNote ? null : task.id) }}
                            className={`flex-shrink-0 transition-colors flex items-center gap-0.5 ${
                              tNotes.length ? 'text-green-500 hover:text-green-400' : 'text-gray-600 hover:text-gray-400'
                            }`}
                            title={tNotes.length ? `${tNotes.length} note(s)` : 'Add note'}
                          >
                            <MessageSquare size={12} />
                            {tNotes.length > 0 && <span className="text-[9px]">{tNotes.length}</span>}
                          </button>
                        </span>

                        {/* Revision count badge */}
                        {revCount > 0 && (
                          <span className="text-[10px] bg-amber-900/60 text-amber-400 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                            {revCount} rev
                          </span>
                        )}

                        {/* Duration badge — shows days from started to completed */}
                        {startedDate && completedDate && (() => {
                          const s = new Date(String(startedDate).slice(0, 10) + 'T00:00:00').getTime()
                          const c = new Date(String(completedDate).slice(0, 10) + 'T00:00:00').getTime()
                          if (isNaN(s) || isNaN(c)) return null
                          const days = Math.max(0, Math.round((c - s) / 86400000))
                          return (
                            <span className="text-[10px] bg-blue-900/40 text-blue-400 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                              {days}d
                            </span>
                          )
                        })()}

                        {/* In-progress duration — days since started (not yet complete) */}
                        {startedDate && !completedDate && status === 'In Progress' && (() => {
                          const s = new Date(String(startedDate).slice(0, 10) + 'T00:00:00').getTime()
                          if (isNaN(s)) return null
                          const days = Math.max(0, Math.round((Date.now() - s) / 86400000))
                          if (days === 0) return null
                          return (
                            <span className="text-[10px] bg-blue-900/20 text-blue-300 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                              {days}d
                            </span>
                          )
                        })()}

                        {/* Completed date */}
                        {completedDate && (
                          <span className="text-[10px] text-gray-500 flex-shrink-0">
                            {(() => {
                              const raw = String(completedDate).slice(0, 10)
                              const d = new Date(raw + 'T00:00:00')
                              return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            })()}
                          </span>
                        )}

                        {/* Quick schedule button for schedulable tasks */}
                        {onScheduleTask && SCHEDULABLE_TASKS[task.id] && !locked && status === 'Ready To Start' && (
                          <button
                            onClick={() => onScheduleTask(SCHEDULABLE_TASKS[task.id])}
                            className="text-[10px] bg-green-900/60 text-green-400 px-1.5 py-0.5 rounded font-medium flex-shrink-0 hover:bg-green-800/60 transition-colors"
                          >
                            Schedule
                          </button>
                        )}

                        {/* Status dropdown */}
                        <select
                          value={status}
                          disabled={locked}
                          onChange={e => updateTaskStatus(task.id, e.target.value)}
                          className={`text-xs rounded px-2 py-1.5 md:px-1.5 md:py-0.5 border-0 cursor-pointer flex-shrink-0 ${
                            STATUS_STYLE[status] ?? 'bg-gray-800 text-gray-400'
                          } ${locked ? 'cursor-not-allowed' : ''}`}
                        >
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>

                      {/* Task notes + follow-up — expandable section */}
                      {isEditingNote && (
                        <div className="border-b border-gray-800/60 bg-gray-900/30">
                          {/* Follow-up date */}
                          <div className="px-3 py-1.5 pl-10 flex items-center gap-2 border-b border-gray-800/40">
                            <span className="text-[10px] text-gray-500">Follow-up:</span>
                            <input
                              type="date"
                              value={followUp ?? ''}
                              onChange={e => updateTaskFollowUp(task.id, e.target.value || null)}
                              className="text-[11px] bg-gray-800 text-gray-300 border border-gray-700 rounded px-1.5 py-0.5 focus:outline-none focus:border-green-500"
                            />
                            {followUp && (
                              <button onClick={() => updateTaskFollowUp(task.id, null)} className="text-[10px] text-red-400 hover:text-red-300">clear</button>
                            )}
                            {followUp && followUp <= new Date().toISOString().split('T')[0] && (
                              <span className="text-[10px] text-amber-400 font-medium">
                                {followUp === new Date().toISOString().split('T')[0] ? 'Due today' : 'Overdue'}
                              </span>
                            )}
                          </div>
                          {/* Existing notes */}
                          {tNotes.map(n => (
                            <div key={n.id} className="px-3 py-1 pl-10 border-b border-gray-800/40">
                              <div className="flex items-baseline gap-2">
                                <span className="text-[10px] text-green-500 font-medium">{n.pm ?? 'Unknown'}</span>
                                <span className="text-[9px] text-gray-600">{fmtNoteTime(n.time)}</span>
                              </div>
                              <div className="text-[11px] text-gray-400">{n.text}</div>
                            </div>
                          ))}
                          {tNotes.length === 0 && (
                            <div className="px-3 py-1 pl-10 text-[10px] text-gray-600 italic">No notes yet</div>
                          )}
                          {/* Add new note */}
                          <TaskNoteInput taskId={task.id} onAdd={addTaskNote} />
                        </div>
                      )}

                      {/* Follow-up indicator (when section is collapsed) */}
                      {!isEditingNote && followUp && followUp <= new Date().toISOString().split('T')[0] && (
                        <div className="px-3 py-0.5 pl-10 border-b border-gray-800/40 bg-amber-950/10 cursor-pointer" onClick={() => setEditingNoteTask(task.id)}>
                          <span className="text-[10px] text-amber-400">📅 Follow-up {followUp === new Date().toISOString().split('T')[0] ? 'due today' : 'overdue'}</span>
                        </div>
                      )}

                      {/* Reason row — shown below when Pending/Revision */}
                      {showReason && (
                        <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/60 pl-10 ${
                          status === 'Pending Resolution' ? 'bg-red-950/10' : 'bg-amber-950/10'
                        }`}>
                          <span className="text-[10px] text-gray-500 flex-shrink-0">Reason</span>
                          {reasonOptions.length > 0 ? (
                            <select
                              value={reason}
                              onChange={e => updateTaskReason(task.id, e.target.value)}
                              className={`text-xs rounded px-2 py-1.5 md:px-1.5 md:py-0.5 border-0 cursor-pointer flex-1 ${
                                status === 'Pending Resolution' ? 'bg-red-950 text-red-300' : 'bg-amber-950 text-amber-300'
                              }`}
                            >
                              <option value="">Select reason...</option>
                              {reasonOptions.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={reason}
                              placeholder="Enter reason..."
                              onChange={e => updateTaskReason(task.id, e.target.value)}
                              className={`text-xs rounded px-2 py-1.5 md:px-1.5 md:py-0.5 border-0 flex-1 ${
                                status === 'Pending Resolution' ? 'bg-red-950 text-red-300 placeholder:text-red-800' : 'bg-amber-950 text-amber-300 placeholder:text-amber-800'
                              }`}
                            />
                          )}
                        </div>
                      )}

                      {/* Saved reason — dim context when status changed away */}
                      {!showReason && reason && (
                        <div className="px-3 py-1 pl-10 border-b border-gray-800/60">
                          <span className="text-[11px] text-gray-600 italic">{reason}</span>
                        </div>
                      )}

                      {/* Expanded inline history */}
                      {isExpanded && history.length > 0 && (
                        <div className="bg-gray-850 border-b border-gray-800/60 pl-10 pr-4 py-2">
                          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 font-medium">
                            History ({history.length})
                          </div>
                          <div className="space-y-1">
                            {history.map((entry: any, i: number) => {
                              const when = entry.changed_at
                                ? new Date(entry.changed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : ''
                              const time = entry.changed_at
                                ? new Date(entry.changed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                                : ''
                              return (
                                <div key={`${entry.task_id}-${entry.changed_at}-${i}`} className="flex items-center gap-2 text-[11px]">
                                  <span className="text-gray-600 w-16 flex-shrink-0">{when}</span>
                                  <span className="text-gray-600 w-14 flex-shrink-0">{time}</span>
                                  <span className={`px-1 py-0.5 rounded flex-shrink-0 ${STATUS_STYLE[entry.status] ?? 'bg-gray-800 text-gray-500'}`}>
                                    {entry.status}
                                  </span>
                                  {entry.reason && (
                                    <span className={`truncate ${
                                      entry.status === 'Pending Resolution' ? 'text-red-400' :
                                      entry.status === 'Revision Required'  ? 'text-amber-400' : 'text-gray-500'
                                    }`}>{entry.reason}</span>
                                  )}
                                  {entry.changed_by && entry.changed_by !== 'migration' && (
                                    <span className="text-gray-600 ml-auto flex-shrink-0">{entry.changed_by}</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Legend */}
            <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-600">
              <span><span className="text-green-500 font-bold">*</span> = required</span>
              <span>Rev = revision count</span>
            </div>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* FULL HISTORY VIEW                                           */}
        {/* ════════════════════════════════════════════════════════════ */}
        {viewMode === 'history' && (
          <div>
            {!taskHistoryLoaded ? (
              <div className="text-xs text-gray-500 text-center py-12 animate-pulse">
                Loading history...
              </div>
            ) : taskHistory.length === 0 ? (
              <div className="text-xs text-gray-500 text-center py-12">
                No history recorded yet.
              </div>
            ) : (
              <>
                <div className="text-xs text-gray-600 mb-3">{taskHistory.length} change{taskHistory.length !== 1 ? 's' : ''} — most recent first</div>
                <div className="divide-y divide-gray-800">
                  {[...taskHistory].sort((a, b) => {
                    const ta = a.changed_at ? new Date(a.changed_at).getTime() : 0
                    const tb = b.changed_at ? new Date(b.changed_at).getTime() : 0
                    return tb - ta
                  }).map((entry, i) => {
                    const taskName = ALL_TASKS_MAP[entry.task_id] ?? entry.task_id
                    const stage = TASK_TO_STAGE[entry.task_id]
                    const when = entry.changed_at
                      ? new Date(entry.changed_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        })
                      : ''
                    return (
                      <div key={`${entry.task_id}-${entry.changed_at}-${i}`} className={`flex items-start gap-3 py-2.5 px-2 hover:bg-gray-800/40 rounded ${rowStyle(entry.status)}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {stage && (
                              <span className="text-[10px] text-gray-600 uppercase">{STAGE_LABELS[stage]}</span>
                            )}
                            <span className="text-xs font-medium text-gray-200">{taskName}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${STATUS_STYLE[entry.status] ?? 'bg-gray-800 text-gray-500'}`}>
                              {entry.status}
                            </span>
                          </div>
                          {entry.reason && (
                            <div className={`mt-0.5 text-xs px-1.5 py-0.5 rounded inline-block ${
                              entry.status === 'Pending Resolution' ? 'bg-red-950 text-red-400' :
                              entry.status === 'Revision Required'  ? 'bg-amber-950 text-amber-400' : 'text-gray-500'
                            }`}>{entry.reason}</div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          {entry.changed_by && entry.changed_by !== 'migration' && (
                            <div className="text-xs text-gray-400">{entry.changed_by}</div>
                          )}
                          <div className="text-xs text-gray-600">{when}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
