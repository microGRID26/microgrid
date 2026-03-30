'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { useRealtimeSubscription } from '@/lib/hooks'
import { fmt$, fmtDate } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { Pagination } from '@/components/Pagination'
import { Download, Calculator, DollarSign, TrendingUp, Clock, CheckCircle, Trophy, ChevronDown, ChevronUp, AlertTriangle, Banknote, Zap } from 'lucide-react'
import {
  loadCommissionRates,
  updateCommissionRate,
  addCommissionRate,
  deleteCommissionRate,
  calculateCommission,
  loadCommissionRecords,
  createCommissionRecord,
  updateCommissionRecord,
  loadEarningsSummary,
  loadUsers,
  COMMISSION_STATUSES,
  COMMISSION_STATUS_LABELS,
  COMMISSION_STATUS_BADGE,
  DEFAULT_ROLES,
} from '@/lib/api'
import {
  loadAdvances,
  updateAdvance,
  clawbackAdvance,
  calculateDaysSinceSale,
  isClawbackEligible,
  ADVANCE_STATUSES,
  ADVANCE_STATUS_LABELS,
  ADVANCE_STATUS_BADGE,
  EC_DEFAULTS,
} from '@/lib/api/commission-advanced'
import type { CommissionRate, CommissionRecord, CommissionAdvance, AdvanceStatus, Project } from '@/types/database'
import type { EarningsSummary } from '@/lib/api'

// Build a lookup map from the DEFAULT_ROLES array
const ROLE_LABELS: Record<string, string> = Object.fromEntries(
  DEFAULT_ROLES.map(r => [r.key, r.label])
)

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'calculator' | 'earnings' | 'advances' | 'leaderboard' | 'rates'
type Period = 'month' | 'quarter' | 'year' | 'all'
type LeaderboardMetric = 'commission' | 'deals' | 'kw'
type SortCol = 'project_id' | 'user_name' | 'system_watts' | 'role_key' | 'solar_commission' | 'adder_commission' | 'referral_commission' | 'total_commission' | 'status' | 'created_at' | 'days_since_sale'

const PERIOD_LABELS: Record<Period, string> = {
  month: 'This Month',
  quarter: 'This Quarter',
  year: 'This Year',
  all: 'All Time',
}

function getPeriodStart(period: Period): string | null {
  if (period === 'all') return null
  const now = new Date()
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3) * 3
    return new Date(now.getFullYear(), q, 1).toISOString()
  }
  return new Date(now.getFullYear(), 0, 1).toISOString()
}

// ── Leaderboard entry type ──────────────────────────────────────────────────

interface LeaderboardEntry {
  userId: string | null
  userName: string
  deals: number
  totalKw: number
  totalCommission: number
  avgPerDeal: number
}

// ── Hero Stat Card ──────────────────────────────────────────────────────────

