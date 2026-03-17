'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmt$, fmtDate, daysAgo, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import type { Project, Note, TaskState } from '@/types/database'

// ── TASK DEFINITIONS ──────────────────────────────────────────────────────────
const TASKS: Record<string, { id: string; name: string; pre: string[]; req: boolean }[]> = {
  evaluation: [
    { id: 'welcome',      name: 'Welcome Call',           pre: [],              req: true  },
    { id: 'ia',           name: 'IA Confirmation',        pre: [],              req: true  },
    { id: 'ub',           name: 'UB Confirmation',        pre: [],              req: true  },
    { id: 'sched_survey', name: 'Schedule Site Survey',   pre: [],              req: true  },
    { id: 'ntp',          name: 'NTP Procedure',          pre: [],              req: true  },
  ],
  survey: [
    { id: 'site_survey',  name: 'Site Survey',            pre: ['sched_survey'],req: true  },
    { id: 'survey_review',name: 'Survey Review',          pre: ['site_survey'], req: true  },
  ],
  design: [
    { id: 'build_design', name: 'Build Design',           pre: ['survey_review'],req: true },
    { id: 'scope',        name: 'Scope of Work',          pre: ['build_design'],req: true  },
    { id: 'monitoring',   name: 'Monitoring',             pre: ['scope'],       req: true  },
    { id: 'build_eng',    name: 'Build Engineering',      pre: ['scope'],       req: true  },
    { id: 'eng_approval', name: 'Engineering Approval',   pre: ['build_eng'],   req: true  },
    { id: 'stamps',       name: 'Stamps Required',        pre: ['eng_approval'],req: true  },
    { id: 'wp1',          name: 'WP1',                    pre: ['scope'],       req: false },
    { id: 'prod_add',     name: 'Production Addendum',    pre: ['scope'],       req: false },
    { id: 'new_ia',       name: 'Create New IA',          pre: ['scope'],       req: false },
    { id: 'reroof',       name: 'Reroof Procedure',       pre: ['scope'],       req: false },
  ],
  permit: [
    { id: 'hoa',          name: 'HOA Approval',           pre: ['eng_approval'],req: true  },
    { id: 'om_review',    name: 'OM Project Review',      pre: ['eng_approval'],req: true  },
    { id: 'city_permit',  name: 'City Permit Approval',   pre: ['eng_approval'],req: true  },
    { id: 'util_permit',  name: 'Utility Permit Approval',pre: ['eng_approval'],req: true  },
    { id: 'checkpoint1',  name: 'Check Point 1',          pre: ['city_permit','util_permit','ntp'],req: false },
    { id: 'revise_ia',    name: 'Revise IA',              pre: [],              req: false },
  ],
  install: [
    { id: 'sched_install',name: 'Schedule Installation',  pre: ['om_review'],   req: true  },
    { id: 'inventory',    name: 'Inventory Allocation',   pre: ['sched_install'],req: true  },
    { id: 'install_done', name: 'Installation Complete',  pre: ['sched_install'],req: true  },
    { id: 'elec_redesign',name: 'Electrical Onsite Redesign',pre: [],           req: false },
  ],
  inspection: [
    { id: 'insp_review',  name: 'Inspection Review',      pre: ['install_done'],req: true  },
    { id: 'sched_city',   name: 'Schedule City Inspection',pre: ['insp_review'],req: true  },
    { id: 'sched_util',   name: 'Schedule Utility Inspection',pre:['insp_review'],req:true },
    { id: 'city_insp',    name: 'City Inspection',        pre: ['sched_city'],  req: true  },
    { id: 'util_insp',    name: 'Utility Inspection',     pre: ['sched_util'],  req: true  },
    { id: 'city_upd',     name: 'City Permit Update',     pre: ['insp_review'], req: false },
    { id: 'util_upd',     name: 'Utility Permit Update',  pre: ['insp_review'], req: false },
    { id: 'wpi28',        name: 'WPI 2 & 8',              pre: ['install_done'],req: false },
  ],
  complete: [
    { id: 'pto',          name: 'Permission to Operate',  pre: ['util_insp'],   req: true  },
    { id: 'in_service',   name: 'In Service',             pre: ['pto'],         req: true  },
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
      <span className={`text-gray-200 ${small ? 'text-xs' : 'text-xs'} break-words`}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 pb-1 border-b border-gray-800">
        {title}
      </div>
      {children}
    </div>
  )
}

