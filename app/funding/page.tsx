'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { fmt$, fmtDate, daysAgo, STAGE_LABELS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useSupabaseQuery } from '@/lib/hooks'
import type { Project, ProjectFunding, NonfundedCode } from '@/types/database'

/** Row shape returned by the funding_dashboard Postgres view */
interface FundingDashboardRow {
  id: string
  name: string
  city: string | null
  address: string | null
  financier: string | null
  ahj: string | null
  install_complete_date: string | null
  pto_date: string | null
  contract: number | null
  sale_date: string | null
  stage: string
  disposition: string | null
  m1_amount: number | null
  m1_funded_date: string | null
  m1_status: string | null
  m1_notes: string | null
  m1_cb: string | null
  m1_cb_credit: number | null
  m2_amount: number | null
  m2_funded_date: string | null
  m2_status: string | null
  m2_notes: string | null
  m2_cb: string | null
  m2_cb_credit: number | null
  m3_amount: number | null
  m3_funded_date: string | null
  m3_status: string | null
  m3_notes: string | null
  m3_projected: number | null
  nonfunded_code_1: string | null
  nonfunded_code_2: string | null
  nonfunded_code_3: string | null
}

type MilestoneKey = 'm1' | 'm2' | 'm3'
type FundingFilter = 'all' | 'ready' | 'submitted' | 'pending' | 'revision' | 'funded' | 'nonfunded'
type FundingStatus = 'Ready To Start' | 'Submitted' | 'Pending Resolution' | 'Revision Required' | 'Funded'

const FUNDING_STATUSES: FundingStatus[] = ['Ready To Start', 'Submitted', 'Pending Resolution', 'Revision Required', 'Funded']

const FUNDING_STATUS_COMPACT: Record<string, string> = {
  'Ready To Start': 'RTS',
  'Submitted': 'Sub',
  'Pending Resolution': 'Pnd',
  'Revision Required': 'Rev',
  'Funded': 'Fun',
}

interface MsData {
  amount: number | null
  funded_date: string | null
  status: string | null
  notes: string | null
  isEligible: boolean
  isFunded: boolean
}

interface FundingRow {
  project: Project
  funding: ProjectFunding | null
  m1: MsData
  m2: MsData
  m3: MsData
  nf1: string | null
  nf2: string | null
  nf3: string | null
}

function getMsData(f: ProjectFunding | null, p: Project, ms: MilestoneKey): MsData {
  const eligible = ms === 'm1' ? true : ms === 'm2' ? !!p.install_complete_date : !!p.pto_date
  if (!f) return { amount: null, funded_date: null, status: null, notes: null, isEligible: eligible, isFunded: false }
  const amount = ms === 'm1' ? f.m1_amount : ms === 'm2' ? f.m2_amount : f.m3_amount
  const funded_date = ms === 'm1' ? f.m1_funded_date : ms === 'm2' ? f.m2_funded_date : f.m3_funded_date
  const status = ms === 'm1' ? f.m1_status : ms === 'm2' ? f.m2_status : f.m3_status
  const notes = ms === 'm1' ? f.m1_notes : ms === 'm2' ? f.m2_notes : f.m3_notes
  return { amount, funded_date, status, notes, isEligible: eligible, isFunded: !!funded_date }
}

// ── Inline Editable Cell ──────────────────────────────────────────────────────

