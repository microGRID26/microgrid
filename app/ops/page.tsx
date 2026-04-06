'use client'

import { useState, useEffect, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { db } from '@/lib/db'
import { handleApiError } from '@/lib/errors'
import { fmt$, fmtDate, cn } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { loadProjectById } from '@/lib/api'
import type { Project } from '@/types/database'
import { X } from 'lucide-react'

const KWH_PER_KW_YEAR = 1400
const BATTERY_KWH = 80

type Period = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_qtr' | 'last_qtr' | 'this_year' | 'last_year'

function getPeriodRange(period: Period): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const iso = (dt: Date) => dt.toISOString().slice(0, 10)
  const today = iso(now)
  switch (period) {
    case 'today': return { start: today, end: today }
    case 'yesterday': { const y2 = new Date(y, m, d - 1); return { start: iso(y2), end: iso(y2) } }
    case 'this_week': { const dow = now.getDay(); const mon = new Date(y, m, d - (dow === 0 ? 6 : dow - 1)); return { start: iso(mon), end: today } }
    case 'last_week': { const dow = now.getDay(); const mon = new Date(y, m, d - (dow === 0 ? 6 : dow - 1) - 7); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); return { start: iso(mon), end: iso(sun) } }
    case 'this_month': return { start: `${y}-${String(m + 1).padStart(2, '0')}-01`, end: today }
    case 'last_month': { const lm = new Date(y, m - 1, 1); const end2 = new Date(y, m, 0); return { start: iso(lm), end: iso(end2) } }
    case 'this_qtr': { const qm = Math.floor(m / 3) * 3; return { start: `${y}-${String(qm + 1).padStart(2, '0')}-01`, end: today } }
    case 'last_qtr': { const qm = Math.floor(m / 3) * 3 - 3; const qy = qm < 0 ? y - 1 : y; const qmAdj = qm < 0 ? qm + 12 : qm; const end2 = new Date(qy, qmAdj + 3, 0); return { start: `${qy}-${String(qmAdj + 1).padStart(2, '0')}-01`, end: iso(end2) } }
    case 'this_year': return { start: `${y}-01-01`, end: today }
    case 'last_year': return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` }
    default: return { start: today, end: today }
  }
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' }, { key: 'last_week', label: 'Last Week' },
  { key: 'this_month', label: 'This Month' }, { key: 'last_month', label: 'Last Month' },
  { key: 'this_qtr', label: 'This Qtr' }, { key: 'last_qtr', label: 'Last Qtr' },
  { key: 'this_year', label: 'This Year' }, { key: 'last_year', label: 'Last Year' },
]

interface OpsProject {
  id: string; name: string; stage: string; disposition: string | null
  sale_date: string | null; install_complete_date: string | null; pto_date: string | null
  contract: number | null; systemkw: number | null; financier: string | null
  utility: string | null; ahj: string | null; city: string | null; pm: string | null
  consultant: string | null; blocker: string | null; battery: string | null
  energy_community: boolean | null; module: string | null; module_qty: number | null
  dealer: string | null
}

// Drill-down filter
interface DrillFilter {
  label: string
  fn: (p: OpsProject) => boolean
}

const isTestProject = (p: OpsProject) => {
  const name = p.name?.toLowerCase() ?? ''
  return name.startsWith('test') ||
    name.includes('test ') ||
    name.includes(' test') ||
    p.id?.startsWith('PROJ-TEST') ||
    p.dealer?.toLowerCase() === 'microgrid' ||
    p.consultant?.toLowerCase() === 'superman'
}

const sum = (arr: OpsProject[], fn: (p: OpsProject) => number) => arr.reduce((s, p) => s + fn(p), 0)
const avg = (arr: OpsProject[], fn: (p: OpsProject) => number) => arr.length > 0 ? sum(arr, fn) / arr.length : 0
const countWith = (arr: OpsProject[], fn: (p: OpsProject) => boolean) => arr.filter(fn).length
const pct = (n: number, d: number) => d > 0 ? `${Math.round(n / d * 100)}%` : '0%'
const fmtN = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : Math.round(n).toLocaleString()

function avgDaysBetween(arr: OpsProject[], from: (p: OpsProject) => string | null, to: (p: OpsProject) => string | null) {
  const valid = arr.filter(p => from(p) && to(p)).map(p => {
    return Math.round((new Date(to(p)!).getTime() - new Date(from(p)!).getTime()) / 86400000)
  }).filter(d => d >= 0 && d < 365)
  return valid.length > 0 ? Math.round(valid.reduce((s, d) => s + d, 0) / valid.length) : 0
}

export function OpsTabContent() { return <OpsContent embedded /> }
export default function OpsPage() { return <OpsContent embedded={false} /> }

function OpsContent({ embedded }: { embedded: boolean }) {
  const { user, loading: authLoading } = useCurrentUser()
  const isManager = user?.isManager ?? false
  const { orgId } = useOrg()
  const [activeProjects, setActiveProjects] = useState<OpsProject[]>([])
  const [legacyProjects, setLegacyProjects] = useState<OpsProject[]>([])
  const [legacyLoaded, setLegacyLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('this_month')
  const [panelProject, setPanelProject] = useState<Project | null>(null)
  const [drill, setDrill] = useState<DrillFilter | null>(null)
  const [displayNames, setDisplayNames] = useState<Map<string, string>>(new Map())

  // Merge active + legacy only when legacy is needed (historical periods)
  const needsLegacy = period === 'last_year' || period === 'last_qtr'
  const projects = useMemo(() => {
    if (!needsLegacy || !legacyLoaded) return activeProjects
    return [...activeProjects, ...legacyProjects]
  }, [activeProjects, legacyProjects, needsLegacy, legacyLoaded])

  // Load active projects once
  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = db().from('projects')
        .select('id, name, stage, disposition, sale_date, install_complete_date, pto_date, contract, systemkw, financier, utility, ahj, city, pm, consultant, blocker, battery, energy_community, module, module_qty, dealer')
        .limit(5000)
      if (orgId) q = q.eq('org_id', orgId)
      const { data } = await q
      setActiveProjects(((data ?? []) as OpsProject[]).filter(p => !isTestProject(p)))
      setLoading(false)
    }
    load()
    // Load display_name maps for utility and AHJ short labels
    Promise.all([
      db().from('utilities').select('name, display_name').limit(500),
      db().from('ahjs').select('name, display_name').limit(2000),
    ]).then(([utilRes, ahjRes]) => {
      const map = new Map<string, string>()
      type NameDisplay = { name: string; display_name: string | null }
      for (const u of (utilRes.data ?? []) as NameDisplay[]) { if (u.display_name) map.set(u.name, u.display_name) }
      for (const a of (ahjRes.data ?? []) as NameDisplay[]) { if (a.display_name) map.set(a.name, a.display_name) }
      setDisplayNames(map)
    }).catch(err => handleApiError(err, '[ops] display_name load'))
  }, [orgId])

  // Lazy-load legacy projects only when a historical period is selected
  useEffect(() => {
    if (!needsLegacy || legacyLoaded) return
    async function loadLegacy() {
      const { data } = await db().from('legacy_projects')
        .select('id, name, sale_date, install_date, pto_date, contract, systemkw, financier, utility, ahj, city, pm, consultant, battery, module, module_qty, dealer, disposition')
        .limit(15000)
      const activeIds = new Set(activeProjects.map(p => p.id))
      const mapped = ((data ?? []) as Array<Record<string, unknown> & { id: string; install_date?: string | null }>)
        .filter(p => !activeIds.has(p.id) && !isTestProject(p as unknown as OpsProject))
        .map(p => ({
          ...p,
          stage: 'complete',
          install_complete_date: p.install_date ?? null,
          blocker: null,
          energy_community: false,
        } as OpsProject))
      setLegacyProjects(mapped)
      setLegacyLoaded(true)
    }
    loadLegacy()
  }, [needsLegacy, legacyLoaded, activeProjects])

  const { start, end } = getPeriodRange(period)

  const sold = useMemo(() => projects.filter(p =>
    p.sale_date && p.sale_date >= start && p.sale_date <= end &&
    p.disposition !== 'Cancelled' && p.disposition !== 'In Service' && p.disposition !== 'Loyalty'
  ), [projects, start, end])

  const scheduled = useMemo(() => projects.filter(p =>
    (p.stage === 'install' || p.stage === 'inspection' || p.stage === 'complete') &&
    p.disposition !== 'Cancelled' && p.disposition !== 'In Service' && p.disposition !== 'Loyalty'
  ), [projects])

  const installed = useMemo(() => projects.filter(p =>
    p.install_complete_date && p.install_complete_date >= start && p.install_complete_date <= end
  ), [projects, start, end])

  const cancelled = useMemo(() => projects.filter(p =>
    p.disposition === 'Cancelled' && p.sale_date && p.sale_date >= start && p.sale_date <= end
  ), [projects, start, end])

  // Drill-down: filter the project list
  const drillProjects = useMemo(() => {
    if (!drill) return sold
    return projects.filter(drill.fn)
  }, [drill, sold, projects])

  const openProject = async (id: string) => { const p = await loadProjectById(id); if (p) setPanelProject(p) }
  const setDrillDown = (label: string, fn: (p: OpsProject) => boolean) => {
    setDrill({ label, fn })
    // Auto-scroll to project list
    setTimeout(() => document.getElementById('ops-project-list')?.scrollIntoView({ behavior: 'smooth' }), 100)
  }
  const clearDrill = () => setDrill(null)

  if (!embedded && authLoading) return <div className="min-h-screen bg-gray-900"><Nav active="Ops" /></div>
  if (!embedded && !isManager) return <div className="min-h-screen bg-gray-900"><Nav active="Ops" /><div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Not authorized.</div></div>

  // Clickable metric cell
  const Cell = ({ v, l, color, onClick }: { v: string | number; l: string; color?: string; onClick?: () => void }) => (
    <div className={cn('bg-gray-800 px-2 py-2 text-center', onClick && 'cursor-pointer hover:bg-gray-700 transition-colors')} onClick={onClick}>
      <div className={cn('text-sm md:text-base font-bold', color ?? 'text-white')}>{v}</div>
      <div className="text-[9px] text-gray-500 leading-tight">{l}</div>
    </div>
  )

  const MetricRow = ({ label, data: arr, color, borderColor, category }: { label: string; data: OpsProject[]; color: string; borderColor: string; category: string }) => {
    const totalKw = sum(arr, p => Number(p.systemkw) || 0)
    const batteryCount = countWith(arr, p => !!p.battery)
    const batteryKwh = batteryCount * BATTERY_KWH
    const estProd = Math.round(totalKw * KWH_PER_KW_YEAR)
    const totalVal = sum(arr, p => Number(p.contract) || 0)

    return (
      <div className="rounded-lg overflow-hidden" style={{ border: `2px solid ${borderColor}` }}>
        <div className="px-3 py-1.5" style={{ backgroundColor: borderColor + '20' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: borderColor }}>{label}</span>
        </div>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-px bg-gray-700">
          <Cell v={arr.length} l={`Total ${label}`} color={color}
            onClick={() => setDrillDown(`All ${category}`, p => arr.some(a => a.id === p.id))} />
          <Cell v={batteryCount} l="Batteries"
            onClick={() => setDrillDown(`${category} w/ Battery`, p => arr.some(a => a.id === p.id) && !!p.battery)} />
          <Cell v={fmtN(estProd)} l="Est Annual Prod"
            onClick={() => setDrillDown(`All ${category}`, p => arr.some(a => a.id === p.id))} />
          <Cell v={`${Math.round(totalKw)}`} l="PV kW"
            onClick={() => setDrillDown(`All ${category}`, p => arr.some(a => a.id === p.id))} />
          <Cell v={batteryKwh.toLocaleString()} l="Battery kWh"
            onClick={() => setDrillDown(`${category} w/ Battery`, p => arr.some(a => a.id === p.id) && !!p.battery)} />
          <Cell v={fmt$(totalVal)} l="Total Value" color="text-green-400"
            onClick={() => setDrillDown(`All ${category}`, p => arr.some(a => a.id === p.id))} />
          <Cell v={fmt$(Math.round(avg(arr, p => Number(p.contract) || 0)))} l="Avg Value"
            onClick={() => setDrillDown(`All ${category}`, p => arr.some(a => a.id === p.id))} />
          <Cell v={`${Math.round(avg(arr, p => Number(p.systemkw) || 0))}`} l="Avg kW"
            onClick={() => setDrillDown(`All ${category}`, p => arr.some(a => a.id === p.id))} />
        </div>
      </div>
    )
  }

  const BreakdownTable = ({ title, field, nameMap }: { title: string; field: keyof OpsProject; nameMap?: Map<string, string> }) => {
    const groups: Record<string, { sale: number; sch: number; ins: number; cncl: number; projects: OpsProject[] }> = {}
    for (const p of projects) {
      const raw = p[field]
      const key = raw === true ? 'Yes' : raw === false ? 'No' : String(raw ?? 'Unknown')
      if (!groups[key]) groups[key] = { sale: 0, sch: 0, ins: 0, cncl: 0, projects: [] }
      groups[key].projects.push(p)
      if (sold.includes(p)) groups[key].sale++
      if (scheduled.includes(p)) groups[key].sch++
      if (installed.includes(p)) groups[key].ins++
      if (cancelled.includes(p)) groups[key].cncl++
    }
    const rows = Object.entries(groups).filter(([, v]) => v.sale + v.sch + v.ins + v.cncl > 0).sort((a, b) => b[1].sale - a[1].sale)
    const totals = rows.reduce((t, [, v]) => ({ sale: t.sale + v.sale, sch: t.sch + v.sch, ins: t.ins + v.ins, cncl: t.cncl + v.cncl }), { sale: 0, sch: 0, ins: 0, cncl: 0 })

    return (
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-700">
          <span className="text-[10px] font-bold uppercase text-gray-400">{title}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left px-2 py-1 font-medium">{title}</th>
                <th className="text-right px-1 py-1 font-medium">Sale</th>
                <th className="text-right px-1 py-1 font-medium">%</th>
                <th className="text-right px-1 py-1 font-medium">Sch</th>
                <th className="text-right px-1 py-1 font-medium">%</th>
                <th className="text-right px-1 py-1 font-medium">Ins</th>
                <th className="text-right px-1 py-1 font-medium">%</th>
                <th className="text-right px-1 py-1 font-medium text-red-400">Cn</th>
                <th className="text-right px-1 py-1 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map(([name, v]) => (
                <tr key={name} className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer"
                  onClick={() => setDrillDown(`${title}: ${name}`, p => {
                    const raw = p[field]
                    const val = raw === true ? 'Yes' : raw === false ? 'No' : String(raw ?? 'Unknown')
                    return val === name
                  })}>
                  <td className="px-2 py-1 text-gray-300 truncate max-w-28">{nameMap?.get(name) ?? name}</td>
                  <td className="text-right px-1 py-1 text-white">{v.sale || ''}</td>
                  <td className="text-right px-1 py-1 text-gray-500">{v.sale ? pct(v.sale, totals.sale) : ''}</td>
                  <td className="text-right px-1 py-1 text-white">{v.sch || ''}</td>
                  <td className="text-right px-1 py-1 text-gray-500">{v.sch ? pct(v.sch, totals.sch) : ''}</td>
                  <td className="text-right px-1 py-1 text-white">{v.ins || ''}</td>
                  <td className="text-right px-1 py-1 text-gray-500">{v.ins ? pct(v.ins, totals.ins) : ''}</td>
                  <td className="text-right px-1 py-1 text-red-400">{v.cncl || ''}</td>
                  <td className="text-right px-1 py-1 text-gray-500">{v.cncl ? pct(v.cncl, totals.cncl) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-600 font-medium text-gray-300">
                <td className="px-2 py-1">Total</td>
                <td className="text-right px-1 py-1">{totals.sale}</td>
                <td className="text-right px-1 py-1 text-gray-500"></td>
                <td className="text-right px-1 py-1">{totals.sch}</td>
                <td className="text-right px-1 py-1 text-gray-500"></td>
                <td className="text-right px-1 py-1">{totals.ins}</td>
                <td className="text-right px-1 py-1 text-gray-500"></td>
                <td className="text-right px-1 py-1 text-red-400">{totals.cncl}</td>
                <td className="text-right px-1 py-1 text-gray-500"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  const saleToInstall = avgDaysBetween(installed, p => p.sale_date, p => p.install_complete_date)
  const saleToPTO = avgDaysBetween(projects.filter(p => p.pto_date), p => p.sale_date, p => p.pto_date)
  const installToPTO = avgDaysBetween(projects.filter(p => p.pto_date && p.install_complete_date), p => p.install_complete_date, p => p.pto_date)

  return (
    <div className={embedded ? 'text-white' : 'min-h-screen bg-gray-900 text-white'}>
      {!embedded && <Nav active="Analytics" />}
      <div className={embedded ? 'space-y-3' : 'max-w-[1600px] mx-auto px-3 md:px-4 py-3 space-y-3'}>

        <div className="flex items-center gap-1.5 flex-wrap">
          {!embedded && <h1 className="text-xs font-bold text-gray-400 mr-2">Operations</h1>}
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => { setPeriod(p.key); clearDrill() }}
              className={cn('px-2.5 py-1 rounded text-[11px] font-medium transition-colors',
                period === p.key ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white')}>
              {p.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-500">Loading...</div>
        ) : (
          <>
            <MetricRow label="Sold" data={sold} color="text-yellow-400" borderColor="#eab308" category="Sold" />
            <MetricRow label="Scheduled" data={scheduled} color="text-teal-400" borderColor="#14b8a6" category="Scheduled" />
            <MetricRow label="Installed" data={installed} color="text-green-400" borderColor="#22c55e" category="Installed" />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <BreakdownTable title="City" field="city" />
              <BreakdownTable title="Utility" field="utility" nameMap={displayNames} />
              <BreakdownTable title="Energy Community" field={'energy_community' as keyof OpsProject} />

              <div className="bg-gray-800 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-700">
                  <span className="text-[10px] font-bold uppercase text-gray-400">By Consultant</span>
                </div>
                <div className="overflow-y-auto max-h-52 p-2 space-y-1">
                  {(() => {
                    const groups: Record<string, number> = {}
                    for (const p of sold) { const k = p.consultant ?? 'Unknown'; groups[k] = (groups[k] ?? 0) + 1 }
                    return Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => (
                      <div key={name} className="flex justify-between text-[10px] cursor-pointer hover:bg-gray-700/30 px-1 rounded"
                        onClick={() => setDrillDown(`Consultant: ${name}`, p => (p.consultant ?? 'Unknown') === name && sold.some(s => s.id === p.id))}>
                        <span className="text-gray-300 truncate mr-2">{name}</span>
                        <span className="text-white font-medium flex-shrink-0">{count}</span>
                      </div>
                    ))
                  })()}
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-[10px] font-bold uppercase text-gray-400 mb-2">Key Metrics</div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center cursor-pointer hover:bg-gray-700/30 px-1 rounded"
                    onClick={() => setDrillDown('Cancelled', p => cancelled.some(c => c.id === p.id))}>
                    <span className="text-[11px] text-gray-400">Cancels</span>
                    <span className="text-xl font-bold text-red-400">{cancelled.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-400">Cancel %</span>
                    <span className="text-xl font-bold text-red-400">{pct(cancelled.length, sold.length + cancelled.length)}</span>
                  </div>
                  <div className="border-t border-gray-700 pt-2 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-gray-400">Sale to EIC</span>
                      <span className="text-lg font-bold">{saleToInstall}d</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-gray-400">Sale to PTO</span>
                      <span className="text-lg font-bold">{saleToPTO}d</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-gray-400">EIC to PTO</span>
                      <span className="text-lg font-bold">{installToPTO}d</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Drill-down indicator */}
            {drill && (
              <div className="flex items-center gap-2 bg-green-900/30 border border-green-800 rounded-lg px-3 py-2">
                <span className="text-xs text-green-400 font-medium">Showing: {drill.label}</span>
                <span className="text-xs text-gray-500">({drillProjects.length} projects)</span>
                <button onClick={clearDrill} className="ml-auto text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
            )}

            {/* Project list */}
            <div id="ops-project-list" className="bg-gray-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase text-gray-400">
                  {drill ? drill.label : 'Sales in Period'} ({drillProjects.length})
                </span>
                {drill && <button onClick={clearDrill} className="text-[10px] text-gray-500 hover:text-white">Clear filter</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-500">
                      {['ID', 'Name', 'Total Value', 'PV kW', 'EC', 'Dealer', 'Consultant', 'City', 'Financier', 'Sale Date', 'Install Date'].map(h => (
                        <th key={h} className="text-left px-2 py-1.5 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drillProjects.slice(0, 200).map(p => (
                      <tr key={p.id} className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer" onClick={() => openProject(p.id)}>
                        <td className="px-2 py-1.5 text-green-400 font-medium whitespace-nowrap">{p.id}</td>
                        <td className="px-2 py-1.5 text-white truncate max-w-32">{p.name}</td>
                        <td className="px-2 py-1.5">{fmt$(Number(p.contract) || 0)}</td>
                        <td className="px-2 py-1.5">{p.systemkw ?? '—'}</td>
                        <td className="px-2 py-1.5">{p.energy_community ? 'Yes' : 'No'}</td>
                        <td className="px-2 py-1.5 text-gray-400 truncate max-w-24">{p.dealer ?? '—'}</td>
                        <td className="px-2 py-1.5 text-gray-400 truncate max-w-24">{p.consultant ?? '—'}</td>
                        <td className="px-2 py-1.5 text-gray-400">{p.city ?? '—'}</td>
                        <td className="px-2 py-1.5 text-gray-400">{p.financier ?? '—'}</td>
                        <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{fmtDate(p.sale_date)}</td>
                        <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{fmtDate(p.install_complete_date)}</td>
                      </tr>
                    ))}
                    {drillProjects.length === 0 && (
                      <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-600">No projects match</td></tr>
                    )}
                  </tbody>
                  {drillProjects.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-gray-600 font-medium text-gray-300">
                        <td className="px-2 py-1.5">{drillProjects.length}</td>
                        <td className="px-2 py-1.5"></td>
                        <td className="px-2 py-1.5 text-green-400">{fmt$(sum(drillProjects, p => Number(p.contract) || 0))}</td>
                        <td className="px-2 py-1.5">{Math.round(sum(drillProjects, p => Number(p.systemkw) || 0))}</td>
                        <td colSpan={7} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {panelProject && (
        <ProjectPanel project={panelProject} onClose={() => setPanelProject(null)} onProjectUpdated={() => {}} />
      )}
    </div>
  )
}
