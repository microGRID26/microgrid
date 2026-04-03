'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { fmtDate, fmt$, cn, STAGE_LABELS } from '@/lib/utils'
import { loadProjectById, loadActiveCrews, upsertTaskState, insertTaskHistory } from '@/lib/api'
import { db } from '@/lib/db'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'
import {
  classifyTier, tierFromScore, haversineDistance, estimateDriveMinutes,
  computeReadinessScore, computePriorityScore, optimizeRoute, autoReadiness, clusterProjectsForCrews,
  getMonday, getWeekLabel, getNextWeeks,
  loadRampConfig, loadAllReadiness, loadAllSchedule, loadScheduledProjectIds,
  scheduleProject, updateScheduleEntry, completeScheduleEntry, cancelScheduleEntry,
  upsertReadiness,
  TIER_INFO, RAMP_STATUS_COLORS, READINESS_WEIGHTS,
} from '@/lib/api/ramp-planner'
import type { Tier, RampConfig, ProjectReadiness, RampScheduleEntry, RoutePoint } from '@/lib/api/ramp-planner'
import dynamic from 'next/dynamic'
import { Calendar, MapPin, Truck, ChevronLeft, ChevronRight, Check, X, Zap, AlertTriangle, Target, Printer } from 'lucide-react'

const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false })
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false })
const Circle = dynamic(() => import('react-leaflet').then(m => m.Circle), { ssr: false })
const Tooltip = dynamic(() => import('react-leaflet').then(m => m.Tooltip), { ssr: false })
const Polyline = dynamic(() => import('react-leaflet').then(m => m.Polyline), { ssr: false })

// ── Proximity Tiers ─────────────────────────────────────────────────────────
const PROXIMITY_TIERS = [
  { key: 'A' as const, label: '0–3 mi', max: 3, color: '#22c55e', ring: '#22c55e40' },
  { key: 'B' as const, label: '3–6 mi', max: 6, color: '#3b82f6', ring: '#3b82f640' },
  { key: 'C' as const, label: '6–12 mi', max: 12, color: '#f59e0b', ring: '#f59e0b30' },
  { key: 'D' as const, label: '12–24 mi', max: 24, color: '#6b7280', ring: '#6b728020' },
]
type TierKey = 'A' | 'B' | 'C' | 'D'
function getTierKey(miles: number): TierKey | null {
  if (miles <= 3) return 'A'
  if (miles <= 6) return 'B'
  if (miles <= 12) return 'C'
  if (miles <= 24) return 'D'
  return null
}

// Map stages to field activity types (Mark's language)
const FIELD_ACTIVITIES = [
  { key: 'all', label: 'All' },
  { key: 'survey', label: 'Surveys', stages: ['evaluation', 'survey'] },
  { key: 'install', label: 'Installs', stages: ['install'] },
  { key: 'inspection', label: 'Inspections', stages: ['inspection'] },
  { key: 'permit', label: 'Permitting', stages: ['permit'] },
  { key: 'design', label: 'Design', stages: ['design'] },
]
function stageMatchesActivity(stage: string, activityKey: string): boolean {
  if (activityKey === 'all') return true
  const activity = FIELD_ACTIVITIES.find(a => a.key === activityKey)
  return activity?.stages?.includes(stage) ?? false
}
const TIER_COLOR_MAP: Record<TierKey, string> = { A: '#22c55e', B: '#3b82f6', C: '#f59e0b', D: '#6b7280' }

const CREW_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899'] // green, blue, amber, pink

// ── Zip geocode cache (reused from map page) ─────────────────────────────────
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

