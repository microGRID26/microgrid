'use client'

import { useState, useEffect } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { db } from '@/lib/db'
import { fmt$ } from '@/lib/utils'
import { Printer } from 'lucide-react'

type Tab = 'leadership' | 'sales' | 'inside_ops' | 'field_ops' | 'journey' | 'technical'

interface PipelineStage { stage: string; count: number; value: number; label: string; color: string }
interface LiveStats {
  totalProjects: number; totalValue: number; pipeline: PipelineStage[]
  ticketCount: number; noteCount: number; userCount: number
  crewCount: number; ahjCount: number; equipmentCount: number
}

const STAGE_META: Record<string, { label: string; color: string }> = {
  evaluation: { label: 'Evaluation', color: '#3b82f6' },
  survey: { label: 'Site Survey', color: '#8b5cf6' },
  design: { label: 'Design', color: '#ec4899' },
  permit: { label: 'Permitting', color: '#f59e0b' },
  install: { label: 'Installation', color: '#f97316' },
  inspection: { label: 'Inspection', color: '#06b6d4' },
  complete: { label: 'Complete', color: '#22c55e' },
}

const DEFAULTS: LiveStats = {
  totalProjects: 871, totalValue: 142370278, pipeline: [
    { stage: 'evaluation', count: 89, value: 20381110, label: 'Evaluation', color: '#3b82f6' },
    { stage: 'design', count: 108, value: 25791576, label: 'Design', color: '#ec4899' },
    { stage: 'permit', count: 263, value: 61754164, label: 'Permitting', color: '#f59e0b' },
    { stage: 'install', count: 149, value: 21800784, label: 'Installation', color: '#f97316' },
    { stage: 'inspection', count: 254, value: 12444537, label: 'Inspection', color: '#06b6d4' },
    { stage: 'complete', count: 8, value: 198107, label: 'Complete', color: '#22c55e' },
  ],
  ticketCount: 12, noteCount: 330000, userCount: 10, crewCount: 4, ahjCount: 1633, equipmentCount: 2517,
}

