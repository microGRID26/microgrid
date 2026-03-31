'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useSupabaseQuery } from '@/lib/hooks'
import { fmt$, daysAgo, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import { db } from '@/lib/db'
import type { ProjectFunding } from '@/types/database'
import {
  ArrowLeft,
  RefreshCw,
  Activity,
  DollarSign,
  Wrench,
  AlertTriangle,
  TrendingUp,
  Clock,
  Users,
  BarChart3,
  Timer,
} from 'lucide-react'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return fmt$(n)
}

function isThisMonth(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

// ── Stage colors ─────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  evaluation: 'bg-blue-500',
  survey: 'bg-cyan-500',
  design: 'bg-violet-500',
  permit: 'bg-amber-500',
  install: 'bg-orange-500',
  inspection: 'bg-pink-500',
  complete: 'bg-green-500',
}

const STAGE_TEXT_COLORS: Record<string, string> = {
  evaluation: 'text-blue-400',
  survey: 'text-cyan-400',
  design: 'text-violet-400',
  permit: 'text-amber-400',
  install: 'text-orange-400',
  inspection: 'text-pink-400',
  complete: 'text-green-400',
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function MobileLeadershipPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [refreshing, setRefreshing] = useState(false)

  // Projects — exclude Cancelled/In Service/Loyalty (same as Analytics)
  const { data: projects, loading: projLoading, refresh: refreshProjects } = useSupabaseQuery('projects', {
    select: 'id, name, stage, contract, install_complete_date, stage_date, sale_date, pm, pm_id, blocker, financier, disposition, pto_date',
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled'] } },
  })

  // Funding data
  const { data: fundingRows, loading: fundLoading, refresh: refreshFunding } = useSupabaseQuery('project_funding', {
    select: 'project_id, m2_funded_date, m3_funded_date, m2_amount, m3_amount, m2_status, m3_status',
  })

  const handleRefresh = useCallback(() => {
    if (!navigator.onLine) return
    setRefreshing(true)
    refreshProjects()
    refreshFunding()
    // refresh() is sync (triggers async fetch); show spinner briefly
    setTimeout(() => {
      setLastRefresh(new Date())
      setRefreshing(false)
    }, 1000)
  }, [refreshProjects, refreshFunding])

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      handleRefresh()
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [handleRefresh])

  // Build funding map
  const funding = useMemo(() => {
    const map: Record<string, ProjectFunding> = {}
    fundingRows.forEach((f) => { map[f.project_id] = f })
    return map
  }, [fundingRows])

  // Crew hours data
  const [crewHours, setCrewHours] = useState<{ name: string; todayMins: number; weekMins: number; activeNow: boolean }[]>([])
  const [hoursLoading, setHoursLoading] = useState(true)

  useEffect(() => {
    async function loadCrewHours() {
      setHoursLoading(true)
      const supabase = db()
      const now = new Date()
      const todayStart = now.toISOString().split('T')[0] + 'T00:00:00'
      const weekStart = new Date(now)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Sunday
      const weekStartStr = weekStart.toISOString().split('T')[0] + 'T00:00:00'

      const { data: entries } = await supabase
        .from('time_entries')
        .select('user_id, user_name, clock_in, clock_out, duration_minutes')
        .gte('clock_in', weekStartStr)
        .order('clock_in', { ascending: false })
        .limit(2000)

      if (!entries) { setHoursLoading(false); return }

      const byUser = new Map<string, { name: string; todayMins: number; weekMins: number; activeNow: boolean }>()

      for (const e of entries as { user_id: string; user_name: string | null; clock_in: string; clock_out: string | null; duration_minutes: number | null }[]) {
        const key = e.user_id
        const existing = byUser.get(key) ?? { name: e.user_name ?? 'Unknown', todayMins: 0, weekMins: 0, activeNow: false }

        // Use stored duration for completed entries, calculate elapsed for active entries
        const mins = e.clock_out
          ? (e.duration_minutes ?? 0)
          : Math.floor((Date.now() - new Date(e.clock_in).getTime()) / 60000)
        existing.weekMins += mins

        if (e.clock_in >= todayStart) {
          existing.todayMins += mins
        }

        if (!e.clock_out) {
          existing.activeNow = true
        }

        byUser.set(key, existing)
      }

      setCrewHours(Array.from(byUser.values()).sort((a, b) => b.todayMins - a.todayMins))
      setHoursLoading(false)
    }
    loadCrewHours()
  }, [lastRefresh])

  const loading = projLoading || fundLoading

  // ── Computed Metrics ───────────────────────────────────────────────────────

  const metrics = useMemo(() => {
    const active = projects.filter(p => p.stage !== 'complete')
    const portfolioValue = active.reduce((s, p) => s + (Number(p.contract) || 0), 0)
    const blocked = active.filter(p => p.blocker)

    // Installs this month
    const installsThisMonth = projects.filter(p =>
      isThisMonth(p.install_complete_date ?? (p.stage === 'complete' ? p.stage_date : null))
    )

    // M2 funded this month
    const m2ThisMonth = projects.filter(p => {
      const f = funding[p.id]
      return f && isThisMonth(f.m2_funded_date)
    })
    const m2Amount = m2ThisMonth.reduce((s, p) => {
      const f = funding[p.id]
      return s + (Number(f?.m2_amount) || 0)
    }, 0)

    // M3 funded this month
    const m3ThisMonth = projects.filter(p => {
      const f = funding[p.id]
      return f && isThisMonth(f.m3_funded_date)
    })
    const m3Amount = m3ThisMonth.reduce((s, p) => {
      const f = funding[p.id]
      return s + (Number(f?.m3_amount) || 0)
    }, 0)

    // Cancelled this month (need separate query — approximate from excluded)
    // We can't see cancelled from this query; show what we can

    // Avg sale-to-install (completed installs with both dates)
    const saleToInstall: number[] = []
    projects.forEach(p => {
      if (!p.sale_date || !p.install_complete_date) return
      const d1 = new Date(p.sale_date + 'T00:00:00')
      const d2 = new Date(p.install_complete_date + 'T00:00:00')
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        const diff = Math.round((d2.getTime() - d1.getTime()) / 86400000)
        if (diff >= 0) saleToInstall.push(diff)
      }
    })
    const avgSaleToInstall = saleToInstall.length > 0
      ? Math.round(saleToInstall.reduce((a, b) => a + b, 0) / saleToInstall.length)
      : null

    // Projects > 90 cycle days
    const aging = active.filter(p => {
      const cd = daysAgo(p.sale_date) || daysAgo(p.stage_date)
      return cd > 90
    })

    // Stage distribution
    const stageCounts = STAGE_ORDER.map(s => ({
      stage: s,
      label: STAGE_LABELS[s],
      count: projects.filter(p => p.stage === s).length,
    }))
    const stageCountValues = stageCounts.map(s => s.count)
    const maxStageCount = stageCountValues.length > 0 ? Math.max(...stageCountValues, 1) : 1

    // PM performance
    const pmMap = new Map<string, string>()
    projects.forEach(p => { if (p.pm_id && p.pm) pmMap.set(p.pm_id, p.pm) })
    const pmStats = [...pmMap.entries()]
      .map(([pmId, pmName]) => {
        const ps = projects.filter(p => p.pm_id === pmId)
        const activePs = ps.filter(p => p.stage !== 'complete')
        return {
          name: pmName,
          active: activePs.length,
          blocked: activePs.filter(p => p.blocker).length,
        }
      })
      .sort((a, b) => b.active - a.active)

    return {
      activeCount: active.length,
      portfolioValue,
      installsThisMonth: installsThisMonth.length,
      m2Count: m2ThisMonth.length,
      m2Amount,
      m3Count: m3ThisMonth.length,
      m3Amount,
      blockedCount: blocked.length,
      avgSaleToInstall,
      agingCount: aging.length,
      stageCounts,
      maxStageCount,
      pmStats,
    }
  }, [projects, funding])

  // ── Role gate ──────────────────────────────────────────────────────────────

  if (userLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  if (!user || !user.isManager) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-lg text-gray-400">Access Restricted</p>
          <p className="text-sm text-gray-500 mt-2">This dashboard is available to Managers and above.</p>
          <a href="/command" className="inline-block mt-4 text-sm text-green-400 hover:text-green-300">
            Go to Command Center
          </a>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-[max(2rem,env(safe-area-inset-bottom))]">
      {/* Top bar */}
      <header className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/command" className="p-2 -ml-2 rounded-lg active:bg-gray-800 transition-colors" aria-label="Back">
            <ArrowLeft className="w-5 h-5 text-gray-400" />
          </a>
          <div>
            <div className="text-xs text-green-400 font-medium tracking-wider uppercase">MicroGRID</div>
            <div className="text-sm font-semibold text-white -mt-0.5">Leadership Dashboard</div>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="p-2 rounded-lg active:bg-gray-800 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-5 h-5 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Last updated */}
      <div className="px-4 pt-2 pb-1">
        <p className="text-[11px] text-gray-600">
          Updated {lastRefresh.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>

      {loading ? (
        <div className="px-4 space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-4 animate-pulse">
                <div className="h-4 w-4 bg-gray-800 rounded mb-2" />
                <div className="h-8 w-16 bg-gray-800 rounded mb-1" />
                <div className="h-3 w-24 bg-gray-800 rounded" />
              </div>
            ))}
          </div>
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 animate-pulse space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 w-20 bg-gray-800 rounded" />
                <div className="flex-1 h-3 bg-gray-800 rounded-full" />
                <div className="h-3 w-8 bg-gray-800 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-4 space-y-6">
          {/* ── Key Metrics Cards ─────────────────────────────── */}
          <section>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={<Activity className="w-4 h-4" />}
                label="Active Projects"
                value={String(metrics.activeCount)}
                color="text-white"
                iconColor="text-green-400"
              />
              <MetricCard
                icon={<DollarSign className="w-4 h-4" />}
                label="Portfolio Value"
                value={fmtCompact(metrics.portfolioValue)}
                color="text-green-400"
                iconColor="text-green-400"
              />
              <MetricCard
                icon={<Wrench className="w-4 h-4" />}
                label="Installs This Month"
                value={String(metrics.installsThisMonth)}
                color="text-white"
                iconColor="text-cyan-400"
              />
              <MetricCard
                icon={<AlertTriangle className="w-4 h-4" />}
                label="Blocked"
                value={String(metrics.blockedCount)}
                color={metrics.blockedCount > 0 ? 'text-red-400' : 'text-white'}
                iconColor={metrics.blockedCount > 0 ? 'text-red-400' : 'text-gray-500'}
              />
            </div>

            {/* Full-width funding cards */}
            <div className="mt-3 space-y-3">
              <FundingCard
                label="M2 Funded This Month"
                count={metrics.m2Count}
                amount={metrics.m2Amount}
              />
              <FundingCard
                label="M3 Funded This Month"
                count={metrics.m3Count}
                amount={metrics.m3Amount}
              />
            </div>
          </section>

          {/* ── Pipeline Snapshot ─────────────────────────────── */}
          <section>
            <SectionHeader icon={<BarChart3 className="w-4 h-4 text-green-400" />} title="Pipeline Snapshot" />
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
              {metrics.stageCounts.map(({ stage, label, count }) => {
                const pct = metrics.maxStageCount > 0 ? Math.round((count / metrics.maxStageCount) * 100) : 0
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <div className="w-20 text-xs text-gray-400 flex-shrink-0 truncate">{label}</div>
                    <div className="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden">
                      <div
                        className={`${STAGE_COLORS[stage]} h-3 rounded-full transition-all duration-500`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <div className={`w-8 text-right text-sm font-mono font-semibold ${STAGE_TEXT_COLORS[stage]}`}>
                      {count}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── PM Performance ────────────────────────────────── */}
          <section>
            <SectionHeader icon={<Users className="w-4 h-4 text-green-400" />} title="PM Performance" />
            <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
              {metrics.pmStats.map((pm, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{pm.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {pm.active} active
                      {pm.blocked > 0 && (
                        <span className="text-red-400 ml-2">{pm.blocked} blocked</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Mini bar showing active count relative to max */}
                    <div className="w-16 bg-gray-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-green-500 h-2 rounded-full"
                        style={{
                          width: `${Math.max(
                            Math.round((pm.active / Math.max(...metrics.pmStats.map(p => p.active), 1)) * 100),
                            4,
                          )}%`,
                        }}
                      />
                    </div>
                    <div className="text-lg font-mono font-bold text-white w-8 text-right">{pm.active}</div>
                  </div>
                </div>
              ))}
              {metrics.pmStats.length === 0 && (
                <div className="px-4 py-6 text-center text-gray-500 text-sm">No PM data</div>
              )}
            </div>
          </section>

          {/* ── Quick Stats ───────────────────────────────────── */}
          <section>
            <SectionHeader icon={<TrendingUp className="w-4 h-4 text-green-400" />} title="Quick Stats" />
            <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
              <QuickStatRow
                icon={<Clock className="w-4 h-4 text-gray-500" />}
                label="Avg Sale-to-Install"
                value={metrics.avgSaleToInstall !== null ? `${metrics.avgSaleToInstall} days` : '--'}
              />
              <QuickStatRow
                icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
                label="Projects > 90 Cycle Days"
                value={String(metrics.agingCount)}
                valueColor={metrics.agingCount > 0 ? 'text-amber-400' : undefined}
              />
            </div>
          </section>

          {/* ── Crew Hours ─────────────────────────────────────── */}
          <section>
            <SectionHeader icon={<Timer className="w-4 h-4 text-green-400" />} title="Crew Hours" />
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              {hoursLoading ? (
                <div className="px-4 py-6 text-center text-gray-500 text-sm">Loading hours...</div>
              ) : crewHours.length === 0 ? (
                <div className="px-4 py-6 text-center text-gray-500 text-sm">No time entries this week</div>
              ) : (
                <>
                  {/* Summary row */}
                  <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                    <div className="text-xs text-gray-400">
                      {crewHours.filter(c => c.activeNow).length} active now
                    </div>
                    <div className="text-xs text-gray-400">
                      Week total: <span className="text-white font-mono font-medium">
                        {Math.floor(crewHours.reduce((s, c) => s + c.weekMins, 0) / 60)}h {crewHours.reduce((s, c) => s + c.weekMins, 0) % 60}m
                      </span>
                    </div>
                  </div>
                  {/* Crew rows */}
                  {crewHours.map((crew, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/50 last:border-0">
                      <div className="flex items-center gap-2">
                        {crew.activeNow && <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
                        <span className="text-sm text-white">{crew.name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <div>
                          <div className="text-xs text-gray-500">Today</div>
                          <div className="text-sm font-mono text-white">
                            {crew.todayMins > 0 ? `${Math.floor(crew.todayMins / 60)}h ${crew.todayMins % 60}m` : '--'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Week</div>
                          <div className="text-sm font-mono text-gray-300">
                            {Math.floor(crew.weekMins / 60)}h {crew.weekMins % 60}m
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>

          {/* Footer link */}
          <div className="text-center pt-2 pb-4">
            <a href="/analytics" className="text-xs text-gray-500 hover:text-gray-400 transition-colors">
              View full Analytics dashboard
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, color, iconColor }: {
  icon: React.ReactNode
  label: string
  value: string
  color?: string
  iconColor?: string
}) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 active:bg-gray-800/50 transition-colors">
      <div className={`mb-2 ${iconColor ?? 'text-gray-500'}`}>{icon}</div>
      <div className={`text-3xl font-bold font-mono leading-none ${color ?? 'text-white'}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1.5">{label}</div>
    </div>
  )
}

function FundingCard({ label, count, amount }: { label: string; count: number; amount: number }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center justify-between">
      <div>
        <div className="text-xs text-gray-400">{label}</div>
        <div className="text-2xl font-bold font-mono text-green-400 mt-0.5">{count}</div>
      </div>
      <div className="text-right">
        <div className="text-xs text-gray-500">Amount</div>
        <div className="text-lg font-mono font-semibold text-white mt-0.5">{fmtCompact(amount)}</div>
      </div>
    </div>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">{title}</h2>
    </div>
  )
}

function QuickStatRow({ icon, label, value, valueColor }: {
  icon: React.ReactNode
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm text-gray-300">{label}</span>
      </div>
      <span className={`text-lg font-mono font-bold ${valueColor ?? 'text-white'}`}>{value}</span>
    </div>
  )
}
