import React from 'react'
import { fmtDate, fmt$, cn, STAGE_LABELS } from '@/lib/utils'
import {
  haversineDistance, optimizeRoute,
  getWeekLabel, getMonday,
  updateScheduleEntry,
  RAMP_STATUS_COLORS, READINESS_WEIGHTS,
} from '@/lib/api/ramp-planner'
import type { RampScheduleEntry } from '@/lib/api/ramp-planner'
import { db } from '@/lib/db'
import dynamic from 'next/dynamic'
import { Calendar, MapPin, Truck, ChevronLeft, ChevronRight, Check, X, Zap, AlertTriangle, Printer } from 'lucide-react'
import type { RampProject, RampConfig, ClusterNearbyProject } from './types'
import { PROXIMITY_TIERS, FIELD_ACTIVITIES, TIER_COLOR_MAP, CREW_COLORS, TIER_BG, TIER_TEXT, type TierKey } from './types'

const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false })
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false })
const Circle = dynamic(() => import('react-leaflet').then(m => m.Circle), { ssr: false })
const Tooltip = dynamic(() => import('react-leaflet').then(m => m.Tooltip), { ssr: false })
const Polyline = dynamic(() => import('react-leaflet').then(m => m.Polyline), { ssr: false })

interface WeekPlannerTabProps {
  config: RampConfig | null
  projects: RampProject[]
  weekSchedule: RampScheduleEntry[]
  scheduledIds: Set<string>
  crewNames: string[]
  selectedWeek: string
  weeks: string[]
  weekIdx: number
  prevWeek: () => void
  nextWeek: () => void
  weekRevenue: number
  weekRoutes: Map<string, ReturnType<typeof optimizeRoute>>
  totalWeekMiles: number
  totalWeekMinutes: number
  crewSuggestions: Map<string, RampProject[]>
  autoFilling: boolean
  // Cluster state
  clusterFocusId: string | null
  setClusterFocusId: React.Dispatch<React.SetStateAction<string | null>>
  clusterRouteIds: Set<string>
  setClusterRouteIds: React.Dispatch<React.SetStateAction<Set<string>>>
  showClusterRoute: boolean
  setShowClusterRoute: React.Dispatch<React.SetStateAction<boolean>>
  clusterJobFilter: string
  setClusterJobFilter: React.Dispatch<React.SetStateAction<string>>
  clusterFocusProject: RampProject | null
  clusterNearby: ClusterNearbyProject[]
  clusterTierCounts: Record<TierKey, number>
  clusterRoutePoints: ClusterNearbyProject[]
  clusterPolyline: [number, number][]
  clusterTotalMiles: number
  clusterGoogleUrl: string | null
  // Handlers
  handleSchedule: (projectId: string, crewName: string, slot: number) => Promise<void>
  handleConfirm: (entry: RampScheduleEntry) => Promise<void>
  handleComplete: (entry: RampScheduleEntry) => Promise<void>
  handleCancel: (id: string) => Promise<void>
  handleAutoFill: () => Promise<void>
  handlePrint: () => void
  openProject: (id: string) => Promise<void>
  loadAll: () => Promise<void>
  userName: string | undefined
  allCrews: { id: string; name: string }[]
  orgId: string | null
}

export function WeekPlannerTab({
  config, projects, weekSchedule, scheduledIds, crewNames,
  selectedWeek, weeks, weekIdx, prevWeek, nextWeek,
  weekRevenue, weekRoutes, totalWeekMiles, totalWeekMinutes,
  crewSuggestions, autoFilling,
  clusterFocusId, setClusterFocusId, clusterRouteIds, setClusterRouteIds,
  showClusterRoute, setShowClusterRoute, clusterJobFilter, setClusterJobFilter,
  clusterFocusProject, clusterNearby, clusterTierCounts, clusterRoutePoints,
  clusterPolyline, clusterTotalMiles, clusterGoogleUrl,
  handleSchedule, handleConfirm, handleComplete, handleCancel,
  handleAutoFill, handlePrint, openProject, loadAll,
  userName, allCrews, orgId,
}: WeekPlannerTabProps) {
  return (
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
                notes: `Ramp-up sync: ${entry.crew_name}`, pm: userName ?? project.pm,
                org_id: orgId ?? null,
              })
              if (insertErr) { console.error('[sync] insert failed:', insertErr.message, { project_id: entry.project_id, crew_id: crew.id, date: installDate }) }
              else synced++
            }
            // Feedback handled via parent toast
            void (synced > 0 ? synced : 0)
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
  )
}
