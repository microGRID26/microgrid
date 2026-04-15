'use client'

import { useState, useEffect } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { loadLiveStats } from '@/lib/api'
import { STAGE_LABELS } from '@/lib/utils'
import { Printer } from 'lucide-react'
import { LeadershipTab } from './components/LeadershipTab'
import { SalesTab } from './components/SalesTab'
import { InsideOpsTab } from './components/InsideOpsTab'
import { FieldOpsTab } from './components/FieldOpsTab'
import { JourneyTab } from './components/JourneyTab'
import { TechnicalTab } from './components/TechnicalTab'

type Tab = 'leadership' | 'sales' | 'inside_ops' | 'field_ops' | 'journey' | 'technical'

interface PipelineStage { stage: string; count: number; value: number; label: string; color: string }
interface LiveStats {
  totalProjects: number; totalValue: number; pipeline: PipelineStage[]
  ticketCount: number; noteCount: number; userCount: number
  crewCount: number; ahjCount: number; equipmentCount: number
}

const STAGE_COLORS: Record<string, string> = {
  evaluation: '#3b82f6',
  survey: '#8b5cf6',
  design: '#ec4899',
  permit: '#f59e0b',
  install: '#f97316',
  inspection: '#06b6d4',
  complete: '#22c55e',
}

const STAGE_META: Record<string, { label: string; color: string }> = Object.fromEntries(
  Object.keys(STAGE_COLORS).map(s => [s, { label: STAGE_LABELS[s] ?? s, color: STAGE_COLORS[s] }])
)

const DEFAULTS: LiveStats = {
  totalProjects: 921, totalValue: 145054591, pipeline: [
    { stage: 'evaluation', count: 89, value: 20381110, label: 'Evaluation', color: '#3b82f6' },
    { stage: 'design', count: 108, value: 25791576, label: 'Design', color: '#ec4899' },
    { stage: 'permit', count: 262, value: 61595989, label: 'Permitting', color: '#f59e0b' },
    { stage: 'install', count: 150, value: 21958959, label: 'Installation', color: '#f97316' },
    { stage: 'inspection', count: 309, value: 15210757, label: 'Inspection', color: '#06b6d4' },
    { stage: 'complete', count: 3, value: 116201, label: 'Complete', color: '#22c55e' },
  ],
  ticketCount: 16, noteCount: 181944, userCount: 16, crewCount: 4, ahjCount: 1408, equipmentCount: 2312,
}