// ── TASK ROW ──────────────────────────────────────────────────────────────────
function TaskRow({
  task,
  status,
  locked,
  onStatusChange,
}: {
  task: { id: string; name: string; req: boolean }
  status: string
  locked: boolean
  onStatusChange: (taskId: string, status: string) => void
}) {
  return (
    <div className={`flex items-center gap-2 py-1.5 px-2 rounded-lg mb-1 ${
      status === 'Complete' ? 'opacity-60' : ''
    } ${locked ? 'opacity-40' : ''}`}>
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        status === 'Complete' ? 'bg-green-500' :
        status === 'Pending Resolution' ? 'bg-red-500' :
        status === 'Revision Required' ? 'bg-amber-500' :
        status === 'In Progress' ? 'bg-blue-500' :
        status === 'Ready To Start' ? 'bg-gray-400' :
        'bg-gray-700'
      }`} />

      {/* Task name */}
      <span className={`flex-1 text-xs ${task.req ? 'text-white' : 'text-gray-400'}`}>
        {task.name}
        {!task.req && <span className="text-gray-600 ml-1">(opt)</span>}
      </span>

      {/* Status dropdown */}
      <select
        value={status}
        disabled={locked}
        onChange={e => onStatusChange(task.id, e.target.value)}
        className={`text-xs rounded px-1.5 py-0.5 border-0 cursor-pointer ${STATUS_STYLE[status] ?? 'bg-gray-800 text-gray-400'}`}
      >
        {TASK_STATUSES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  )
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
  const [tab, setTab] = useState<'tasks' | 'notes' | 'info' | 'files'>('tasks')
  const [taskStates, setTaskStates] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Note[]>([])
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [folderUrl, setFolderUrl] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')

  const pid = project.id
  const stageTasks = TASKS[project.stage] ?? []

  // Load task states
  const loadTasks = useCallback(async () => {
    const { data } = await supabase
      .from('task_state')
      .select('task_id, status')
      .eq('project_id', pid)
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((t: any) => { map[t.task_id] = t.status })
      setTaskStates(map)
    }
  }, [pid])

  // Load notes
  const loadNotes = useCallback(async () => {
    const { data } = await supabase
      .from('notes')
      .select('*')
      .eq('project_id', pid)
      .order('time', { ascending: false })
    if (data) setNotes(data as Note[])
  }, [pid])

  // Load Drive folder
  const loadFolder = useCallback(async () => {
    const { data } = await supabase
      .from('project_folders')
      .select('folder_url')
      .eq('project_id', pid)
      .single()
    if (data && 'folder_url' in data) setFolderUrl((data as any).folder_url)
  }, [pid])

  // Load user
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? '')
    })
  }, [])

  useEffect(() => {
    loadTasks()
    loadNotes()
    loadFolder()
  }, [loadTasks, loadNotes, loadFolder])

  // Update task status
  async function updateTaskStatus(taskId: string, status: string) {
    setTaskStates(prev => ({ ...prev, [taskId]: status }))
    await (supabase as any).from('task_state').upsert({
      project_id: pid,
      task_id: taskId,
      status,
      completed_date: status === 'Complete' ? new Date().toISOString().slice(0, 10) : null,
    }, { onConflict: 'project_id,task_id' })
  }

  // Is a task locked (prereqs not complete)
  function isLocked(task: { pre: string[] }): boolean {
    return task.pre.some(preId => taskStates[preId] !== 'Complete')
  }

  // Add note
  async function addNote() {
    if (!newNote.trim()) return
    setSaving(true)
    const pm = userEmail.split('@')[0] ?? 'PM'
    await (supabase as any).from('notes').insert({
      project_id: pid,
      text: newNote.trim(),
      time: new Date().toISOString(),
      pm,
    })
    setNewNote('')
    await loadNotes()
    setSaving(false)
  }

  // Stuck task count for tab badge
  const stuckCount = stageTasks.filter(t => {
    const s = taskStates[t.id] ?? 'Not Ready'
    return s === 'Pending Resolution' || s === 'Revision Required'
  }).length

  const days = daysAgo(project.stage_date)
  const cycle = daysAgo(project.sale_date) || days

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-5xl bg-gray-900 flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">{project.name}</h2>
            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{project.id}</span>
              <span>·</span>
              <span>{project.city}</span>
              <span>·</span>
              <span className="text-green-400">{STAGE_LABELS[project.stage]}</span>
              <span>·</span>
              <span>{days}d in stage</span>
              <span>·</span>
              <span>{cycle}d total</span>
              <span>·</span>
              <span>{project.pm}</span>
              {project.blocker && (
                <span className="bg-red-900 text-red-300 px-2 py-0.5 rounded-full">
                  🚫 {project.blocker}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl ml-4">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 flex-shrink-0 bg-gray-950">
          {([
            { id: 'tasks', label: `Tasks${stuckCount ? ` (${stuckCount} stuck)` : ''}` },
            { id: 'notes', label: `Notes${notes.length ? ` (${notes.length})` : ''}` },
            { id: 'info',  label: 'Info' },
            { id: 'files', label: 'Files' },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'text-green-400 border-b-2 border-green-400'
                  : 'text-gray-400 hover:text-white'
              } ${stuckCount && t.id === 'tasks' ? 'text-red-400' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── TASKS TAB ── */}
          {tab === 'tasks' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-2xl">
                <div className="text-xs text-gray-500 mb-4">
                  Tasks for current stage: <span className="text-white">{STAGE_LABELS[project.stage]}</span>
                  {' · '}Tasks from prior stages remain in their state.
                </div>

                {/* Current stage tasks */}
                <div className="mb-6">
                  {stageTasks.map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      status={taskStates[task.id] ?? 'Not Ready'}
                      locked={isLocked(task)}
                      onStatusChange={updateTaskStatus}
                    />
                  ))}
                  {stageTasks.length === 0 && (
                    <div className="text-gray-500 text-xs">No tasks defined for this stage.</div>
                  )}
                </div>

                {/* Previous stage tasks (collapsed summary) */}
                {STAGE_ORDER.filter(s => s !== project.stage && TASKS[s]).map(stageId => {
                  const tasks = TASKS[stageId] ?? []
                  const completedCount = tasks.filter(t => taskStates[t.id] === 'Complete').length
                  const stuckInStage = tasks.filter(t => {
                    const s = taskStates[t.id]
                    return s === 'Pending Resolution' || s === 'Revision Required'
                  }).length
                  if (completedCount === 0 && stuckInStage === 0) return null
                  return (
                    <div key={stageId} className="mb-3 opacity-60">
                      <div className="text-xs text-gray-500 mb-1">
                        {STAGE_LABELS[stageId]} — {completedCount}/{tasks.length} complete
                        {stuckInStage > 0 && <span className="text-red-400 ml-2">{stuckInStage} stuck</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── NOTES TAB ── */}
          {tab === 'notes' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Note input */}
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
                  <button
                    onClick={addNote}
                    disabled={saving || !newNote.trim()}
                    className="bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {saving ? 'Saving…' : 'Add Note'}
                  </button>
                </div>
              </div>

              {/* Notes list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {notes.length === 0 && (
                  <div className="text-gray-500 text-xs text-center py-8">No notes yet.</div>
                )}
                {notes.map(note => (
                  <div key={note.id} className="bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-green-400">{note.pm}</span>
                      <span className="text-xs text-gray-500">
                        {note.time ? new Date(note.time).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        }) : ''}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{note.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── INFO TAB ── */}
          {tab === 'info' && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-8 max-w-3xl">
                <div>
                  <Section title="Contact">
                    <Row label="Address" value={project.address} small />
                    <Row label="Phone" value={project.phone} />
                    <Row label="Email" value={project.email} small />
                  </Section>
                  <Section title="Contract">
                    <Row label="Amount" value={fmt$(project.contract)} />
                    <Row label="System" value={project.systemkw ? `${project.systemkw} kW` : null} />
                    <Row label="Financier" value={project.financier} />
                    <Row label="Financing" value={project.financing_type} />
                    <Row label="Down payment" value={project.down_payment ? `$${Number(project.down_payment).toLocaleString()}` : null} />
                    <Row label="TPO escalator" value={project.tpo_escalator?.toString()} />
                    <Row label="Adv pmt sched" value={project.financier_adv_pmt} />
                    <Row label="Disposition" value={project.disposition} />
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
                    <Row label="HOA" value={project.hoa} />
                    <Row label="ESID" value={project.esid} />
                  </Section>
                </div>
                <div>
                  <Section title="Team">
                    <Row label="PM" value={project.pm} />
                    <Row label="Advisor" value={project.advisor} />
                    <Row label="Consultant" value={project.consultant} />
                    <Row label="Consultant email" value={project.consultant_email} small />
                    <Row label="Site surveyor" value={project.site_surveyor} />
                  </Section>
                  <Section title="Permitting">
                    <Row label="AHJ" value={project.ahj} />
                    <Row label="Utility" value={project.utility} />
                    <Row label="Permit #" value={project.permit_number} />
                    <Row label="Utility app #" value={project.utility_app_number} />
                    <Row label="Permit fee" value={project.permit_fee ? `$${Number(project.permit_fee).toLocaleString()}` : null} />
                    <Row label="City permit" value={fmtDate(project.city_permit_date)} />
                    <Row label="Utility permit" value={fmtDate(project.utility_permit_date)} />
                  </Section>
                  <Section title="Milestones">
                    <Row label="Sale date" value={fmtDate(project.sale_date)} />
                    <Row label="NTP" value={fmtDate(project.ntp_date)} />
                    <Row label="Survey scheduled" value={fmtDate(project.survey_scheduled_date)} />
                    <Row label="Survey complete" value={fmtDate(project.survey_date)} />
                    <Row label="Install scheduled" value={fmtDate(project.install_scheduled_date)} />
                    <Row label="Install complete" value={fmtDate(project.install_complete_date)} />
                    <Row label="City inspection" value={fmtDate(project.city_inspection_date)} />
                    <Row label="Utility inspection" value={fmtDate(project.utility_inspection_date)} />
                    <Row label="PTO" value={fmtDate(project.pto_date)} />
                    <Row label="In service" value={fmtDate(project.in_service_date)} />
                  </Section>
                </div>
              </div>
            </div>
          )}

          {/* ── FILES TAB ── */}
          {tab === 'files' && (
            <div className="flex-1 flex items-center justify-center">
              {folderUrl ? (
                <a
                  href={folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl px-6 py-4 transition-colors"
                >
                  <img
                    src="https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png"
                    alt="Drive"
                    className="w-8 h-8"
                  />
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
    </div>
  )
}