// ── Project with computed fields ─────────────────────────────────────────────
interface RampProject {
  id: string; name: string; city: string | null; address: string | null; zip: string | null
  ahj: string | null; stage: string; module: string | null; inverter: string | null; battery: string | null
  systemkw: number | null; contract: number | null; pm: string | null; blocker: string | null
  financier: string | null
  tier: Tier; lat: number; lng: number
  distanceMiles: number; driveMinutes: number
  readiness: ProjectReadiness | null; readinessScore: number
  priorityScore: number
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
  // expandedProject removed — was unused
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
  const clusterNearby = useMemo(() => {
    if (!clusterFocusProject) return [] as RampProject[]
    const result: any[] = []
    for (const p of projects) {
      if (p.id === clusterFocusProject.id) continue
      if (!stageMatchesActivity(p.stage, clusterJobFilter)) continue
      const distance = haversineDistance(clusterFocusProject.lat, clusterFocusProject.lng, p.lat, p.lng)
      const tier = getTierKey(distance)
      if (tier) result.push({ ...p, distance, tier })
    }
    result.sort((a: any, b: any) => a.distance - b.distance)
    return result
  }, [clusterFocusProject, projects, clusterJobFilter])
  const clusterTierCounts = useMemo(() => {
    const c: Record<TierKey, number> = { A: 0, B: 0, C: 0, D: 0 }
    for (const p of clusterNearby) c[p.tier as TierKey]++
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

  const TIER_COLORS = { 1: 'border-green-500', 2: 'border-amber-500', 3: 'border-blue-500', 4: 'border-red-500' }
  const TIER_BG = { 1: 'bg-green-900/20', 2: 'bg-amber-900/20', 3: 'bg-blue-900/20', 4: 'bg-red-900/20' }
  const TIER_TEXT = { 1: 'text-green-400', 2: 'text-amber-400', 3: 'text-blue-400', 4: 'text-red-400' }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Nav active="Ramp-Up" />

      {/* Instructional Guide */}
      {showGuide && (
        <div className="bg-gray-900 border-b border-gray-700 px-4 py-5">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-start justify-between">
              <div className="space-y-4 flex-1 pr-8">
                <div>
                  <h2 className="text-sm font-bold text-white">Install Ramp-Up Planner — Complete Guide</h2>
                  <p className="text-[11px] text-gray-500 mt-1">This tool manages the entire install scheduling pipeline: score project readiness, group by geographic clusters, assign to crews, track 30/60/90-day forecasts.</p>
                </div>

                {/* Step-by-step workflow */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="text-green-400 font-semibold mb-1.5">Step 1: Understand the Tier Cards</div>
                    <p className="text-gray-400">At the top of the page, four <span className="text-white">Tier Cards</span> show project counts by readiness score. <span className="text-green-400">Tier 1 (60+)</span> = ready to schedule now. <span className="text-amber-400">Tier 2 (40-59)</span> = almost ready, may need one checklist item. Click any tier card to filter the <span className="text-white">Readiness Queue</span> to just that tier.</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="text-blue-400 font-semibold mb-1.5">Step 2: Update Readiness Checklist</div>
                    <p className="text-gray-400">Go to the <span className="text-white">Readiness Queue</span> tab. Each project has a checklist row: <span className="text-white">NTP, Redesign, Ext Scope, Equipment, Utility, Permit, HOA</span>. Click each badge to toggle it on/off — the score recalculates instantly. Focus on getting Tier 2 projects to Tier 1 by confirming their blockers are cleared.</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="text-amber-400 font-semibold mb-1.5">Step 3: Use Proximity Clusters</div>
                    <p className="text-gray-400">On the <span className="text-white">Week Planner</span> tab, the map shows all projects color-coded by proximity tier. <span className="text-green-400">Green (0-3 mi)</span>, <span className="text-blue-400">Blue (3-6 mi)</span>, <span className="text-amber-400">Amber (6-12 mi)</span>, <span className="text-gray-300">Gray (12-24 mi)</span> from the warehouse. Click any project dot on the map to see nearby projects and a suggested route. Projects are <span className="text-white">auto-clustered by zip code</span> so crews drive less between jobs. The system groups nearby projects together and assigns them to the same crew.</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="text-purple-400 font-semibold mb-1.5">Step 4: Schedule with Crews</div>
                    <p className="text-gray-400">Each crew has slots for the week (default 2 installs/crew/week). Assign projects manually by clicking <span className="text-green-400">+ [Crew Name]</span> on suggested projects, or hit <span className="text-green-400">Auto-Fill Week</span> to let the system assign the best-fit clustered projects to all empty crew slots. Use the <span className="text-white">Activity Filter</span> (Surveys, Installs, Inspections) to focus on one job type.</p>
                  </div>
                </div>

                {/* Second row — advanced features */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="text-cyan-400 font-semibold mb-1.5">Complete & Track</div>
                    <p className="text-gray-400">On the <span className="text-white">30/60/90 Timeline</span> tab, view your rolling install forecast by week. Click <span className="text-green-400">Complete</span> on a finished install — this automatically updates the project&apos;s Install Complete task, sets M2 funding eligible, and advances the pipeline to Inspection stage. Click <span className="text-red-400">Cancel</span> to reschedule.</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="text-pink-400 font-semibold mb-1.5">Scoring Formula</div>
                    <p className="text-gray-400"><span className="text-white">Priority Score</span> = Readiness (50%) + Proximity (20%) + Contract Value (15%) + Cluster Density (15%). Readiness = NTP 20pts + Redesign 20pts + Ext Scope 20pts + Equipment 20pts + Utility 10pts + Permit 5pts + HOA 5pts = 100pt max. Higher-value projects near other ready projects in the same area get scheduled first.</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="text-orange-400 font-semibold mb-1.5">Week Navigation & Config</div>
                    <p className="text-gray-400">Use <span className="text-white">← →</span> arrows to navigate weeks. The ramp schedule starts from your configured ramp start date with 2 crews, adding 1 crew every 2 weeks. Warehouse address, installs per crew, and crew assignments are configurable in Admin &gt; Ramp Config. The map always shows the current week&apos;s assignments with route lines between clustered jobs.</p>
                  </div>
                </div>

                {/* Quick reference */}
                <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-[10px] text-gray-500 pt-1 border-t border-gray-700/50">
                  <span><span className="text-green-400 font-medium">Tier 1 (60+)</span> Ready to schedule</span>
                  <span><span className="text-amber-400 font-medium">Tier 2 (40-59)</span> Almost ready</span>
                  <span><span className="text-blue-400 font-medium">Tier 3 (20-39)</span> Needs work</span>
                  <span><span className="text-red-400 font-medium">Tier 4 (0-19)</span> Not ready</span>
                  <span className="text-gray-600">|</span>
                  <span><span className="text-green-400">A</span> 0-3 mi · <span className="text-blue-400">B</span> 3-6 mi · <span className="text-amber-400">C</span> 6-12 mi · <span className="text-gray-300">D</span> 12-24 mi from warehouse</span>
                  <span className="text-gray-600">|</span>
                  <span>Ramp: 2 crews month 1 → +1 crew every 2 weeks</span>
                </div>
              </div>
              <button onClick={() => { setShowGuide(false); localStorage.setItem('mg_rampup_guide_dismissed', 'true') }}
                className="text-gray-500 hover:text-white flex-shrink-0 mt-1">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([1, 2, 3, 4] as Tier[]).map(tier => (
            <div key={tier} onClick={() => {
                setTierFilter(prev => { const next = new Set(prev); if (next.has(tier)) next.delete(tier); else next.add(tier); return next })
                setTab('queue')
              }}
              className={cn('rounded-lg p-3 border cursor-pointer transition-opacity', TIER_COLORS[tier], TIER_BG[tier],
                tierFilter.size > 0 && !tierFilter.has(tier) && 'opacity-40')}>
              <div className="flex items-center justify-between">
                <span className={cn('text-xs font-semibold', TIER_TEXT[tier])}>Tier {tier}: {TIER_INFO[tier].label}</span>
                <span className="text-lg font-bold text-white">{tierCounts[tier].count}</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">{TIER_INFO[tier].description}</div>
              <div className="text-xs text-gray-300 mt-1">{fmt$(tierCounts[tier].value)}</div>
            </div>
          ))}
        </div>

        {/* Scoring Legend */}
        <div className="bg-gray-800/50 rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="text-[10px] text-gray-500 uppercase font-medium tracking-wider">Scoring:</span>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="text-gray-400"><span className="text-white font-semibold">Readiness</span> (50%): NTP 20 + Redesign 20 + Ext Scope 20 + Equipment 20 + Utility 10 + Permit 5 + HOA 5 = 100pt</span>
          </div>
          <div className="flex items-center gap-4 text-[10px]">
            <span className="text-gray-400"><span className="text-white font-semibold">Proximity</span> (20%): Distance from warehouse</span>
            <span className="text-gray-400"><span className="text-white font-semibold">Contract</span> (15%): Higher value = higher priority</span>
            <span className="text-gray-400"><span className="text-white font-semibold">Cluster</span> (15%): Projects in same zip</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] ml-auto">
            <span className="text-green-400">T1: 60+</span>
            <span className="text-amber-400">T2: 40-59</span>
            <span className="text-blue-400">T3: 20-39</span>
            <span className="text-red-400">T4: 0-19</span>
          </div>
        </div>

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
          <div className="space-y-4">
            {/* Week selector */}
            <div className="flex items-center gap-3">
              <button onClick={prevWeek} disabled={weekIdx <= 0} className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-sm font-semibold text-white min-w-[180px] text-center">{getWeekLabel(selectedWeek)}</span>
              <button onClick={nextWeek} disabled={weekIdx >= weeks.length - 1} className="p-1 text-gray-400 hover:text-white disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
              <span className="text-[10px] text-gray-500">Week {weekIdx + 1} of {weeks.length}</span>
              <span className="text-[10px] text-gray-500 ml-auto">
                {weekSchedule.length} / {crewNames.length * (config?.installs_per_crew_per_week ?? 2)} slots filled · {crewNames.length} crews
                {weekRevenue > 0 && <span className="text-green-400 font-medium ml-2">{fmt$(weekRevenue)}</span>}
              </span>
              {crewSuggestions.size > 0 && weekSchedule.length < crewNames.length * (config?.installs_per_crew_per_week ?? 2) && (
                <button onClick={handleAutoFill} disabled={autoFilling} className="text-[10px] px-3 py-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-md font-medium ml-2">
                  {autoFilling ? 'Filling...' : 'Auto-Fill Week'}
                </button>
              )}
              {weekSchedule.length > 0 && (
                <button onClick={async () => {
                  // Sync all current week's ramp entries to the main schedule table
                  let synced = 0
                  for (const entry of weekSchedule) {
                    const project = projects.find(p => p.id === entry.project_id)
                    const crew = allCrews.find(c => c.name === entry.crew_name)
                    if (!crew || !project) continue
                    const installDate = entry.scheduled_day ?? selectedWeek
                    // Check if already exists in schedule
                    const { data: existing } = await db().from('schedule').select('id').eq('project_id', entry.project_id).eq('crew_id', crew.id).eq('job_type', 'install').gte('date', entry.scheduled_week).limit(1)
                    if (existing && existing.length > 0) continue
                    const { error: insertErr } = await db().from('schedule').insert({
                      id: crypto.randomUUID(), project_id: entry.project_id, crew_id: crew.id,
                      job_type: 'install', date: installDate, status: 'scheduled',
                      notes: `Ramp-up sync: ${entry.crew_name}`, pm: user?.name ?? project.pm,
                    })
                    if (insertErr) { console.error('[sync] insert failed:', insertErr.message, { project_id: entry.project_id, crew_id: crew.id, date: installDate }) }
                    else synced++
                  }
                  setToast({ message: synced > 0 ? `Synced ${synced} jobs to Schedule page` : 'All jobs already synced', type: 'success' })
                  setTimeout(() => setToast(null), 3000)
                }} className="text-[10px] px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-medium ml-1">
                  Sync to Schedule
                </button>
              )}
              {weekSchedule.length > 0 && (
                <button onClick={handlePrint} className="text-[10px] px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md font-medium ml-1">
                  <Printer className="w-3 h-3 inline mr-1" />Print
                </button>
              )}
            </div>

            {/* Crew schedules */}
            <div className={cn('grid gap-4', crewNames.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4')}>
              {crewNames.map(crew => {
                const crewJobs = weekSchedule.filter(s => s.crew_name === crew)
                return (
                  <div key={crew} className="bg-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Truck className="w-4 h-4 text-gray-400" /> {crew}</h3>
                      <span className="text-[10px] text-gray-500">{crewJobs.length} / {config?.installs_per_crew_per_week ?? 2} jobs</span>
                    </div>
                    {Array.from({ length: config?.installs_per_crew_per_week ?? 2 }, (_, i) => i + 1).map(slot => {
                      const job = crewJobs.find(j => j.slot === slot)
                      const project = job ? projects.find(p => p.id === job.project_id) : null
                      return (
                        <div key={slot} className={cn('border rounded-lg p-3 mb-2', job ? 'border-gray-700 bg-gray-900/50' : 'border-dashed border-gray-700 bg-gray-900/20')}>
                          <div className="text-[10px] text-gray-500 mb-1">Job {slot}</div>
                          {job && project ? (
                            <div>
                              <div className="flex items-center justify-between">
                                <button onClick={() => openProject(project.id)} className="text-sm font-medium text-white hover:text-green-400">{project.name}</button>
                                <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-medium', RAMP_STATUS_COLORS[job.status])}>{job.status}</span>
                              </div>
                              <div className="text-[10px] text-gray-400 mt-1">
                                {project.id} · {project.city} · {project.distanceMiles}mi · ~{project.driveMinutes}min drive
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                {project.systemkw}kW · {fmt$(Number(project.contract) || 0)} · Tier {project.tier}
                              </div>
                              {/* Install date picker */}
                              <div className="flex items-center gap-2 mt-2">
                                <label className="text-[10px] text-gray-500">Install Date:</label>
                                <input type="date" value={job.scheduled_day ?? ''}
                                  onChange={e => updateScheduleEntry(job.id, { scheduled_day: e.target.value || null } as Partial<RampScheduleEntry>).then(loadAll)}
                                  min={selectedWeek}
                                  className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-[10px] text-white focus:outline-none focus:border-green-500" />
                                {job.scheduled_day && <span className="text-[10px] text-green-400">{fmtDate(job.scheduled_day)}</span>}
                              </div>
                              <div className="flex gap-2 mt-2">
                                {job.status === 'planned' && (
                                  <button onClick={() => handleConfirm(job)}
                                    className="text-[10px] px-2 py-0.5 bg-indigo-900/40 text-indigo-400 rounded hover:opacity-80">Confirm</button>
                                )}
                                {(job.status === 'planned' || job.status === 'confirmed') && (
                                  <button onClick={() => handleComplete(job)}
                                    className="text-[10px] px-2 py-0.5 bg-green-900/40 text-green-400 rounded hover:opacity-80"><Check className="w-3 h-3 inline" /> Complete</button>
                                )}
                                <button onClick={() => handleCancel(job.id)}
                                  className="text-[10px] px-2 py-0.5 bg-red-900/40 text-red-400 rounded hover:opacity-80"><X className="w-3 h-3 inline" /> Cancel</button>
                              </div>
                            </div>
                          ) : (() => {
                            // Show top suggestion for this crew with one-click assign
                            const crewSugs = crewSuggestions.get(crew) ?? []
                            const alreadyScheduled = new Set(crewJobs.map(j => j.project_id))
                            const topSug = crewSugs.find(s => !alreadyScheduled.has(s.id))
                            return topSug ? (
                              <button onClick={() => handleSchedule(topSug.id, crew, slot)}
                                className="w-full text-left hover:bg-gray-800/50 rounded p-1 -m-1 transition-colors group">
                                <div className="text-xs text-green-400 group-hover:text-green-300">
                                  + Assign: {topSug.name}
                                </div>
                                <div className="text-[10px] text-gray-600 mt-0.5">
                                  {topSug.city} · {topSug.distanceMiles}mi · Score {topSug.priorityScore}
                                </div>
                              </button>
                            ) : (
                              <div className="text-xs text-gray-600">
                                No suggestions available
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* Route Summary — per crew */}
            {weekRoutes.size > 0 && (
              <div className="bg-gray-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Week Route Summary</h4>
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-500">Total: <span className="text-white font-medium">{Math.round(totalWeekMiles * 10) / 10} mi</span></span>
                    <span className="text-gray-500">Drive: <span className="text-white font-medium">{Math.round(totalWeekMinutes / 60 * 10) / 10} hrs</span></span>
                  </div>
                </div>
                {[...weekRoutes.entries()].map(([crew, route], ci) => (
                  <div key={crew} className="border-t border-gray-700 pt-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CREW_COLORS[ci] ?? '#6b7280' }} />
                      <span className="text-xs font-medium text-white">{crew}</span>
                      <span className="text-[10px] text-gray-500">{Math.round(route.totalMiles * 10) / 10} mi · {Math.round(route.totalMinutes)} min · {route.ordered.length} stops</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-500 flex-wrap">
                      {route.legs.map((leg, i) => (
                        <React.Fragment key={i}>
                          <span className={leg.from === 'Warehouse' || leg.to === 'Warehouse' ? 'text-amber-400' : 'text-gray-300'}>{leg.from === 'Warehouse' ? '🏭 ' : ''}{leg.from.slice(0, 25)}</span>
                          <span className="text-gray-600">→ {Math.round(leg.miles * 10) / 10}mi</span>
                        </React.Fragment>
                      ))}
                      <span className="text-amber-400">🏭</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Week Map + Proximity Sidebar */}
            {config && (
              <div className="flex bg-gray-800 rounded-lg overflow-hidden" style={{ height: clusterFocusId ? '600px' : '400px' }}>
                <div className="flex-1 relative">
                <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                <MapContainer
                  center={[config.warehouse_lat, config.warehouse_lng] as [number, number]}
                  zoom={9}
                  style={{ height: '100%', width: '100%', background: '#0a0a0a' }}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                  {/* Warehouse marker */}
                  <CircleMarker center={[config.warehouse_lat, config.warehouse_lng]} radius={10}
                    pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.9, weight: 2 }}>
                    <Tooltip permanent direction="top" offset={[0, -12]}>
                      <span style={{ fontSize: '10px', color: '#fff', background: '#1f2937', padding: '2px 6px', borderRadius: '4px' }}>Warehouse</span>
                    </Tooltip>
                  </CircleMarker>

                  {/* Dots color-code by tier A/B/C/D — no ring overlays */}

                  {/* Cluster route polyline */}
                  {showClusterRoute && clusterPolyline.length > 1 && (
                    <Polyline positions={clusterPolyline} pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.8 }} />
                  )}

                  {/* Route lines per crew (hidden in cluster mode) */}
                  {!clusterFocusId && [...weekRoutes.entries()].map(([crew, route], ci) => {
                    if (!config || route.ordered.length === 0) return null
                    const color = CREW_COLORS[ci] ?? '#6b7280'
                    const points: [number, number][] = [
                      [config.warehouse_lat, config.warehouse_lng],
                      ...route.ordered.map(p => [p.lat, p.lng] as [number, number]),
                      [config.warehouse_lat, config.warehouse_lng],
                    ]
                    return (
                      <Polyline key={`route-${crew}`} positions={points}
                        pathOptions={{ color, weight: 2, opacity: 0.6, dashArray: '6 4' }} />
                    )
                  })}
                  {/* Scheduled jobs */}
                  {weekSchedule.map(s => {
                    const p = projects.find(pr => pr.id === s.project_id)
                    if (!p) return null
                    const crewIdx = crewNames.indexOf(s.crew_name ?? '')
                    const nearbyInfo = clusterNearby.find(n => n.id === p.id)
                    const isClusterFocus = p.id === clusterFocusId
                    const inClusterRoute = clusterRouteIds.has(p.id)
                    let color = CREW_COLORS[crewIdx] ?? '#6b7280'
                    let radius = 8
                    let opacity = 0.8
                    if (clusterFocusId && !isClusterFocus) {
                      if (nearbyInfo) { color = TIER_COLOR_MAP[nearbyInfo.tier as TierKey]; radius = nearbyInfo.tier === 'A' ? 9 : 7 }
                      else { opacity = 0.2; radius = 5 }
                      if (inClusterRoute) { color = '#22c55e'; radius = 10 }
                    }
                    if (isClusterFocus) { color = '#ffffff'; radius = 12; opacity = 1 }
                    return (
                      <CircleMarker key={s.id} center={[p.lat, p.lng]} radius={radius}
                        pathOptions={{ color: isClusterFocus ? '#ffffff' : color, fillColor: isClusterFocus ? '#22c55e' : color, fillOpacity: opacity, weight: isClusterFocus ? 3 : 2 }}
                        eventHandlers={{ click: () => { setClusterFocusId(p.id === clusterFocusId ? null : p.id); setClusterRouteIds(new Set()); setShowClusterRoute(false) } }}>
                        <Tooltip direction="top" offset={[0, -10]}>
                          <div style={{ background: '#1f2937', color: '#e5e7eb', padding: '8px 12px', borderRadius: '8px', fontSize: '11px', border: `2px solid ${color}`, minWidth: '220px' }}>
                            <div style={{ fontWeight: 700, color: '#fff', fontSize: '12px', marginBottom: '4px' }}>{p.name}</div>
                            <div style={{ color: '#9ca3af', fontSize: '10px' }}>{p.id} · {p.city}</div>
                            {nearbyInfo && <div style={{ color: TIER_COLOR_MAP[nearbyInfo.tier as TierKey], fontSize: '10px', fontWeight: 600, marginTop: '4px' }}>Tier {nearbyInfo.tier} · {nearbyInfo.distance.toFixed(1)} mi</div>}
                            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '2px' }}>{s.crew_name} · {s.status}</div>
                          </div>
                        </Tooltip>
                      </CircleMarker>
                    )
                  })}
                  {/* All projects as background dots — clickable for clustering */}
                  {projects.filter(p => !scheduledIds.has(p.id) && p.lat !== 0).map(p => {
                    const nearbyInfo = clusterNearby.find(n => n.id === p.id)
                    const isClusterFocus = p.id === clusterFocusId
                    const inClusterRoute = clusterRouteIds.has(p.id)
                    let dotColor = '#4b5563'
                    let dotRadius = 5
                    let dotOpacity = 0.6
                    if (clusterFocusId && !isClusterFocus) {
                      if (nearbyInfo) { dotColor = TIER_COLOR_MAP[nearbyInfo.tier as TierKey]; dotRadius = nearbyInfo.tier === 'A' ? 8 : 6 }
                      else { dotOpacity = 0.15; dotRadius = 3 }
                      if (inClusterRoute) { dotColor = '#22c55e'; dotRadius = 9 }
                    }
                    if (isClusterFocus) { dotColor = '#22c55e'; dotRadius = 12; dotOpacity = 1 }
                    return (
                      <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={dotRadius}
                        pathOptions={{ color: isClusterFocus ? '#fff' : dotColor, fillColor: dotColor, fillOpacity: dotOpacity, weight: isClusterFocus ? 3 : 1 }}
                        eventHandlers={{ click: () => { setClusterFocusId(p.id === clusterFocusId ? null : p.id); setClusterRouteIds(new Set()); setShowClusterRoute(false) } }}>
                        <Tooltip direction="top" offset={[0, -8]}>
                          <div style={{ background: '#1f2937', color: '#9ca3af', padding: '4px 8px', borderRadius: '4px', fontSize: '10px' }}>
                            {p.name} ({p.id}) · Score: {p.priorityScore}
                            {nearbyInfo && <span style={{ color: TIER_COLOR_MAP[nearbyInfo.tier as TierKey], fontWeight: 600 }}> · Tier {nearbyInfo.tier} ({nearbyInfo.distance.toFixed(1)}mi)</span>}
                          </div>
                        </Tooltip>
                      </CircleMarker>
                    )
                  })}
                </MapContainer>

                {/* Tier legend overlay (in cluster mode) */}
                {clusterFocusId && (
                  <div className="absolute bottom-2 left-2 bg-gray-900/90 border border-gray-700 rounded-lg p-2 z-[400]">
                    <div className="text-[9px] text-gray-500 uppercase font-medium mb-1">Distance Tiers</div>
                    {PROXIMITY_TIERS.map(t => (
                      <div key={t.key} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                        <span className="text-gray-300">{t.key}: {t.label}</span>
                        <span className="text-gray-500 ml-auto">{clusterTierCounts[t.key]}</span>
                      </div>
                    ))}
                    <button onClick={() => { setClusterFocusId(null); setClusterRouteIds(new Set()); setShowClusterRoute(false) }} className="text-[9px] text-gray-400 hover:text-white mt-1 pt-1 border-t border-gray-700 w-full text-left">
                      <X className="w-3 h-3 inline" /> Exit Cluster
                    </button>
                  </div>
                )}
                </div>

                {/* Proximity Sidebar */}
                {clusterFocusId && clusterFocusProject && (
                  <div className="w-72 bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-gray-700 flex-shrink-0">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-bold text-white truncate">{clusterFocusProject.name}</div>
                        <button onClick={() => { setClusterFocusId(null); setClusterRouteIds(new Set()); setShowClusterRoute(false) }} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="text-[10px] text-gray-400">{clusterFocusProject.id} · {clusterFocusProject.city}</div>
                      <div className="flex gap-1 mt-2">
                        {PROXIMITY_TIERS.map(t => (
                          <div key={t.key} className="flex-1 text-center rounded py-1" style={{ backgroundColor: t.color + '15' }}>
                            <div className="text-xs font-bold" style={{ color: t.color }}>{clusterTierCounts[t.key]}</div>
                            <div className="text-[8px] text-gray-500">{t.key}</div>
                          </div>
                        ))}
                      </div>
                      {/* Job type filter */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {FIELD_ACTIVITIES.map(a => (
                          <button key={a.key} onClick={() => { setClusterJobFilter(a.key); setClusterRouteIds(new Set()); setShowClusterRoute(false) }}
                            className={cn('text-[9px] px-1.5 py-0.5 rounded', clusterJobFilter === a.key ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500')}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                      {/* Best Bundle auto-select */}
                      {clusterNearby.length > 0 && (
                        <button onClick={() => {
                          const best = clusterNearby.filter(p => p.tier === 'A' || p.tier === 'B').slice(0, 6)
                          if (best.length === 0) { const fallback = clusterNearby.slice(0, 4); setClusterRouteIds(new Set(fallback.map(p => p.id))) }
                          else setClusterRouteIds(new Set(best.map(p => p.id)))
                          setShowClusterRoute(true)
                        }} className="w-full mt-2 text-[10px] px-2 py-1 bg-green-900/40 text-green-400 rounded hover:bg-green-900/60 font-medium">
                          Best Bundle ({clusterNearby.filter(p => p.tier === 'A' || p.tier === 'B').length || Math.min(clusterNearby.length, 4)} closest)
                        </button>
                      )}
                    </div>
                    {clusterRouteIds.size > 0 && (
                      <div className="p-2 border-b border-gray-700 flex-shrink-0 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400">{clusterRouteIds.size} selected</span>
                          <button onClick={() => setShowClusterRoute(!showClusterRoute)} className={cn('text-[10px] px-2 py-0.5 rounded font-medium', showClusterRoute ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-300')}>
                            {showClusterRoute ? 'Hide Route' : 'Show Route'}
                          </button>
                        </div>
                        {showClusterRoute && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-gray-500">{clusterTotalMiles} mi total</span>
                            {clusterGoogleUrl && <a href={clusterGoogleUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300">Google Maps →</a>}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto">
                      {PROXIMITY_TIERS.map(t => {
                        const tierProjects = clusterNearby.filter(p => p.tier === t.key)
                        if (tierProjects.length === 0) return null
                        return (
                          <div key={t.key}>
                            <div className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider sticky top-0 bg-gray-900 z-10" style={{ color: t.color }}>
                              Tier {t.key} · {t.label} · {tierProjects.length}
                            </div>
                            {tierProjects.map(p => (
                              <div key={p.id}
                                className={cn('px-3 py-1.5 hover:bg-gray-800/50 cursor-pointer border-l-2 flex items-start gap-2', clusterRouteIds.has(p.id) ? 'border-green-500 bg-green-950/20' : 'border-transparent')}
                                onClick={() => setClusterRouteIds(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                              >
                                <input type="checkbox" checked={clusterRouteIds.has(p.id)} readOnly className="mt-0.5 rounded border-gray-600 text-green-500 focus:ring-0 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] text-white font-medium truncate">{p.name}</div>
                                  <div className="text-[9px] text-gray-500">{p.id} · {p.distance.toFixed(1)} mi · {STAGE_LABELS[p.stage] ?? p.stage} · {p.systemkw ?? '—'} kW</div>
                                </div>
                                {showClusterRoute && clusterRouteIds.has(p.id) && (
                                  <span className="text-[10px] font-bold text-green-400">#{clusterRoutePoints.findIndex(r => r.id === p.id) + 1}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                      {clusterNearby.length === 0 && <div className="p-3 text-center text-gray-500 text-[10px]">No projects within 24 miles</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Crew legend (below map) */}
            {config && (
              <div className="bg-gray-900 rounded-b-lg border-t border-gray-700 px-4 py-2 flex flex-wrap gap-4 -mt-2">
                  {crewNames.map((name, i) => (
                    <div key={name} className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: CREW_COLORS[i] ?? '#6b7280' }} />
                      <span className="text-[10px] text-gray-300">{name}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="text-[10px] text-gray-300">Warehouse</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-gray-500" />
                    <span className="text-[10px] text-gray-300">Suggested</span>
                  </div>
                  <div className="text-[9px] text-gray-500 ml-auto">Click any dot to see nearby clusters</div>
              </div>
            )}

            {/* Crew-Clustered Suggestions */}
            {crewSuggestions.size > 0 && (
              <div className="bg-gray-800 rounded-lg p-4 space-y-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Auto-Clustered Suggestions by Crew</h4>
                <p className="text-[10px] text-gray-500 -mt-2">Projects grouped by geographic proximity. Click to assign to the recommended crew.</p>
                {[...crewSuggestions.entries()].map(([crew, crewProjects], ci) => {
                  const crewSlots = weekSchedule.filter(s => s.crew_name === crew).length
                  const maxSlots = config?.installs_per_crew_per_week ?? 2
                  const slotsLeft = maxSlots - crewSlots
                  if (slotsLeft <= 0) return null
                  return (
                    <div key={crew} className="border-t border-gray-700 pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: CREW_COLORS[ci] ?? '#6b7280' }} />
                        <span className="text-xs font-semibold text-white">{crew}</span>
                        <span className="text-[10px] text-gray-500">{slotsLeft} slot{slotsLeft > 1 ? 's' : ''} available</span>
                      </div>
                      <div className="space-y-1.5">
                        {crewProjects.slice(0, slotsLeft + 2).map(p => (
                          <div key={p.id} className="flex items-center justify-between bg-gray-900/50 rounded-lg px-3 py-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <button onClick={() => openProject(p.id)} className="text-xs font-medium text-white hover:text-green-400">{p.name}</button>
                                <span className="text-[10px] font-mono" style={{ color: CREW_COLORS[ci] ?? '#6b7280' }}>{p.id}</span>
                                <span className={cn('text-[9px] px-1.5 py-0.5 rounded', TIER_BG[p.tier], TIER_TEXT[p.tier])}>T{p.tier}</span>
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                <span className="capitalize">{p.stage}</span> · {p.city} · {p.distanceMiles}mi · {p.systemkw}kW · {fmt$(Number(p.contract) || 0)}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="text-xs font-bold" style={{ color: CREW_COLORS[ci] }}>{p.priorityScore}</div>
                                <div className="text-[9px] text-gray-500">score</div>
                              </div>
                              <button onClick={() => handleSchedule(p.id, crew, crewSlots + 1)}
                                className="text-[10px] px-3 py-1 rounded hover:opacity-80 font-medium"
                                style={{ backgroundColor: `${CREW_COLORS[ci]}20`, color: CREW_COLORS[ci], border: `1px solid ${CREW_COLORS[ci]}40` }}>
                                + {crew}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── READINESS QUEUE TAB ───────────────────────────────────────── */}
        {tab === 'queue' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-md">
                <input value={queueSearch} onChange={e => setQueueSearch(e.target.value)}
                  placeholder="Search name, city, project ID..."
                  className="w-full pl-3 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-white placeholder-gray-500 focus:outline-none focus:border-green-500" />
              </div>
              <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-[10px] text-white">
                <option value="">All Stages</option>
                {['evaluation', 'survey', 'design', 'permit', 'install', 'inspection'].map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <select value={financierFilter} onChange={e => setFinancierFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-[10px] text-white">
                <option value="">All Financiers</option>
                {[...new Set(projects.map(p => p.financier).filter(Boolean))].sort().map(f => (
                  <option key={f} value={f!}>{f}</option>
                ))}
              </select>
              <div className="flex gap-1">
                {([1, 2, 3, 4] as Tier[]).map(t => (
                  <button key={t} onClick={() => setTierFilter(prev => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next })}
                    className={cn('text-[10px] px-2 py-1 rounded border', tierFilter.has(t) ? `${TIER_BG[t]} ${TIER_TEXT[t]} ${TIER_COLORS[t]}` : 'border-gray-700 text-gray-500')}>
                    T{t} ({tierCounts[t].count})
                  </button>
                ))}
                {(tierFilter.size > 0 || stageFilter || financierFilter) && <button onClick={() => { setTierFilter(new Set()); setStageFilter(''); setFinancierFilter('') }} className="text-[10px] text-gray-400 ml-1">Clear</button>}
              </div>
              <span className="text-[10px] text-gray-500 ml-auto">
                {unscheduled.filter(p => {
                  if (tierFilter.size > 0 && !tierFilter.has(p.tier)) return false
                  if (stageFilter && p.stage !== stageFilter) return false
                  if (financierFilter && p.financier !== financierFilter) return false
                  if (queueSearch) { const q = queueSearch.toLowerCase(); if (!p.name.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q) && !(p.city ?? '').toLowerCase().includes(q)) return false }
                  return true
                }).length} projects
              </span>
            </div>
            {unscheduled.filter(p => {
              if (tierFilter.size > 0 && !tierFilter.has(p.tier)) return false
              if (stageFilter && p.stage !== stageFilter) return false
              if (financierFilter && p.financier !== financierFilter) return false
              if (queueSearch) {
                const q = queueSearch.toLowerCase()
                if (!p.name.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q) && !(p.city ?? '').toLowerCase().includes(q)) return false
              }
              return true
            }).map(p => (
              <div key={p.id} className="bg-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <button onClick={() => openProject(p.id)} className="text-sm font-medium text-white hover:text-green-400">{p.name}</button>
                    <span className="text-[10px] text-green-400 font-mono ml-2">{p.id}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-green-400">{p.priorityScore}</div>
                    <div className="text-[9px] text-gray-500">priority score</div>
                  </div>
                </div>
                <div className="text-[10px] text-gray-500 mt-1">
                  <span className="capitalize text-gray-300">{p.stage}</span> · {p.city} · {p.distanceMiles}mi · {p.systemkw}kW · {fmt$(Number(p.contract) || 0)} · {p.financier ?? '—'} · AHJ: {p.ahj}
                </div>
                {/* Readiness checklist */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {READINESS_WEIGHTS.map(item => {
                    const checked = p.readiness ? (p.readiness as any)[item.field] === true : false
                    return (
                      <button key={item.field} onClick={(e) => { e.stopPropagation(); handleReadinessToggle(p.id, item.field, checked) }}
                        className={cn('text-[10px] px-2 py-0.5 rounded border transition-colors',
                          checked ? 'bg-green-900/40 border-green-700 text-green-400' : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300')}>
                        {checked ? <Check className="w-2.5 h-2.5 inline mr-0.5" /> : <X className="w-2.5 h-2.5 inline mr-0.5 opacity-30" />}
                        {item.label} <span className="text-[8px] opacity-60">({item.weight}pt)</span>
                      </button>
                    )
                  })}
                  {/* Readiness bar */}
                  <div className="ml-auto flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${p.readinessScore}%`, backgroundColor: p.readinessScore >= 80 ? '#22c55e' : p.readinessScore >= 50 ? '#f59e0b' : '#ef4444' }} />
                    </div>
                    <span className={cn('text-[10px] font-bold', p.readinessScore >= 80 ? 'text-green-400' : p.readinessScore >= 50 ? 'text-amber-400' : 'text-red-400')}>{p.readinessScore}/100</span>
                  </div>
                </div>
              </div>
            ))}
            {unscheduled.filter(p => p.tier === 1).length === 0 && (
              <div className="text-center py-12 text-gray-500 text-sm">All Tier 1 projects are scheduled.</div>
            )}
          </div>
        )}

        {/* ── TIMELINE TAB ──────────────────────────────────────────────── */}
        {tab === 'timeline' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">Rolling 16-week view. Auto-updates as projects complete.</p>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="grid grid-cols-1 gap-1">
                {weeks.map((week, i) => {
                  const weekJobs = schedule.filter(s => s.scheduled_week === week && s.status !== 'cancelled')
                  const completed = weekJobs.filter(s => s.status === 'completed').length
                  const planned = weekJobs.length
                  const weekCrewCount = getActiveCrewCount(week)
                  const target = weekCrewCount * (config?.installs_per_crew_per_week ?? 2)
                  const revenue = weekJobs.reduce((sum, s) => {
                    const p = projects.find(pr => pr.id === s.project_id)
                    return sum + (Number(p?.contract) || 0)
                  }, 0)
                  const isCurrentWeek = week === getMonday(new Date())
                  const isPast = new Date(week) < new Date(getMonday(new Date()))

                  return (
                    <div key={week}
                      onClick={() => { setSelectedWeek(week); setTab('planner') }}
                      className={cn('flex items-center gap-3 px-3 py-2 rounded cursor-pointer transition-colors',
                        isCurrentWeek ? 'bg-green-900/20 border border-green-700/50' : 'hover:bg-gray-700/30',
                        selectedWeek === week && 'ring-1 ring-green-500/50')}>
                      <span className="text-[10px] text-gray-500 w-16 flex-shrink-0">Wk {i + 1}</span>
                      <span className="text-xs text-gray-300 w-32 flex-shrink-0">{getWeekLabel(week)}</span>
                      {/* Progress bar */}
                      <div className="flex-1 h-4 bg-gray-900 rounded-full overflow-hidden flex">
                        {completed > 0 && <div className="bg-green-600 h-full" style={{ width: `${completed / target * 100}%` }} />}
                        {planned > completed && <div className="bg-blue-600/50 h-full" style={{ width: `${(planned - completed) / target * 100}%` }} />}
                      </div>
                      <span className="text-[10px] text-gray-400 w-20 text-right">{planned}/{target} jobs ({weekCrewCount}c)</span>
                      <span className="text-[10px] text-green-400 w-20 text-right">{revenue > 0 ? fmt$(revenue) : '—'}</span>
                      {isCurrentWeek && <span className="text-[9px] text-green-400 font-medium">THIS WEEK</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Revenue forecast */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '30-Day Forecast', weeks: 4 },
                { label: '60-Day Forecast', weeks: 8 },
                { label: '90-Day Forecast', weeks: 12 },
              ].map(period => {
                const periodWeeks = weeks.slice(0, period.weeks)
                const periodJobs = schedule.filter(s => periodWeeks.includes(s.scheduled_week) && s.status !== 'cancelled')
                const periodRevenue = periodJobs.reduce((sum, s) => {
                  const p = projects.find(pr => pr.id === s.project_id)
                  return sum + (Number(p?.contract) || 0)
                }, 0)
                return (
                  <div key={period.label} className="bg-gray-800 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-gray-500 uppercase">{period.label}</div>
                    <div className="text-lg font-bold text-green-400 mt-1">{periodJobs.length} installs</div>
                    <div className="text-xs text-gray-300">{fmt$(periodRevenue)}</div>
                  </div>
                )
              })}
            </div>
          </div>
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
