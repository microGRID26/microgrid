'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { fmt$, fmtDate, daysAgo } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { useSupabaseQuery } from '@/lib/hooks'
import { Download } from 'lucide-react'
import type { Project, ProjectFunding, NonfundedCode } from '@/types/database'
import {
  EditableCell, StatusSelect, NfCodePicker, MsBadge, MsCells, getSubmissionAge,
  exportFundingCSV, getMsData,
  type MilestoneKey, type FundingFilter, type FundingDashboardRow, type MsData, type FundingRow, type SortColumn,
} from '@/components/funding'

// ── Main Page ─────────────────────────────────────────────────────────
export default function FundingPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const canEditFunding = currentUser?.isFinance ?? false

  const [projects, setProjects] = useState<Project[]>([])
  const [funding, setFunding] = useState<Record<string, ProjectFunding>>({})
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<FundingFilter>('all')
  const [financierFilter, setFinancierFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<SortColumn>('financier')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('mg_funding_guide_v3') !== 'dismissed'
  })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ readyToSubmit: true, awaitingPayment: true, needsAttention: true })
  const [milestoneFilter, setMilestoneFilter] = useState<'all' | 'm1' | 'm2' | 'm3'>('all')
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
    const { data, error } = await db().from('funding_dashboard').select('*').limit(5000)
    if (error) { console.error('funding_dashboard load failed:', error); setDashLoading(false); return }
    if (data) {
      const projList: Project[] = []
      const fundMap: Record<string, ProjectFunding> = {}
      const rows = data as unknown as FundingDashboardRow[]
      rows.forEach((row) => {
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
    const update: Record<string, string | number | null> = { [field]: value }
    const { error } = await db().from('project_funding').upsert(
      { project_id: projectId, ...update },
      { onConflict: 'project_id' }
    )
    if (error) { console.error('Funding save error:', error); showToast('Save failed — please try again'); return }
    setFunding(prev => {
      const existing = prev[projectId] ?? { project_id: projectId } as ProjectFunding
      return { ...prev, [projectId]: { ...existing, ...update } }
    })
  }

  const nfField = (slot: number) => `nonfunded_code_${slot}`

  // Financier list with counts for dropdown
  const financierCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    projects.forEach(p => {
      const key = p.financier ?? '(none)'
      counts[key] = (counts[key] ?? 0) + 1
    })
    return counts
  }, [projects])
  const financiers = useMemo(() => Object.keys(financierCounts).filter(k => k !== '(none)').sort(), [financierCounts])

  const toggleSort = (col: SortColumn) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }
  const sortIcon = (col: SortColumn) => sortCol === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  // Build one row per project
  const rows = useMemo(() => {
    const result: FundingRow[] = []
    projects.forEach(p => {
      if (financierFilter !== 'all' && p.financier !== financierFilter) return

      // Search: name, id, city, address, financier, AHJ
      if (search.trim()) {
        const q = search.toLowerCase()
        if (
          !p.name?.toLowerCase().includes(q) &&
          !p.id?.toLowerCase().includes(q) &&
          !p.city?.toLowerCase().includes(q) &&
          !p.address?.toLowerCase().includes(q) &&
          !p.financier?.toLowerCase().includes(q) &&
          !p.ahj?.toLowerCase().includes(q)
        ) return
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

      // Milestone filter from "Ready to Collect" cards
      if (milestoneFilter === 'm1' && (m1.isFunded || m1.status === 'Submitted' || !p.sale_date)) return
      if (milestoneFilter === 'm2' && (!m2.isEligible || m2.isFunded || m2.status === 'Submitted')) return
      if (milestoneFilter === 'm3' && (!m3.isEligible || m3.isFunded || m3.status === 'Submitted')) return

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
        case 'stage': av = a.project.stage; bv = b.project.stage; break
        case 'm1_amount': av = a.m1.amount; bv = b.m1.amount; break
        case 'm1_funded': av = a.m1.funded_date; bv = b.m1.funded_date; break
        case 'm1_status': av = a.m1.status; bv = b.m1.status; break
        case 'm2_amount': av = a.m2.amount; bv = b.m2.amount; break
        case 'm2_funded': av = a.m2.funded_date; bv = b.m2.funded_date; break
        case 'm2_status': av = a.m2.status; bv = b.m2.status; break
        case 'm3_amount': av = a.m3.amount; bv = b.m3.amount; break
        case 'm3_funded': av = a.m3.funded_date; bv = b.m3.funded_date; break
        case 'm3_status': av = a.m3.status; bv = b.m3.status; break
        case 'nf': av = a.nf1; bv = b.nf1; break
        default: av = a.project.financier; bv = b.project.financier
      }
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return result
  }, [projects, funding, financierFilter, search, statusFilter, milestoneFilter, sortCol, sortDir])

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

    // Stale submissions (>30 days)
    const staleCount = rows.reduce((count, r) => {
      const m2Stale = getSubmissionAge(r.m2.status, r.project.install_complete_date)
      const m3Stale = getSubmissionAge(r.m3.status, r.project.pto_date)
      return count + (m2Stale && m2Stale.days > 30 ? 1 : 0) + (m3Stale && m3Stale.days > 30 ? 1 : 0)
    }, 0)

    // Ready to collect: milestone is eligible but not yet funded or submitted
    // M1 = sale date exists, M1 not funded
    const m1Ready = rows.filter(r => r.project.sale_date && !r.m1.isFunded && r.m1.status !== 'Submitted')
    const m1ReadyAmount = m1Ready.reduce((s, r) => s + (Number(r.m1.amount) || 0), 0)
    // M2 = install complete, M2 not funded
    const m2Ready = rows.filter(r => r.m2.isEligible && !r.m2.isFunded && r.m2.status !== 'Submitted')
    const m2ReadyAmount = m2Ready.reduce((s, r) => s + (Number(r.m2.amount) || 0), 0)
    // M3 = PTO received, M3 not funded
    const m3Ready = rows.filter(r => r.m3.isEligible && !r.m3.isFunded && r.m3.status !== 'Submitted')
    const m3ReadyAmount = m3Ready.reduce((s, r) => s + (Number(r.m3.amount) || 0), 0)

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
      staleCount,
      m1ReadyCount: m1Ready.length,
      m1ReadyAmount,
      m2ReadyCount: m2Ready.length,
      m2ReadyAmount,
      m3ReadyCount: m3Ready.length,
      m3ReadyAmount,
      totalReadyToCollect: m1ReadyAmount + m2ReadyAmount + m3ReadyAmount,
    }
  }, [rows])

  // Task-based sections
  const readyToSubmit = useMemo(() => {
    const items: { row: FundingRow; milestone: 'm2' | 'm3'; data: MsData }[] = []
    rows.forEach(r => {
      if (r.m2.status === 'Ready To Start') items.push({ row: r, milestone: 'm2', data: r.m2 })
      if (r.m3.status === 'Ready To Start') items.push({ row: r, milestone: 'm3', data: r.m3 })
    })
    return items
  }, [rows])

  const awaitingPayment = useMemo(() => {
    const items: { row: FundingRow; milestone: 'm2' | 'm3'; data: MsData; daysWaiting: number; staleColor: string }[] = []
    rows.forEach(r => {
      if (r.m2.status === 'Submitted') {
        const days = daysAgo(r.project.install_complete_date)
        const staleColor = days > 60 ? 'text-red-400' : days > 30 ? 'text-amber-400' : 'text-blue-300'
        items.push({ row: r, milestone: 'm2', data: r.m2, daysWaiting: days, staleColor })
      }
      if (r.m3.status === 'Submitted') {
        const days = daysAgo(r.project.pto_date)
        const staleColor = days > 60 ? 'text-red-400' : days > 30 ? 'text-amber-400' : 'text-blue-300'
        items.push({ row: r, milestone: 'm3', data: r.m3, daysWaiting: days, staleColor })
      }
    })
    // Sort stale items to top
    items.sort((a, b) => b.daysWaiting - a.daysWaiting)
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

  // Role gate: Finance+ only (placed after all hooks to respect Rules of Hooks)
  if (!userLoading && currentUser && !currentUser.isFinance) {
    return (
      <>
        <Nav active="Funding" />
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">Funding is available to Finance and above.</p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              &larr; Back to Command Center
            </a>
          </div>
        </div>
      </>
    )
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading funding...</div>
    </div>
  )

  // Sortable column header helper
  const SortHeader = ({ col, children, className = '' }: { col: SortColumn; children?: React.ReactNode; className?: string }) => (
    <th
      className={`text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 cursor-pointer hover:text-white select-none whitespace-nowrap ${className}`}
      onClick={() => toggleSort(col)}
      aria-sort={sortCol === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
      scope="col"
    >
      {children}{sortIcon(col)}
    </th>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Funding" />

      {/* Ready to Collect — hero cards */}
      {!loading && (stats.m1ReadyAmount > 0 || stats.m2ReadyAmount > 0 || stats.m3ReadyAmount > 0) && (
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex-shrink-0">
          <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Ready to Collect</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {/* Total */}
            <button onClick={() => setMilestoneFilter('all')}
              className={`rounded-xl p-4 border text-left transition-all ${milestoneFilter === 'all' ? 'bg-green-950/40 border-green-700' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}>
              <div className="text-xs text-gray-400 mb-1">Total Collectable</div>
              <div className="text-2xl font-bold text-green-400 font-mono">{fmt$(stats.totalReadyToCollect)}</div>
              <div className="text-xs text-gray-500 mt-1">{stats.m1ReadyCount + stats.m2ReadyCount + stats.m3ReadyCount} milestones</div>
            </button>
            {/* M1 */}
            <button onClick={() => setMilestoneFilter(milestoneFilter === 'm1' ? 'all' : 'm1')}
              className={`rounded-xl p-4 border text-left transition-all ${milestoneFilter === 'm1' ? 'bg-blue-950/40 border-blue-700' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}>
              <div className="text-xs text-gray-400 mb-1">M1 — Contract Signed</div>
              <div className="text-2xl font-bold text-blue-400 font-mono">{fmt$(stats.m1ReadyAmount)}</div>
              <div className="text-xs text-gray-500 mt-1">{stats.m1ReadyCount} projects</div>
            </button>
            {/* M2 */}
            <button onClick={() => setMilestoneFilter(milestoneFilter === 'm2' ? 'all' : 'm2')}
              className={`rounded-xl p-4 border text-left transition-all ${milestoneFilter === 'm2' ? 'bg-amber-950/40 border-amber-700' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}>
              <div className="text-xs text-gray-400 mb-1">M2 — Install Complete</div>
              <div className="text-2xl font-bold text-amber-400 font-mono">{fmt$(stats.m2ReadyAmount)}</div>
              <div className="text-xs text-gray-500 mt-1">{stats.m2ReadyCount} projects</div>
            </button>
            {/* M3 */}
            <button onClick={() => setMilestoneFilter(milestoneFilter === 'm3' ? 'all' : 'm3')}
              className={`rounded-xl p-4 border text-left transition-all ${milestoneFilter === 'm3' ? 'bg-purple-950/40 border-purple-700' : 'bg-gray-800 border-gray-700 hover:border-gray-600'}`}>
              <div className="text-xs text-gray-400 mb-1">M3 — PTO Received</div>
              <div className="text-2xl font-bold text-purple-400 font-mono">{fmt$(stats.m3ReadyAmount)}</div>
              <div className="text-xs text-gray-500 mt-1">{stats.m3ReadyCount} projects</div>
            </button>
          </div>
        </div>
      )}

      {/* Stats bar - wraps on mobile */}
      <div className="bg-gray-900 border-b border-gray-800 grid grid-cols-2 sm:grid-cols-4 lg:flex lg:items-center lg:justify-between px-6 py-4 flex-shrink-0 gap-y-3 gap-x-4">
        <div>
          <div className="text-xs text-gray-500">Projects</div>
          <div className="text-2xl font-bold text-white font-mono">{stats.totalProjects}</div>
          <div className="text-xs text-gray-500 font-mono">{fmt$(stats.totalContract)}</div>
        </div>
        <div className="lg:border-l lg:border-gray-700 lg:pl-6">
          <div className="text-xs text-gray-500">M2 Eligible</div>
          <div className="text-2xl font-bold text-amber-400 font-mono">{stats.m2Eligible}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">M3 Eligible</div>
          <div className="text-2xl font-bold text-amber-400 font-mono">{stats.m3Eligible}</div>
        </div>
        <div className="lg:border-l lg:border-gray-700 lg:pl-6">
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
        {stats.staleCount > 0 && <div>
          <div className="text-xs text-gray-500">Stale (&gt;30d)</div>
          <div className="text-2xl font-bold text-amber-400 font-mono">{stats.staleCount}</div>
        </div>}
        <div className="lg:border-l lg:border-gray-700 lg:pl-6">
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-indigo-200">
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
              aria-label="Dismiss guide"
              className="text-indigo-400 hover:text-white text-lg flex-shrink-0 leading-none">x</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-2 px-4 py-2 flex-shrink-0 flex-wrap">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as FundingFilter)}
          aria-label="Filter by funding status"
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
          aria-label="Filter by financier"
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Financiers ({projects.length})</option>
          {financiers.map(f => <option key={f} value={f}>{f} ({financierCounts[f]})</option>)}
        </select>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, ID, city, financier, AHJ..."
          aria-label="Search funding projects"
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5 w-64" />
        <span className="ml-auto text-xs text-gray-500 flex items-center gap-3">
          {rows.length} projects
          <button
            onClick={() => exportFundingCSV(rows)}
            className="inline-flex items-center gap-1 text-gray-400 hover:text-green-400 transition-colors"
            title="Export filtered results to CSV"
            aria-label="Export funding data to CSV"
          >
            <Download size={14} />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </span>
      </div>

      {/* Task-based sections */}
      {(readyToSubmit.length > 0 || awaitingPayment.length > 0 || needsAttention.length > 0) && (
        <div className="px-4 py-3 space-y-3 flex-shrink-0 border-b border-gray-800">

          {readyToSubmit.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-900/50 rounded-xl p-4">
              <button onClick={() => toggleBucket('readyToSubmit')} className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2 w-full text-left hover:text-amber-300 transition-colors">
                <span className="text-[10px]">{collapsed.readyToSubmit ? '\u25B8' : '\u25BE'}</span>
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
                        <span>&middot;</span>
                        <span>{item.row.project.financier ?? '\u2014'}</span>
                        {item.data.amount && <><span>&middot;</span><span className="text-amber-300 font-mono">{fmt$(item.data.amount)}</span></>}
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
                <span className="text-[10px]">{collapsed.awaitingPayment ? '\u25B8' : '\u25BE'}</span>
                Submitted &mdash; Awaiting Payment ({awaitingPayment.length})
              </button>
              {!collapsed.awaitingPayment && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  {awaitingPayment.map(item => (
                    <div
                      key={`${item.row.project.id}-${item.milestone}`}
                      onClick={() => setSelectedProject(item.row.project)}
                      className={`bg-gray-800/80 hover:bg-gray-700 border rounded-lg p-3 cursor-pointer transition-colors ${
                        item.daysWaiting > 60 ? 'border-red-700/60' : item.daysWaiting > 30 ? 'border-amber-700/60' : 'border-gray-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white text-sm truncate">{item.row.project.name}</span>
                        <span className="bg-blue-900 text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0">{item.milestone.toUpperCase()}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{item.row.project.id}</span>
                        <span>&middot;</span>
                        <span>{item.row.project.financier ?? '\u2014'}</span>
                        {item.data.amount && <><span>&middot;</span><span className="text-blue-300 font-mono">{fmt$(item.data.amount)}</span></>}
                        {item.daysWaiting > 0 && <><span>&middot;</span><span className={item.staleColor}>{item.daysWaiting}d waiting</span></>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {needsAttention.length > 0 && (
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4">
              <button onClick={() => toggleBucket('needsAttention')} className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2 w-full text-left hover:text-red-300 transition-colors">
                <span className="text-[10px]">{collapsed.needsAttention ? '\u25B8' : '\u25BE'}</span>
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
                          <span>&middot;</span>
                          <span>{item.row.project.financier ?? '\u2014'}</span>
                          <span>&middot;</span>
                          <span className={item.data.status === 'Pending Resolution' ? 'text-red-400' : 'text-orange-400'}>{item.data.status === 'Pending Resolution' ? 'Pending' : 'Revision'}</span>
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
          <thead className="bg-gray-900 sticky top-0 z-10">
            {/* Group headers */}
            <tr>
              <th colSpan={6} className="border-b border-gray-800"></th>
              <th colSpan={4} className="text-center text-[10px] text-amber-400 font-bold border-b border-gray-800 border-l border-gray-700 bg-amber-950/20 py-1 hidden lg:table-cell">M1 &mdash; Advance</th>
              <th colSpan={4} className="text-center text-[10px] text-blue-400 font-bold border-b border-gray-800 border-l border-gray-700 bg-blue-950/20 py-1">M2 &mdash; Install</th>
              <th colSpan={4} className="text-center text-[10px] text-green-400 font-bold border-b border-gray-800 border-l border-gray-700 bg-green-950/20 py-1">M3 &mdash; PTO</th>
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
              {/* M1 - hidden on small screens */}
              <SortHeader col="m1_status" className="border-l border-gray-700 hidden lg:table-cell" />
              <SortHeader col="m1_amount" className="hidden lg:table-cell">Amt Due</SortHeader>
              <SortHeader col="m1_funded" className="hidden lg:table-cell">Funded</SortHeader>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800 hidden lg:table-cell">Status</th>
              {/* M2 */}
              <SortHeader col="m2_status" className="border-l border-gray-700" />
              <SortHeader col="m2_amount">Amt Due</SortHeader>
              <SortHeader col="m2_funded">Funded</SortHeader>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Status</th>
              {/* M3 */}
              <SortHeader col="m3_status" className="border-l border-gray-700" />
              <SortHeader col="m3_amount">Amt Due</SortHeader>
              <SortHeader col="m3_funded">Funded</SortHeader>
              <th className="text-left text-[10px] text-gray-500 font-medium px-1 py-2 border-b border-gray-800">Status</th>
              {/* NF + Notes */}
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800 border-l border-gray-700 cursor-pointer hover:text-white select-none" onClick={() => toggleSort('nf')}>NF Codes{sortIcon('nf')}</th>
              <th className="text-left text-xs text-gray-400 font-medium px-2 py-2 border-b border-gray-800">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const pid = row.project.id
              const f = row.funding
              const allNotes = [row.m1.notes, row.m2.notes, row.m3.notes].filter(Boolean).join(' | ')
              return (
                <tr key={pid} className="border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors">
                  {/* Project */}
                  <td className="px-2 py-1.5 max-w-[160px] cursor-pointer" onClick={() => setSelectedProject(row.project)}>
                    <div className="font-medium text-green-400 hover:text-green-300 truncate text-xs">{row.project.name}</div>
                    <div className="text-gray-500 truncate text-[10px]">{pid}</div>
                  </td>
                  <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{row.project.financier ?? '\u2014'}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{row.project.ahj ?? '\u2014'}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(row.project.install_complete_date)}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap text-[10px]">{fmtDate(row.project.pto_date)}</td>
                  <td className="px-2 py-1.5 text-gray-300 font-mono whitespace-nowrap">{row.project.contract ? fmt$(Number(row.project.contract)) : '\u2014'}</td>

                  {/* M1 - hidden on small screens */}
                  <td className="px-1 py-1.5 font-mono text-center hidden lg:table-cell">
                    <MsBadge ms="m1" data={row.m1} />
                  </td>
                  <td className="px-1 py-1.5 font-mono hidden lg:table-cell">
                    <EditableCell value={row.m1.amount} type="currency" disabled={!canEditFunding}
                      onSave={async val => saveFundingField(pid, 'm1_amount', val ? Number(val) : null)} />
                  </td>
                  <td className="px-1 py-1.5 hidden lg:table-cell">
                    <EditableCell value={row.m1.funded_date} type="date" disabled={!canEditFunding}
                      onSave={async val => saveFundingField(pid, 'm1_funded_date', val)} />
                  </td>
                  <td className="px-1 py-1.5 hidden lg:table-cell">
                    <StatusSelect value={row.m1.status} disabled={!canEditFunding}
                      onSave={async val => saveFundingField(pid, 'm1_status', val)} compact />
                  </td>

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
                  {/* Notes */}
                  <td className="px-2 py-1.5 max-w-[180px]">
                    <EditableCell
                      value={allNotes || null}
                      type="text"
                      placeholder={canEditFunding ? "Add note..." : "\u2014"}
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
