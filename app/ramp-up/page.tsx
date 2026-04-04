'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { fmtDate, fmt$, cn } from '@/lib/utils'
import { loadProjectById, loadActiveCrews, upsertTaskState, insertTaskHistory } from '@/lib/api'
import { db } from '@/lib/db'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'
import {
  haversineDistance, estimateDriveMinutes,
  computeReadinessScore, computePriorityScore, optimizeRoute, autoReadiness, clusterProjectsForCrews,
  tierFromScore,
  getMonday, getWeekLabel, getNextWeeks,
  loadRampConfig, loadAllReadiness, loadAllSchedule, loadScheduledProjectIds,
  scheduleProject, updateScheduleEntry, completeScheduleEntry, cancelScheduleEntry,
  upsertReadiness,
  RAMP_STATUS_COLORS,
} from '@/lib/api/ramp-planner'
import type { RampScheduleEntry, ProjectReadiness, RoutePoint, RampConfig } from '@/lib/api/ramp-planner'
import { Calendar, Zap, Truck, Target } from 'lucide-react'
import {
  InstructionalGuide,
  TierCards,
  ScoringLegend,
  WeekPlannerTab,
  ReadinessQueueTab,
  TimelineTab,
  stageMatchesActivity,
  TIER_COLOR_MAP,
  type RampProject,
  type ClusterNearbyProject,
  type Tier,
  type TierKey,
} from './components'

