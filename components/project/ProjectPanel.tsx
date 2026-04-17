'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '@/lib/db'
import { daysAgo, STAGE_LABELS, STAGE_ORDER, escapeIlike } from '@/lib/utils'
import { TASKS, isTaskRequired } from '@/lib/tasks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useEdgeSync } from '@/lib/hooks/useEdgeSync'
import { handleApiError } from '@/lib/errors'
import { useProjectTasks } from '@/lib/hooks/useProjectTasks'
import type { Project, Note, Crew } from '@/types/database'
import { BomTab } from './BomTab'
import { TasksTab } from './TasksTab'
import { NotesTab } from './NotesTab'
import { InfoTab } from './InfoTab'
import { FilesTab } from './FilesTab'
import { MaterialsTab } from './MaterialsTab'
import { NTPTab } from './NTPTab'
import { WarrantyTab } from './WarrantyTab'
import { TicketsTab } from './TicketsTab'
import { ProjectCostBasisTab } from './ProjectCostBasisTab'
import { ScheduleAssignModal } from './ScheduleAssignModal'
import { createWorkOrderFromProject } from '@/lib/api/work-orders'
import { AhjEditModal, UtilEditModal, HoaEditModal, FinancierEditModal } from './RefEditModals'
import { WorkOrderCreateModal } from './WorkOrderCreateModal'

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
  initialTab?: 'tasks' | 'notes' | 'info' | 'bom' | 'files' | 'materials' | 'warranty' | 'ntp' | 'cost_basis'
}

