'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Nav } from '@/components/Nav'
import { fmt$, fmtDate, STAGE_LABELS } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project, ProjectFunding } from '@/types/database'

type MilestoneKey = 'm1' | 'm2' | 'm3'
type FundingFilter = 'all' | 'eligible' | 'funded' | 'nonfunded'

interface FundingRow {
  project: Project
  funding: ProjectFunding | null
  milestone: MilestoneKey
  amount: number | null
  funded_date: string | null
  cb: number | null
  cb_credit: number | null
  nf1: string | null
  nf2: string | null
  nf3: string | null
  isEligible: boolean
  isFunded: boolean
  isNonfunded: boolean
  daysWaiting: number | null
}

function getMilestoneData(f: ProjectFunding | null, ms: MilestoneKey) {
  if (!f) return { amount: null, funded_date: null, cb: null, cb_credit: null, nf1: null, nf2: null, nf3: null }
  return {
    amount:      ms === 'm1' ? f.m1_amount : ms === 'm2' ? f.m2_amount : f.m3_amount,
    funded_date: ms === 'm1' ? f.m1_funded_date : ms === 'm2' ? f.m2_funded_date : f.m3_funded_date,
    cb:          ms === 'm1' ? f.m1_cb : ms === 'm2' ? f.m2_cb : null,
    cb_credit:   ms === 'm1' ? f.m1_cb_credit : ms === 'm2' ? f.m2_cb_credit : null,
    nf1:         f.nonfunded_code_1,
    nf2:         f.nonfunded_code_2,
    nf3:         f.nonfunded_code_3,
  }
}

function isEligible(p: Project, ms: MilestoneKey): boolean {
  if (ms === 'm1') return true // Always eligible after sale
  if (ms === 'm2') return !!p.install_complete_date
  if (ms === 'm3') return !!p.pto_date
  return false
}

const MS_LABELS: Record<MilestoneKey, string> = { m1: 'M1', m2: 'M2', m3: 'M3' }
const MS_FULL: Record<MilestoneKey, string> = { m1: 'Milestone 1', m2: 'Milestone 2 (Install)', m3: 'Milestone 3 (PTO)' }