function EditableCell({ value, onSave, type = 'text', placeholder = '—', className = '', disabled = false }: {
  value: string | number | null
  onSave: (val: string | null) => Promise<void>
  type?: 'text' | 'number' | 'date' | 'currency'
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = (e: React.MouseEvent) => {
    if (disabled) return
    e.stopPropagation()
    setDraft(value != null ? String(value) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const save = async () => {
    const newVal = draft.trim() || null
    const oldVal = value != null ? String(value) : null
    if (newVal === oldVal) { setEditing(false); return }
    setSaving(true)
    await onSave(newVal)
    setSaving(false)
    setEditing(false)
  }

  const cancel = () => { setEditing(false) }

  if (editing) {
    return (
      <div className="relative w-full">
        {type === 'currency' && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>}
        <input
          ref={inputRef}
          type={type === 'currency' || type === 'number' ? 'number' : type}
          step={type === 'currency' ? '0.01' : undefined}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          className={`bg-gray-700 text-white text-xs rounded px-2 py-1 border border-green-500 focus:outline-none w-full ${type === 'currency' ? 'pl-5' : ''} ${className}`}
          onClick={e => e.stopPropagation()}
        />
      </div>
    )
  }

  const display = type === 'currency' && value ? fmt$(Number(value))
    : type === 'date' && value ? fmtDate(String(value))
    : value ?? placeholder

  return (
    <div
      onClick={startEdit}
      className={`rounded px-1 py-0.5 -mx-1 -my-1 min-h-[24px] flex items-center transition-colors w-full text-gray-300 ${saving ? 'opacity-50' : ''} ${disabled ? '' : 'cursor-pointer hover:bg-gray-700 hover:text-white'} ${className}`}
      title={disabled ? undefined : 'Click to edit'}
    >
      {display}
    </div>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function MsBadge({ ms, data }: { ms: MilestoneKey; data: MsData }) {
  const color = data.status === 'Funded' || data.status === 'Complete' ? 'bg-green-900 text-green-300'
    : data.status === 'Rejected' ? 'bg-red-900 text-red-300'
    : data.status === 'Submitted' ? 'bg-blue-900 text-blue-300'
    : data.isEligible ? 'bg-amber-900 text-amber-300'
    : 'bg-gray-800 text-gray-500'
  return <span className={`font-bold px-1 py-0.5 rounded text-[10px] ${color}`}>{ms.toUpperCase()}</span>
}

// ── Status Dropdown ───────────────────────────────────────────────────────────

function StatusSelect({ value, onSave, compact, disabled = false }: { value: string | null; onSave: (val: string | null) => Promise<void>; compact?: boolean; disabled?: boolean }) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation()
    const val = e.target.value || null
    setSaving(true)
    await onSave(val)
    setSaving(false)
  }

  const color = value === 'Funded' ? 'text-green-400'
    : value === 'Submitted' ? 'text-blue-400'
    : value === 'Ready To Start' ? 'text-amber-400'
    : value === 'Pending Resolution' ? 'text-red-400'
    : value === 'Revision Required' ? 'text-amber-400'
    : 'text-gray-500'

  return (
    <select
      value={value ?? ''}
      onChange={handleChange}
      onClick={e => e.stopPropagation()}
      disabled={saving || disabled}
      className={`bg-transparent border-0 text-[10px] focus:outline-none w-full ${color} ${saving ? 'opacity-50' : ''} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <option value="">—</option>
      {FUNDING_STATUSES.map(s => <option key={s} value={s}>{compact ? FUNDING_STATUS_COMPACT[s] : s}</option>)}
    </select>
  )
}

// ── NF Code Picker ────────────────────────────────────────────────────────────

function NfCodePicker({ value, onSave, codes, slot, disabled = false }: {
  value: string | null
  onSave: (val: string | null) => Promise<void>
  codes: NonfundedCode[]
  slot: number
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = query.trim()
    ? codes.filter(c => c.code.toLowerCase().includes(query.toLowerCase()) || c.description.toLowerCase().includes(query.toLowerCase()) || c.master_code.toLowerCase().includes(query.toLowerCase()))
    : codes

  const groups: Record<string, NonfundedCode[]> = {}
  filtered.forEach(c => { (groups[c.master_code] ??= []).push(c) })

  const select = async (code: string | null) => {
    setSaving(true)
    await onSave(code)
    setSaving(false)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="relative inline-block" ref={ref}>
      {value ? (
        <span className="inline-flex items-center gap-0.5">
          <span
            className={`bg-red-900/50 text-red-300 text-[10px] px-1 py-0.5 rounded ${disabled ? '' : 'cursor-pointer hover:bg-red-800'}`}
            onClick={e => { e.stopPropagation(); if (!disabled) setOpen(!open) }}
            title={codes.find(c => c.code === value)?.description ?? value}
          >{value}</span>
          {!disabled && <button onClick={e => { e.stopPropagation(); select(null) }} className="text-gray-600 hover:text-red-400 text-[10px]" title="Remove">x</button>}
        </span>
      ) : (
        !disabled && <button onClick={e => { e.stopPropagation(); setOpen(!open) }} className="text-gray-600 hover:text-gray-300 text-xs" title={`Add NF code ${slot}`}>+</button>
      )}
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search codes..." autoFocus
            className="w-full bg-gray-900 text-white text-xs px-3 py-2 border-b border-gray-700 focus:outline-none" />
          <div className="max-h-64 overflow-y-auto">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div className="px-3 py-1.5 text-xs font-bold text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-900">{group}</div>
                {items.map(c => (
                  <button key={c.code} onClick={() => select(c.code)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors flex items-start gap-2">
                    <span className="text-amber-400 font-mono font-bold flex-shrink-0 w-12">{c.code}</span>
                    <span className="text-gray-300">{c.description}</span>
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-gray-500 text-xs">No codes match &ldquo;{query}&rdquo;</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Milestone Cell Group ──────────────────────────────────────────────────────

function MsCells({ ms, data, pid, saveFundingField, disabled = false }: {
  ms: MilestoneKey
  data: MsData
  pid: string
  saveFundingField: (projectId: string, field: string, value: string | number | null) => Promise<void>
  disabled?: boolean
}) {
  const field = (f: string) => `${ms}_${f}`
  return (
    <>
      <td className="px-1 py-1.5 font-mono text-center">
        <MsBadge ms={ms} data={data} />
      </td>
      <td className="px-1 py-1.5 font-mono">
        <EditableCell value={data.amount} type="currency" disabled={disabled}
          onSave={async val => saveFundingField(pid, field('amount'), val ? Number(val) : null)} />
      </td>
      <td className="px-1 py-1.5">
        <EditableCell value={data.funded_date} type="date" disabled={disabled}
          onSave={async val => saveFundingField(pid, field('funded_date'), val)} />
      </td>
      <td className="px-1 py-1.5">
        <StatusSelect value={data.status} disabled={disabled}
          onSave={async val => saveFundingField(pid, field('status'), val)} compact />
      </td>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FundingPage() {
  const { user: currentUser } = useCurrentUser()
  const canEditFunding = currentUser?.isFinance ?? false
  const [projects, setProjects] = useState<Project[]>([])
  const [funding, setFunding] = useState<Record<string, ProjectFunding>>({})
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<FundingFilter>('all')
  const [financierFilter, setFinancierFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string>('financier')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('mg_funding_guide_v3') !== 'dismissed'
  })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ readyToSubmit: true, awaitingPayment: true, needsAttention: true })
  const toggleBucket = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // nonfunded_codes via hook (typed table)
  const { data: rawNfCodes, loading: nfLoading } = useSupabaseQuery('nonfunded_codes', {
    order: { column: 'master_code', ascending: true },
    limit: 2000,
  })
  const nfCodes = rawNfCodes as unknown as NonfundedCode[]

  // funding_dashboard is a Postgres view (migration 016) joining projects + project_funding.
  // Views are not in Database types, so we query manually via cast and map rows to
  // separate Project[] and ProjectFunding record structures client-side.
  const loadDashboard = useCallback(async () => {
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from('funding_dashboard').select('*').limit(5000)
    if (error) console.error('funding_dashboard load failed:', error)
    if (data) {
      const projList: Project[] = []
      const fundMap: Record<string, ProjectFunding> = {}
      const rows = data as unknown as FundingDashboardRow[]
      rows.forEach((row) => {
        // Extract project fields
        projList.push({
          id: row.id,
          name: row.name,
          city: row.city,
          address: row.address,
          financier: row.financier,
          ahj: row.ahj,
          install_complete_date: row.install_complete_date,
          pto_date: row.pto_date,
          contract: row.contract,
          sale_date: row.sale_date,
          stage: row.stage,
          disposition: row.disposition,
        } as Project)
        // Extract funding fields (may be null from LEFT JOIN)
        if (row.m1_amount != null || row.m2_amount != null || row.m3_amount != null ||
            row.m1_status != null || row.m2_status != null || row.m3_status != null ||
            row.m1_funded_date != null || row.m2_funded_date != null || row.m3_funded_date != null) {
          fundMap[row.id] = {
            project_id: row.id,
            m1_amount: row.m1_amount,
            m1_funded_date: row.m1_funded_date,
            m1_status: row.m1_status,
            m1_notes: row.m1_notes,
            m1_cb: row.m1_cb,
            m1_cb_credit: row.m1_cb_credit,
            m2_amount: row.m2_amount,
            m2_funded_date: row.m2_funded_date,
            m2_status: row.m2_status,
            m2_notes: row.m2_notes,
            m2_cb: row.m2_cb,
            m2_cb_credit: row.m2_cb_credit,
            m3_amount: row.m3_amount,
            m3_funded_date: row.m3_funded_date,
            m3_status: row.m3_status,
            m3_notes: row.m3_notes,
            m3_projected: row.m3_projected,
            nonfunded_code_1: row.nonfunded_code_1,
            nonfunded_code_2: row.nonfunded_code_2,
            nonfunded_code_3: row.nonfunded_code_3,
          } as ProjectFunding
        }
      })
      setProjects(projList)
      setFunding(fundMap)
    }
    setDashLoading(false)
  }, [])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  const loading = dashLoading || nfLoading

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current) }
  }, [])
  const showToast = (msg: string) => { setToast(msg); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2000) }

  const saveFundingField = async (projectId: string, field: string, value: string | number | null) => {
    if (!canEditFunding) return
    const update: Record<string, any> = { [field]: value }
    const { error } = await db().from('project_funding').upsert(
      { project_id: projectId, ...update },
      { onConflict: 'project_id' }
    )
    if (error) { showToast('Save failed: ' + error.message); return }
    setFunding(prev => {
      const existing = prev[projectId] ?? { project_id: projectId } as ProjectFunding
      return { ...prev, [projectId]: { ...existing, ...update } }
    })
  }

  const nfField = (slot: number) => `nonfunded_code_${slot}`
  const financiers = useMemo(() => [...new Set(projects.map(p => p.financier).filter(Boolean))].sort() as string[], [projects])

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortIcon = (col: string) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  // Build one row per project
  const rows = useMemo(() => {
    const result: FundingRow[] = []
    projects.forEach(p => {
      if (financierFilter !== 'all' && p.financier !== financierFilter) return
      if (search.trim()) {
        const q = search.toLowerCase()
        if (!p.name?.toLowerCase().includes(q) && !p.id?.toLowerCase().includes(q) && !p.city?.toLowerCase().includes(q) && !p.address?.toLowerCase().includes(q)) return
      }
      const f = funding[p.id] ?? null
      const m1 = getMsData(f, p, 'm1')
      const m2 = getMsData(f, p, 'm2')
      const m3 = getMsData(f, p, 'm3')

      // Filter by status across any milestone
      const anyStatus = (s: string) => m1.status === s || m2.status === s || m3.status === s
      if (statusFilter === 'ready' && !anyStatus('Ready To Start')) return
      if (statusFilter === 'submitted' && !anyStatus('Submitted')) return
      if (statusFilter === 'pending' && !anyStatus('Pending Resolution')) return
      if (statusFilter === 'revision' && !anyStatus('Revision Required')) return
      if (statusFilter === 'funded' && !m1.isFunded && !m2.isFunded && !m3.isFunded) return
      if (statusFilter === 'nonfunded' && !f?.nonfunded_code_1) return

      result.push({ project: p, funding: f, m1, m2, m3, nf1: f?.nonfunded_code_1 ?? null, nf2: f?.nonfunded_code_2 ?? null, nf3: f?.nonfunded_code_3 ?? null })
    })

    const dir = sortDir === 'asc' ? 1 : -1
    result.sort((a, b) => {
      let av: string | number | null = null
      let bv: string | number | null = null
      switch (sortCol) {
        case 'name': av = a.project.name; bv = b.project.name; break
        case 'financier': av = a.project.financier; bv = b.project.financier; break
        case 'ahj': av = a.project.ahj; bv = b.project.ahj; break
        case 'install': av = a.project.install_complete_date; bv = b.project.install_complete_date; break
        case 'pto': av = a.project.pto_date; bv = b.project.pto_date; break
        case 'contract': av = a.project.contract; bv = b.project.contract; break
        case 'm2_amount': av = a.m2.amount; bv = b.m2.amount; break
        case 'm2_funded': av = a.m2.funded_date; bv = b.m2.funded_date; break
        default: av = a.project.financier; bv = b.project.financier
      }
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return result
  }, [projects, funding, financierFilter, search, statusFilter, sortCol, sortDir])

  // Stats
  const stats = useMemo(() => {
    const allMs = rows.flatMap(r => [r.m2, r.m3])
    const rts = allMs.filter(d => d.status === 'Ready To Start')
    const sub = allMs.filter(d => d.status === 'Submitted')
    const pnd = allMs.filter(d => d.status === 'Pending Resolution')
    const rev = allMs.filter(d => d.status === 'Revision Required')
    const fun = allMs.filter(d => d.status === 'Funded')
    const totalContract = rows.reduce((s, r) => s + (Number(r.project.contract) || 0), 0)
    const m2Eligible = rows.filter(r => r.m2.isEligible && r.m2.status !== 'Funded').length
    const m3Eligible = rows.filter(r => r.m3.isEligible && r.m3.status !== 'Funded').length
    const withNf = rows.filter(r => r.nf1).length
    return {
      totalProjects: rows.length,
      totalContract,
      readyToStart: rts.length,
      readyAmount: rts.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      submitted: sub.length,
      submittedAmount: sub.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      pendingResolution: pnd.length,
      revisionRequired: rev.length,
      needsAttention: pnd.length + rev.length,
      funded: fun.length,
      fundedAmount: fun.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      outstanding: rts.reduce((s, d) => s + (Number(d.amount) || 0), 0) + sub.reduce((s, d) => s + (Number(d.amount) || 0), 0),
      m2Eligible,
      m3Eligible,
      withNf,
    }
  }, [rows])

  // Task-based sections computed from rows
  const readyToSubmit = useMemo(() => {
    const items: { row: FundingRow; milestone: 'm2' | 'm3'; data: MsData }[] = []
    rows.forEach(r => {
      if (r.m2.status === 'Ready To Start') items.push({ row: r, milestone: 'm2', data: r.m2 })
      if (r.m3.status === 'Ready To Start') items.push({ row: r, milestone: 'm3', data: r.m3 })
    })
    return items
  }, [rows])

  const awaitingPayment = useMemo(() => {
    const items: { row: FundingRow; milestone: 'm2' | 'm3'; data: MsData }[] = []
    rows.forEach(r => {
      if (r.m2.status === 'Submitted') items.push({ row: r, milestone: 'm2', data: r.m2 })
      if (r.m3.status === 'Submitted') items.push({ row: r, milestone: 'm3', data: r.m3 })
    })
    return items
  }, [rows])

  const needsAttention = useMemo(() => {
    const items: { row: FundingRow; milestone: 'm2' | 'm3'; data: MsData }[] = []
    rows.forEach(r => {
      if (r.m2.status === 'Pending Resolution' || r.m2.status === 'Revision Required') items.push({ row: r, milestone: 'm2', data: r.m2 })
      if (r.m3.status === 'Pending Resolution' || r.m3.status === 'Revision Required') items.push({ row: r, milestone: 'm3', data: r.m3 })
    })
    return items
  }, [rows])

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading funding...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Funding" />

      {/* Stats bar */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 py-4 flex-shrink-0 flex-wrap gap-y-3">
        <div>
          <div className="text-xs text-gray-500">Projects</div>
          <div className="text-2xl font-bold text-white font-mono">{stats.totalProjects}</div>
          <div className="text-xs text-gray-500 font-mono">{fmt$(stats.totalContract)}</div>
        </div>
        <div className="border-l border-gray-700 pl-6">
          <div className="text-xs text-gray-500">M2 Eligible</div>
          <div className="text-2xl font-bold text-amber-400 font-mono">{stats.m2Eligible}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">M3 Eligible</div>
          <div className="text-2xl font-bold text-amber-400 font-mono">{stats.m3Eligible}</div>
        </div>
        <div className="border-l border-gray-700 pl-6">
          <div className="text-xs text-gray-500">Ready to Submit</div>
          <div className="text-2xl font-bold text-amber-400 font-mono">{stats.readyToStart}</div>
          {stats.readyAmount > 0 && <div className="text-xs text-gray-500 font-mono">{fmt$(stats.readyAmount)}</div>}
        </div>
        <div>
          <div className="text-xs text-gray-500">Submitted</div>
          <div className="text-2xl font-bold text-blue-400 font-mono">{stats.submitted}</div>
          {stats.submittedAmount > 0 && <div className="text-xs text-gray-500 font-mono">{fmt$(stats.submittedAmount)}</div>}
        </div>
        {stats.needsAttention > 0 && <div>
          <div className="text-xs text-gray-500">Needs Attention</div>
          <div className="text-2xl font-bold text-red-400 font-mono">{stats.needsAttention}</div>
        </div>}
        <div className="border-l border-gray-700 pl-6">
          <div className="text-xs text-gray-500">Funded</div>
          <div className="text-2xl font-bold text-green-400 font-mono">{stats.funded}</div>
          <div className="text-xs text-gray-500 font-mono">{fmt$(stats.fundedAmount)}</div>
        </div>
        {stats.outstanding > 0 && <div>
          <div className="text-xs text-gray-500">Outstanding</div>
          <div className="text-2xl font-bold text-white font-mono">{fmt$(stats.outstanding)}</div>
        </div>}
        {stats.withNf > 0 && <div>
          <div className="text-xs text-gray-500">NF Codes</div>
          <div className="text-2xl font-bold text-red-400 font-mono">{stats.withNf}</div>
        </div>}
      </div>

      {/* Guide */}
      {showGuide && (
        <div className="bg-indigo-950 border-b border-indigo-800 px-6 py-3 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-2">How to use the Funding page</div>
              <div className="grid grid-cols-3 gap-6 text-xs text-indigo-200">
                <div>
                  <div className="font-semibold text-white mb-1">Inline editing</div>
                  <div className="text-indigo-300 space-y-1">
                    <div>Click any <span className="text-white font-medium">Amount Due, Funded Date,</span> or <span className="text-white font-medium">Notes</span> cell to edit directly.</div>
                    <div>Press <span className="text-white font-medium">Enter</span> to save, <span className="text-white font-medium">Escape</span> to cancel.</div>
                    <div>Click <span className="text-green-400 font-medium">project name</span> to open the full project panel.</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-white mb-1">Status & NF codes</div>
                  <div className="text-indigo-300 space-y-1">
                    <div>Each milestone has its own <span className="text-white font-medium">Status</span> dropdown: Submitted, Funded, Rejected.</div>
                    <div>Click <span className="text-white font-medium">+</span> in the NF Codes column to search and assign nonfunded codes.</div>
                    <div>Click <span className="text-red-300 font-medium">x</span> next to a code to remove it.</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-white mb-1">Layout & Sorting</div>
                  <div className="space-y-1 text-indigo-300">
                    <div>Each row is one project with <span className="text-white font-medium">M1, M2, M3</span> payment columns side by side.</div>
                    <div>Click any <span className="text-white font-medium">column header</span> to sort. Click again to reverse.</div>
                    <div><span className="bg-amber-900 text-amber-300 px-1 py-0.5 rounded text-[10px] font-bold">M1</span> Eligible <span className="bg-blue-900 text-blue-300 px-1 py-0.5 rounded text-[10px] font-bold">M2</span> Submitted <span className="bg-green-900 text-green-300 px-1 py-0.5 rounded text-[10px] font-bold">M3</span> Funded <span className="bg-red-900 text-red-300 px-1 py-0.5 rounded text-[10px] font-bold">M1</span> Rejected</div>
                  </div>
                </div>
              </div>
            </div>
            <button onClick={() => { setShowGuide(false); localStorage.setItem('mg_funding_guide_v3', 'dismissed') }}
              className="text-indigo-400 hover:text-white text-lg flex-shrink-0 leading-none">x</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 flex-shrink-0 flex-wrap">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as FundingFilter)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Statuses</option>
          <option value="ready">Ready to Submit</option>
          <option value="submitted">Submitted</option>
          <option value="pending">Pending Resolution</option>
          <option value="revision">Revision Required</option>
          <option value="funded">Funded</option>
          <option value="nonfunded">Has NF Code</option>
        </select>
        <select value={financierFilter} onChange={e => setFinancierFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Financiers</option>
          {financiers.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..."
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5 w-48" />
        <span className="ml-auto text-xs text-gray-500">{rows.length} projects</span>
      </div>

      {/* Task-based sections */}
      {(readyToSubmit.length > 0 || awaitingPayment.length > 0 || needsAttention.length > 0) && (
        <div className="px-4 py-3 space-y-3 flex-shrink-0 border-b border-gray-800">

          {readyToSubmit.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-900/50 rounded-xl p-4">
              <button onClick={() => toggleBucket('readyToSubmit')} className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2 w-full text-left hover:text-amber-300 transition-colors">
                <span className="text-[10px]">{collapsed.readyToSubmit ? '▸' : '▾'}</span>
                Ready to Submit ({readyToSubmit.length})
              </button>
              {!collapsed.readyToSubmit && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {readyToSubmit.map(item => (
                    <div
                      key={`${item.row.project.id}-${item.milestone}`}
                      onClick={() => setSelectedProject(item.row.project)}
                      className="bg-gray-800/80 hover:bg-gray-700 border border-gray-700 rounded-lg p-3 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white text-sm truncate">{item.row.project.name}</span>
                        <span className="bg-amber-900 text-amber-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">{item.milestone.toUpperCase()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{item.row.project.id}</span>
                        <span>·</span>
                        <span>{item.row.project.financier ?? '—'}</span>
                        {item.data.amount && <><span>·</span><span className="text-amber-300 font-mono">{fmt$(item.data.amount)}</span></>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {awaitingPayment.length > 0 && (
            <div className="bg-blue-950/30 border border-blue-900/50 rounded-xl p-4">
              <button onClick={() => toggleBucket('awaitingPayment')} className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2 w-full text-left hover:text-blue-300 transition-colors">
                <span className="text-[10px]">{collapsed.awaitingPayment ? '▸' : '▾'}</span>
                Submitted — Awaiting Payment ({awaitingPayment.length})
              </button>
              {!collapsed.awaitingPayment && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {awaitingPayment.map(item => {
                    // Use install_complete_date for M2, pto_date for M3 as proxy for submission timing
                    const proxyDate = item.milestone === 'm2' ? item.row.project.install_complete_date : item.row.project.pto_date
                    const daysSince = proxyDate ? daysAgo(proxyDate) : 0
                    return (
                      <div
                        key={`${item.row.project.id}-${item.milestone}`}
                        onClick={() => setSelectedProject(item.row.project)}
                        className="bg-gray-800/80 hover:bg-gray-700 border border-gray-700 rounded-lg p-3 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-white text-sm truncate">{item.row.project.name}</span>
                          <span className="bg-blue-900 text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">{item.milestone.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>{item.row.project.id}</span>
                          <span>·</span>
                          <span>{item.row.project.financier ?? '—'}</span>
                          {item.data.amount && <><span>·</span><span className="text-blue-300 font-mono">{fmt$(item.data.amount)}</span></>}
                          {daysSince > 0 && <><span>·</span><span className="text-blue-300">{daysSince}d waiting</span></>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {needsAttention.length > 0 && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4">
              <button onClick={() => toggleBucket('needsAttention')} className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2 w-full text-left hover:text-red-300 transition-colors">
                <span className="text-[10px]">{collapsed.needsAttention ? '▸' : '▾'}</span>
                Needs Attention ({needsAttention.length})
              </button>
              {!collapsed.needsAttention && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {needsAttention.map(item => {
                    const nfCodes_display = [item.row.nf1, item.row.nf2, item.row.nf3].filter(Boolean)
                    return (
                      <div
                        key={`${item.row.project.id}-${item.milestone}`}
                        onClick={() => setSelectedProject(item.row.project)}
                        className="bg-gray-800/80 hover:bg-gray-700 border border-gray-700 rounded-lg p-3 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-white text-sm truncate">{item.row.project.name}</span>
                          <span className="bg-red-900 text-red-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">{item.milestone.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span>{item.row.project.id}</span>
                          <span>·</span>
                          <span>{item.row.project.financier ?? '—'}</span>
                          <span>·</span>
                          <span className={item.data.status === 'Pending Resolution' ? 'text-red-400' : 'text-amber-400'}>{item.data.status === 'Pending Resolution' ? 'Pending' : 'Revision'}</span>
                        </div>
                        {nfCodes_display.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5">
                            {nfCodes_display.map(code => (
                              <span key={code} className="bg-red-900/50 text-red-300 text-[10px] px-1 py-0.5 rounded">{code}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-gray-950 sticky top-0 z-10">
            {/* Group headers */}
            <tr>
              <th colSpan={6} className="border-b border-gray-800"></th>
              <th colSpan={4} className="text-center text-[10px] text-amber-400 font-bold border-b border-gray-800 border-l border-gray-700 bg-amber-950/20 py-1">M1 — Advance</th>
              <th colSpan={4} className="text-center text-[10px] text-blue-400 font-bold border-b border-gray-800 border-l border-gray-700 bg-blue-950/20 py-1">M2 — Install</th>
              <th colSpan={4} className="text-center text-[10px] text-green-400 font-bold border-b border-gray-800 border-l border-gray-700 bg-green-950/20 py-1">M3 — PTO</th>
              <th colSpan={2} className="border-b border-gray-800 border-l border-gray-700"></th>
            </tr>
            {/* Column headers */}
            <tr>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap cursor-pointer hover:text-white select-none" onClick={() => toggleSort('name')}>Project{sortIcon('name')}</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap cursor-pointer hover:text-white select-none" onClick={() => toggleSort('financier')}>Financier{sortIcon('financier')}</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap cursor-pointer hover:text-white select-none" onClick={() => toggleSort('ahj')}>AHJ{sortIcon('ahj')}</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap cursor-pointer hover:text-white select-none" onClick={() => toggleSort('install')}>Install{sortIcon('install')}</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap cursor-pointer hover:text-white select-none" onClick={() => toggleSort('pto')}>PTO{sortIcon('pto')}</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap cursor-pointer hover:text-white select-none" onClick={() => toggleSort('contract')}>Contract{sortIcon('contract')}</th>
              {/* M1 */}
              <th className="text-center text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 border-l border-gray-700"></th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Amt Due</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Funded</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Status</th>
              {/* M2 */}
              <th className="text-center text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 border-l border-gray-700"></th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 cursor-pointer hover:text-white select-none" onClick={() => toggleSort('m2_amount')}>Amt Due{sortIcon('m2_amount')}</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 cursor-pointer hover:text-white select-none" onClick={() => toggleSort('m2_funded')}>Funded{sortIcon('m2_funded')}</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Status</th>
              {/* M3 */}
              <th className="text-center text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 border-l border-gray-700"></th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Amt Due</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Funded</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Status</th>
              {/* NF + Notes */}
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 border-l border-gray-700">NF Codes</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pid = row.project.id
              const f = row.funding
              // Combine notes from all milestones for display
              const allNotes = [row.m1.notes, row.m2.notes, row.m3.notes].filter(Boolean).join(' | ')
              return (
                <tr key={pid} className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors">
                  {/* Project */}
                  <td className="px-2 py-1.5 max-w-[160px] cursor-pointer" onClick={() => setSelectedProject(row.project)}>
                    <div className="font-medium text-green-400 hover:text-green-300 truncate text-xs">{row.project.name}</div>
                    <div className="text-gray-500 truncate text-[10px]">{pid}</div>
                  </td>
                  <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{row.project.financier ?? '—'}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{row.project.ahj ?? '—'}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(row.project.install_complete_date)}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(row.project.pto_date)}</td>
                  <td className="px-2 py-1.5 text-gray-300 font-mono whitespace-nowrap">{row.project.contract ? fmt$(Number(row.project.contract)) : '—'}</td>

                  {/* M1 */}
                  <MsCells ms="m1" data={row.m1} pid={pid} saveFundingField={saveFundingField} disabled={!canEditFunding} />
                  {/* M2 */}
                  <MsCells ms="m2" data={row.m2} pid={pid} saveFundingField={saveFundingField} disabled={!canEditFunding} />
                  {/* M3 */}
                  <MsCells ms="m3" data={row.m3} pid={pid} saveFundingField={saveFundingField} disabled={!canEditFunding} />

                  {/* NF Codes */}
                  <td className="px-2 py-1.5 border-l border-gray-700">
                    <div className="flex items-center gap-1">
                      <NfCodePicker value={row.nf1} codes={nfCodes} slot={1} disabled={!canEditFunding} onSave={async val => saveFundingField(pid, nfField(1), val)} />
                      <NfCodePicker value={row.nf2} codes={nfCodes} slot={2} disabled={!canEditFunding} onSave={async val => saveFundingField(pid, nfField(2), val)} />
                      <NfCodePicker value={row.nf3} codes={nfCodes} slot={3} disabled={!canEditFunding} onSave={async val => saveFundingField(pid, nfField(3), val)} />
                    </div>
                  </td>
                  {/* Notes — show combined, edit m1 notes for now */}
                  <td className="px-2 py-1.5 max-w-[180px]">
                    <EditableCell
                      value={allNotes || null}
                      type="text"
                      placeholder={canEditFunding ? "Add note..." : "—"}
                      className="text-gray-400 text-[10px]"
                      disabled={!canEditFunding}
                      onSave={async val => saveFundingField(pid, 'm1_notes', val)}
                    />
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={20} className="text-center py-12 text-gray-500">No projects match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}

      {selectedProject && (
        <ProjectPanel project={selectedProject} onClose={() => setSelectedProject(null)} onProjectUpdated={loadDashboard} />
      )}
    </div>
  )
}