export default function InfographicPage() {
  const { user } = useCurrentUser()
  const isSales = user?.isSales ?? false
  const isMicrogridEmployee = user?.email?.endsWith('@gomicrogridenergy.com') ?? false
  const isAdmin = user?.isAdmin ?? false
  const isSuperAdmin = user?.isSuperAdmin ?? false
  const TECHNICAL_EMAILS = ['greg@gomicrogridenergy.com', 'greg@energydevelopmentgroup.com', 'mark@gomicrogridenergy.com', 'zach@gomicrogridenergy.com', 'paul@gomicrogridenergy.com']
  const canSeeTechnical = TECHNICAL_EMAILS.includes(user?.email ?? '')
  const [tab, setTab] = useState<Tab>(isSales ? 'sales' : 'leadership')
  const [stats, setStats] = useState<LiveStats>(DEFAULTS)

  // Force sales tab for sales role
  useEffect(() => { if (isSales) setTab('sales') }, [isSales])
  const [loading, setLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = db()
      const { data: projects } = await supabase.from('projects').select('stage, contract').not('disposition', 'in', '("In Service","Loyalty","Cancelled")').limit(5000)
      if (!projects) { setLoading(false); return }
      const byStage: Record<string, { count: number; value: number }> = {}
      let totalValue = 0
      for (const p of projects as any[]) {
        if (!byStage[p.stage]) byStage[p.stage] = { count: 0, value: 0 }
        byStage[p.stage].count++
        const v = Number(p.contract) || 0
        byStage[p.stage].value += v
        totalValue += v
      }
      const pipeline: PipelineStage[] = []
      for (const s of ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete']) {
        const meta = STAGE_META[s]; const d = byStage[s] ?? { count: 0, value: 0 }
        if (d.count > 0) pipeline.push({ stage: s, count: d.count, value: d.value, label: meta.label, color: meta.color })
      }
      const [tickets, notes, users, crews, ahjs, equipment] = await Promise.all([
        supabase.from('tickets').select('id', { count: 'exact', head: true }),
        supabase.from('notes').select('id', { count: 'exact', head: true }),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase.from('crews').select('id', { count: 'exact', head: true }).eq('active', 'TRUE'),
        supabase.from('ahjs').select('id', { count: 'exact', head: true }),
        supabase.from('equipment').select('id', { count: 'exact', head: true }),
      ])
      setStats({
        totalProjects: projects.length, totalValue, pipeline,
        ticketCount: tickets.count ?? 0, noteCount: notes.count ?? 0, userCount: users.count ?? 0,
        crewCount: crews.count ?? 0, ahjCount: ahjs.count ?? 0, equipmentCount: equipment.count ?? 0,
      })
      setLoadedAt(new Date())
      setLoading(false)
    }
    load()
  }, [])

  const maxCount = Math.max(...stats.pipeline.map(s => s.count), 1)

  return (
    <div className="min-h-screen bg-gray-950 text-white print:bg-white print:text-black">
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
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-10 print:space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-3xl font-bold"><span className="text-green-400 print:text-green-700">MicroGRID</span> Infographic</h1>
          <div className="flex items-center gap-2">
            <div className="flex bg-gray-800 rounded-lg p-0.5 print:hidden overflow-x-auto max-w-[70vw]">
              {!isSales && ([
                { key: 'leadership' as Tab, label: 'Leadership' },
                ...(isMicrogridEmployee ? [{ key: 'sales' as Tab, label: 'Sales' }] : []),
                { key: 'inside_ops' as Tab, label: 'Inside Ops' },
                { key: 'field_ops' as Tab, label: 'Field Ops' },
                { key: 'journey' as Tab, label: 'Customer Journey' },
                ...(canSeeTechnical ? [{ key: 'technical' as Tab, label: 'Technical' }] : []),
              ]).map(t => (
                <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === t.key ? 'bg-green-700 text-white' : 'text-gray-400 hover:text-white'}`}>{t.label}</button>
              ))}
            </div>
            <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-md print:hidden"><Printer className="w-3.5 h-3.5" /> Print</button>
          </div>
        </div>

        {/* ═══ EXECUTIVE ═══ */}
        {tab === 'leadership' && (
          <div className="space-y-14">

            {/* HERO — The number */}
            <div className="text-center py-12 relative">
              <div className="absolute inset-0 bg-gradient-radial from-green-900/20 via-transparent to-transparent rounded-3xl" style={{ background: 'radial-gradient(ellipse at center, rgba(29,158,117,0.08) 0%, transparent 70%)' }} />
              <div className="animate-count text-7xl font-black text-green-400 print:text-green-700 tracking-tight drop-shadow-[0_0_30px_rgba(29,158,117,0.3)]">
                {fmt$(stats.totalValue)}
              </div>
              <div className="animate-count text-xl text-gray-300 mt-3 print:text-gray-700" style={{ animationDelay: '0.2s' }}>
                Portfolio Under Management
              </div>
              <div className="animate-count text-sm text-gray-500 mt-2" style={{ animationDelay: '0.4s' }}>
                {stats.totalProjects.toLocaleString()} active projects · 7 automated pipeline stages · 14,705 legacy records preserved
              </div>
            </div>

            {/* PIPELINE FUNNEL — Full width, tall bars */}
            <div>
              <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Pipeline Breakdown</h2>
              <div className="space-y-2">
                {stats.pipeline.map(s => (
                  <div key={s.stage} className="flex items-center gap-3">
                    <div className="w-24 text-right flex-shrink-0">
                      <div className="text-xs font-bold" style={{ color: s.color }}>{s.label}</div>
                    </div>
                    <div className="flex-1">
                      <div className="h-14 rounded-lg bg-gray-800/50 print:bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-lg flex items-center justify-between px-4 animate-grow animate-pulse-glow"
                          style={{ width: `${Math.max((s.count / maxCount) * 100, 12)}%`, backgroundColor: `${s.color}15`, borderLeft: `5px solid ${s.color}`, boxShadow: `inset 0 0 30px ${s.color}10` }}>
                          <span className="text-sm font-bold print:text-black">{s.count} projects</span>
                          <span className="text-sm font-bold text-green-400 print:text-green-700">{fmt$(s.value)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* THE STORY — 3 panels */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-6 print:bg-red-50 print:border-red-200 animate-slide animate-slide-1">
                <div className="text-red-400 text-xs font-bold uppercase tracking-wider mb-2">The Challenge</div>
                <p className="text-sm text-gray-300 print:text-gray-700">Managing 900+ solar installations across multiple crews, 1,633 permit authorities, and complex funding milestones with spreadsheets doesn't scale. Projects fall through cracks. Revenue gets delayed.</p>
              </div>
              <div className="bg-blue-950/20 border border-blue-900/30 rounded-xl p-6 print:bg-blue-50 print:border-blue-200 animate-slide animate-slide-2">
                <div className="text-blue-400 text-xs font-bold uppercase tracking-wider mb-2">The Solution</div>
                <p className="text-sm text-gray-300 print:text-gray-700">Purpose-built platform with automated 7-stage pipeline, real-time crew scheduling with route optimization, integrated ticketing, and AI-powered data access. Every action is tracked, every milestone triggers the next.</p>
              </div>
              <div className="bg-green-950/20 border border-green-900/30 rounded-xl p-6 print:bg-green-50 print:border-green-200 animate-slide animate-slide-3">
                <div className="text-green-400 text-xs font-bold uppercase tracking-wider mb-2">The Impact</div>
                <p className="text-sm text-gray-300 print:text-gray-700">Zero projects lost in transition. Automated funding milestones. 30/60/90 day revenue forecasting. Crew route optimization reduces drive time. Multi-tenant ready for the EDGE partner network.</p>
              </div>
            </div>

            {/* TOP 4 ADVANTAGES — Big cards */}
            <div>
              <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Core Differentiators</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { icon: '⚡', title: 'Automated Pipeline', desc: 'When a task completes, the next one activates. When all tasks finish, the project advances. When install completes, M2 funding becomes eligible. No manual handoffs.', color: '#f59e0b' },
                  { icon: '🏢', title: 'Built for the EDGE Network', desc: 'Multi-tenant architecture with org-scoped data, cross-org engineering assignments, NTP approval workflows, and inter-org invoicing. Ready for partner EPCs.', color: '#8b5cf6' },
                  { icon: '🤖', title: 'AI-Powered Data Access', desc: 'Ask Atlas in plain English: "Show me Houston projects over $50K stuck in permitting." Get instant answers from your live data. No SQL, no reports to build.', color: '#3b82f6' },
                  { icon: '📈', title: 'Install Ramp Planner', desc: 'Readiness scoring across 900+ projects. Geographic crew clustering. Auto-fill weekly schedules. 30/60/90 day revenue forecasts. Built for the funded ramp-up.', color: '#1D9E75' },
                ].map(a => (
                  <div key={a.title} className="bg-gray-800 rounded-xl p-6 border border-gray-700 print:border-gray-300 print:bg-gray-50">
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">{a.icon}</span>
                      <div>
                        <h3 className="text-base font-bold print:text-black" style={{ color: a.color }}>{a.title}</h3>
                        <p className="text-sm text-gray-400 mt-1 print:text-gray-600">{a.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1 pl-1">
                <span>Also: SLA tracking</span><span>·</span><span>{stats.ahjCount.toLocaleString()} AHJ records</span><span>·</span><span>Crew route optimization</span><span>·</span><span>Full audit trail</span><span>·</span><span>Real-time across all devices</span>
              </div>
            </div>

            {/* RAMP FORECAST — Big */}
            <div>
              <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Install Ramp-Up Forecast</h2>
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 print:border-gray-300 print:bg-gray-50">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                  {[
                    { period: 'Month 1', crews: 2, installs: 16, revenue: '$700K', color: '#1D9E75' },
                    { period: 'Month 2', crews: 4, installs: 32, revenue: '$1.4M', color: '#3b82f6' },
                    { period: 'Month 3', crews: 6, installs: 48, revenue: '$2.1M', color: '#8b5cf6' },
                    { period: 'Month 4', crews: 8, installs: 64, revenue: '$2.8M', color: '#f59e0b' },
                  ].map(p => (
                    <div key={p.period} className="text-center">
                      <div className="text-xs text-gray-500">{p.period}</div>
                      <div className="text-3xl font-black mt-1" style={{ color: p.color }}>{p.installs}</div>
                      <div className="text-[10px] text-gray-400">{p.crews} crews × 2/week</div>
                      <div className="text-sm font-bold text-white mt-1 print:text-black">{p.revenue}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-end gap-1 h-40">
                  {Array.from({ length: 16 }, (_, i) => {
                    const crews = i < 4 ? 2 : 2 + Math.floor((i - 4) / 2) + 1
                    const h = (crews * 2 / 16) * 100
                    const color = i < 4 ? '#1D9E75' : i < 8 ? '#3b82f6' : i < 12 ? '#8b5cf6' : '#f59e0b'
                    return <div key={i} className="flex-1 rounded-t animate-grow" style={{ height: `${h}%`, backgroundColor: color, animationDelay: `${i * 0.08}s`, boxShadow: `0 0 8px ${color}30` }} />
                  })}
                </div>
                <div className="flex justify-between mt-2 text-[9px] text-gray-500"><span>Week 1 — 4 installs/wk</span><span>Week 16 — 16 installs/wk</span></div>
              </div>
            </div>

            {/* WHAT'S NEXT */}
            <div>
              <h2 className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Roadmap</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { phase: 'Phase 2', title: 'System Redesign Tool', desc: 'Enhanced redesign calculator for Ecoflow → Duracell migration. Automated string sizing, panel-fit estimates, and DXF planset generation.', status: 'Up Next', color: '#f59e0b' },
                  { phase: 'Phase 3', title: 'Route Optimization', desc: 'Google Routes API integration for real drive times with traffic. Day-level scheduling with time windows and homeowner availability.', status: 'Planned', color: '#3b82f6' },
                  { phase: 'Phase 4', title: 'Customer App', desc: 'Native iOS/Android app for homeowners. Sign documents, view lending agreements, monitor system performance. One-stop shop.', status: 'Planned', color: '#8b5cf6' },
                ].map(r => (
                  <div key={r.phase} className="bg-gray-800 rounded-xl p-5 border border-gray-700 print:border-gray-300 print:bg-gray-50">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${r.color}20`, color: r.color }}>{r.phase}</span>
                      <span className="text-[10px] text-gray-500">{r.status}</span>
                    </div>
                    <h3 className="text-sm font-bold text-white print:text-black">{r.title}</h3>
                    <p className="text-xs text-gray-400 mt-1 print:text-gray-600">{r.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ INSIDE OPS ═══ */}
        {tab === 'inside_ops' && (
          <div className="space-y-12">
            <div className="text-center py-2">
              <h2 className="text-2xl font-bold">Inside Operations</h2>
              <p className="text-sm text-gray-500 mt-1">For PMs, ops managers, and inside coordinators</p>
            </div>

            {/* Daily workflow */}
            <div>
              <h2 className="text-xl font-bold mb-4">Your Daily Workflow</h2>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {[
                  { step: '1', name: 'Command Center', desc: 'Action items, stuck tasks, follow-ups, today\'s schedule', color: '#1D9E75', href: '/command' },
                  { step: '2', name: 'Queue', desc: 'Prioritized worklist — smart filters, inline actions', color: '#3b82f6', href: '/queue' },
                  { step: '3', name: 'Pipeline', desc: 'Visual Kanban board — change status, add notes, set follow-ups', color: '#f59e0b', href: '/pipeline' },
                  { step: '4', name: 'Schedule', desc: 'Confirm jobs, assign crews, batch complete installs', color: '#8b5cf6', href: '/schedule' },
                  { step: '5', name: 'Tickets', desc: 'Handle issues, track SLA, resolve complaints', color: '#ec4899', href: '/tickets' },
                ].map(s => (
                  <a key={s.step} href={s.href} className="rounded-xl p-5 text-center border block hover:opacity-80 transition-opacity" style={{ backgroundColor: `${s.color}08`, borderColor: `${s.color}30` }}>
                    <div className="text-3xl font-black" style={{ color: s.color }}>{s.step}</div>
                    <div className="text-sm font-bold text-white mt-2">{s.name}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{s.desc}</div>
                  </a>
                ))}
              </div>
            </div>

            {/* Automations */}
            <div>
              {/* Total time saved */}
              <div className="bg-gradient-to-r from-green-900/20 to-green-900/5 border border-green-800/30 rounded-xl p-5 text-center">
                <div className="text-3xl font-black text-green-400 drop-shadow-[0_0_20px_rgba(29,158,117,0.3)]">~45 min/day saved</div>
                <div className="text-sm text-gray-400 mt-1">Per PM through automation — that's 3.75 hours per week back</div>
              </div>

              <h2 className="text-xl font-bold mb-4">Automation Saves You Time</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { category: 'Pipeline', color: '#1D9E75', items: [
                    { before: 'Manually advance stage', now: 'Auto-advances on task complete', saved: '~2 min/project' },
                    { before: 'Check M2 eligibility', now: 'Auto-sets on install complete', saved: '~1 min/project' },
                    { before: 'Set project blocker', now: 'Auto-sets on stuck task', saved: '~1 min/project' },
                  ]},
                  { category: 'Scheduling', color: '#3b82f6', items: [
                    { before: 'Figure out crew routes', now: 'Geographic clustering suggests crews', saved: '~15 min/week' },
                    { before: 'Update tasks after install', now: 'Batch complete syncs tasks', saved: '~2 min/day' },
                    { before: 'Calculate readiness', now: 'Auto-scored from task data', saved: '~10 min/week' },
                  ]},
                  { category: 'Communication', color: '#8b5cf6', items: [
                    { before: 'Remember follow-ups', now: 'Bell notification when overdue', saved: '~5 min/day' },
                    { before: 'Notify team on @mention', now: 'Instant notification badge', saved: '~1 min/mention' },
                  ]},
                ].map(group => (
                  <div key={group.category} className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: group.color }}>{group.category}</h3>
                    <div className="space-y-3">
                      {group.items.map((a, i) => (
                        <div key={i}>
                          <div className="text-[10px] text-red-400 line-through">{a.before}</div>
                          <div className="text-xs text-green-400">{a.now}</div>
                          <div className="text-[9px] text-amber-400 mt-0.5">{a.saved}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Shortcuts */}
            <div>
              <h2 className="text-xl font-bold mb-4">Tips & Shortcuts</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { shortcut: '⌘K', desc: 'Global search — find any project from any page' },
                  { shortcut: '···', desc: 'Quick Actions on Queue cards — set blocker, add note, follow-up' },
                  { shortcut: 'Select', desc: 'Batch select on Queue/Pipeline/Tasks — bulk update multiple items' },
                  { shortcut: 'Auto-Fill', desc: 'Ramp planner fills all crew slots with best-fit projects' },
                  { shortcut: '@name', desc: 'Mention anyone in notes or tickets — instant bell notification' },
                  { shortcut: 'CSV', desc: 'Export any page to spreadsheet — projects, tickets, analytics' },
                ].map((t, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg px-4 py-3 border border-gray-700 flex items-start gap-3">
                    <span className="text-[10px] bg-gray-700 text-green-400 px-2 py-0.5 rounded font-mono flex-shrink-0">{t.shortcut}</span>
                    <span className="text-xs text-gray-300">{t.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick start */}
            <div>
              <h2 className="text-xl font-bold mb-4">New PM Quick Start</h2>
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                {['Log in with Google (@gomicrogridenergy.com)', 'Command Center loads — check your action items and stuck tasks', 'Queue shows your assigned projects filtered by default', 'Click any project → Tasks tab to update statuses and add notes', 'Questions? Help page or @mention someone in Notes'].map((step, i) => (
                  <div key={i} className="flex items-start gap-3 py-2">
                    <div className="w-6 h-6 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0 text-xs font-bold">{i + 1}</div>
                    <span className="text-sm text-gray-300 pt-0.5">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ FIELD OPS ═══ */}
        {tab === 'field_ops' && (
          <div className="space-y-12">
            <div className="text-center py-6 relative">
              <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />
              <div className="text-4xl mb-2">🔨</div>
              <h2 className="text-2xl font-bold">Field Operations</h2>
              <p className="text-sm text-gray-500 mt-1">Built for crew leads, installers, and field technicians</p>
            </div>

            {/* Field day workflow */}
            <div>
              <h2 className="text-xl font-bold mb-4">Your Day in the Field</h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {[
                  { step: '1', name: 'Check Schedule', desc: 'Open crew view on your phone. See today\'s jobs with addresses and customer info.', color: '#1D9E75', icon: '📱' },
                  { step: '2', name: 'Navigate to Site', desc: 'Tap the address for Google Maps directions. Customer phone is one tap away.', color: '#3b82f6', icon: '🗺️' },
                  { step: '3', name: 'Complete Checklist', desc: 'Follow the job-type checklist. Mark items done as you go. Add photos and notes.', color: '#f59e0b', icon: '✅' },
                  { step: '4', name: 'Mark Complete', desc: 'Hit Complete. Tasks auto-update. Funding milestones trigger. Next job loads.', color: '#22c55e', icon: '🎉' },
                ].map(s => (
                  <div key={s.step} className="rounded-xl p-5 text-center border" style={{ backgroundColor: `${s.color}08`, borderColor: `${s.color}30` }}>
                    <div className="text-2xl mb-1">{s.icon}</div>
                    <div className="text-2xl font-black" style={{ color: s.color }}>{s.step}</div>
                    <div className="text-sm font-bold text-white mt-1">{s.name}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{s.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile tools */}
            <div>
              <h2 className="text-xl font-bold mb-4">Your Mobile Tools</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { name: 'Crew View', desc: 'See your scheduled jobs for the week. Customer name, address, phone, equipment specs, job type.', color: '#1D9E75', href: '/crew' },
                  { name: 'One-Tap Navigation', desc: 'Tap any address to open Google Maps with driving directions. Tap phone to call the customer.', color: '#3b82f6', href: '/crew' },
                  { name: 'Job Checklists', desc: '5 checklist templates: Install (9 items), Inspection (5), Service (4), Survey (4), Repair (6).', color: '#f59e0b', href: '/work-orders' },
                  { name: 'Clock In/Out', desc: 'GPS-tracked time tracking. Clock in when you arrive, clock out when done. Hours automatically logged.', color: '#8b5cf6', href: '/mobile/field' },
                  { name: 'Barcode Scanner', desc: 'Scan warehouse stock barcodes with your phone camera. Check out equipment to a project.', color: '#ec4899', href: '/mobile/scan' },
                  { name: 'Report Issues', desc: 'Create a ticket from the field. Priority, category. Ops gets notified immediately.', color: '#ef4444', href: '/tickets' },
                ].map(t => (
                  <a key={t.name} href={t.href} className="bg-gray-800 rounded-xl p-5 border border-gray-700 block hover:opacity-80 transition-opacity">
                    <h3 className="text-sm font-bold" style={{ color: t.color }}>{t.name} →</h3>
                    <p className="text-xs text-gray-400 mt-1">{t.desc}</p>
                  </a>
                ))}
              </div>
            </div>

            {/* Work order types */}
            <div>
              <h2 className="text-xl font-bold mb-4">Job Types & Checklists</h2>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {[
                  { type: 'Install', items: 9, desc: 'Panels, wiring, inverter, battery, testing, cleanup', color: '#f97316' },
                  { type: 'Survey', items: 4, desc: 'Roof measurement, electrical panel, photos, shade', color: '#3b82f6' },
                  { type: 'Inspection', items: 5, desc: 'Permit verify, visual, electrical test, photos', color: '#06b6d4' },
                  { type: 'Service', items: 4, desc: 'Diagnose, repair, test, customer sign-off', color: '#22c55e' },
                  { type: 'Repair', items: 6, desc: 'Diagnose, parts, repair, test, cleanup, sign-off', color: '#ef4444' },
                ].map(t => (
                  <div key={t.type} className="bg-gray-800 rounded-lg p-4 text-center border border-gray-700">
                    <div className="text-sm font-bold" style={{ color: t.color }}>{t.type}</div>
                    <div className="text-2xl font-black text-white mt-1">{t.items}</div>
                    <div className="text-[9px] text-gray-500">checklist items</div>
                    <div className="text-[10px] text-gray-400 mt-1">{t.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick start for field */}
            <div>
              <h2 className="text-xl font-bold mb-4">Field Quick Start</h2>
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                {[
                  'Open MicroGRID on your phone browser (microgrid-crm.vercel.app)',
                  'Log in with Google — your crew schedule loads automatically',
                  'Tap today\'s job to see customer info, address, and equipment',
                  'Tap address for Google Maps directions, tap phone to call',
                  'After the job: complete the checklist, add notes, mark done',
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-3 py-2">
                    <div className="w-6 h-6 rounded-full bg-blue-700 flex items-center justify-center flex-shrink-0 text-xs font-bold">{i + 1}</div>
                    <span className="text-sm text-gray-300 pt-0.5">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ SALES ═══ */}
        {tab === 'sales' && (
          <div className="space-y-12">
            {/* Commission pipeline */}
            <div>
              <h2 className="text-xl font-bold mb-4">Your Commission Pipeline</h2>
              <div className="relative">
                <div className="absolute top-1/2 left-0 right-0 h-0.5 animate-flow" style={{ marginTop: '-1px' }} />
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-2 relative z-10">
                {[
                  { step: 'Contract Signed', desc: 'Deal enters pipeline', color: '#3b82f6', icon: '📝' },
                  { step: 'NTP Approved', desc: 'Notice to proceed', color: '#8b5cf6', icon: '✅' },
                  { step: 'Design & Permit', desc: 'Engineering + AHJ', color: '#f59e0b', icon: '📐' },
                  { step: 'Install Complete', desc: 'System on the roof', color: '#f97316', icon: '🔨' },
                  { step: 'Inspection Passed', desc: 'City/utility approval', color: '#06b6d4', icon: '🔍' },
                  { step: 'PTO Received', desc: 'Permission to operate', color: '#22c55e', icon: '⚡' },
                  { step: 'Commission Paid', desc: 'Rep gets paid', color: '#1D9E75', icon: '💰' },
                ].map((s, i) => (
                  <div key={s.step} className="flex items-center flex-shrink-0">
                    <div className="rounded-xl px-4 py-4 text-center min-w-[120px] border" style={{ backgroundColor: `${s.color}10`, borderColor: `${s.color}40` }}>
                      <div className="text-xl mb-1">{s.icon}</div>
                      <div className="text-[10px] font-bold" style={{ color: s.color }}>{s.step}</div>
                      <div className="text-[9px] text-gray-500 mt-0.5">{s.desc}</div>
                    </div>
                    {i < 6 && <span className="mx-1 text-gray-600">→</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* What happens after you submit */}
            <div>
              <h2 className="text-xl font-bold mb-2">What Happens After You Close</h2>
              <p className="text-sm text-gray-500 mb-4">You close the sale — here's how your deal moves toward your paycheck. Every step is tracked so you always know where it stands.</p>
              <div className="space-y-2">
                {[
                  { step: 1, who: 'Your Deal', action: 'Contract enters the pipeline. Your commission is calculated and tracked from this moment.', color: '#3b82f6' },
                  { step: 2, who: 'Survey', action: 'Site survey gets scheduled. The faster this happens, the faster you get paid.', color: '#1D9E75' },
                  { step: 3, who: 'Design', action: 'Engineering designs the system and gets stamps. Any change orders are tracked so you know if the deal changes.', color: '#8b5cf6' },
                  { step: 4, who: 'Approved', action: 'Notice to Proceed approved. Your deal is greenlit for installation.', color: '#22c55e' },
                  { step: 5, who: 'Permits', action: 'Permits submitted. This is the waiting game — the system tracks every deadline and follows up automatically.', color: '#f59e0b' },
                  { step: 6, who: 'Install', action: 'Crew installs the system. When complete, your first commission payment is triggered automatically.', color: '#f97316' },
                  { step: 7, who: 'Paid', action: 'Inspections pass, system goes live, final funding hits. Your full commission is paid out. Check your Earnings Dashboard anytime.', color: '#1D9E75' },
                ].map(s => (
                  <div key={s.step} className={`flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3 border border-gray-700 animate-slide animate-slide-${s.step}`}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold" style={{ backgroundColor: `${s.color}20`, color: s.color, boxShadow: `0 0 12px ${s.color}20` }}>{s.step}</div>
                    <div className="flex-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded mr-2" style={{ backgroundColor: `${s.color}20`, color: s.color }}>{s.who}</span>
                      <span className="text-xs text-gray-300">{s.action}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* How you get paid */}
            <div>
              <h2 className="text-xl font-bold mb-4">How You Get Paid</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <h3 className="text-sm font-bold text-green-400 mb-3">Your Sales Toolkit</h3>
                  <div className="space-y-3">
                    {[
                      { icon: '📋', label: 'Spark Proposal Tool', desc: 'AI roof design + instant pricing' },
                      { icon: '📊', label: 'Earnings Dashboard', desc: 'Track commissions on every deal' },
                      { icon: '🏆', label: 'Leaderboard', desc: 'See where you rank vs the team' },
                      { icon: '📍', label: 'Project Map', desc: 'Visualize your pipeline by location' },
                      { icon: '🎓', label: 'Training Hub', desc: '30-day onboarding + product knowledge' },
                    ].map(t => (
                      <div key={t.label} className="flex items-center gap-3">
                        <span className="text-lg">{t.icon}</span>
                        <div>
                          <div className="text-xs font-medium text-white">{t.label}</div>
                          <div className="text-[10px] text-gray-500">{t.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <h3 className="text-sm font-bold text-amber-400 mb-3">How Your Deal Tracks</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'Deal Submitted', icon: '📝', desc: 'Commission calculated instantly' },
                      { label: 'Install Complete', icon: '🔨', desc: 'First payment triggered' },
                      { label: 'System Live', icon: '⚡', desc: 'Final payment processed' },
                      { label: 'Earnings Dashboard', icon: '📊', desc: 'Track every dollar, every deal' },
                    ].map(t => (
                      <div key={t.label} className="flex items-center gap-3">
                        <span className="text-xl">{t.icon}</span>
                        <div>
                          <div className="text-xs font-medium text-white">{t.label}</div>
                          <div className="text-[10px] text-gray-500">{t.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-700 text-[10px] text-gray-500">
                    Your pay scale is in your profile · Talk to your manager about tier upgrades
                  </div>
                </div>
              </div>
            </div>

            {/* Rep tools */}
            <div>
              <h2 className="text-xl font-bold mb-4">Your Tools</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { name: 'Commission Calculator', desc: 'Enter system size + adders → see your payout breakdown by role', color: '#1D9E75', href: '/commissions' },
                  { name: 'Earnings Dashboard', desc: 'YTD earnings, deal history, pending vs paid commissions', color: '#3b82f6', href: '/commissions' },
                  { name: 'Leaderboard', desc: 'Team rankings by commission, deals, kW sold with period filters', color: '#f59e0b', href: '/commissions' },
                  { name: 'Onboarding Tracker', desc: 'License, W-9, ICA, background check status all in one place', color: '#8b5cf6', href: '/sales' },
                  { name: 'Spark Proposals', desc: 'Create customer proposals with roof design, pricing, and e-signature', color: '#ec4899', href: 'https://spark-portal.vercel.app' },
                  { name: 'Rep Scorecard', desc: 'Deals, total earned, paid, pending, average per deal', color: '#06b6d4', href: '/sales' },
                ].map(t => (
                  <a key={t.name} href={t.href} className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-opacity-100 transition-colors block" style={{ borderColor: `${t.color}30` }}>
                    <h3 className="text-xs font-bold" style={{ color: t.color }}>{t.name} →</h3>
                    <p className="text-[10px] text-gray-400 mt-1">{t.desc}</p>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ CUSTOMER JOURNEY ═══ */}
        {tab === 'journey' && (
          <div className="space-y-12">
            {/* Hero */}
            <div className="text-center py-4">
              <h2 className="text-2xl font-bold">The Homeowner Experience</h2>
              <p className="text-sm text-gray-500 mt-1">From contract signing to powering their home — here's what the customer experiences at every step.</p>
            </div>

            {/* Timeline */}
            <div className="relative">
              <div className="absolute left-8 top-0 bottom-0 w-1 rounded-full hidden md:block" style={{ background: 'linear-gradient(to bottom, #3b82f6, #8b5cf6, #ec4899, #f59e0b, #f97316, #06b6d4, #22c55e)' }} />
              {[
                { stage: 'Contract Signed', days: 'Day 0', customer: 'Signs proposal via Spark. Chooses financing. Picks equipment package.', ops: 'Project created automatically. Drive folder generated. Welcome call scheduled.', color: '#3b82f6', icon: '📝' },
                { stage: 'Site Survey', days: 'Day 3-5', customer: 'Crew visits home. Takes measurements and photos. Checks electrical panel.', ops: 'Survey data uploaded. Engineering design initiated. HOA check if applicable.', color: '#8b5cf6', icon: '📐' },
                { stage: 'Design & Engineering', days: 'Day 5-15', customer: 'Receives system design for approval. Reviews panel layout and equipment.', ops: 'String sizing, structural analysis, planset generation. Stamps applied.', color: '#ec4899', icon: '📋' },
                { stage: 'Permitting', days: 'Day 15-45', customer: 'Waits for city/county approval. May need HOA sign-off.', ops: 'Permit submitted to AHJ. Utility interconnection filed. NTP processed. This is often the longest wait.', color: '#f59e0b', icon: '🏛️' },
                { stage: 'Installation', days: 'Day 45-55', customer: 'Crew arrives. Panels go on the roof. Inverter and battery installed. 1-2 day process.', ops: 'Equipment delivered from warehouse. Crew scheduled via ramp planner. Quality checklist completed.', color: '#f97316', icon: '🔨' },
                { stage: 'Inspection', days: 'Day 55-70', customer: 'City inspector visits. Utility inspection scheduled. Customer does not need to be home for most.', ops: 'Inspections scheduled and tracked. Any failures create tickets. Re-inspection if needed.', color: '#06b6d4', icon: '🔍' },
                { stage: 'PTO & In Service', days: 'Day 70-90', customer: 'System turned on! Monitoring activated. Customer sees solar production on their app.', ops: 'PTO received from utility. Monitoring configured. M3 funding triggered. Project complete.', color: '#22c55e', icon: '⚡' },
              ].map((s, i) => (
                <div key={s.stage} className="relative pl-0 md:pl-20 pb-8">
                  <div className="hidden md:flex absolute left-5 top-2 w-7 h-7 rounded-full items-center justify-center text-sm border-2 border-gray-950" style={{ backgroundColor: s.color }}>{s.icon}</div>
                  <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 ml-0">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="md:hidden text-xl">{s.icon}</span>
                      <h3 className="text-base font-bold" style={{ color: s.color }}>{s.stage}</h3>
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{s.days}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">What the Customer Sees</div>
                        <p className="text-xs text-gray-300">{s.customer}</p>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">What Happens Behind the Scenes</div>
                        <p className="text-xs text-gray-400">{s.ops}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Where delays happen */}
            <div>
              <h2 className="text-xl font-bold mb-4">Where Delays Happen & How We Prevent Them</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { blocker: 'Permit rejection', stage: 'Permitting', fix: 'AHJ database with 1,633 records — portal URLs, requirements, and notes from past submissions. Tickets auto-created on rejection.', color: '#f59e0b' },
                  { blocker: 'Equipment not delivered', stage: 'Installation', fix: 'Purchase order tracking with vendor performance metrics. Delivery accuracy tracking. Auto-alerts on delays.', color: '#f97316' },
                  { blocker: 'Failed inspection', stage: 'Inspection', fix: 'Ticket auto-created with SLA timer. Re-inspection scheduled. Blocker auto-set on project.', color: '#06b6d4' },
                  { blocker: 'Utility PTO delay', stage: 'PTO', fix: 'Utility tracking with application numbers. Follow-up reminders. Escalation to utility rep.', color: '#22c55e' },
                  { blocker: 'HOA not approved', stage: 'Design', fix: 'HOA database with contacts. Auto-tracked in task system. Follow-up dates with notifications.', color: '#ec4899' },
                  { blocker: 'Customer unreachable', stage: 'Any', fix: 'Follow-up dates surface on Command Center. Overdue notifications in bell. PM sees it every morning.', color: '#ef4444' },
                ].map(b => (
                  <div key={b.blocker} className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: `${b.color}20`, color: b.color }}>{b.stage}</span>
                      <span className="text-xs font-bold text-white">{b.blocker}</span>
                    </div>
                    <p className="text-[10px] text-gray-400">{b.fix}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* The numbers */}
            <div>
              <h2 className="text-xl font-bold mb-4">By the Numbers</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { value: '~90', unit: 'days', label: 'Avg Sale to In-Service', color: '#1D9E75', pct: 100 },
                  { value: '~55', unit: 'days', label: 'Avg Sale to Install', color: '#3b82f6', pct: 61 },
                  { value: '7', unit: 'stages', label: 'Automated Pipeline', color: '#f59e0b', pct: 100 },
                  { value: '30+', unit: 'tasks', label: 'Per Project Tracked', color: '#8b5cf6', pct: 100 },
                ].map(n => (
                  <div key={n.label} className="bg-gray-800 rounded-xl p-6 text-center border border-gray-700 relative overflow-hidden">
                    <svg className="ring-chart w-20 h-20 mx-auto mb-2" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="45" fill="none" stroke="#1f2937" strokeWidth="6" />
                      <circle cx="50" cy="50" r="45" fill="none" stroke={n.color} strokeWidth="6" strokeLinecap="round"
                        strokeDasharray="283" strokeDashoffset={283 - (283 * n.pct / 100)}
                        className="animate-grow" style={{ animationDuration: '1.5s' }} />
                    </svg>
                    <div className="text-3xl font-black" style={{ color: n.color }}>{n.value}</div>
                    <div className="text-xs text-gray-400">{n.unit}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{n.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ TECHNICAL ═══ */}
        {tab === 'technical' && (
          <div className="space-y-12">
            {/* Architecture — layered bands */}
            <div>
              <h2 className="text-xl font-bold mb-4">Architecture</h2>
              <div className="space-y-1">
                {[
                  { layer: 'Browser', color: '#3b82f6', items: ['Next.js 16 App Router', 'React 19', 'TypeScript (strict)', 'Tailwind CSS v4', 'Leaflet Maps'] },
                  { layer: 'API Layer', color: '#1D9E75', items: ['16 API modules', '200+ functions', 'lib/api/ centralized', 'Typed requests', '.limit() on all queries'] },
                  { layer: 'Database', color: '#f59e0b', items: ['Supabase (PostgreSQL)', '45+ tables', 'Row-Level Security', 'Org-scoped access', 'Realtime subscriptions'] },
                  { layer: 'Infrastructure', color: '#8b5cf6', items: ['Vercel (auto-deploy)', 'Sentry (errors)', 'Resend (email)', 'Google Calendar sync', 'HMAC webhooks'] },
                ].map(l => (
                  <div key={l.layer} className="rounded-lg px-5 py-4 flex items-center gap-4 animate-pulse-glow" style={{ backgroundColor: `${l.color}08`, borderLeft: `4px solid ${l.color}`, boxShadow: `inset 0 0 40px ${l.color}05` }}>
                    <div className="w-28 flex-shrink-0">
                      <span className="text-xs font-bold" style={{ color: l.color }}>{l.layer}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {l.items.map(item => (
                        <span key={item} className="text-[10px] px-2 py-0.5 rounded border" style={{ borderColor: `${l.color}40`, color: l.color }}>{item}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Data flow */}
            <div>
              <h2 className="text-xl font-bold mb-4">Data Flow</h2>
              <div className="flex items-center gap-2 overflow-x-auto pb-2 justify-center">
                {[
                  { name: 'Project', color: '#1D9E75' },
                  { name: 'Tasks', color: '#3b82f6' },
                  { name: 'Notes', color: '#8b5cf6' },
                  { name: 'Schedule', color: '#f59e0b' },
                  { name: 'Funding', color: '#22c55e' },
                  { name: 'Tickets', color: '#ec4899' },
                ].map((n, i) => (
                  <div key={n.name} className="flex items-center flex-shrink-0">
                    <div className="rounded-lg px-4 py-3 text-center border" style={{ backgroundColor: `${n.color}10`, borderColor: `${n.color}40` }}>
                      <div className="text-xs font-bold" style={{ color: n.color }}>{n.name}</div>
                    </div>
                    {i < 5 && <span className="mx-1 text-gray-600">→</span>}
                  </div>
                ))}
              </div>
              <p className="text-center text-[10px] text-gray-600 mt-2">Every entity links back to the project. All changes logged to audit_log with timestamp and author.</p>
            </div>

            {/* Live stats */}
            <div>
              <h2 className="text-xl font-bold mb-4">Live Database Stats</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Active Projects', value: stats.totalProjects },
                  { label: 'Legacy Projects', value: 14705 },
                  { label: 'Notes', value: stats.noteCount },
                  { label: 'Tickets', value: stats.ticketCount },
                  { label: 'Active Users', value: stats.userCount },
                  { label: 'Active Crews', value: stats.crewCount },
                  { label: 'AHJ Records', value: stats.ahjCount },
                  { label: 'Equipment Items', value: stats.equipmentCount },
                  { label: 'Migrations', value: 66 },
                  { label: 'API Modules', value: 16 },
                ].map(s => (
                  <div key={s.label} className="bg-gray-800 rounded-lg p-3 text-center border border-gray-700">
                    <div className="text-xl font-bold text-green-400">{s.value.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Testing + Security side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h2 className="text-xl font-bold mb-4">Testing</h2>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-2">
                  {[
                    ['Framework', 'Vitest + React Testing Library'],
                    ['Test Files', '74'],
                    ['Total Tests', '2,506 (2,504 passed)'],
                    ['Pre-commit', 'Tests must pass before push'],
                    ['Protocol', 'Build → Test → Audit R1 → Fix → Audit R2'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs"><span className="text-gray-400">{k}</span><span className="text-white">{v}</span></div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold mb-4">Security</h2>
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-2">
                  {[
                    ['Auth', 'Google OAuth (domain-restricted)'],
                    ['Database RLS', 'Org-scoped on 30+ tables'],
                    ['Route Protection', 'Server-side proxy + role hierarchy'],
                    ['Roles', 'super_admin → admin → finance → manager → user → sales'],
                    ['Webhooks', 'HMAC-SHA256 signed'],
                    ['Sanitization', 'escapeIlike + HTML escape'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs"><span className="text-gray-400">{k}</span><span className="text-white">{v}</span></div>
                  ))}
                </div>
              </div>
            </div>

            {/* Code quality bar */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
                <div><div className="text-2xl font-bold text-green-400">9.5/10</div><div className="text-[10px] text-gray-400">Quality Rating</div></div>
                <div><div className="text-2xl font-bold text-green-400">10</div><div className="text-[10px] text-gray-400">`as any` casts left</div></div>
                <div><div className="text-2xl font-bold text-green-400">200+</div><div className="text-[10px] text-gray-400">API Functions</div></div>
                <div><div className="text-2xl font-bold text-green-400">50+</div><div className="text-[10px] text-gray-400">Pages / Routes</div></div>
              </div>
            </div>
          </div>
        )}

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