export function ProjectPanel({ project: initialProject, onClose, onProjectUpdated, initialTab }: ProjectPanelProps) {
  const supabase = db()
  const { user: currentUser } = useCurrentUser()
  const edgeSync = useEdgeSync()
  const [project, setProject] = useState<Project>(initialProject)
  const [tab, setTab] = useState<'tasks' | 'notes' | 'info' | 'tickets' | 'details'>(
    initialTab === 'bom' || initialTab === 'materials' || initialTab === 'warranty' || initialTab === 'files' || initialTab === 'ntp' || initialTab === 'cost_basis' ? 'details' : (initialTab as 'tasks' | 'notes' | 'info') ?? 'tasks'
  )
  const [detailSections, setDetailSections] = useState<Set<string>>(new Set(initialTab === 'ntp' ? ['ntp'] : initialTab === 'bom' ? ['bom'] : initialTab === 'materials' ? ['materials'] : initialTab === 'warranty' ? ['warranty'] : initialTab === 'files' ? ['files'] : initialTab === 'cost_basis' ? ['cost_basis'] : []))
  useEffect(() => {
    if (!initialTab) return
    const mapped = ['bom', 'materials', 'warranty', 'files', 'ntp', 'cost_basis'].includes(initialTab) ? 'details' : initialTab
    setTab(mapped as 'tasks' | 'notes' | 'info' | 'tickets' | 'details')
  }, [initialTab])
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
  interface AHJInfoData { permit_phone: string | null; permit_website: string | null; max_duration: number | null; electric_code: string | null; permit_notes: string | null }
  interface UtilInfoData { phone: string | null; website: string | null; notes: string | null }
  interface HOAInfoData { phone: string | null; website: string | null; contact_name: string | null; contact_email: string | null; notes: string | null }
  interface FinancierInfoData { phone: string | null; website: string | null; contact_name: string | null; contact_email: string | null; notes: string | null }
  // Reference entity edit records use index signature because they map to multiple DB tables
  // (AHJs, utilities, HOAs, financiers) with varying schemas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- values flow into form input value props with varying types
  type RefEditRecord = { id: string; [key: string]: any }
  interface StageHistoryEntry { id: string; project_id: string; stage: string; entered: string }
  interface ServiceCallEntry { id: string; project_id: string; created_at: string; [key: string]: unknown }
  interface ProjectAdderEntry { id: string; adder_name: string; price: number; quantity: number; total_amount: number; created_at: string }
  const [ahjInfo, setAhjInfo] = useState<AHJInfoData | null>(null)
  const [utilityInfo, setUtilityInfo] = useState<UtilInfoData | null>(null)
  const [hoaInfo, setHoaInfo] = useState<HOAInfoData | null>(null)
  const [financierInfo, setFinancierInfo] = useState<FinancierInfoData | null>(null)
  const [ahjEdit, setAhjEdit] = useState<RefEditRecord | null>(null)
  const [utilEdit, setUtilEdit] = useState<RefEditRecord | null>(null)
  const [hoaEdit, setHoaEdit] = useState<RefEditRecord | null>(null)
  const [financierEdit, setFinancierEdit] = useState<RefEditRecord | null>(null)
  const [refSaving, setRefSaving] = useState(false)
  const [serviceCalls, setServiceCalls] = useState<ServiceCallEntry[]>([])
  const [stageHistory, setStageHistory] = useState<StageHistoryEntry[]>([])
  const [adders, setAdders] = useState<ProjectAdderEntry[]>([])
  const [scheduleModal, setScheduleModal] = useState<{ jobType: string; crews: Crew[] } | null>(null)
  const [showWOCreate, setShowWOCreate] = useState(false)
  const [woType, setWoType] = useState('install')
  const [woCreating, setWoCreating] = useState(false)

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

  // ── Task state management (extracted hook) ──────────────────────────────────
  const {
    taskStates, taskReasons, taskNotes, taskFollowUps, taskStatesRaw,
    taskHistory, taskHistoryLoaded,
    cascadeConfirm, setCascadeConfirm, cancelCascade,
    changeOrderSuggest, setChangeOrderSuggest,
    coSaving, setCoSaving,
    changeOrderCount, setChangeOrderCount,
    loadTasks, loadTaskHistory,
    updateTaskStatus, applyTaskStatus,
    updateTaskReason, addTaskNote, updateTaskFollowUp,
    isLocked,
  } = useProjectTasks({
    project,
    setProject,
    setBlockerInput,
    setNotes,
    onProjectUpdated,
    showToast,
    currentUser: currentUser ? { id: currentUser.id, name: currentUser.name, isAdmin: currentUser.isAdmin, isSuperAdmin: currentUser.isSuperAdmin, isSales: currentUser.isSales } : null,
    userEmail,
    edgeSync,
  })

  const loadNotes = useCallback(async () => {
    const { data, error } = await supabase.from('notes').select('*').eq('project_id', pid).is('task_id', null).order('time', { ascending: false })
    if (error) handleApiError(error, '[ProjectPanel] loadNotes')
    if (data) setNotes(data as Note[])
  }, [pid])

  const loadStageHistory = useCallback(async () => {
    const { data, error } = await supabase.from('stage_history').select('*').eq('project_id', pid).order('entered', { ascending: false })
    if (error) handleApiError(error, '[ProjectPanel] loadStageHistory')
    if (data) setStageHistory(data)
  }, [pid])

  const loadServiceCalls = useCallback(async () => {
    const { data, error } = await supabase.from('service_calls').select('*').eq('project_id', pid).order('created', { ascending: false }).limit(5)
    if (error) handleApiError(error, '[ProjectPanel] loadServiceCalls')
    if (data) setServiceCalls(data)
  }, [pid])

  const loadAdders = useCallback(async () => {
    const { data, error } = await supabase.from('project_adders').select('*').eq('project_id', pid).order('created_at', { ascending: true })
    if (error) handleApiError(error, '[ProjectPanel] loadAdders')
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
      permit_required: ahjEdit.permit_required ?? true,
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

  const handleCreateWO = async () => {
    setWoCreating(true)
    const wo = await createWorkOrderFromProject(pid, woType, { name: project.name, address: project.address, city: project.city })
    setWoCreating(false)
    if (wo) { setShowWOCreate(false); showToast('Work order created') }
    else showToast('Failed to create work order')
  }

  const loadFolder = useCallback(async () => {
    const { data } = await supabase.from('project_folders').select('folder_url').eq('project_id', pid).maybeSingle()
    setFolderUrl(data?.folder_url ?? null)
  }, [pid])

  useEffect(() => {
    let mounted = true
    supabase.auth.getUser().then(({ data }: { data: { user: { email?: string | null } | null } }) => {
      if (mounted) setUserEmail(data.user?.email ?? '')
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    let mounted = true
    setProject(initialProject)
    setBlockerInput(initialProject.blocker ?? '')
    // Fetch full project data (parent pages may pass trimmed columns from optimized queries)
    supabase.from('projects').select('*').eq('id', initialProject.id).single().then((result: { data: Record<string, unknown> | null }) => {
      if (mounted && result.data) {
        setProject(result.data as unknown as Project)
        setBlockerInput((result.data as unknown as Project).blocker ?? '')
      }
    })
    return () => { mounted = false }
  }, [initialProject.id])

  useEffect(() => {
    setAhjInfo(null)
    setUtilityInfo(null)
    setHoaInfo(null)
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
  }, [initialProject.id])

  async function addNote(noteText?: string) {
    const text = (noteText ?? newNote).trim()
    if (!text) return
    setSaving(true)
    const pm = currentUser?.name ?? userEmail.split('@')[0] ?? 'PM'
    const { error: noteErr } = await supabase.from('notes').insert({
      project_id: pid, text,
      time: new Date().toISOString(), pm,
      pm_id: currentUser?.id ?? null,
    })
    if (noteErr) { handleApiError(noteErr, '[ProjectPanel] note insert'); showToast('Failed to add note'); setSaving(false); return }
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
      handleApiError(blockerErr, '[ProjectPanel] blocker update')
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
      handleApiError(updateErr, '[ProjectPanel] project update')
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
      if (auditErr2) handleApiError(auditErr2, '[ProjectPanel] audit_log insert')
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
      handleApiError(stageErr, '[ProjectPanel] stage advance')
      showToast('Failed to advance stage')
      setAdvancing(false)
      return
    }
    const { error: histErr } = await supabase.from('stage_history').insert({ project_id: pid, stage: nextStage, entered: today })
    if (histErr) handleApiError(histErr, '[ProjectPanel] stage_history insert')
    const { error: auditErr3 } = await supabase.from('audit_log').insert({
      project_id: pid, field: 'stage',
      old_value: project.stage, new_value: nextStage,
      changed_by: currentUser?.name ?? null, changed_by_id: currentUser?.id ?? null,
    })
    if (auditErr3) handleApiError(auditErr3, '[ProjectPanel] audit_log stage insert')
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
                        Follow-up {new Date(project.follow_up_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                  className="text-xs px-3 py-1.5 rounded-lg font-medium bg-green-600 hover:bg-green-500 text-white disabled:opacity-50 transition-colors">
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
                  advance.ok ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'
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
                    if (reactErr) { handleApiError(reactErr, '[ProjectPanel] reactivate'); showToast('Reactivate failed'); return }
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
                    const contractVal = Number(project.contract) || 0
                    const fee = Math.round(contractVal * 0.1 * 100) / 100
                    if (!confirm(`Cancel ${project.name}?${fee > 0 ? `\n\n10% cancellation fee: $${fee.toLocaleString()}` : ''}\n\nIt will be removed from the active pipeline.`)) return
                    const cancelUpdates: Record<string, unknown> = { disposition: 'Cancelled' }
                    if (fee > 0) { cancelUpdates.cancellation_fee = fee; cancelUpdates.cancellation_fee_status = 'pending' }
                    const { error: cancelErr } = await supabase.from('projects').update(cancelUpdates).eq('id', project.id)
                    if (cancelErr) { handleApiError(cancelErr, '[ProjectPanel] cancel'); showToast('Cancel failed'); return }
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
                    if (delAuditErr) handleApiError(delAuditErr, '[ProjectPanel] delete audit_log')
                    const { error: delErr1 } = await supabase.from('task_state').delete().eq('project_id', project.id)
                    if (delErr1) handleApiError(delErr1, '[ProjectPanel] delete task_state')
                    const { error: delErr2 } = await supabase.from('notes').delete().eq('project_id', project.id)
                    if (delErr2) handleApiError(delErr2, '[ProjectPanel] delete notes')
                    const { error: delErr3 } = await supabase.from('stage_history').delete().eq('project_id', project.id)
                    if (delErr3) handleApiError(delErr3, '[ProjectPanel] delete stage_history')
                    const { error: delErr4 } = await supabase.from('task_history').delete().eq('project_id', project.id)
                    if (delErr4) handleApiError(delErr4, '[ProjectPanel] delete task_history')
                    const { error: delErr5 } = await supabase.from('schedule').delete().eq('project_id', project.id)
                    if (delErr5) handleApiError(delErr5, '[ProjectPanel] delete schedule')
                    const { error: delErr6 } = await supabase.from('service_calls').delete().eq('project_id', project.id)
                    if (delErr6) handleApiError(delErr6, '[ProjectPanel] delete service_calls')
                    const { error: delErr7 } = await supabase.from('project_funding').delete().eq('project_id', project.id)
                    if (delErr7) handleApiError(delErr7, '[ProjectPanel] delete project_funding')
                    const { error: delErr8 } = await supabase.from('project_folders').delete().eq('project_id', project.id)
                    if (delErr8) handleApiError(delErr8, '[ProjectPanel] delete project_folders')
                    const { error: delErr9 } = await supabase.from('change_orders').delete().eq('project_id', project.id)
                    if (delErr9) handleApiError(delErr9, '[ProjectPanel] delete change_orders')
                    const { error: delErr10 } = await supabase.from('projects').delete().eq('id', project.id)
                    if (delErr10) handleApiError(delErr10, '[ProjectPanel] delete projects')
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
            { id: 'tickets', label: 'Tickets', stuck: false },
            { id: 'details', label: 'Details', stuck: false },
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
              projectId={pid}
              currentUserName={currentUser?.name}
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

          {/* TICKETS */}
          {tab === 'tickets' && <TicketsTab projectId={project.id} />}

          {/* DETAILS — combined NTP + BOM + Materials + Warranty + Files */}
          {tab === 'details' && (
            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {[
                { key: 'ntp', label: 'NTP', content: <NTPTab project={project} /> },
                { key: 'bom', label: 'BOM', content: <BomTab project={project} /> },
                { key: 'materials', label: 'Materials', content: <MaterialsTab project={project} /> },
                { key: 'warranty', label: 'Warranty', content: <WarrantyTab project={project} /> },
                { key: 'files', label: 'Files', content: <FilesTab folderUrl={folderUrl} projectId={pid} currentStage={project.stage} /> },
                { key: 'cost_basis', label: 'Cost Basis 🔒', content: <ProjectCostBasisTab project={project} /> },
              ].map(section => {
                const isOpen = detailSections.has(section.key)
                return (
                  <div key={section.key} className="border border-gray-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setDetailSections(prev => {
                        const next = new Set(prev)
                        if (next.has(section.key)) next.delete(section.key)
                        else next.add(section.key)
                        return next
                      })}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-800 hover:bg-gray-750 transition-colors"
                    >
                      <span className="text-sm font-medium text-white">{section.label}</span>
                      <span className="text-gray-500 text-xs">{isOpen ? '▼' : '▶'}</span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-gray-700">
                        {section.content}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* AHJ Edit Modal */}
      {ahjEdit && <AhjEditModal ahjEdit={ahjEdit} setAhjEdit={setAhjEdit} onSave={saveAhjEdit} refSaving={refSaving} />}

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
      {showWOCreate && <WorkOrderCreateModal projectName={project.name} projectId={project.id} woType={woType} setWoType={setWoType} woCreating={woCreating} onClose={() => setShowWOCreate(false)} onCreate={handleCreateWO} />}


      {/* Utility Edit Popup */}
      {/* Reference Edit Modals */}
      {utilEdit && <UtilEditModal utilEdit={utilEdit} setUtilEdit={setUtilEdit} onSave={saveUtilEdit} refSaving={refSaving} />}
      {hoaEdit && <HoaEditModal hoaEdit={hoaEdit} setHoaEdit={setHoaEdit} onSave={saveHoaEdit} refSaving={refSaving} />}
      {financierEdit && <FinancierEditModal financierEdit={financierEdit} setFinancierEdit={setFinancierEdit} onSave={saveFinancierEdit} refSaving={refSaving} />}
    </div>
  )
}