export default function FundingPage() {
  const supabase = createClient()
  const [projects, setProjects] = useState<Project[]>([])
  const [funding, setFunding] = useState<Record<string, ProjectFunding>>({})
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)


  const [msFilter, setMsFilter] = useState<MilestoneKey | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<FundingFilter>('eligible')
  const [financierFilter, setFinancierFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('mg_funding_guide') !== 'dismissed'
  })

  const loadData = useCallback(async () => {
    const [projRes, fundRes] = await Promise.all([
      supabase.from('projects').select('*'),
      (supabase as any).from('project_funding').select('*'),
    ])
    if (projRes.data) setProjects(projRes.data as Project[])
    if (fundRes.data) {
      const map: Record<string, ProjectFunding> = {}
      fundRes.data.forEach((f: any) => { map[f.project_id] = f })
      setFunding(map)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const financiers = [...new Set(projects.map(p => p.financier).filter(Boolean))].sort() as string[]
  const milestones: MilestoneKey[] = msFilter === 'all' ? ['m1', 'm2', 'm3'] : [msFilter]

  // Build rows
  const rows: FundingRow[] = []
  projects.forEach(p => {
    if (financierFilter !== 'all' && p.financier !== financierFilter) return
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!p.name?.toLowerCase().includes(q) && !p.id?.toLowerCase().includes(q)) return
    }
    milestones.forEach(ms => {
      const f = funding[p.id] ?? null
      const data = getMilestoneData(f, ms)
      const eligible = isEligible(p, ms)
      const funded = !!data.funded_date
      const nonfunded = !funded && !!data.nf1
      // Days waiting = days since install_complete (M2) or pto_date (M3) with no funded date
      let daysWaiting: number | null = null
      if (eligible && !funded) {
        const triggerDate = ms === 'm2' ? p.install_complete_date : ms === 'm3' ? p.pto_date : p.sale_date
        if (triggerDate) daysWaiting = Math.floor((Date.now() - new Date(triggerDate + 'T00:00:00').getTime()) / 86400000)
      }
      const row: FundingRow = {
        project: p, funding: f, milestone: ms,
        ...data,
        isEligible: eligible, isFunded: funded, isNonfunded: nonfunded,
        daysWaiting,
      }
      if (statusFilter === 'eligible' && (!eligible || funded)) return
      if (statusFilter === 'funded' && !funded) return
      if (statusFilter === 'nonfunded' && !nonfunded) return
      rows.push(row)
    })
  })

  // Sort: eligible unfunded first, then by financier
  rows.sort((a, b) => {
    if (a.isFunded !== b.isFunded) return a.isFunded ? 1 : -1
    return (a.project.financier ?? '').localeCompare(b.project.financier ?? '')
  })

  const totalEligible = rows.filter(r => r.isEligible && !r.isFunded).length
  const totalFunded = rows.filter(r => r.isFunded).length
  const totalAmount = rows.filter(r => r.isFunded).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const pendingAmount = rows.filter(r => r.isEligible && !r.isFunded).reduce((s, r) => {
    return s + (Number(r.amount) || 0)
  }, 0)

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading funding...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Funding" />

      {/* Stats bar */}
      <div className="bg-gray-900 border-b border-gray-800 flex items-center gap-8 px-6 py-3 flex-shrink-0">
        <div><div className="text-xs text-gray-500">Eligible (unfunded)</div><div className="text-xl font-bold text-amber-400 font-mono">{totalEligible}</div></div>
        <div><div className="text-xs text-gray-500">Funded</div><div className="text-xl font-bold text-green-400 font-mono">{totalFunded}</div></div>
        <div><div className="text-xs text-gray-500">Total Funded</div><div className="text-xl font-bold text-white font-mono">{fmt$(totalAmount)}</div></div>
        {pendingAmount > 0 && <div><div className="text-xs text-gray-500">Pending</div><div className="text-xl font-bold text-amber-400 font-mono">{fmt$(pendingAmount)}</div></div>}
        <div className="ml-auto">
          <button
            onClick={async () => {
              const eligible = rows.filter(r => r.isEligible && !r.isFunded && !r.isNonfunded)
              if (eligible.length === 0) return
              if (!confirm(`Mark ${eligible.length} eligible milestone${eligible.length > 1 ? 's' : ''} as submitted?`)) return
              alert(`${eligible.length} milestones marked for submission`)
            }}
            className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            Submit All Eligible ({rows.filter(r => r.isEligible && !r.isFunded).length})
          </button>
        </div>
      </div>

      {/* How-to banner for Taylor */}
      {showGuide && (
        <div className="bg-indigo-950 border-b border-indigo-800 px-6 py-4 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs font-bold text-indigo-300 uppercase tracking-wider mb-2">👋 How to use the Funding page</div>
              <div className="grid grid-cols-3 gap-6 text-xs text-indigo-200">
                <div>
                  <div className="font-semibold text-white mb-1">The three milestones</div>
                  <div className="text-indigo-300 space-y-1">
                    <div><span className="text-amber-300 font-bold">M1</span> — Advance payment. Eligible once a project is sold.</div>
                    <div><span className="text-amber-300 font-bold">M2</span> — Substantial completion. Eligible once installation is complete.</div>
                    <div><span className="text-amber-300 font-bold">M3</span> — Final payment. Eligible once PTO date is recorded.</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-white mb-1">Status badges</div>
                  <div className="space-y-1 text-indigo-300">
                    <div><span className="bg-amber-900 text-amber-300 px-1.5 py-0.5 rounded text-xs font-bold mr-1">M1</span> Eligible — ready to submit to financier</div>
                    <div><span className="bg-green-900 text-green-300 px-1.5 py-0.5 rounded text-xs font-bold mr-1">M1</span> Funded — payment received</div>
                    <div><span className="bg-red-900 text-red-300 px-1.5 py-0.5 rounded text-xs font-bold mr-1">M1</span> Nonfunded — rejected, see NF codes</div>
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-white mb-1">Daily workflow</div>
                  <div className="text-indigo-300 space-y-1">
                    <div>1. Set filter to <span className="text-white font-medium">Eligible (unfunded)</span> to see what needs submitting</div>
                    <div>2. Filter by <span className="text-white font-medium">Financier</span> to group submissions</div>
                    <div>3. Click a row to open the project and record payment details</div>
                    <div>4. <span className="text-white font-medium">Days Waiting</span> highlights overdue submissions in red</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-indigo-800">
                <div className="text-xs font-bold text-white mb-1">👋 Hey Taylor — this page is being built for you.</div>
                <div className="text-xs text-indigo-300 leading-relaxed">
                  This is an early version of the Funding page. Before I build out the full submission workflow, I need your input on how you actually work.
                  Some things I'd love your feedback on:
                  <span className="text-white"> How do you currently track which milestones have been submitted vs. paid?
                  What does your submission process look like — do you submit one at a time or in batches by financier?
                  What information do you need on screen when you're working through these?
                  Anything that's missing or confusing here?</span>
                  <br /><br />
                  Drop your feedback in a note to Greg or reach out directly — the goal is to make this page save you time, not create more work.
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setShowGuide(false)
                localStorage.setItem('mg_funding_guide', 'dismissed')
              }}
              className="text-indigo-400 hover:text-white text-lg flex-shrink-0 leading-none"
            >×</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-950 border-b border-gray-800 flex items-center gap-2 px-4 py-2 flex-shrink-0 flex-wrap">
        <select value={msFilter} onChange={e => setMsFilter(e.target.value as any)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Milestones</option>
          {(['m1','m2','m3'] as MilestoneKey[]).map(ms => <option key={ms} value={ms}>{MS_FULL[ms]}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as FundingFilter)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Statuses</option>
          <option value="eligible">Eligible (unfunded)</option>
          <option value="funded">Funded</option>
          <option value="nonfunded">Nonfunded</option>
        </select>
        <select value={financierFilter} onChange={e => setFinancierFilter(e.target.value)}
          className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
          <option value="all">All Financiers</option>
          {financiers.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="ml-auto text-xs text-gray-500">{rows.length} rows</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-gray-950 sticky top-0">
            <tr>
              {['MS','Project','Financier','Stage','Amount','Funded Date','Days Waiting','CB','CB Credit','Nonfunded'].map(h => (
                <th key={h} className="text-left text-xs text-gray-400 font-medium px-3 py-2 border-b border-gray-800 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.project.id}-${row.milestone}`}
                onClick={() => setSelectedProject(row.project)}
                className={`border-b border-gray-800 cursor-pointer hover:bg-gray-800`}>
                <td className="px-3 py-2">
                  <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${
                    row.isFunded ? 'bg-green-900 text-green-300' :
                    row.isNonfunded ? 'bg-red-900 text-red-300' :
                    row.isEligible ? 'bg-amber-900 text-amber-300' :
                    'bg-gray-800 text-gray-500'
                  }`}>{MS_LABELS[row.milestone]}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-white">{row.project.name}</div>
                  <div className="text-gray-500">{row.project.id} · {row.project.city}</div>
                </td>
                <td className="px-3 py-2 text-gray-300">{row.project.financier}</td>
                <td className="px-3 py-2 text-gray-400">{STAGE_LABELS[row.project.stage]}</td>
                <td className="px-3 py-2 text-gray-200 font-mono">{row.amount ? fmt$(row.amount) : '—'}</td>
                <td className="px-3 py-2 text-gray-300">{fmtDate(row.funded_date) || '—'}</td>
                <td className="px-3 py-2 font-mono">
                  {row.daysWaiting !== null
                    ? <span className={row.daysWaiting >= 30 ? 'text-red-400' : row.daysWaiting >= 14 ? 'text-amber-400' : 'text-gray-300'}>{row.daysWaiting}d</span>
                    : <span className="text-gray-600">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-400 font-mono">{row.cb ? fmt$(row.cb) : '—'}</td>
                <td className="px-3 py-2 text-gray-400 font-mono">{row.cb_credit ? fmt$(row.cb_credit) : '—'}</td>
                <td className="px-3 py-2 text-red-400">{[row.nf1, row.nf2, row.nf3].filter(Boolean).join(', ') || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-gray-500">No funding rows match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedProject && (
        <ProjectPanel project={selectedProject} onClose={() => setSelectedProject(null)} onProjectUpdated={loadData} />
      )}
    </div>
  )
}