function HeroCard({ label, value, icon, accent, subtitle }: {
  label: string
  value: string
  icon: React.ReactNode
  accent: 'green' | 'blue' | 'amber' | 'emerald'
  subtitle?: string
}) {
  const colors = {
    green: { bg: 'bg-green-900/30', border: 'border-green-700/50', text: 'text-green-400', icon: 'text-green-500' },
    blue: { bg: 'bg-blue-900/30', border: 'border-blue-700/50', text: 'text-blue-400', icon: 'text-blue-500' },
    amber: { bg: 'bg-amber-900/30', border: 'border-amber-700/50', text: 'text-amber-400', icon: 'text-amber-500' },
    emerald: { bg: 'bg-emerald-900/30', border: 'border-emerald-700/50', text: 'text-emerald-400', icon: 'text-emerald-500' },
  }
  const c = colors[accent]

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4 md:p-6`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400 font-medium">{label}</span>
        <span className={c.icon}>{icon}</span>
      </div>
      <p className={`text-2xl md:text-3xl font-bold ${c.text} tracking-tight`}>{value}</p>
      {subtitle && <p className="text-[10px] text-gray-500 mt-1">{subtitle}</p>}
    </div>
  )
}

// ── Calculator Tab ───────────────────────────────────────────────────────────

function CalculatorTab({ rates }: { rates: CommissionRate[] }) {
  const [systemKw, setSystemKw] = useState('')
  const [adderRevenue, setAdderRevenue] = useState('')
  const [referralCount, setReferralCount] = useState('')
  const [selectedRole, setSelectedRole] = useState('')
  const [isEC, setIsEC] = useState(false)
  const [result, setResult] = useState<{
    solar: number; adder: number; referral: number; total: number;
    solarRate: number; adderRate: number; referralRate: number; watts: number;
    grossRate: number; opsDeduction: number; ecBonus: number; effectiveRate: number
  } | null>(null)

  const activeRates = rates.filter(r => r.active)
  const roleKeys = Array.from(new Set(activeRates.map(r => r.role_key)))

  useEffect(() => {
    if (roleKeys.length > 0 && !selectedRole) {
      setSelectedRole(roleKeys[0])
    }
  }, [roleKeys.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const calculate = () => {
    const watts = parseFloat(systemKw || '0') * 1000
    const adders = parseFloat(adderRevenue || '0')
    const referrals = parseInt(referralCount || '0', 10)

    // EC/Non-EC rate breakdown
    const grossRate = 0.50 // base gross rate $/W
    const opsDeduction = 0.10 // ops deduction $/W
    const ecBonus = isEC ? 0.15 : 0 // EC bonus $/W
    const effectiveRate = grossRate - opsDeduction + ecBonus // $0.40 (EC) or $0.25 (non-EC)

    const breakdown = calculateCommission(watts, adders, referrals, selectedRole, rates)

    const roleRate = activeRates.find(r => r.role_key === selectedRole)
    const adderRate = activeRates.find(r => r.role_key === 'adder' && r.active)
    const referralRate = activeRates.find(r => r.role_key === 'referral' && r.active)

    setResult({
      solar: breakdown.solarCommission,
      adder: breakdown.adderCommission,
      referral: breakdown.referralCommission,
      total: breakdown.total,
      solarRate: roleRate?.rate ?? 0,
      adderRate: adderRate?.rate ?? 0,
      referralRate: referralRate?.rate ?? 0,
      watts,
      grossRate,
      opsDeduction,
      ecBonus,
      effectiveRate,
    })
  }

  return (
    <div className="space-y-6">
      {/* Calculator Form */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-green-400" />
          Quick Calculator
        </h3>
        {/* EC Toggle */}
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-700/50">
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              type="button"
              role="switch"
              aria-checked={isEC}
              onClick={() => setIsEC(!isEC)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isEC ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isEC ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
            </button>
            <span className="text-xs text-gray-300 font-medium">Energy Community</span>
          </label>
          {isEC && (
            <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-green-900/40 text-green-400 border border-green-800">
              EC
            </span>
          )}
          <span className="text-[10px] text-gray-500">
            {isEC ? '$0.40/W effective ($0.50 gross - $0.10 ops + $0.15 EC bonus)' : '$0.25/W effective ($0.35 gross - $0.10 ops)'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">System Size (kW)</label>
            <input
              type="number"
              step="0.1"
              value={systemKw}
              onChange={e => setSystemKw(e.target.value)}
              placeholder="e.g. 10.5"
              className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            />
            {systemKw && <p className="text-[10px] text-gray-500 mt-1">{(parseFloat(systemKw || '0') * 1000).toLocaleString()} watts</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">Adder Revenue ($)</label>
            <input
              type="number"
              step="0.01"
              value={adderRevenue}
              onChange={e => setAdderRevenue(e.target.value)}
              placeholder="e.g. 2500"
              className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">Referral Count</label>
            <input
              type="number"
              step="1"
              value={referralCount}
              onChange={e => setReferralCount(e.target.value)}
              placeholder="e.g. 1"
              className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 font-medium mb-1">Role</label>
            <select
              value={selectedRole}
              onChange={e => setSelectedRole(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500"
            >
              {roleKeys.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r] ?? r}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={calculate}
          className="mt-4 px-6 py-2 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-md transition-colors"
        >
          Calculate
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4">Commission Breakdown</h3>
          <div className="space-y-3">
            {/* EC Rate Breakdown */}
            <div className="bg-gray-900 border border-gray-700/50 rounded-lg p-3 mb-2">
              <p className="text-[10px] text-gray-500 font-medium mb-2 uppercase tracking-wider">Rate Breakdown</p>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">${result.grossRate.toFixed(2)} gross</span>
                <span className="text-red-400">- ${result.opsDeduction.toFixed(2)} ops</span>
                {result.ecBonus > 0 && (
                  <span className="text-green-400">+ ${result.ecBonus.toFixed(2)} EC bonus</span>
                )}
                <span className="text-gray-600">=</span>
                <span className="text-white font-medium">${result.effectiveRate.toFixed(2)}/W effective</span>
                {result.ecBonus > 0 && (
                  <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/40 text-green-400 border border-green-800 ml-1">EC</span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-700/50">
              <div>
                <p className="text-sm text-gray-300">Solar Commission</p>
                <p className="text-xs text-gray-500">{result.watts.toLocaleString()} watts x ${result.solarRate}/watt</p>
              </div>
              <p className="text-sm font-medium text-white">{fmt$(result.solar)}</p>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-700/50">
              <div>
                <p className="text-sm text-gray-300">Adder Commission</p>
                <p className="text-xs text-gray-500">{fmt$(parseFloat(adderRevenue || '0'))} x {result.adderRate}%</p>
              </div>
              <p className="text-sm font-medium text-white">{fmt$(result.adder)}</p>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-700/50">
              <div>
                <p className="text-sm text-gray-300">Referral Bonus</p>
                <p className="text-xs text-gray-500">{referralCount || '0'} x {fmt$(result.referralRate)}</p>
              </div>
              <p className="text-sm font-medium text-white">{fmt$(result.referral)}</p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <p className="text-base font-semibold text-white">Total Commission</p>
              <p className="text-xl font-bold text-green-400">{fmt$(result.total)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Rate Card */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-white mb-4">Current Rate Card</h3>
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-xs">
            <thead className="bg-gray-900 border-b border-gray-700">
              <tr>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Role</th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Type</th>
                <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Rate</th>
                <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {activeRates.map(r => (
                <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-700/20">
                  <td className="px-3 py-2 text-white font-medium">{ROLE_LABELS[r.role_key] ?? r.role_key}</td>
                  <td className="px-3 py-2 text-gray-400">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${
                      r.rate_type === 'per_watt' ? 'bg-blue-900/40 text-blue-400 border border-blue-800' :
                      r.rate_type === 'percentage' ? 'bg-amber-900/40 text-amber-400 border border-amber-800' :
                      'bg-green-900/40 text-green-400 border border-green-800'
                    }`}>
                      {r.rate_type === 'per_watt' ? 'Per Watt' : r.rate_type === 'percentage' ? 'Percentage' : 'Flat Fee'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-white font-mono">
                    {r.rate_type === 'per_watt' ? `$${r.rate}/W` :
                     r.rate_type === 'percentage' ? `${r.rate}%` :
                     fmt$(r.rate)}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{r.description || '\u2014'}</td>
                </tr>
              ))}
              {activeRates.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-600 text-sm">No active rates configured</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Earnings Tab ─────────────────────────────────────────────────────────────

function EarningsTab({ orgId, rates: loadedRates }: { orgId: string | null; rates: CommissionRate[] }) {
  const { user: currentUser } = useCurrentUser()
  const isAdmin = currentUser?.isAdmin ?? false

  const [records, setRecords] = useState<CommissionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('month')
  const [userFilter, setUserFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<SortCol>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [projectMap, setProjectMap] = useState<Map<string, { sale_date: string | null; energy_community: boolean }>>(new Map())
  const pageSize = 50

  // Summary (enhanced with all-time + month)
  const [allTimeSummary, setAllTimeSummary] = useState<EarningsSummary | null>(null)
  const [monthSummary, setMonthSummary] = useState<EarningsSummary | null>(null)

  // 6-month trend data
  const [monthlyTrend, setMonthlyTrend] = useState<{ label: string; amount: number }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const periodStart = getPeriodStart(period)
      const userId = !isAdmin ? currentUser?.id : (userFilter !== 'all' ? userFilter : undefined)
      const data = await loadCommissionRecords({
        orgId,
        userId,
        dateFrom: periodStart ?? undefined,
      })
      setRecords(data)

      // Load project sale_date + energy_community for days-since-sale and EC badge
      const projectIds = Array.from(new Set(data.map(r => r.project_id).filter(Boolean)))
      if (projectIds.length > 0) {
        const { db: getDb } = await import('@/lib/db')
        const supabase = getDb()
        const { data: projects } = await supabase
          .from('projects')
          .select('id, sale_date, energy_community')
          .in('id', projectIds.slice(0, 200))
        if (projects) {
          const map = new Map<string, { sale_date: string | null; energy_community: boolean }>()
          for (const p of projects as { id: string; sale_date: string | null; energy_community: boolean }[]) {
            map.set(p.id, { sale_date: p.sale_date, energy_community: p.energy_community ?? false })
          }
          setProjectMap(map)
        }
      }

      // Load all-time summary
      const ats = await loadEarningsSummary(userId, orgId)
      setAllTimeSummary(ats)

      // Load current month summary
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const ms = await loadEarningsSummary(userId, orgId, { from: monthStart })
      setMonthSummary(ms)

      // Build 6-month trend
      const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const trendRecs = await loadCommissionRecords({
        userId,
        orgId,
        dateFrom: trendStart.toISOString(),
      })
      const trend: { label: string; amount: number }[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const label = d.toLocaleDateString('en-US', { month: 'short' })
        const mStart = d.getTime()
        const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime()
        const monthTotal = trendRecs
          .filter(r => {
            if (r.status === 'cancelled') return false
            const t = new Date(r.created_at).getTime()
            return t >= mStart && t <= mEnd
          })
          .reduce((sum, r) => sum + (r.total_commission ?? 0), 0)
        trend.push({ label, amount: Math.round(monthTotal * 100) / 100 })
      }
      setMonthlyTrend(trend)
    } catch (err) {
      console.error('Failed to load commission records:', err)
    }
    setLoading(false)
  }, [orgId, period, userFilter, isAdmin, currentUser?.id])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, sortCol, sortDir, period, userFilter])

  // Realtime refresh
  useRealtimeSubscription('commission_records', {
    event: '*',
    onChange: () => load(),
  })

  // Get unique users for filter
  const uniqueUsers = useMemo(() => {
    const map = new Map<string, string>()
    records.forEach(r => {
      if (r.user_id && r.user_name) map.set(r.user_id, r.user_name)
    })
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [records])

  // Filter + sort
  const filtered = useMemo(() => {
    let list = [...records]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        (r.project_id?.toLowerCase().includes(q)) ||
        (r.user_name?.toLowerCase().includes(q))
      )
    }
    list.sort((a, b) => {
      let av: string | number | null | undefined
      let bv: string | number | null | undefined
      if (sortCol === 'days_since_sale') {
        av = calculateDaysSinceSale(projectMap.get(a.project_id)?.sale_date)
        bv = calculateDaysSinceSale(projectMap.get(b.project_id)?.sale_date)
      } else {
        av = a[sortCol as keyof CommissionRecord] as string | number | null | undefined
        bv = b[sortCol as keyof CommissionRecord] as string | number | null | undefined
      }
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return list
  }, [records, search, sortCol, sortDir])

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return null
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />
  }

  // CSV export
  const exportCSV = () => {
    const headers = ['Project', 'User', 'Role', 'System kW', 'Solar $', 'Adder $', 'Referral $', 'Total', 'Status', 'Days', 'EC', 'Date']
    const rows = filtered.map(r => {
      const proj = projectMap.get(r.project_id)
      return [
        r.project_id,
        r.user_name ?? '',
        ROLE_LABELS[r.role_key] ?? r.role_key,
        r.system_watts ? (r.system_watts / 1000).toFixed(2) : '',
        r.solar_commission.toFixed(2),
        r.adder_commission.toFixed(2),
        r.referral_commission.toFixed(2),
        r.total_commission.toFixed(2),
        r.status,
        proj?.sale_date ? String(calculateDaysSinceSale(proj.sale_date)) : '',
        proj?.energy_community ? 'Yes' : 'No',
        r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
      ]
    })
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `commissions-${period}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const maxTrend = Math.max(...monthlyTrend.map(m => m.amount), 1)

  return (
    <div className="space-y-4">
      {/* Period toggle */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              period === p
                ? 'bg-green-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}

        {isAdmin && (
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="ml-auto bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:outline-none focus:border-green-500"
          >
            <option value="all">All Users</option>
            {uniqueUsers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Hero Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroCard
          label="Total Earned"
          value={fmt$(allTimeSummary?.totalEarned ?? 0)}
          icon={<DollarSign className="w-6 h-6" />}
          accent="green"
          subtitle="All time"
        />
        <HeroCard
          label="This Month"
          value={fmt$(monthSummary?.totalEarned ?? 0)}
          icon={<TrendingUp className="w-6 h-6" />}
          accent="blue"
          subtitle={`${(monthSummary?.byRole ?? []).reduce((s, r) => s + r.count, 0)} deals`}
        />
        <HeroCard
          label="Pending"
          value={fmt$(allTimeSummary?.totalPending ?? 0)}
          icon={<Clock className="w-6 h-6" />}
          accent="amber"
          subtitle="Awaiting approval"
        />
        <HeroCard
          label="Paid"
          value={fmt$(allTimeSummary?.totalPaid ?? 0)}
          icon={<CheckCircle className="w-6 h-6" />}
          accent="emerald"
          subtitle="In your pocket"
        />
      </div>

      {/* Earnings Trend Chart (last 6 months) */}
      {monthlyTrend.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            Earnings Trend (Last 6 Months)
          </h3>
          <div className="flex items-end gap-3 h-40">
            {monthlyTrend.map((m, i) => {
              const pct = maxTrend > 0 ? (m.amount / maxTrend) * 100 : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-green-400 font-medium">
                    {m.amount > 0 ? fmt$(m.amount) : ''}
                  </span>
                  <div className="w-full flex items-end justify-center" style={{ height: '120px' }}>
                    <div
                      className="w-full max-w-[48px] rounded-t-md transition-all duration-500"
                      style={{
                        height: `${Math.max(pct, 2)}%`,
                        background: `linear-gradient(to top, #065f46, #10b981)`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400">{m.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Search + export */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search project or user..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
          />
        </div>
        <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 rounded-md transition-colors">
          <Download className="w-3.5 h-3.5" />
          CSV
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500 text-sm">Loading commissions...</div>
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
              <tr>
                {[
                  { key: 'project_id' as SortCol, label: 'Project' },
                  { key: 'user_name' as SortCol, label: 'User' },
                  { key: 'system_watts' as SortCol, label: 'System kW' },
                  { key: 'role_key' as SortCol, label: 'Role' },
                  { key: 'solar_commission' as SortCol, label: 'Solar $' },
                  { key: 'adder_commission' as SortCol, label: 'Adder $' },
                  { key: 'referral_commission' as SortCol, label: 'Referral $' },
                  { key: 'total_commission' as SortCol, label: 'Total' },
                  { key: 'days_since_sale' as SortCol, label: 'Days' },
                  { key: 'status' as SortCol, label: 'Status' },
                  { key: 'created_at' as SortCol, label: 'Date' },
                ].map(({ key, label }) => (
                  <th key={key} onClick={() => toggleSort(key)} className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white select-none">
                    {label} <SortIcon col={key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => (
                <React.Fragment key={r.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); /* ProjectPanel opened via state below */ }}
                          className="text-blue-400 hover:text-blue-300 font-mono"
                        >
                          {r.project_id}
                        </button>
                        {projectMap.get(r.project_id)?.energy_community && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/40 text-green-400 border border-green-800">EC</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-white">{r.user_name || '\u2014'}</td>
                    <td className="px-3 py-2 text-gray-400">{r.system_watts ? (r.system_watts / 1000).toFixed(2) : '\u2014'}</td>
                    <td className="px-3 py-2 text-gray-400">{ROLE_LABELS[r.role_key] ?? r.role_key}</td>
                    <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(r.solar_commission)}</td>
                    <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(r.adder_commission)}</td>
                    <td className="px-3 py-2 text-gray-300 font-mono">{fmt$(r.referral_commission)}</td>
                    <td className="px-3 py-2 text-white font-medium font-mono">{fmt$(r.total_commission)}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const days = calculateDaysSinceSale(projectMap.get(r.project_id)?.sale_date)
                        if (!days) return <span className="text-gray-600">{'\u2014'}</span>
                        const color = days < 30 ? 'text-green-400' : days < 60 ? 'text-amber-400' : 'text-red-400'
                        return <span className={`font-mono ${color}`}>{days}</span>
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${COMMISSION_STATUS_BADGE[r.status] ?? 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                        {COMMISSION_STATUS_LABELS[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">{fmtDate(r.created_at)}</td>
                  </tr>
                  {expandedId === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={11} className="bg-gray-850 px-6 py-4">
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-2">
                          <p className="text-xs text-gray-400 font-medium mb-2">Commission Detail</p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                            <div>
                              <p className="text-gray-500">Solar</p>
                              <p className="text-white">{r.system_watts?.toLocaleString() ?? 0} W x {(() => {
                                const rateInfo = loadedRates.find(lr => lr.role_key === r.role_key)
                                if (rateInfo?.rate_type === 'percentage') return `${r.rate}%`
                                if (rateInfo?.rate_type === 'flat') return `${fmt$(r.rate)} flat`
                                return `$${r.rate}/W`
                              })()} = {fmt$(r.solar_commission)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Adder</p>
                              <p className="text-white">{fmt$(r.adder_revenue ?? 0)} revenue = {fmt$(r.adder_commission)}</p>
                              {r.adder_commission > 0 && (
                                <p className="text-red-400 text-[10px]">Deduction: {fmt$(r.adder_commission)}</p>
                              )}
                            </div>
                            <div>
                              <p className="text-gray-500">Referral</p>
                              <p className="text-white">{r.referral_count} referral(s) = {fmt$(r.referral_commission)}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Milestone</p>
                              <p className="text-white">{r.milestone || '\u2014'}</p>
                            </div>
                          </div>
                          {r.notes && (
                            <div className="pt-2 border-t border-gray-800">
                              <p className="text-gray-500 text-xs">Notes</p>
                              <p className="text-gray-300 text-xs">{r.notes}</p>
                            </div>
                          )}
                          {/* Admin Notes */}
                          <div className="pt-2 border-t border-gray-800">
                            <p className="text-gray-500 text-xs mb-1">Payroll Admin Notes</p>
                            {isAdmin ? (
                              editingNoteId === r.id ? (
                                <div className="flex gap-2">
                                  <input
                                    value={notesDraft}
                                    onChange={e => setNotesDraft(e.target.value)}
                                    onClick={e => e.stopPropagation()}
                                    placeholder="Add admin note..."
                                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-green-500"
                                  />
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      await updateCommissionRecord(r.id, { notes: notesDraft || null })
                                      setEditingNoteId(null)
                                      load()
                                    }}
                                    className="px-2 py-1 bg-green-700 text-white text-xs rounded hover:bg-green-600"
                                  >Save</button>
                                  <button
                                    onClick={e => { e.stopPropagation(); setEditingNoteId(null) }}
                                    className="px-2 py-1 text-gray-400 text-xs hover:text-white"
                                  >Cancel</button>
                                </div>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); setEditingNoteId(r.id); setNotesDraft(r.notes ?? '') }}
                                  className="text-xs text-gray-400 hover:text-white"
                                >
                                  {r.notes || 'Click to add admin note...'}
                                </button>
                              )
                            ) : (
                              <p className="text-gray-400 text-xs">{r.notes || '\u2014'}</p>
                            )}
                          </div>
                          {r.paid_at && (
                            <p className="text-xs text-gray-500">Paid: {fmtDate(r.paid_at)}</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-gray-600 text-sm">
                    No commission records found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalCount={filtered.length}
          pageSize={pageSize}
          hasMore={page < totalPages}
          onPrevPage={() => setPage(p => Math.max(1, p - 1))}
          onNextPage={() => setPage(p => Math.min(totalPages, p + 1))}
        />
      )}

      {selectedProject && (
        <ProjectPanel project={selectedProject} onClose={() => setSelectedProject(null)} onProjectUpdated={() => {}} />
      )}
    </div>
  )
}

// ── Leaderboard Tab ─────────────────────────────────────────────────────────

function LeaderboardTab({ orgId, currentUserId }: { orgId: string | null; currentUserId: string | null }) {
  const [lbPeriod, setLbPeriod] = useState<Period>('month')
  const [lbMetric, setLbMetric] = useState<LeaderboardMetric>('commission')
  const [allRecords, setAllRecords] = useState<CommissionRecord[]>([])
  const [loading, setLoading] = useState(true)

  // Load all records for leaderboard (no user filter)
  const loadLbData = useCallback(async () => {
    setLoading(true)
    const lbRange = getPeriodStart(lbPeriod)
    const allRecs = await loadCommissionRecords({
      orgId,
      dateFrom: lbRange ?? undefined,
    })
    setAllRecords(allRecs)
    setLoading(false)
  }, [orgId, lbPeriod])

  useEffect(() => { loadLbData() }, [loadLbData])

  // Build leaderboard
  const leaderboard = useMemo((): LeaderboardEntry[] => {
    const map = new Map<string, LeaderboardEntry>()

    for (const r of allRecords) {
      if (r.status === 'cancelled') continue
      const key = r.user_name ?? r.user_id ?? 'Unknown'
      const existing = map.get(key) ?? {
        userId: r.user_id,
        userName: r.user_name ?? 'Unknown',
        deals: 0,
        totalKw: 0,
        totalCommission: 0,
        avgPerDeal: 0,
      }
      existing.deals += 1
      existing.totalKw += (r.system_watts ?? 0) / 1000
      existing.totalCommission += r.total_commission ?? 0
      map.set(key, existing)
    }

    const entries = Array.from(map.values()).map(e => ({
      ...e,
      totalKw: Math.round(e.totalKw * 100) / 100,
      totalCommission: Math.round(e.totalCommission * 100) / 100,
      avgPerDeal: e.deals > 0 ? Math.round((e.totalCommission / e.deals) * 100) / 100 : 0,
    }))

    if (lbMetric === 'commission') entries.sort((a, b) => b.totalCommission - a.totalCommission)
    else if (lbMetric === 'deals') entries.sort((a, b) => b.deals - a.deals)
    else entries.sort((a, b) => b.totalKw - a.totalKw)

    return entries
  }, [allRecords, lbMetric])

  // Summary cards
  const lbSummary = useMemo(() => {
    const topEarner = leaderboard[0]
    const totalEarnings = leaderboard.reduce((s, e) => s + e.totalCommission, 0)
    const totalDeals = leaderboard.reduce((s, e) => s + e.deals, 0)
    const avgCommission = leaderboard.length > 0 ? totalEarnings / leaderboard.length : 0
    return { topEarner, totalEarnings, totalDeals, avgCommission }
  }, [leaderboard])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 text-sm">Loading leaderboard...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Period + Metric selectors */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['month', 'quarter', 'year'] as Period[]).map(p => (
            <button key={p} onClick={() => setLbPeriod(p)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                lbPeriod === p ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white border border-gray-700'
              }`}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-gray-700" />
        <div className="flex gap-1">
          {([['commission', 'Total Commission'], ['deals', 'Deal Count'], ['kw', 'Total kW']] as [LeaderboardMetric, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setLbMetric(m)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                lbMetric === m ? 'bg-blue-700 text-white' : 'text-gray-400 hover:text-white border border-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-800 border border-yellow-700/30 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Top Earner</p>
          <p className="text-sm font-semibold text-yellow-400">{lbSummary.topEarner?.userName ?? '--'}</p>
          <p className="text-xs text-gray-500">{fmt$(lbSummary.topEarner?.totalCommission ?? 0)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Avg Commission</p>
          <p className="text-lg font-bold text-white">{fmt$(lbSummary.avgCommission)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Total Team Earnings</p>
          <p className="text-lg font-bold text-green-400">{fmt$(lbSummary.totalEarnings)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1">Total Deals</p>
          <p className="text-lg font-bold text-white">{lbSummary.totalDeals}</p>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            Rankings
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700/50">
                <th className="px-3 py-2 font-medium w-12">#</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium text-right">Deals</th>
                <th className="px-3 py-2 font-medium text-right">Total kW</th>
                <th className="px-3 py-2 font-medium text-right">Commission</th>
                <th className="px-3 py-2 font-medium text-right">Avg/Deal</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No data for this period.</td></tr>
              )}
              {leaderboard.map((entry, i) => {
                const rank = i + 1
                const isMe = entry.userId === currentUserId
                const rankBg = rank === 1
                  ? 'bg-yellow-900/20'
                  : rank === 2
                    ? 'bg-gray-700/20'
                    : rank === 3
                      ? 'bg-amber-900/20'
                      : ''
                const rankBorder = isMe ? 'border-l-2 border-l-green-400' : ''

                return (
                  <tr key={entry.userName} className={`border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors ${rankBg} ${rankBorder}`}>
                    <td className="px-3 py-2.5">
                      {rank === 1 && <span className="text-yellow-400 font-bold">1</span>}
                      {rank === 2 && <span className="text-gray-400 font-bold">2</span>}
                      {rank === 3 && <span className="text-amber-600 font-bold">3</span>}
                      {rank > 3 && <span className="text-gray-500">{rank}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-medium ${isMe ? 'text-green-400' : 'text-white'}`}>
                        {entry.userName}
                      </span>
                      {isMe && <span className="text-[10px] text-green-500 ml-1.5">(you)</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-300">{entry.deals}</td>
                    <td className="px-3 py-2.5 text-right text-gray-300">{entry.totalKw.toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-green-400">{fmt$(entry.totalCommission)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-400">{fmt$(entry.avgPerDeal)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Rate Card Tab (Admin only) ───────────────────────────────────────────────

function RateCardTab({ rates, onReload, orgId }: { rates: CommissionRate[]; onReload: () => void; orgId: string | null }) {
  const { user: currentUser } = useCurrentUser()
  const isSuperAdmin = currentUser?.isSuperAdmin ?? false

  const [editing, setEditing] = useState<CommissionRate | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState<Partial<CommissionRate>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const openEdit = (r: CommissionRate) => {
    setEditing(r)
    setDraft({ ...r })
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await updateCommissionRate(editing.id, {
        role_key: draft.role_key,
        label: draft.label,
        rate_type: draft.rate_type,
        rate: draft.rate,
        description: draft.description,
        active: draft.active,
        sort_order: draft.sort_order,
      })
      setEditing(null)
      setToast('Rate saved')
      onReload()
    } catch {
      setToast('Save failed')
    }
    setSaving(false)
    setTimeout(() => setToast(''), 2500)
  }

  const createNew = async () => {
    if (!draft.role_key?.trim() || !draft.label?.trim()) return
    setSaving(true)
    try {
      await addCommissionRate({
        role_key: draft.role_key ?? '',
        label: draft.label ?? '',
        rate_type: draft.rate_type ?? 'per_watt',
        rate: draft.rate ?? 0,
        description: draft.description ?? null,
        active: draft.active ?? true,
        sort_order: draft.sort_order ?? 0,
        org_id: orgId,
      })
      setShowNew(false)
      setDraft({})
      setToast('Rate created')
      onReload()
    } catch {
      setToast('Create failed')
    }
    setSaving(false)
    setTimeout(() => setToast(''), 2500)
  }

  const deleteRate = async (r: CommissionRate) => {
    if (!confirm(`Delete rate "${r.label}"?`)) return
    try {
      await deleteCommissionRate(r.id)
      setToast('Rate deleted')
      onReload()
    } catch {
      setToast('Delete failed')
    }
    setTimeout(() => setToast(''), 2500)
  }

  return (
    <div className="space-y-4">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{rates.length} rate records</p>
        <button onClick={() => { setShowNew(true); setDraft({ active: true, rate_type: 'per_watt', sort_order: 0 }) }}
          className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Rate</button>
      </div>

      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
            <tr>
              {['Role', 'Label', 'Type', 'Rate', 'Description', 'Active', 'Order'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-16" />
            </tr>
          </thead>
          <tbody>
            {rates.map((r, i) => (
              <tr key={r.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                <td className="px-3 py-2 text-white font-medium">{ROLE_LABELS[r.role_key] ?? r.role_key}</td>
                <td className="px-3 py-2 text-gray-300">{r.label}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${
                    r.rate_type === 'per_watt' ? 'bg-blue-900/40 text-blue-400 border border-blue-800' :
                    r.rate_type === 'percentage' ? 'bg-amber-900/40 text-amber-400 border border-amber-800' :
                    'bg-green-900/40 text-green-400 border border-green-800'
                  }`}>
                    {r.rate_type === 'per_watt' ? 'Per Watt' : r.rate_type === 'percentage' ? 'Percentage' : 'Flat Fee'}
                  </span>
                </td>
                <td className="px-3 py-2 text-white font-mono">
                  {r.rate_type === 'per_watt' ? `$${r.rate}/W` :
                   r.rate_type === 'percentage' ? `${r.rate}%` :
                   fmt$(r.rate)}
                </td>
                <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{r.description || '\u2014'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${r.active ? 'bg-green-400' : 'bg-gray-600'}`} />
                </td>
                <td className="px-3 py-2 text-gray-500">{r.sort_order}</td>
                <td className="px-3 py-2 flex gap-1">
                  <button onClick={() => openEdit(r)} className="text-gray-500 hover:text-blue-400">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  </button>
                  {isSuperAdmin && (
                    <button onClick={() => deleteRate(r)} className="text-gray-500 hover:text-red-400">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rates.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-600 text-sm">No rates configured</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit / New modal */}
      {(editing || showNew) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setEditing(null); setShowNew(false) }} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">{editing ? `Edit Rate \u2014 ${editing.label}` : 'New Commission Rate'}</h2>
              <button onClick={() => { setEditing(null); setShowNew(false) }} className="text-gray-400 hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Role Key</label>
                  <input value={draft.role_key ?? ''} onChange={e => setDraft(d => ({ ...d, role_key: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Label</label>
                  <input value={draft.label ?? ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Rate Type</label>
                  <select value={draft.rate_type ?? 'per_watt'} onChange={e => setDraft(d => ({ ...d, rate_type: e.target.value as CommissionRate['rate_type'] }))}
                    className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                    <option value="per_watt">Per Watt</option>
                    <option value="percentage">Percentage</option>
                    <option value="flat">Flat Fee</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">
                    Rate {draft.rate_type === 'per_watt' ? '($/W)' : draft.rate_type === 'percentage' ? '(%)' : '($)'}
                  </label>
                  <input type="number" step="0.01" value={draft.rate ?? ''} onChange={e => setDraft(d => ({ ...d, rate: parseFloat(e.target.value) || 0 }))}
                    className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-400 font-medium">Description</label>
                <input value={draft.description ?? ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Sort Order</label>
                  <input type="number" value={draft.sort_order ?? 0} onChange={e => setDraft(d => ({ ...d, sort_order: parseInt(e.target.value) || 0 }))}
                    className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                    <input type="checkbox" checked={draft.active ?? true} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}
                      className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500" />
                    Active
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => { setEditing(null); setShowNew(false) }} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
                <button onClick={editing ? save : createNew} disabled={saving}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Advances Tab (Admin only) ───────────────────────────────────────────────

function AdvancesTab({ orgId }: { orgId: string | null }) {
  const { user: currentUser } = useCurrentUser()
  const isAdmin = currentUser?.isAdmin ?? false

  const [advances, setAdvances] = useState<CommissionAdvance[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [clawbackModal, setClawbackModal] = useState<CommissionAdvance | null>(null)
  const [clawbackReason, setClawbackReason] = useState('')
  const [toast, setToast] = useState('')
  const [projectMap, setProjectMap] = useState<Map<string, { sale_date: string | null }>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await loadAdvances({
        orgId: orgId ?? undefined,
        status: statusFilter !== 'all' ? statusFilter as AdvanceStatus : undefined,
      })
      setAdvances(data)

      // Load project sale dates
      const projectIds = Array.from(new Set(data.map(a => a.project_id).filter(Boolean)))
      if (projectIds.length > 0) {
        const { db: getDb } = await import('@/lib/db')
        const supabase = getDb()
        const { data: projects } = await supabase
          .from('projects')
          .select('id, sale_date')
          .in('id', projectIds.slice(0, 200))
        if (projects) {
          const map = new Map<string, { sale_date: string | null }>()
          for (const p of projects as { id: string; sale_date: string | null }[]) map.set(p.id, { sale_date: p.sale_date })
          setProjectMap(map)
        }
      }
    } catch (err) {
      console.error('Failed to load advances:', err)
    }
    setLoading(false)
  }, [orgId, statusFilter])

  useEffect(() => { load() }, [load])

  useRealtimeSubscription('commission_advances', {
    event: '*',
    onChange: () => load(),
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return advances
    const q = search.toLowerCase()
    return advances.filter(a =>
      a.project_id?.toLowerCase().includes(q) ||
      a.rep_name?.toLowerCase().includes(q)
    )
  }, [advances, search])

  // Summary
  const summary = useMemo(() => {
    const pending = advances.filter(a => a.status === 'pending')
    const approved = advances.filter(a => a.status === 'approved')
    const paid = advances.filter(a => a.status === 'paid')
    const clawedBack = advances.filter(a => a.status === 'clawed_back')
    return {
      pendingCount: pending.length,
      pendingAmount: pending.reduce((s, a) => s + a.amount, 0),
      approvedCount: approved.length,
      approvedAmount: approved.reduce((s, a) => s + a.amount, 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((s, a) => s + a.amount, 0),
      clawedBackCount: clawedBack.length,
      clawedBackAmount: clawedBack.reduce((s, a) => s + a.amount, 0),
    }
  }, [advances])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  const handleApprove = async (advance: CommissionAdvance) => {
    if (!confirm(`Approve advance of ${fmt$(advance.amount)} for ${advance.rep_name ?? advance.project_id}?`)) return
    await updateAdvance(advance.id, { status: 'approved' })
    showToast('Advance approved')
    load()
  }

  const handlePay = async (advance: CommissionAdvance) => {
    if (!confirm(`Mark advance of ${fmt$(advance.amount)} as paid for ${advance.rep_name ?? advance.project_id}?`)) return
    await updateAdvance(advance.id, { status: 'paid', paid_at: new Date().toISOString() })
    showToast('Advance marked as paid')
    load()
  }

  const handleClawback = async () => {
    if (!clawbackModal || !clawbackReason.trim()) return
    await clawbackAdvance(clawbackModal.id, clawbackReason.trim())
    setClawbackModal(null)
    setClawbackReason('')
    showToast('Advance clawed back')
    load()
  }

  const getDeadlineStyle = (clawbackDate: string | null): string => {
    if (!clawbackDate) return ''
    const deadlineDate = new Date(clawbackDate)
    if (isNaN(deadlineDate.getTime())) return ''
    const now = new Date()
    const daysUntil = Math.floor((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (daysUntil < 0) return 'bg-red-900/20 border-red-800/50'
    if (daysUntil <= 7) return 'bg-amber-900/20 border-amber-800/50'
    return ''
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 text-sm">Loading advances...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <HeroCard
          label="Pending"
          value={fmt$(summary.pendingAmount)}
          icon={<Clock className="w-6 h-6" />}
          accent="amber"
          subtitle={`${summary.pendingCount} advances`}
        />
        <HeroCard
          label="Approved"
          value={fmt$(summary.approvedAmount)}
          icon={<CheckCircle className="w-6 h-6" />}
          accent="blue"
          subtitle={`${summary.approvedCount} advances`}
        />
        <HeroCard
          label="Paid"
          value={fmt$(summary.paidAmount)}
          icon={<Banknote className="w-6 h-6" />}
          accent="green"
          subtitle={`${summary.paidCount} advances`}
        />
        <HeroCard
          label="Clawed Back"
          value={fmt$(summary.clawedBackAmount)}
          icon={<AlertTriangle className="w-6 h-6" />}
          accent="amber"
          subtitle={`${summary.clawedBackCount} advances`}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:outline-none focus:border-green-500"
        >
          <option value="all">All Statuses</option>
          {ADVANCE_STATUSES.map(s => (
            <option key={s} value={s}>{ADVANCE_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <div className="relative flex-1 max-w-sm">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search project or rep..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-700">
            <tr>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Project</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Rep</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Role</th>
              <th className="text-right px-3 py-2.5 text-gray-400 font-medium">Amount</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Status</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Self-Gen</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Days</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Clawback Deadline</th>
              <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a, i) => {
              const deadlineStyle = getDeadlineStyle(a.clawback_date)
              const daysSince = calculateDaysSinceSale(projectMap.get(a.project_id)?.sale_date)
              const daysColor = daysSince < 30 ? 'text-green-400' : daysSince < 60 ? 'text-amber-400' : 'text-red-400'

              return (
                <React.Fragment key={a.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer transition-colors ${deadlineStyle} ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                  >
                    <td className="px-3 py-2 text-blue-400 font-mono">{a.project_id}</td>
                    <td className="px-3 py-2 text-white">{a.rep_name || '\u2014'}</td>
                    <td className="px-3 py-2 text-gray-400">{ROLE_LABELS[a.role_key] ?? a.role_key}</td>
                    <td className="px-3 py-2 text-right text-white font-medium font-mono">{fmt$(a.amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${ADVANCE_STATUS_BADGE[a.status]}`}>
                        {ADVANCE_STATUS_LABELS[a.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {a.self_generated ? (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/40 text-blue-400 border border-blue-800">Self</span>
                      ) : (
                        <span className="text-gray-600">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {daysSince > 0 ? (
                        <span className={`font-mono ${daysColor}`}>{daysSince}</span>
                      ) : (
                        <span className="text-gray-600">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-400">
                      {a.clawback_date ? (
                        (() => {
                          const deadlineDate = new Date(a.clawback_date)
                          const now = new Date()
                          const daysUntil = Math.floor((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                          const color = daysUntil < 0 ? 'text-red-400' : daysUntil <= 7 ? 'text-amber-400' : 'text-gray-400'
                          return (
                            <span className={color}>
                              {fmtDate(a.clawback_date)}
                              {daysUntil < 0 && <span className="text-[10px] ml-1">(overdue)</span>}
                              {daysUntil >= 0 && daysUntil <= 7 && <span className="text-[10px] ml-1">({daysUntil}d)</span>}
                            </span>
                          )
                        })()
                      ) : (
                        <span className="text-gray-600">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {a.status === 'pending' && (
                          <button onClick={() => handleApprove(a)} className="px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white text-[10px] rounded transition-colors">
                            Approve
                          </button>
                        )}
                        {a.status === 'approved' && (
                          <button onClick={() => handlePay(a)} className="px-2 py-0.5 bg-green-700 hover:bg-green-600 text-white text-[10px] rounded transition-colors">
                            Pay
                          </button>
                        )}
                        {isClawbackEligible(a) && (
                          <button onClick={() => setClawbackModal(a)} className="px-2 py-0.5 bg-red-700 hover:bg-red-600 text-white text-[10px] rounded transition-colors">
                            Clawback
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === a.id && (
                    <tr key={`${a.id}-detail`}>
                      <td colSpan={9} className="bg-gray-850 px-6 py-4">
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-2">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                            <div>
                              <p className="text-gray-500">Created</p>
                              <p className="text-white">{fmtDate(a.created_at)}</p>
                            </div>
                            {a.status === 'approved' && (
                              <div>
                                <p className="text-gray-500">Status</p>
                                <p className="text-white">Approved</p>
                              </div>
                            )}
                            {a.paid_at && (
                              <div>
                                <p className="text-gray-500">Paid</p>
                                <p className="text-white">{fmtDate(a.paid_at)}</p>
                              </div>
                            )}
                            {a.clawed_back_at && (
                              <div>
                                <p className="text-gray-500">Clawed Back</p>
                                <p className="text-red-400">{fmtDate(a.clawed_back_at)}</p>
                              </div>
                            )}
                          </div>
                          {a.clawback_reason && (
                            <div className="pt-2 border-t border-gray-800">
                              <p className="text-gray-500 text-xs">Clawback Reason</p>
                              <p className="text-red-400 text-xs">{a.clawback_reason}</p>
                            </div>
                          )}
                          {a.admin_notes && (
                            <div className="pt-2 border-t border-gray-800">
                              <p className="text-gray-500 text-xs">Admin Notes</p>
                              <p className="text-gray-300 text-xs">{a.admin_notes}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-gray-600 text-sm">
                  No advances found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Clawback Modal */}
      {clawbackModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setClawbackModal(null)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Clawback Advance</h2>
              <p className="text-xs text-gray-500 mt-1">
                {clawbackModal.project_id} - {clawbackModal.rep_name} - {fmt$(clawbackModal.amount)}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1">Reason for clawback</label>
                <textarea
                  value={clawbackReason}
                  onChange={e => setClawbackReason(e.target.value)}
                  placeholder="Enter clawback reason..."
                  rows={3}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setClawbackModal(null)} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">
                  Cancel
                </button>
                <button
                  onClick={handleClawback}
                  disabled={!clawbackReason.trim()}
                  className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors"
                >
                  Confirm Clawback
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function CommissionsPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const { orgId } = useOrg()
  const isAdmin = currentUser?.isAdmin ?? false
  const isSales = currentUser?.isSales ?? false

  const [tab, setTab] = useState<Tab>('calculator')
  const [rates, setRates] = useState<CommissionRate[]>([])
  const [ratesLoading, setRatesLoading] = useState(true)

  const loadRates = useCallback(async () => {
    setRatesLoading(true)
    try {
      const data = await loadCommissionRates(orgId)
      setRates(data)
    } catch (err) {
      console.error('Failed to load rates:', err)
    }
    setRatesLoading(false)
  }, [orgId])

  useEffect(() => { loadRates() }, [loadRates])

  // Loading state
  if (userLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Checking permissions...</div>
      </div>
    )
  }

  // Auth gate: Admin sees everything. Sales sees only their own data. Others blocked.
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Please sign in to view commissions.</div>
      </div>
    )
  }

  if (!isAdmin && !isSales) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">You don&apos;t have permission to view this page.</div>
      </div>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'calculator', label: 'Calculator', icon: <Calculator className="w-3.5 h-3.5" /> },
    { key: 'earnings', label: 'My Earnings', icon: <DollarSign className="w-3.5 h-3.5" /> },
    ...(isAdmin ? [{ key: 'advances' as Tab, label: 'Advances', icon: <Banknote className="w-3.5 h-3.5" /> }] : []),
    ...(isAdmin ? [{ key: 'leaderboard' as Tab, label: 'Leaderboard', icon: <Trophy className="w-3.5 h-3.5" /> }] : []),
    ...(isAdmin ? [{ key: 'rates' as Tab, label: 'Rate Card', icon: <TrendingUp className="w-3.5 h-3.5" /> }] : []),
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Nav active="Commissions" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-white">Commissions</h1>
            <p className="text-xs text-gray-500 mt-0.5">Calculate, track, and manage commission earnings</p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-6 border-b border-gray-800 pb-px">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
                tab === t.key
                  ? 'border-green-500 text-white bg-gray-900'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-gray-900/50'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'calculator' && <CalculatorTab rates={rates} />}
        {tab === 'earnings' && <EarningsTab orgId={orgId} rates={rates} />}
        {tab === 'advances' && isAdmin && <AdvancesTab orgId={orgId} />}
        {tab === 'leaderboard' && <LeaderboardTab orgId={orgId} currentUserId={currentUser.id} />}
        {tab === 'rates' && isAdmin && <RateCardTab rates={rates} onReload={loadRates} orgId={orgId} />}
      </div>
    </div>
  )
}