// ── Zip geocode cache ───────────────────────────────────────────────────────
const zipCache = new Map<string, [number, number]>()
async function geocodeZip(zip: string): Promise<[number, number] | null> {
  if (zipCache.has(zip)) return zipCache.get(zip)!
  try {
    const resp = await fetch(`https://api.zippopotam.us/us/${zip}`)
    if (!resp.ok) return null
    const data = await resp.json()
    const lat = parseFloat(data.places?.[0]?.latitude)
    const lng = parseFloat(data.places?.[0]?.longitude)
    if (isNaN(lat) || isNaN(lng)) return null
    zipCache.set(zip, [lat, lng])
    return [lat, lng]
  } catch { return null }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RampUpPage() {
  const { user, loading: authLoading } = useCurrentUser()
  const isManager = user?.isManager ?? false
  const { orgId } = useOrg()

  const [projects, setProjects] = useState<RampProject[]>([])
  const [schedule, setSchedule] = useState<RampScheduleEntry[]>([])
  const [scheduledIds, setScheduledIds] = useState<Set<string>>(new Set())
  const [config, setConfig] = useState<RampConfig | null>(null)
  const [loading, setLoading] = useState(true)
  // Ramp starts 5 weeks from now
  const rampStart = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 35) // 5 weeks
    return getMonday(d)
  }, [])
  const [selectedWeek, setSelectedWeek] = useState(rampStart)
  const [panelProject, setPanelProject] = useState<Project | null>(null)
  const [tab, setTab] = useState<'planner' | 'queue' | 'timeline'>('planner')
  // Proximity clustering state
  const [clusterFocusId, setClusterFocusId] = useState<string | null>(null)
  const [clusterRouteIds, setClusterRouteIds] = useState<Set<string>>(new Set())
  const [showClusterRoute, setShowClusterRoute] = useState(false)
  const [clusterJobFilter, setClusterJobFilter] = useState<string>('all')
  const [showGuide, setShowGuide] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('mg_rampup_guide_dismissed') !== 'true'
  })
  const [tierFilter, setTierFilter] = useState<Set<Tier>>(new Set())
  const [queueSearch, setQueueSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [financierFilter, setFinancierFilter] = useState('')
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'|'info'} | null>(null)

  // Load everything
  const loadAll = useCallback(async () => {
    setLoading(true)
    const [cfg, readinessMap, sched, schedIds] = await Promise.all([
      loadRampConfig(),
      loadAllReadiness(),
      loadAllSchedule(),
      loadScheduledProjectIds(),
    ])
    setConfig(cfg)
    setSchedule(sched)
    setScheduledIds(schedIds)

    // Load ALL active projects (every stage — if install_done is Complete, filtered below)
    let q = db().from('projects')
      .select('id, name, city, address, zip, ahj, stage, module, inverter, battery, systemkw, contract, pm, blocker, financier')
      .not('disposition', 'in', '("In Service","Loyalty","Cancelled")')
      .not('stage', 'eq', 'complete')
      .limit(2000)
    if (orgId) q = q.eq('org_id', orgId)
    const { data: rawProjects } = await q

    if (!rawProjects || !cfg) { setLoading(false); return }

    // Load task states to determine real readiness + filter out already-installed
    const { data: taskStates } = await db().from('task_state')
      .select('project_id, task_id, status')
      .in('task_id', ['install_done', 'sched_install', 'inventory', 'util_permit', 'city_permit', 'hoa', 'eng_approval', 'stamps', 'ntp', 'quote_ext_scope'])
      .limit(50000)
    const taskMap = new Map<string, Map<string, string>>()
    for (const t of (taskStates ?? []) as { project_id: string; task_id: string; status: string }[]) {
      if (!taskMap.has(t.project_id)) taskMap.set(t.project_id, new Map())
      taskMap.get(t.project_id)!.set(t.task_id, t.status)
    }

    // Load AHJ permit_required data
    const { data: ahjs } = await db().from('ahjs').select('name, permit_required').limit(2000)
    const ahjPermitMap = new Map<string, boolean>()
    for (const a of (ahjs ?? []) as { name: string; permit_required: boolean }[]) {
      ahjPermitMap.set(a.name, a.permit_required ?? true)
    }

    // Geocode all zips
    type RawProject = { id: string; name: string; city: string | null; address: string | null; zip: string | null; ahj: string | null; stage: string; module: string | null; inverter: string | null; battery: string | null; systemkw: number | null; contract: number | null; pm: string | null; blocker: string | null; financier: string | null }
    const projects = rawProjects as RawProject[]
    const zips = [...new Set(projects.map(p => p.zip).filter((z): z is string => !!z))]
    await Promise.all(zips.map(z => geocodeZip(z)))

    // Compute all fields
    const maxContract = Math.max(...projects.map(p => Number(p.contract) || 0), 1)
    const allMapped: RampProject[] = []

    // First pass: compute distances
    for (const p of projects) {
      // Skip projects where install is already complete
      const tasks = taskMap.get(p.id)
      if (tasks?.get('install_done') === 'Complete') continue

      const coords = p.zip ? zipCache.get(p.zip) : null
      const permitRequired = p.ahj ? ahjPermitMap.get(p.ahj) : undefined
      const dist = coords ? haversineDistance(cfg.warehouse_lat, cfg.warehouse_lng, coords[0], coords[1]) : 50 // Default 50mi if no coords

      // Build readiness from DB row OR auto-compute from project properties + task data
      const dbReadiness = readinessMap.get(p.id)
      const autoR = autoReadiness(p.ahj, p.module, p.inverter, p.battery, permitRequired)
      // Enhance auto-readiness with actual task completion data
      if (!dbReadiness && tasks) {
        if (tasks.get('ntp') === 'Complete') autoR.ntp_approved = true
        if (tasks.get('inventory') === 'Complete') autoR.equipment_ready = true
        if (tasks.get('util_permit') === 'Complete') autoR.utility_approved = true
        if (tasks.get('hoa') === 'Complete') autoR.hoa_approved = true
        // Extended scope: if status is anything other than 'Not Ready' or 'Complete', it's blocking
        const extScope = tasks.get('quote_ext_scope')
        if (extScope && extScope !== 'Not Ready' && extScope !== 'Complete') {
          autoR.ext_scope_clear = false
        }
        // Redesign is NEVER auto-checked — must be manually confirmed
        // Old TriSMART engineering/stamps don't count under MicroGRID
      }
      const readiness = (dbReadiness ?? autoR) as ProjectReadiness
      const readinessScore = computeReadinessScore(readiness)
      // Tier derived from readiness score
      const tier = tierFromScore(readinessScore, readiness)

      allMapped.push({
        ...p,
        tier,
        lat: coords ? coords[0] : 0,
        lng: coords ? coords[1] : 0,
        distanceMiles: Math.round(dist * 10) / 10,
        driveMinutes: estimateDriveMinutes(dist),
        readiness,
        readinessScore,
        priorityScore: 0, // computed below
      })
    }

    // Second pass: compute priority scores with cluster counts
    const zipCounts = new Map<string, number>()
    for (const p of allMapped) {
      if (p.zip) zipCounts.set(p.zip, (zipCounts.get(p.zip) ?? 0) + 1)
    }
    const maxDist = Math.max(...allMapped.map(p => p.distanceMiles), 1)

    for (const p of allMapped) {
      p.priorityScore = Math.round(computePriorityScore(
        p.readinessScore,
        p.distanceMiles,
        zipCounts.get(p.zip ?? '') ?? 0,
        Number(p.contract) || 0,
        maxDist,
        maxContract,
        { readiness: cfg.weight_readiness, proximity: cfg.weight_proximity, cluster: cfg.weight_cluster, value: cfg.weight_value }
      ) * 10) / 10
    }

    allMapped.sort((a, b) => b.priorityScore - a.priorityScore)
    setProjects(allMapped)
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadAll() }, [loadAll])

  // Derived data
  const tierCounts = useMemo(() => {
    const counts = { 1: { count: 0, value: 0 }, 2: { count: 0, value: 0 }, 3: { count: 0, value: 0 }, 4: { count: 0, value: 0 } }
    for (const p of projects) {
      counts[p.tier].count++
      counts[p.tier].value += Number(p.contract) || 0
    }
    return counts
  }, [projects])

  const unscheduled = useMemo(() => projects.filter(p => !scheduledIds.has(p.id)), [projects, scheduledIds])
  const weekSchedule = useMemo(() => schedule.filter(s => s.scheduled_week === selectedWeek && s.status !== 'cancelled'), [schedule, selectedWeek])
  const weeks = useMemo(() => {
    // Start from ramp start date, 16 weeks
    const result: string[] = []
    const start = new Date(rampStart + 'T12:00:00')
    for (let i = 0; i < 16; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i * 7)
      result.push(getMonday(d))
    }
    return result
  }, [rampStart])

  // Load real crews from DB
  const [allCrews, setAllCrews] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    loadActiveCrews().then((r: any) => setAllCrews((r.data ?? r ?? []).map((cr: any) => ({ id: cr.id, name: cr.name }))))
  }, [])

  // Crew ramp: 2 crews for first 4 weeks, then +1 crew every 2 weeks (no cap)
  const getActiveCrewCount = useCallback((week: string): number => {
    const weekIdx = weeks.indexOf(week)
    if (weekIdx < 0) return 2
    if (weekIdx < 4) return 2 // First month: 2 crews
    const weeksAfterMonth1 = weekIdx - 4
    const extra = Math.floor(weeksAfterMonth1 / 2) + 1
    return 2 + extra // 2→3→3→4→4→5→5→6...
  }, [weeks])

  const crewNames = useMemo(() => {
    const count = getActiveCrewCount(selectedWeek)
    // Prioritize HOU crews first, then DFW
    const sorted = [...allCrews].sort((a, b) => {
      if (a.name.startsWith('HOU') && !b.name.startsWith('HOU')) return -1
      if (!a.name.startsWith('HOU') && b.name.startsWith('HOU')) return 1
      return a.name.localeCompare(b.name)
    })
    return sorted.slice(0, count).map(c => c.name)
  }, [allCrews, selectedWeek, getActiveCrewCount])

  // Auto-suggest with crew-aware geographic clustering
  const crewSuggestions = useMemo(() => {
    if (!config) return new Map<string, RampProject[]>()

    // Only suggest for crews that have empty slots
    const crewsWithSpace = crewNames.filter(crew => {
      const filled = weekSchedule.filter(s => s.crew_name === crew).length
      return filled < (config.installs_per_crew_per_week ?? 2)
    })
    if (crewsWithSpace.length === 0) return new Map<string, RampProject[]>()

    // Get pool of candidates with coordinates
    const pool = unscheduled.filter(p => p.readinessScore >= 20 && p.lat !== 0)
    if (pool.length === 0) return new Map<string, RampProject[]>()

    // Cluster projects geographically for available crews
    const warehouse = { lat: config.warehouse_lat, lng: config.warehouse_lng }
    const clusters = clusterProjectsForCrews(
      warehouse,
      pool.map(p => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, priorityScore: p.priorityScore })),
      crewsWithSpace.length,
      config.installs_per_crew_per_week ?? 2,
    )

    // Map clusters to crew names
    const result = new Map<string, RampProject[]>()
    clusters.forEach((cluster, i) => {
      const crewName = crewsWithSpace[i]
      if (!crewName) return
      const projectIds = new Set(cluster.projects.map(cp => cp.id))
      result.set(crewName, pool.filter(p => projectIds.has(p.id)))
    })
    return result
  }, [unscheduled, config, weekSchedule, crewNames])

  // Flat list for backward compat
  const suggestions = useMemo(() => [...crewSuggestions.values()].flat(), [crewSuggestions])

  // Handlers
  const handleSchedule = async (projectId: string, crewName: string, slot: number) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    // Conflict detection — warn if already scheduled elsewhere
    if (scheduledIds.has(projectId)) {
      const existing = schedule.find(s => s.project_id === projectId && s.status !== 'cancelled')
      if (existing && !confirm(`${project.name} is already scheduled for ${getWeekLabel(existing.scheduled_week)}. Schedule again?`)) return
    }
    const result = await scheduleProject({
      project_id: projectId,
      crew_name: crewName,
      scheduled_week: selectedWeek,
      slot,
      status: 'confirmed',
      priority_score: project.priorityScore ?? 0,
      distance_miles: project.distanceMiles ?? null,
      drive_minutes: project.driveMinutes ?? null,
      created_by: user?.name,
    })
    if (!result) { setToast({ message: 'Failed to schedule project', type: 'error' }); setTimeout(() => setToast(null), 3000); return }

    // Also write to main schedule table so it appears on the Schedule page
    const crew = allCrews.find(c => c.name === crewName)
    if (crew) {
      const installDate = selectedWeek // Monday of the selected week
      const { error: schedInsertErr } = await db().from('schedule').insert({
        id: crypto.randomUUID(),
        project_id: projectId,
        crew_id: crew.id,
        job_type: 'install',
        date: installDate,
        status: 'scheduled',
        notes: `Ramp-up: ${crewName}, Week of ${getWeekLabel(selectedWeek)}`,
        pm: user?.name ?? project.pm,
        org_id: orgId ?? null,
      })
      if (schedInsertErr) console.error('[ramp→schedule] FAILED:', schedInsertErr.message, schedInsertErr)
    }
    loadAll()
  }

  // Confirm → update install date on the main schedule entry (already created on assign)
  const handleConfirm = async (entry: RampScheduleEntry) => {
    const project = projects.find(p => p.id === entry.project_id)
    if (!project) return

    const crew = allCrews.find(c => c.name === entry.crew_name)
    const installDate = entry.scheduled_day ?? selectedWeek

    // Update the schedule table entry date if user changed it via date picker
    if (crew) {
      await db().from('schedule')
        .update({ date: installDate, status: 'confirmed' })
        .eq('project_id', entry.project_id)
        .eq('crew_id', crew.id)
        .eq('job_type', 'install')
        .gte('date', entry.scheduled_week)
        .then(({ error: e }: any) => { if (e) console.error('[confirm→schedule]', e.message) })
    }

    // Update ramp schedule status + date
    await updateScheduleEntry(entry.id, { status: 'confirmed', scheduled_day: installDate })
    loadAll()
  }

  // Complete → mark install_done task as Complete on the project
  const handleComplete = async (entry: RampScheduleEntry) => {
    // Complete the ramp schedule entry
    await completeScheduleEntry(entry.id)

    // Complete the install_done task on the project (triggers automation chain)
    const today = new Date().toISOString().slice(0, 10)
    await upsertTaskState({
      project_id: entry.project_id,
      task_id: 'install_done',
      status: 'Complete',
      completed_date: today,
    })

    // Log to task history
    await insertTaskHistory({
      project_id: entry.project_id,
      task_id: 'install_done',
      status: 'Complete',
      changed_by: user?.name ?? 'Ramp Planner',
    })

    // Update schedule entry status to Complete
    const crew = allCrews.find(c => c.name === entry.crew_name)
    if (crew) {
      await db().from('schedule')
        .update({ status: 'complete' })
        .eq('project_id', entry.project_id)
        .eq('crew_id', crew.id)
        .eq('job_type', 'install')
    }

    loadAll()
  }

  const handleCancel = async (id: string) => {
    const reason = prompt('Reason for cancellation:')
    if (reason === null) return

    // Also remove from main schedule — match by project + crew + specific date
    const entry = schedule.find(s => s.id === id)
    if (entry) {
      const crew = allCrews.find(c => c.name === entry.crew_name)
      if (crew && entry.scheduled_day) {
        await db().from('schedule')
          .delete()
          .eq('project_id', entry.project_id)
          .eq('crew_id', crew.id)
          .eq('date', entry.scheduled_day)
          .eq('job_type', 'install')
          .in('status', ['Scheduled', 'scheduled'])
      }
    }

    await cancelScheduleEntry(id, reason)
    loadAll()
  }

  const handleReadinessToggle = async (projectId: string, field: string, current: boolean) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    // Build full readiness from either DB or auto-computed values
    const base = project.readiness ?? autoReadiness(project.ahj, project.module, project.inverter, project.battery)
    const updated = { ...base, [field]: !current }
    await upsertReadiness(projectId, updated as Partial<ProjectReadiness>, user?.name)
    // Optimistic update — don't wait for full reload
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p
      const newReadiness = { ...p.readiness, ...updated } as ProjectReadiness
      const newScore = computeReadinessScore(newReadiness)
      const newTier = tierFromScore(newScore, newReadiness)
      return { ...p, readiness: newReadiness, readinessScore: newScore, tier: newTier }
    }))
  }

  // Auto-fill week — assign top clustered suggestions to all empty slots
  const [autoFilling, setAutoFilling] = useState(false)
  const handleAutoFill = async () => {
    if (!config || autoFilling) return
    setAutoFilling(true)
    let filled = 0
    let failed = 0
    for (const [crew, crewProjects] of crewSuggestions.entries()) {
      const crewSlots = weekSchedule.filter(s => s.crew_name === crew).length
      const maxSlots = config.installs_per_crew_per_week ?? 2
      for (let i = 0; i < Math.min(crewProjects.length, maxSlots - crewSlots); i++) {
        const p = crewProjects[i]
        const result = await scheduleProject({
          project_id: p.id,
          crew_name: crew,
          scheduled_week: selectedWeek,
          slot: crewSlots + i + 1,
          status: 'confirmed',
          priority_score: p.priorityScore ?? 0,
          distance_miles: p.distanceMiles ?? null,
          drive_minutes: p.driveMinutes ?? null,
          created_by: user?.name,
        })
        if (result) {
          filled++
          // Also write to main schedule table
          const crewObj = allCrews.find(c => c.name === crew)
          if (crewObj) {
            const { error: afErr } = await db().from('schedule').insert({
              id: crypto.randomUUID(),
              project_id: p.id,
              crew_id: crewObj.id,
              job_type: 'install',
              date: selectedWeek,
              status: 'scheduled',
              notes: `Ramp-up auto-fill: ${crew}`,
              pm: user?.name ?? p.pm,
              org_id: orgId ?? null,
            })
            if (afErr) console.error('[ramp→schedule auto-fill] FAILED:', afErr.message, afErr)
          }
        } else failed++
      }
    }
    setAutoFilling(false)
    if (failed > 0) { setToast({ message: `Filled ${filled} slots, ${failed} failed`, type: 'error' }); setTimeout(() => setToast(null), 3000) }
    if (filled > 0) loadAll()
  }

  // Week revenue
  const weekRevenue = useMemo(() => {
    return weekSchedule.reduce((sum, s) => {
      const p = projects.find(pr => pr.id === s.project_id)
      return sum + (Number(p?.contract) || 0)
    }, 0)
  }, [weekSchedule, projects])

  // HTML escape for print template
  const esc = (s: string | null | undefined) => (s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  // Print crew sheet
  const handlePrint = () => {
    const printData = crewNames.map(crew => {
      const jobs = weekSchedule.filter(s => s.crew_name === crew)
      return {
        crew,
        jobs: jobs.map(j => {
          const p = projects.find(pr => pr.id === j.project_id)
          return p ? { name: p.name, id: p.id, address: p.address, city: p.city, phone: null as string | null, systemkw: p.systemkw, date: j.scheduled_day } : null
        }).filter(Boolean),
      }
    })
    const html = `<html><head><title>Crew Schedule — ${getWeekLabel(selectedWeek)}</title>
    <style>body{font-family:Arial,sans-serif;padding:20px}h1{font-size:18px}h2{font-size:14px;margin-top:20px;border-bottom:2px solid #000;padding-bottom:4px}
    .job{margin:10px 0;padding:10px;border:1px solid #ccc;border-radius:6px}
    .label{color:#666;font-size:11px}.value{font-size:13px;font-weight:600}
    @media print{body{padding:0}}</style></head><body>
    <h1>MicroGRID — Install Schedule: ${getWeekLabel(selectedWeek)}</h1>
    <p style="color:#666;font-size:12px">Warehouse: ${config?.warehouse_address ?? ''}</p>
    ${printData.map(c => `<h2>${esc(c.crew)} (${c.jobs.length} jobs)</h2>
    ${c.jobs.map((j: any, i: number) => `<div class="job">
      <div><span class="label">Job ${i + 1}:</span> <span class="value">${esc(j.name)}</span> <span style="color:#666">(${esc(j.id)})</span></div>
      <div><span class="label">Date:</span> ${j.date ? new Date(j.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : 'TBD'}</div>
      <div><span class="label">Address:</span> <span class="value">${esc(j.address)}, ${esc(j.city)}</span></div>
      <div><span class="label">Phone:</span> ${esc(j.phone)}</div>
      <div><span class="label">System:</span> ${j.systemkw ?? '—'} kW</div>
    </div>`).join('')}`).join('')}
    </body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
    else { setToast({ message: 'Popup blocked — please allow popups for this site to print crew sheets.', type: 'error' }); setTimeout(() => setToast(null), 3000) }
  }

  const openProject = async (id: string) => {
    const p = await loadProjectById(id)
    if (p) setPanelProject(p)
  }

  // Week navigation
  const weekIdx = weeks.indexOf(selectedWeek)
  const prevWeek = () => { if (weekIdx > 0) setSelectedWeek(weeks[weekIdx - 1]) }
  const nextWeek = () => { if (weekIdx < weeks.length - 1) setSelectedWeek(weeks[weekIdx + 1]) }

  // Route for the week — per crew
  const weekRoutes = useMemo(() => {
    if (!config || weekSchedule.length === 0) return new Map<string, ReturnType<typeof optimizeRoute>>()
    const routes = new Map<string, ReturnType<typeof optimizeRoute>>()
    const warehouse = { lat: config.warehouse_lat, lng: config.warehouse_lng }
    for (const crew of crewNames) {
      const crewJobs = weekSchedule.filter(s => s.crew_name === crew)
      const points: RoutePoint[] = crewJobs.map(s => {
        const p = projects.find(pr => pr.id === s.project_id)
        return p && p.lat !== 0 && p.lng !== 0 ? { id: p.id, lat: p.lat, lng: p.lng, label: `${p.name} (${p.id})` } : null
      }).filter(Boolean) as RoutePoint[]
      if (points.length > 0) routes.set(crew, optimizeRoute(warehouse, points))
    }
    return routes
  }, [weekSchedule, projects, config, crewNames])

  const totalWeekMiles = [...weekRoutes.values()].reduce((sum, r) => sum + r.totalMiles, 0)
  const totalWeekMinutes = [...weekRoutes.values()].reduce((sum, r) => sum + r.totalMinutes, 0)

  // Proximity clustering computed data
  const clusterFocusProject = useMemo(() => projects.find(p => p.id === clusterFocusId) ?? null, [projects, clusterFocusId])
  const clusterNearby = useMemo((): ClusterNearbyProject[] => {
    if (!clusterFocusProject) return []
    const result: ClusterNearbyProject[] = []
    for (const p of projects) {
      if (p.id === clusterFocusProject.id) continue
      if (!stageMatchesActivity(p.stage, clusterJobFilter)) continue
      const distance = haversineDistance(clusterFocusProject.lat, clusterFocusProject.lng, p.lat, p.lng)
      const tier: TierKey | null = distance <= 3 ? 'A' : distance <= 6 ? 'B' : distance <= 12 ? 'C' : distance <= 24 ? 'D' : null
      if (tier) result.push({ ...p, distance, tier })
    }
    result.sort((a, b) => a.distance - b.distance)
    return result
  }, [clusterFocusProject, projects, clusterJobFilter])
  const clusterTierCounts = useMemo(() => {
    const c: Record<TierKey, number> = { A: 0, B: 0, C: 0, D: 0 }
    for (const p of clusterNearby) c[p.tier]++
    return c
  }, [clusterNearby])
  const clusterRoutePoints = useMemo(() => {
    if (!showClusterRoute || !clusterFocusProject || clusterRouteIds.size === 0) return []
    const selected = clusterNearby.filter(p => clusterRouteIds.has(p.id))
    const remaining = [...selected]
    const ordered: typeof selected = []
    let curLat = clusterFocusProject.lat, curLng = clusterFocusProject.lng
    while (remaining.length > 0) {
      let bestIdx = 0, bestDist = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineDistance(curLat, curLng, remaining[i].lat, remaining[i].lng)
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      const next = remaining.splice(bestIdx, 1)[0]
      ordered.push(next)
      curLat = next.lat; curLng = next.lng
    }
    return ordered
  }, [showClusterRoute, clusterFocusProject, clusterRouteIds, clusterNearby])
  const clusterPolyline = useMemo(() => {
    if (!clusterFocusProject || clusterRoutePoints.length === 0) return []
    return [[clusterFocusProject.lat, clusterFocusProject.lng] as [number, number], ...clusterRoutePoints.map(p => [p.lat, p.lng] as [number, number])]
  }, [clusterFocusProject, clusterRoutePoints])
  const clusterTotalMiles = useMemo(() => {
    if (clusterPolyline.length < 2) return 0
    let t = 0
    for (let i = 1; i < clusterPolyline.length; i++) t += haversineDistance(clusterPolyline[i-1][0], clusterPolyline[i-1][1], clusterPolyline[i][0], clusterPolyline[i][1])
    return Math.round(t * 10) / 10
  }, [clusterPolyline])
  const clusterGoogleUrl = useMemo(() => {
    if (!clusterFocusProject || clusterRoutePoints.length === 0) return null
    const origin = `${clusterFocusProject.address ?? ''}, ${clusterFocusProject.city ?? ''} TX ${clusterFocusProject.zip ?? ''}`
    const dest = clusterRoutePoints[clusterRoutePoints.length - 1]
    const destination = `${dest.address ?? ''}, ${dest.city ?? ''} TX ${dest.zip ?? ''}`
    const waypoints = clusterRoutePoints.length > 1 ? clusterRoutePoints.map(p => `${p.address ?? ''}, ${p.city ?? ''} TX ${p.zip ?? ''}`).join('|') : ''
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}`
  }, [clusterFocusProject, clusterRoutePoints])

  if (authLoading) return <div className="min-h-screen bg-gray-900"><Nav active="Ramp-Up" /></div>
  if (!isManager) return <div className="min-h-screen bg-gray-900"><Nav active="Ramp-Up" /><div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Not authorized.</div></div>

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Nav active="Ramp-Up" />

      {/* Instructional Guide */}
      {showGuide && (
        <InstructionalGuide onDismiss={() => { setShowGuide(false); localStorage.setItem('mg_rampup_guide_dismissed', 'true') }} />
      )}

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Target className="w-5 h-5 text-green-400" /> Install Ramp-Up Planner
              {!showGuide && (
                <button onClick={() => { setShowGuide(true); localStorage.removeItem('mg_rampup_guide_dismissed') }}
                  className="text-[10px] bg-gray-800 text-gray-400 hover:text-white px-2 py-0.5 rounded-full ml-2" title="Show instructions">?</button>
              )}
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              {crewNames.length} crews × {config?.installs_per_crew_per_week ?? 2} installs/week = {crewNames.length * (config?.installs_per_crew_per_week ?? 2)} installs/week
              <span className="ml-2 text-gray-600">| Ramp: {getWeekLabel(rampStart)}</span>
              <span className="ml-2 text-gray-600">| Warehouse: {config?.warehouse_address ?? '...'}</span>
            </p>
          </div>
        </div>

        {/* Tier Cards */}
        <TierCards tierCounts={tierCounts} tierFilter={tierFilter} setTierFilter={setTierFilter} setTab={setTab} />

        {/* Scoring Legend */}
        <ScoringLegend />

        {/* Tab Bar */}
        <div className="flex gap-4 border-b border-gray-700">
          {([
            { key: 'planner', label: 'Week Planner', icon: <Calendar className="w-3.5 h-3.5" /> },
            { key: 'queue', label: `Readiness Queue (${unscheduled.length})`, icon: <Zap className="w-3.5 h-3.5" /> },
            { key: 'timeline', label: '30/60/90 Timeline', icon: <Truck className="w-3.5 h-3.5" /> },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('flex items-center gap-1.5 text-xs pb-2 border-b-2 transition-colors',
                tab === t.key ? 'text-white border-green-500' : 'text-gray-500 border-transparent hover:text-gray-300')}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── WEEK PLANNER TAB ──────────────────────────────────────────── */}
        {tab === 'planner' && (
          <WeekPlannerTab
            config={config}
            projects={projects}
            weekSchedule={weekSchedule}
            scheduledIds={scheduledIds}
            crewNames={crewNames}
            selectedWeek={selectedWeek}
            weeks={weeks}
            weekIdx={weekIdx}
            prevWeek={prevWeek}
            nextWeek={nextWeek}
            weekRevenue={weekRevenue}
            weekRoutes={weekRoutes}
            totalWeekMiles={totalWeekMiles}
            totalWeekMinutes={totalWeekMinutes}
            crewSuggestions={crewSuggestions}
            autoFilling={autoFilling}
            clusterFocusId={clusterFocusId}
            setClusterFocusId={setClusterFocusId}
            clusterRouteIds={clusterRouteIds}
            setClusterRouteIds={setClusterRouteIds}
            showClusterRoute={showClusterRoute}
            setShowClusterRoute={setShowClusterRoute}
            clusterJobFilter={clusterJobFilter}
            setClusterJobFilter={setClusterJobFilter}
            clusterFocusProject={clusterFocusProject}
            clusterNearby={clusterNearby}
            clusterTierCounts={clusterTierCounts}
            clusterRoutePoints={clusterRoutePoints}
            clusterPolyline={clusterPolyline}
            clusterTotalMiles={clusterTotalMiles}
            clusterGoogleUrl={clusterGoogleUrl}
            handleSchedule={handleSchedule}
            handleConfirm={handleConfirm}
            handleComplete={handleComplete}
            handleCancel={handleCancel}
            handleAutoFill={handleAutoFill}
            handlePrint={handlePrint}
            openProject={openProject}
            loadAll={loadAll}
            userName={user?.name}
            allCrews={allCrews}
            orgId={orgId}
          />
        )}

        {/* ── READINESS QUEUE TAB ───────────────────────────────────────── */}
        {tab === 'queue' && (
          <ReadinessQueueTab
            unscheduled={unscheduled}
            tierCounts={tierCounts}
            tierFilter={tierFilter}
            setTierFilter={setTierFilter}
            queueSearch={queueSearch}
            setQueueSearch={setQueueSearch}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            financierFilter={financierFilter}
            setFinancierFilter={setFinancierFilter}
            projects={projects}
            handleReadinessToggle={handleReadinessToggle}
            openProject={openProject}
          />
        )}

        {/* ── TIMELINE TAB ──────────────────────────────────────────────── */}
        {tab === 'timeline' && (
          <TimelineTab
            weeks={weeks}
            schedule={schedule}
            projects={projects}
            config={config}
            selectedWeek={selectedWeek}
            setSelectedWeek={setSelectedWeek}
            setTab={setTab}
            getActiveCrewCount={getActiveCrewCount}
          />
        )}
      </div>

      {/* Project Panel */}
      {panelProject && (
        <ProjectPanel project={panelProject} onClose={() => setPanelProject(null)} onProjectUpdated={() => {}} />
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === 'error' ? 'bg-red-600 text-white' : toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'
        }`}>{toast.message}</div>
      )}
    </div>
  )
}
