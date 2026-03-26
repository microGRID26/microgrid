'use client'

import { useState, useMemo, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { useSupabaseQuery, clearQueryCache } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { RefreshCw } from 'lucide-react'
import { Leadership, PipelineHealth, ByPM, FundingTab, CycleTimes, Dealers, PERIOD_LABELS } from '@/components/analytics'
import type { Period, AnalyticsData } from '@/components/analytics'
import type { ProjectFunding } from '@/types/database'

type Tab = 'leadership' | 'pipeline' | 'pm' | 'funding_analytics' | 'cycle' | 'dealers'

const TAB_LABELS: Record<Tab, string> = {
  leadership: 'Leadership', pipeline: 'Pipeline Health', pm: 'By PM',
  funding_analytics: 'Funding', cycle: 'Cycle Times', dealers: 'Dealers',
}

export default function AnalyticsPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [period, setPeriod] = useState<Period>('mtd')
  const [tab, setTab] = useState<Tab>('leadership')
  const [refreshing, setRefreshing] = useState(false)

  // Role gate: Manager+ only
  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <>
        <Nav active="Analytics" />
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">Analytics is available to Managers and above.</p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              ← Back to Command Center
            </a>
          </div>
        </div>
      </>
    )
  }

  const { data: projects, loading: projLoading, refresh: refreshProjects } = useSupabaseQuery('projects', {
    select: 'id, name, stage, contract, install_complete_date, stage_date, sale_date, pm, pm_id, blocker, financier, disposition, pto_date, dealer, consultant, advisor, systemkw',
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled'] } },
  })

  const { data: fundingRows, loading: fundLoading, refresh: refreshFunding } = useSupabaseQuery('project_funding', {
    select: 'project_id, m2_funded_date, m3_funded_date, m2_amount, m3_amount, m2_status, m3_status, m1_amount, m1_status, nonfunded_code_1, nonfunded_code_2, nonfunded_code_3',
  })

  const funding = useMemo(() => {
    const map: Record<string, ProjectFunding> = {}
    fundingRows.forEach((f) => { map[f.project_id] = f })
    return map
  }, [fundingRows])

  const loading = projLoading || fundLoading

  const active = useMemo(() => projects.filter(p => p.stage !== 'complete'), [projects])
  const complete = useMemo(() => projects.filter(p => p.stage === 'complete'), [projects])

  const analyticsData: AnalyticsData = useMemo(() => ({
    projects, active, complete, funding, period,
  }), [projects, active, complete, funding, period])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    clearQueryCache()
    refreshProjects()
    refreshFunding()
    // refresh is synchronous cache-clear + refetch trigger; brief visual feedback
    setTimeout(() => setRefreshing(false), 600)
  }, [refreshProjects, refreshFunding])

  if (loading) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-green-400 text-sm animate-pulse">Loading analytics...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Analytics" right={
        <div className="flex items-center gap-2">
          <button onClick={handleRefresh} disabled={refreshing}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md px-2 py-1.5 transition-colors disabled:opacity-50 flex items-center gap-1"
            title="Refresh data">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <select value={period} onChange={e => setPeriod(e.target.value as Period)}
            className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5">
            {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      } />

      {/* Sub-tabs — wraps on mobile */}
      <div className="bg-gray-950 border-b border-gray-800 flex flex-wrap px-4 flex-shrink-0">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs px-4 py-3 font-medium transition-colors border-b-2 whitespace-nowrap ${tab === t ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'leadership' && <Leadership data={analyticsData} />}
        {tab === 'pipeline' && <PipelineHealth data={analyticsData} />}
        {tab === 'pm' && <ByPM data={analyticsData} />}
        {tab === 'funding_analytics' && <FundingTab data={analyticsData} />}
        {tab === 'cycle' && <CycleTimes data={analyticsData} />}
        {tab === 'dealers' && <Dealers data={analyticsData} />}
      </div>
    </div>
  )
}
