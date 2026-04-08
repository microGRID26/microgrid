'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { useSupabaseQuery } from '@/lib/hooks'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { db } from '@/lib/db'
import { Executive, CashFlow, InstallVelocity, PipelineHealth, ByPM, Dealers, setCustomRange } from '@/components/analytics'
import { CrewPerformance } from '@/components/analytics/CrewPerformance'
import { Forecasting } from '@/components/analytics/Forecasting'
import { JobCosting } from '@/components/analytics/JobCosting'
import type { Period, AnalyticsData, RampScheduleRow, WorkOrderRow, SalesRepRow } from '@/components/analytics'
import type { ProjectFunding } from '@/types/database'

import { OpsTabContent } from '@/app/ops/page'

type Tab = 'executive' | 'cash_flow' | 'velocity' | 'pipeline' | 'pm' | 'sales' | 'crew' | 'forecast' | 'job_costing' | 'ops'

const TAB_LABELS: Record<Tab, string> = {
  executive: 'Executive', cash_flow: 'Cash Flow', velocity: 'Install Velocity',
  pipeline: 'Pipeline', pm: 'By PM', sales: 'Sales',
  crew: 'Crew', forecast: 'Forecast', job_costing: 'Job Costing',
  ops: 'Operations',
}

export default function AnalyticsPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const [period, setPeriod] = useState<Period>('mtd')
  const [tab, setTab] = useState<Tab>('executive')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const handlePeriodChange = useCallback((p: Period) => {
    setPeriod(p)
    if (p === 'custom') {
      setCustomRange(customFrom || null, customTo || null)
    }
  }, [customFrom, customTo])

  const handleCustomDateChange = useCallback((from: string, to: string) => {
    setCustomFrom(from)
    setCustomTo(to)
    setCustomRange(from || null, to || null)
    setPeriod('custom')
  }, [])

  const { data: projects, loading: projLoading } = useSupabaseQuery('projects', {
    select: 'id, name, stage, contract, install_complete_date, stage_date, sale_date, pm, pm_id, blocker, financier, disposition, pto_date, dealer, consultant, advisor, systemkw',
    filters: { disposition: { not_in: ['In Service', 'Loyalty', 'Cancelled', 'Legal', 'On Hold'] } },
  })

  const { data: fundingRows, loading: fundLoading } = useSupabaseQuery('project_funding', {
    select: 'project_id, m2_funded_date, m3_funded_date, m2_amount, m3_amount, m2_status, m3_status, m1_amount, m1_status, nonfunded_code_1, nonfunded_code_2, nonfunded_code_3',
  })

  const { data: taskStateRows, loading: taskLoading } = useSupabaseQuery('task_state', {
    select: 'project_id, task_id, status',
    limit: 50000,
  })

  // Crew + schedule data for Crew Performance tab
  const [rampSchedule, setRampSchedule] = useState<RampScheduleRow[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([])
  const [salesReps, setSalesReps] = useState<SalesRepRow[]>([])
  useEffect(() => {
    const supabase = db()
    supabase.from('ramp_schedule').select('id, project_id, crew_id, crew_name, scheduled_week, scheduled_day, slot, status, completed_at, drive_minutes, distance_miles').limit(5000)
      .then(({ data, error }: { data: RampScheduleRow[] | null; error: unknown }) => { if (error) console.error('[analytics] ramp_schedule:', error); if (data) setRampSchedule(data) })
    supabase.from('work_orders').select('id, project_id, assigned_crew, status, scheduled_date, started_at, completed_at, time_on_site_minutes, type').limit(5000)
      .then(({ data, error }: { data: WorkOrderRow[] | null; error: unknown }) => { if (error) console.error('[analytics] work_orders:', error); if (data) setWorkOrders(data) })
    supabase.from('sales_reps').select('id, first_name, last_name, team_id, status, role_key').limit(500)
      .then(({ data, error }: { data: SalesRepRow[] | null; error: unknown }) => { if (error) console.error('[analytics] sales_reps:', error); if (data) setSalesReps(data) })
  }, [])

  const funding = useMemo(() => {
    const map: Record<string, ProjectFunding> = {}
    fundingRows.forEach((f) => { map[f.project_id] = f })
    return map
  }, [fundingRows])

  const taskMap = useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    taskStateRows.forEach((t: { project_id: string; task_id: string; status: string }) => {
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
    projects: realProjects, active, complete, funding, taskMap,
    rampSchedule, workOrders, salesReps,
    period, onPeriodChange: handlePeriodChange, onCustomDateChange: handleCustomDateChange,
  }), [realProjects, active, complete, funding, taskMap, rampSchedule, workOrders, salesReps, period, handlePeriodChange, handleCustomDateChange])

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

      {/* Main tabs — top level, bigger text */}
      <div className="bg-gray-900 border-b border-gray-800 flex flex-wrap px-4 flex-shrink-0" role="tablist" aria-label="Analytics tabs">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            role="tab" aria-selected={tab === t} aria-controls={`panel-${t}`}
            className={`text-sm px-5 py-3 font-medium transition-colors border-b-2 whitespace-nowrap ${tab === t ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-white'}`}>
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
        {tab === 'crew' && <CrewPerformance data={analyticsData} />}
        {tab === 'forecast' && <Forecasting data={analyticsData} />}
        {tab === 'job_costing' && <JobCosting data={analyticsData} />}
        {tab === 'ops' && <OpsTabContent />}
      </div>
    </div>
  )
}
