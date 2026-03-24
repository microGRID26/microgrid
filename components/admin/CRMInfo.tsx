'use client'

import { useEffect, useState } from 'react'
import { db } from '@/lib/db'
import { STAGE_ORDER, STAGE_LABELS, CRMStats } from './shared'

export function CRMInfo() {
  const supabase = db()
  const [stats, setStats] = useState<CRMStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [stageBreakdown, setStageBreakdown] = useState<Record<string, number>>({})

  useEffect(() => {
    const load = async () => {
      const [
        { count: projects },
        { count: ahjs },
        { count: utilities },
        { count: hoas },
        { count: users },
        { count: crews },
        { count: serviceCalls },
        { data: stageData },
      ] = await Promise.all([
        supabase.from('projects').select('*', { count: 'exact', head: true }),
        supabase.from('ahjs').select('*', { count: 'exact', head: true }),
        supabase.from('utilities').select('*', { count: 'exact', head: true }),
        (supabase as any).from('hoas').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('crews').select('*', { count: 'exact', head: true }),
        supabase.from('service_calls').select('*', { count: 'exact', head: true }),
        supabase.from('projects').select('stage').limit(2000),
      ])
      setStats({ projects: projects ?? 0, ahjs: ahjs ?? 0, utilities: utilities ?? 0, hoas: hoas ?? 0, users: users ?? 0, crews: crews ?? 0, serviceCalls: serviceCalls ?? 0 })
      const breakdown: Record<string, number> = {}
      ;(stageData ?? []).forEach((r: { stage: string }) => {
        breakdown[r.stage] = (breakdown[r.stage] || 0) + 1
      })
      setStageBreakdown(breakdown)
      setLoading(false)
    }
    load()
  }, [])

  const statCards = [
    { label: 'Projects', value: stats?.projects, icon: '📋', color: 'text-blue-400' },
    { label: 'AHJs', value: stats?.ahjs, icon: '🏛️', color: 'text-purple-400' },
    { label: 'Utilities', value: stats?.utilities, icon: '⚡', color: 'text-yellow-400' },
    { label: 'Users', value: stats?.users, icon: '👥', color: 'text-green-400' },
    { label: 'Crews', value: stats?.crews, icon: '🔧', color: 'text-orange-400' },
    { label: 'Service Calls', value: stats?.serviceCalls, icon: '🛎️', color: 'text-red-400' },
  ]

  const totalProjects = stats?.projects ?? 0

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">CRM Info</h2>
        <p className="text-xs text-gray-500 mt-0.5">Live database statistics</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-gray-500 text-sm">Loading stats…</div>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {statCards.map(s => (
              <div key={s.label} className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value?.toLocaleString() ?? '—'}</p>
                  </div>
                  <span className="text-xl">{s.icon}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Stage breakdown */}
          <div className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Projects by Stage</h3>
            <div className="space-y-2">
              {STAGE_ORDER.map(stage => {
                const count = stageBreakdown[stage] ?? 0
                const pct = totalProjects ? (count / totalProjects) * 100 : 0
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-24 shrink-0">{STAGE_LABELS[stage]}</span>
                    <div className="flex-1 bg-gray-700/50 rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-white w-8 text-right shrink-0">{count}</span>
                    <span className="text-xs text-gray-600 w-10 shrink-0">{pct.toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* System info */}
          <div className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">System</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Stack',      value: 'Next.js 16 + TypeScript + Tailwind v4' },
                { label: 'Database',   value: 'Supabase (PostgreSQL)' },
                { label: 'Hosting',    value: 'Vercel Hobby' },
                { label: 'Auth',       value: 'Google OAuth (@gomicrogridenergy.com + 1 more)' },
                { label: 'Repo',       value: 'github.com/microGRID26/microgrid-crm' },
                { label: 'Phase',      value: 'Phase 3 — Admin Portal' },
              ].map(r => (
                <div key={r.label} className="flex flex-col gap-0.5">
                  <span className="text-gray-500">{r.label}</span>
                  <span className="text-gray-300">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
