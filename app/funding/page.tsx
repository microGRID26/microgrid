'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { fmt$, fmtDate, STAGE_LABELS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project, ProjectFunding, NonfundedCode } from '@/types/database'

type MilestoneKey = 'm1' | 'm2' | 'm3'
type FundingFilter = 'all' | 'eligible' | 'funded' | 'nonfunded' | 'submitted' | 'rejected'
type FundingStatus = 'Not Submitted' | 'Submitted' | 'Funded' | 'Rejected' | 'Complete'

const FUNDING_STATUSES: FundingStatus[] = ['Not Submitted', 'Submitted', 'Funded', 'Rejected', 'Complete']

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
      <input
        ref={inputRef}
        type={type === 'currency' || type === 'number' ? 'number' : type}
        step={type === 'currency' ? '0.01' : undefined}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
        className={`bg-gray-700 text-white text-xs rounded px-2 py-1 border border-green-500 focus:outline-none w-full ${className}`}
        onClick={e => e.stopPropagation()}
      />
    )
  }

  const display = type === 'currency' && value ? fmt$(Number(value))
    : type === 'date' && value ? fmtDate(String(value))
    : value ?? placeholder

  return (
    <div
      onClick={startEdit}
      className={`rounded px-1 py-0.5 -mx-1 -my-1 min-h-[24px] flex items-center transition-colors w-full ${saving ? 'opacity-50' : ''} ${disabled ? '' : 'cursor-pointer hover:bg-gray-700 hover:text-white'} ${className}`}
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

  const color = value === 'Funded' || value === 'Complete' ? 'text-green-400'
    : value === 'Submitted' ? 'text-blue-400'
    : value === 'Rejected' ? 'text-red-400'
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
      {FUNDING_STATUSES.map(s => <option key={s} value={s}>{compact ? s.slice(0, 3) : s}</option>)}
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
  const supabase = createClient()
  const { user: currentUser } = useCurrentUser()
  const canEditFunding = currentUser?.isFinance ?? false
  const [projects, setProjects] = useState<Project[]>([])
  const [funding, setFunding] = useState<Record<string, ProjectFunding>>({})
  const [nfCodes, setNfCodes] = useState<NonfundedCode[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<FundingFilter>('all')
  const [financierFilter, setFinancierFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('mg_funding_guide_v3') !== 'dismissed'
  })

  const loadData = useCallback(async () => {
    const [projRes, fundRes, nfRes] = await Promise.all([
      supabase.from('projects').select('id, name, city, financier, ahj, install_complete_date, pto_date, contract, sale_date, stage'),
      (supabase as any).from('project_funding').select('*'),
      (supabase as any).from('nonfunded_codes').select('*').order('master_code').order('code'),
    ])
    if (projRes.data) setProjects(projRes.data as Project[])
    if (fundRes.data) {
      const map: Record<string, ProjectFunding> = {}
      fundRes.data.forEach((f: any) => { map[f.project_id] = f })
      setFunding(map)
    }
    if (nfRes.data) setNfCodes(nfRes.data as NonfundedCode[])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2000) }

  const saveFundingField = async (projectId: string, field: string, value: string | number | null) => {
    const update: Record<string, any> = { [field]: value }
    const { error } = await (supabase as any).from('project_funding').upsert(
      { project_id: projectId, ...update },
      { onConflict: 'project_id' }
    )
    if (error) { showToast('Save failed: ' + error.message); return }
    setFunding(prev => {
      const existing = prev[projectId] ?? { project_id: projectId } as any
      return { ...prev, [projectId]: { ...existing, ...update } }
    })
  }

  const nfField = (slot: number) => `nonfunded_code_${slot}`
  const financiers = [...new Set(projects.map(p => p.financier).filter(Boolean))].sort() as string[]

  // Build one row per project
  const rows: FundingRow[] = []
  projects.forEach(p => {
    if (financierFilter !== 'all' && p.financier !== financierFilter) return
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!p.name?.toLowerCase().includes(q) && !p.id?.toLowerCase().includes(q) && !p.city?.toLowerCase().includes(q)) return
    }
    const f = funding[p.id] ?? null
    const m1 = getMsData(f, p, 'm1')
    const m2 = getMsData(f, p, 'm2')
    const m3 = getMsData(f, p, 'm3')

    // Filter by status across any milestone
    if (statusFilter === 'eligible' && !m1.isEligible && !m2.isEligible && !m3.isEligible) return
    if (statusFilter === 'funded' && !m1.isFunded && !m2.isFunded && !m3.isFunded) return
    if (statusFilter === 'submitted' && m1.status !== 'Submitted' && m2.status !== 'Submitted' && m3.status !== 'Submitted') return
    if (statusFilter === 'rejected' && m1.status !== 'Rejected' && m2.status !== 'Rejected' && m3.status !== 'Rejected') return
    if (statusFilter === 'nonfunded' && !f?.nonfunded_code_1) return

    rows.push({ project: p, funding: f, m1, m2, m3, nf1: f?.nonfunded_code_1 ?? null, nf2: f?.nonfunded_code_2 ?? null, nf3: f?.nonfunded_code_3 ?? null })
  })

  rows.sort((a, b) => (a.project.financier ?? '').localeCompare(b.project.financier ?? ''))

  // Stats
  const allMs = rows.flatMap(r => [r.m1, r.m2, r.m3])
  const totalEligible = allMs.filter(d => d.isEligible && !d.isFunded).length
  const totalFunded = allMs.filter(d => d.isFunded).length
  const totalAmount = allMs.filter(d => d.isFunded).reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const pendingAmount = allMs.filter(d => d.isEligible && !d.isFunded).reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const totalSubmitted = allMs.filter(d => d.status === 'Submitted').length
  const totalRejected = allMs.filter(d => d.status === 'Rejected').length

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading funding...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Funding" />

      {/* Stats bar */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-6 px-6 py-3 flex-shrink-0 flex-wrap">
        <div><div className="text-xs text-gray-500">Eligible</div><div className="text-xl font-bold text-amber-400 font-mono">{totalEligible}</div></div>
        {totalSubmitted > 0 && <div><div className="text-xs text-gray-500">Submitted</div><div className="text-xl font-bold text-blue-400 font-mono">{totalSubmitted}</div></div>}
        <div><div className="text-xs text-gray-500">Funded</div><div className="text-xl font-bold text-green-400 font-mono">{totalFunded}</div></div>
        {totalRejected > 0 && <div><div className="text-xs text-gray-500">Rejected</div><div className="text-xl font-bold text-red-400 font-mono">{totalRejected}</div></div>}
        <div><div className="text-xs text-gray-500">Total Funded</div><div className="text-xl font-bold text-white font-mono">{fmt$(totalAmount)}</div></div>
        {pendingAmount > 0 && <div><div className="text-xs text-gray-500">Pending</div><div className="text-xl font-bold text-amber-400 font-mono">{fmt$(pendingAmount)}</div></div>}
        <span className="ml-auto text-xs text-gray-500">{rows.length} projects</span>
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
                    <div>Each milestone has its own <span className="text-white font-medium">Status</span> dropdown: Not Submitted, Submitted, Funded, Rejected, Complete.</div>
                    <div>Click <span className="text-white font-medium">+</span> in the NF Codes column to search and assign nonfunded codes.</div>
                    <div>Click <span className="text-red-300 font-medium">x</span> next to a code to remove it.</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-white mb-1">Layout</div>
                  <div className="space-y-1 text-indigo-300">
                    <div>Each row is one project with <span className="text-white font-medium">M1, M2, M3</span> payment columns side by side.</div>
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
          <option value="eligible">Has Eligible</option>
          <option value="submitted">Has Submitted</option>
          <option value="funded">Has Funded</option>
          <option value="rejected">Has Rejected</option>
          <option value="nonfunded">Has NF Code</option>
        </select>
        <select value={financierFilter} onChange={e => setFinancierFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Financiers</option>
          {financiers.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects..."
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5 w-48" />
      </div>

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
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap">Project</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap">Financier</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap">AHJ</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap">Install</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap">PTO</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 whitespace-nowrap">Contract</th>
              {/* M1 */}
              <th className="text-center text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 border-l border-gray-700"></th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Amt Due</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Funded</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Status</th>
              {/* M2 */}
              <th className="text-center text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 border-l border-gray-700"></th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Amt Due</th>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Funded</th>
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
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(row.project.install_complete_date) || '—'}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(row.project.pto_date) || '—'}</td>
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
        <ProjectPanel project={selectedProject} onClose={() => setSelectedProject(null)} onProjectUpdated={loadData} />
      )}
    </div>
  )
}