export default function InfographicPage() {
  const { user } = useCurrentUser()
  const { orgId } = useOrg()
  const isSales = user?.isSales ?? false
  const [tab, setTab] = useState<Tab>(isSales ? 'sales' : 'leadership')
  const [stats, setStats] = useState<LiveStats>(DEFAULTS)

  // Force sales tab for sales role
  useEffect(() => { if (isSales) setTab('sales') }, [isSales])
  const [loading, setLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  useEffect(() => {
    async function load() {
      const result = await loadLiveStats(orgId ?? undefined)
      const pipeline: PipelineStage[] = []
      for (const s of ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete']) {
        const meta = STAGE_META[s]; const d = result.projectsByStage[s] ?? { count: 0, value: 0 }
        if (d.count > 0) pipeline.push({ stage: s, count: d.count, value: d.value, label: meta.label, color: meta.color })
      }
      setStats({
        totalProjects: result.totalProjects, totalValue: result.totalValue, pipeline,
        ticketCount: result.openTickets, noteCount: result.totalNotes, userCount: result.activeUsers,
        crewCount: result.activeCrews, ahjCount: result.totalAHJs, equipmentCount: result.totalEquipment,
      })
      setLoadedAt(new Date())
      setLoading(false)
    }
    load()
  }, [orgId])

  const maxCount = Math.max(...stats.pipeline.map(s => s.count), 1)

  return (
    <div className="min-h-screen bg-gray-900 text-white print:bg-white print:text-black">
      <style>{`
        @keyframes countUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes growBar { from { width: 0; } }
        @keyframes flowDots { from { background-position: 0 0; } to { background-position: 40px 0; } }
        @keyframes pulseGlow { 0%, 100% { box-shadow: 0 0 0 0 rgba(29,158,117,0); } 50% { box-shadow: 0 0 20px 2px rgba(29,158,117,0.15); } }
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ringGrow { from { stroke-dashoffset: 283; } }
        .animate-count { animation: countUp 0.8s ease-out forwards; }
        .animate-grow { animation: growBar 1.2s ease-out forwards; }
        .animate-flow { background: repeating-linear-gradient(90deg, transparent, transparent 8px, #1D9E7540 8px, #1D9E7540 16px); background-size: 40px 2px; animation: flowDots 1.5s linear infinite; }
        .animate-pulse-glow { animation: pulseGlow 3s ease-in-out infinite; }
        .animate-slide { animation: fadeSlideUp 0.5s ease-out forwards; opacity: 0; }
        .animate-slide-1 { animation-delay: 0.1s; }
        .animate-slide-2 { animation-delay: 0.2s; }
        .animate-slide-3 { animation-delay: 0.3s; }
        .animate-slide-4 { animation-delay: 0.4s; }
        .animate-slide-5 { animation-delay: 0.5s; }
        .animate-slide-6 { animation-delay: 0.6s; }
        .animate-slide-7 { animation-delay: 0.7s; }
        .gradient-border { background: linear-gradient(135deg, #1D9E75, #3b82f6, #8b5cf6); padding: 1px; border-radius: 12px; }
        .gradient-border > div { background: #111827; border-radius: 11px; }
        .ring-chart { transform: rotate(-90deg); }
      `}</style>
      <Nav active="Infographic" />
      <div className="max-w-6xl mx-auto px-3 md:px-6 py-4 md:py-8 space-y-6 md:space-y-10 print:space-y-6">

        {/* Header */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl md:text-3xl font-bold"><span className="text-green-400 print:text-green-700">MicroGRID</span> Infographic</h1>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-md print:hidden flex-shrink-0"><Printer className="w-3.5 h-3.5" /> Print</button>
          </div>
          <div className="flex bg-gray-800 rounded-lg p-0.5 print:hidden overflow-x-auto">
            {(isSales ? [
              { key: 'sales' as Tab, label: 'Sales' },
            ] : [
              { key: 'leadership' as Tab, label: 'Leadership' },
              { key: 'sales' as Tab, label: 'Sales' },
              { key: 'inside_ops' as Tab, label: 'Inside Ops' },
              { key: 'field_ops' as Tab, label: 'Field Ops' },
              { key: 'journey' as Tab, label: 'Journey' },
              { key: 'technical' as Tab, label: 'Technical' },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`px-3 md:px-4 py-1.5 text-[11px] md:text-xs font-medium rounded-md transition-colors whitespace-nowrap flex-shrink-0 ${tab === t.key ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white'}`}>{t.label}</button>
            ))}
          </div>
        </div>

        {tab === 'leadership' && <LeadershipTab stats={stats} maxCount={maxCount} />}
        {tab === 'inside_ops' && <InsideOpsTab />}
        {tab === 'field_ops' && <FieldOpsTab />}
        {tab === 'sales' && <SalesTab stats={stats} />}
        {tab === 'journey' && <JourneyTab />}
        {tab === 'technical' && <TechnicalTab stats={stats} />}

        {/* Timestamp */}
        <div className="text-center py-4 border-t border-gray-800 print:border-gray-300">
          <p className="text-sm text-gray-400">Built by <span className="text-green-400 font-semibold print:text-green-700">Atlas</span> for MicroGRID Energy / EDGE</p>
          {loadedAt ? (
            <p className="text-[10px] text-gray-600 mt-1">Data as of {loadedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at {loadedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
          ) : (
            <p className="text-[10px] text-amber-400 mt-1 animate-pulse">Refreshing live data...</p>
          )}
        </div>
      </div>
    </div>
  )
}
