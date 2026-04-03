'use client'

import { useState, useMemo, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { useSupabaseQuery, clearQueryCache } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { RefreshCw } from 'lucide-react'
import { Executive, CashFlow, InstallVelocity, Leadership, PipelineHealth, ByPM, FundingTab, CycleTimes, Dealers, PERIOD_LABELS, setCustomRange } from '@/components/analytics'
import type { Period, AnalyticsData } from '@/components/analytics'
import type { ProjectFunding } from '@/types/database'

import { OpsTabContent } from '@/app/ops/page'

type Tab = 'executive' | 'cash_flow' | 'velocity' | 'pipeline' | 'pm' | 'sales' | 'ops'

const TAB_LABELS: Record<Tab, string> = {
  executive: 'Executive', cash_flow: 'Cash Flow', velocity: 'Install Velocity',
  pipeline: 'Pipeline', pm: 'By PM', sales: 'Sales', ops: 'Operations',
}

export default function AnalyticsPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [period, setPeriod] = useState<Period>('mtd')
  const [tab, setTab] = useState<Tab>('executive')
  const [refreshing, setRefreshing] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const handlePeriodChange = (p: Period) => {
    setPeriod(p)
    if (p === 'custom') {
      setCustomRange(customFrom || null, customTo || null)
    }
  }
  const handleCustomDateChange = (from: string, to: string) => {
    setCustomFrom(from)
    setCustomTo(to)
    setCustomRange(from || null, to || null)
    setPeriod('custom')
  }

  const { data: projects, loading: projLoading, refresh: refreshProjects } = useSupabaseQuery('projects', {
    select: 'id, name, stage, contract, install_complete_date, stage_date, sale_date, pm, pm_id, blocker, financier, disposition, pto_date, dealer, consultant, advisor, systemkw',
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled'] } },
  })

  const { data: fundingRows, loading: fundLoading, refresh: refreshFunding } = useSupabaseQuery('project_funding', {
    select: 'project_id, m2_funded_date, m3_funded_date, m2_amount, m3_amount, m2_status, m3_status, m1_amount, m1_status, nonfunded_code_1, nonfunded_code_2, nonfunded_code_3',
  })

  const { data: taskStateRows, loading: taskLoading, refresh: refreshTasks } = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, status',
    limit: 50000,
  })

  const funding = useMemo(() => {
    const map: Record<string, ProjectFunding> = {}
    fundingRows.forEach((f) => { map[f.project_id] = f })
    return map
  }, [fundingRows])

  const taskMap = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    taskStateRows.forEach((t: any) => {
      if (!map[t.project_id]) map[t.project_id] = {}
      map[t.project_id][t.task_id] = t.status
    })
    return map
  }, [taskStateRows])

  const loading = projLoading || fundLoading || taskLoading

  // Exclude test projects from all analytics calculations
  const isTestProject = (p: { id: string; name?: string | null; dealer?: string | null; consultant?: string | null }) => {
    const name = (p.name ?? '').toLowerCase()
    return name.startsWith('test') || name.includes('test ') || name.includes(' test') ||
      p.id?.startsWith('PROJ-TEST') ||
      (p.dealer ?? '').toLowerCase() === 'microgrid' ||
      (p.consultant ?? '').toLowerCase() === 'superman'
  }
  const realProjects = useMemo(() => projects.filter(p => !isTestProject(p)), [projects])

  const active = useMemo(() => realProjects.filter(p => p.stage !== 'complete'), [realProjects])
  const complete = useMemo(() => realProjects.filter(p => p.stage === 'complete'), [realProjects])

  const analyticsData: AnalyticsData = useMemo(() => ({
    projects: realProjects, active, complete, funding, taskMap, period,
  }), [realProjects, active, complete, funding, taskMap, period])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    clearQueryCache()
    refreshProjects()
    refreshFunding()
    refreshTasks()
    // refresh is synchronous cache-clear + refetch trigger; brief visual feedback
    setTimeout(() => setRefreshing(false), 600)
  }, [refreshProjects, refreshFunding])

  // Role gate: Manager+ only (after all hooks to respect Rules of Hooks)
  if (!userLoading && currentUser && !currentUser.isManager) {
    return (
      <>
        <Nav active="Analytics" />
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg text-gray-400">Access Restricted</p>
            <p className="text-sm text-gray-500 mt-2">Analytics is available to Managers and above.</p>
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
      <div className="text-green-400 text-sm animate-pulse">Loading analytics...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Analytics" />
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex flex-wrap items-center gap-2">
        <button onClick={handleRefresh} disabled={refreshing}
          className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md px-2 py-1.5 transition-colors disabled:opacity-50 flex items-center gap-1"
          title="Refresh data"
          aria-label="Refresh analytics data">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
          {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([k, v]) => (
            <button key={k} onClick={() => handlePeriodChange(k)}
              className={`text-xs px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                period === k ? 'bg-green-700 text-white font-medium' : 'text-gray-400 hover:text-white'
              }`}>
              {v}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={customFrom} onChange={e => handleCustomDateChange(e.target.value, customTo)}
              className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5" />
            <span className="text-gray-500 text-xs">to</span>
            <input type="date" value={customTo} onChange={e => handleCustomDateChange(customFrom, e.target.value)}
              className="text-xs bg-gray-800 text-gray-300 border border-gray-700 rounded-md px-2 py-1.5" />
          </div>
        )}
      </div>

      {/* Sub-tabs — wraps on mobile */}
      <div className="bg-gray-900 border-b border-gray-800 flex flex-wrap px-4 flex-shrink-0" role="tablist" aria-label="Analytics tabs">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`}
            className={`text-xs px-4 py-3 font-medium transition-colors border-b-2 whitespace-nowrap ${tab === t ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6" role="tabpanel" id={`panel-${tab}`} aria-label={TAB_LABELS[tab]}>
        {tab === 'executive' && <Executive data={analyticsData} />}
        {tab === 'cash_flow' && <CashFlow data={analyticsData} />}
        {tab === 'velocity' && <InstallVelocity data={analyticsData} />}
        {tab === 'pipeline' && <PipelineHealth data={analyticsData} />}
        {tab === 'pm' && <ByPM data={analyticsData} />}
        {tab === 'sales' && <Dealers data={analyticsData} />}
        {tab === 'ops' && <OpsTabContent />}
      </div>
    </div>
  )
}
