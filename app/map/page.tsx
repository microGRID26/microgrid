'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { loadProjectById } from '@/lib/api'
import { db } from '@/lib/db'
import { cn, STAGE_LABELS, STAGE_ORDER } from '@/lib/utils'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import type { Project } from '@/types/database'
import { Search, Layers, X, Navigation, MapPin, Route } from 'lucide-react'

// Dynamic import for Leaflet (SSR incompatible)
const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false })
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false })
const Circle = dynamic(() => import('react-leaflet').then(m => m.Circle), { ssr: false })
const Popup = dynamic(() => import('react-leaflet').then(m => m.Popup), { ssr: false })
const Tooltip = dynamic(() => import('react-leaflet').then(m => m.Tooltip), { ssr: false })
const Polyline = dynamic(() => import('react-leaflet').then(m => m.Polyline), { ssr: false })

// ── Stage Colors ─────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  evaluation: '#3b82f6',
  survey: '#8b5cf6',
  design: '#ec4899',
  permit: '#f59e0b',
  install: '#f97316',
  inspection: '#06b6d4',
  complete: '#22c55e',
}

const STAGE_FILL: Record<string, string> = {
  evaluation: '#3b82f680',
  survey: '#8b5cf680',
  design: '#ec489980',
  permit: '#f59e0b80',
  install: '#f9731680',
  inspection: '#06b6d480',
  complete: '#22c55e80',
}

// ── Proximity Tiers ─────────────────────────────────────────────────────────

const TIERS = [
  { key: 'A', label: '0–3 mi', max: 3, color: '#22c55e', ring: '#22c55e40' },
  { key: 'B', label: '3–6 mi', max: 6, color: '#3b82f6', ring: '#3b82f640' },
  { key: 'C', label: '6–12 mi', max: 12, color: '#f59e0b', ring: '#f59e0b30' },
  { key: 'D', label: '12–24 mi', max: 24, color: '#6b7280', ring: '#6b728020' },
] as const

type TierKey = 'A' | 'B' | 'C' | 'D'

function getTier(miles: number): TierKey | null {
  if (miles <= 3) return 'A'
  if (miles <= 6) return 'B'
  if (miles <= 12) return 'C'
  if (miles <= 24) return 'D'
  return null
}

const TIER_COLORS: Record<TierKey, string> = { A: '#22c55e', B: '#3b82f6', C: '#f59e0b', D: '#6b7280' }

// ── Haversine ───────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Nearest-neighbor route ──────────────────────────────────────────────────

function optimizeRoute<T extends { id: string; lat: number; lng: number }>(start: { lat: number; lng: number }, points: T[]): T[] {
  if (points.length <= 1) return [...points]
  const remaining = [...points]
  const ordered: T[] = []
  let curLat = start.lat, curLng = start.lng
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(curLat, curLng, remaining[i].lat, remaining[i].lng)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    ordered.push(next)
    curLat = next.lat
    curLng = next.lng
  }
  return ordered
}

// ── Zip Code Geocoding Cache ────────────────────────────────────────────────

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
    const coords: [number, number] = [lat, lng]
    zipCache.set(zip, coords)
    return coords
  } catch {
    return null
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface MapProject {
  id: string
  name: string
  city: string | null
  address: string | null
  zip: string | null
  stage: string
  pm: string | null
  blocker: string | null
  systemkw: number | null
  lat: number
  lng: number
}

interface NearbyProject extends MapProject {
  distance: number
  tier: TierKey
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MapPage() {
  const { user, loading: authLoading } = useCurrentUser()
  const isManager = user?.isManager ?? false
  const { orgId } = useOrg()

  const [projects, setProjects] = useState<MapProject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set())
  const [panelProject, setPanelProject] = useState<Project | null>(null)

  // Proximity clustering state
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [routeIds, setRouteIds] = useState<Set<string>>(new Set())
  const [showRoute, setShowRoute] = useState(false)

  // Load and geocode projects
  useEffect(() => {
    async function load() {
      setLoading(true)
      const supabase = db()
      let q = supabase.from('projects')
        .select('id, name, city, address, zip, stage, pm, blocker, systemkw')
        .not('disposition', 'in', '("In Service","Loyalty","Cancelled")')
        .not('zip', 'is', null)
        .limit(2000)
      if (orgId) q = q.eq('org_id', orgId)

      const { data } = await q
      if (!data) { setLoading(false); return }

      const zips = [...new Set((data as any[]).map(p => p.zip).filter(Boolean))]
      await Promise.all(zips.map(z => geocodeZip(z)))

      const mapped: MapProject[] = []
      for (const p of data as any[]) {
        if (!p.zip) continue
        const coords = zipCache.get(p.zip)
        if (!coords) continue
        const jitter = () => (Math.random() - 0.5) * 0.005
        mapped.push({
          id: p.id, name: p.name, city: p.city, address: p.address, zip: p.zip,
          stage: p.stage, pm: p.pm, blocker: p.blocker, systemkw: p.systemkw,
          lat: coords[0] + jitter(), lng: coords[1] + jitter(),
        })
      }
      setProjects(mapped)
      setLoading(false)
    }
    load()
  }, [orgId])

  const filtered = useMemo(() => {
    let list = projects
    if (stageFilter.size > 0) list = list.filter(p => stageFilter.has(p.stage))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.id.toLowerCase().includes(q) ||
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.city ?? '').toLowerCase().includes(q) ||
        (p.pm ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [projects, stageFilter, search])

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of projects) counts[p.stage] = (counts[p.stage] ?? 0) + 1
    return counts
  }, [projects])

  // Compute nearby projects when a project is selected
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedId) ?? null, [projects, selectedId])

  const nearby = useMemo<NearbyProject[]>(() => {
    if (!selectedProject) return []
    const result: NearbyProject[] = []
    for (const p of filtered) {
      if (p.id === selectedProject.id) continue
      const distance = haversine(selectedProject.lat, selectedProject.lng, p.lat, p.lng)
      const tier = getTier(distance)
      if (tier) result.push({ ...p, distance, tier })
    }
    result.sort((a, b) => a.distance - b.distance)
    return result
  }, [selectedProject, filtered])

  const tierCounts = useMemo(() => {
    const counts: Record<TierKey, number> = { A: 0, B: 0, C: 0, D: 0 }
    for (const p of nearby) counts[p.tier]++
    return counts
  }, [nearby])

  // Route computation
  const routePoints = useMemo(() => {
    if (!showRoute || !selectedProject || routeIds.size === 0) return []
    const selected = nearby.filter(p => routeIds.has(p.id))
    return optimizeRoute(selectedProject, selected)
  }, [showRoute, selectedProject, routeIds, nearby])

  const routePolyline = useMemo(() => {
    if (!selectedProject || routePoints.length === 0) return []
    return [
      [selectedProject.lat, selectedProject.lng] as [number, number],
      ...routePoints.map(p => [p.lat, p.lng] as [number, number]),
    ]
  }, [selectedProject, routePoints])

  const totalRouteMiles = useMemo(() => {
    if (routePolyline.length < 2) return 0
    let total = 0
    for (let i = 1; i < routePolyline.length; i++) {
      total += haversine(routePolyline[i - 1][0], routePolyline[i - 1][1], routePolyline[i][0], routePolyline[i][1])
    }
    return Math.round(total * 10) / 10
  }, [routePolyline])

  const toggleStage = (stage: string) => {
    setStageFilter(prev => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  const toggleRouteProject = (id: string) => {
    setRouteIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openProject = async (id: string) => {
    const p = await loadProjectById(id)
    if (p) setPanelProject(p)
  }

  const clearSelection = () => {
    setSelectedId(null)
    setRouteIds(new Set())
    setShowRoute(false)
  }

  const handleDotClick = (p: MapProject) => {
    if (selectedId === p.id) {
      // Second click on same project opens panel
      openProject(p.id)
    } else {
      setSelectedId(p.id)
      setRouteIds(new Set())
      setShowRoute(false)
    }
  }

  const googleMapsUrl = useMemo(() => {
    if (!selectedProject || routePoints.length === 0) return null
    const origin = `${selectedProject.address ?? ''}, ${selectedProject.city ?? ''} TX ${selectedProject.zip ?? ''}`
    const waypoints = routePoints.map(p => `${p.address ?? ''}, ${p.city ?? ''} TX ${p.zip ?? ''}`).join('|')
    const dest = routePoints[routePoints.length - 1]
    const destination = `${dest.address ?? ''}, ${dest.city ?? ''} TX ${dest.zip ?? ''}`
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${routePoints.length > 1 ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}`
  }, [selectedProject, routePoints])

  if (authLoading) return <div className="min-h-screen bg-gray-950"><Nav active="Map" /></div>
  if (!isManager) return <div className="min-h-screen bg-gray-950"><Nav active="Map" /><div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Not authorized.</div></div>

  const isClusterMode = !!selectedProject

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <Nav active="Map" />

      {/* Controls bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-3 flex-wrap z-[10]">
        <div className="flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-semibold text-gray-400">{isClusterMode ? 'Proximity Clusters' : 'Project Map'}</span>
          <span className="text-[10px] text-gray-500 ml-1">{filtered.length} of {projects.length} projects</span>
        </div>

        {isClusterMode && (
          <button onClick={clearSelection} className="text-[10px] px-2 py-0.5 bg-gray-800 text-gray-300 rounded hover:bg-gray-700 flex items-center gap-1">
            <X className="w-3 h-3" /> Exit Cluster View
          </button>
        )}

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, city, PM..."
            className="w-full pl-9 pr-3 py-1 bg-gray-800 border border-gray-700 rounded-md text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
        </div>

        {/* Stage filter chips */}
        <div className="flex gap-1 flex-wrap">
          {STAGE_ORDER.map(stage => {
            const count = stageCounts[stage] ?? 0
            if (count === 0) return null
            const active = stageFilter.size === 0 || stageFilter.has(stage)
            return (
              <button key={stage} onClick={() => toggleStage(stage)}
                className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-all border',
                  active ? 'opacity-100' : 'opacity-30')}
                style={{
                  backgroundColor: STAGE_FILL[stage],
                  borderColor: STAGE_COLORS[stage],
                  color: STAGE_COLORS[stage],
                }}>
                {STAGE_LABELS[stage]} ({count})
              </button>
            )
          })}
          {stageFilter.size > 0 && (
            <button onClick={() => setStageFilter(new Set())} className="text-[10px] text-gray-400 hover:text-white ml-1">
              <X className="w-3 h-3 inline" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Map + Sidebar */}
      <div className="flex-1 flex relative">
        {/* Map */}
        <div className={cn('flex-1 relative', isClusterMode && 'md:mr-80')}>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
              <div className="text-gray-500 text-sm">Loading map...</div>
            </div>
          ) : (
            <>
              <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
              <MapContainer
                center={[31.5, -97.5] as [number, number]}
                zoom={7}
                style={{ height: '100%', width: '100%', background: '#0a0a0a' }}
                zoomControl={true}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />

                {/* Distance rings when a project is selected */}
                {selectedProject && TIERS.map(t => (
                  <Circle key={t.key}
                    center={[selectedProject.lat, selectedProject.lng]}
                    radius={t.max * 1609.34}
                    pathOptions={{ color: t.color, fillColor: t.ring, fillOpacity: 0.08, weight: 1, dashArray: '4 4' }}
                  />
                ))}

                {/* Route polyline */}
                {showRoute && routePolyline.length > 1 && (
                  <Polyline positions={routePolyline} pathOptions={{ color: '#22c55e', weight: 3, opacity: 0.8 }} />
                )}

                {/* Project dots */}
                {filtered.map(p => {
                  const isSelected = p.id === selectedId
                  const nearbyInfo = nearby.find(n => n.id === p.id)
                  const inRoute = routeIds.has(p.id)

                  // In cluster mode: color by tier, dim projects outside 24mi
                  let dotColor = STAGE_COLORS[p.stage] ?? '#6b7280'
                  let dotFill = STAGE_FILL[p.stage] ?? '#6b728080'
                  let dotRadius = 6
                  let dotWeight = 1.5
                  let dotOpacity = 0.8

                  if (isClusterMode && !isSelected) {
                    if (nearbyInfo) {
                      dotColor = TIER_COLORS[nearbyInfo.tier]
                      dotFill = TIER_COLORS[nearbyInfo.tier] + '80'
                      dotRadius = nearbyInfo.tier === 'A' ? 8 : nearbyInfo.tier === 'B' ? 7 : 6
                    } else {
                      dotOpacity = 0.15
                      dotRadius = 4
                    }
                    if (inRoute) {
                      dotWeight = 3
                      dotRadius = 9
                      dotColor = '#22c55e'
                      dotFill = '#22c55e80'
                    }
                  }

                  if (isSelected) {
                    dotColor = '#ffffff'
                    dotFill = '#22c55e'
                    dotRadius = 10
                    dotWeight = 3
                  }

                  if (p.blocker && !isClusterMode) {
                    dotColor = '#ef4444'
                    dotFill = '#ef444480'
                    dotRadius = 8
                    dotWeight = 2
                  }

                  return (
                    <CircleMarker
                      key={p.id}
                      center={[p.lat, p.lng]}
                      radius={dotRadius}
                      pathOptions={{ color: dotColor, fillColor: dotFill, fillOpacity: dotOpacity, weight: dotWeight }}
                      eventHandlers={{ click: () => handleDotClick(p) }}
                    >
                      <Tooltip direction="top" offset={[0, -8]} className="leaflet-dark-tooltip">
                        <div style={{ background: '#1f2937', color: '#e5e7eb', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', border: '1px solid #374151', minWidth: '180px' }}>
                          <div style={{ fontWeight: 600, color: '#fff', marginBottom: '2px' }}>{p.name}</div>
                          <div style={{ color: '#9ca3af', fontSize: '10px' }}>{p.id} &middot; {p.city}</div>
                          <div style={{ marginTop: '4px', display: 'flex', gap: '8px', fontSize: '10px' }}>
                            <span style={{ color: STAGE_COLORS[p.stage], fontWeight: 600 }}>{STAGE_LABELS[p.stage]}</span>
                            {p.systemkw && <span style={{ color: '#9ca3af' }}>{p.systemkw} kW</span>}
                            {nearbyInfo && <span style={{ color: TIER_COLORS[nearbyInfo.tier], fontWeight: 600 }}>Tier {nearbyInfo.tier} ({nearbyInfo.distance.toFixed(1)} mi)</span>}
                          </div>
                          {p.blocker && <div style={{ color: '#ef4444', fontSize: '10px', marginTop: '2px' }}>Blocked: {p.blocker}</div>}
                        </div>
                      </Tooltip>
                    </CircleMarker>
                  )
                })}

                {/* Route stop numbers */}
                {showRoute && routePoints.map((p, i) => (
                  <CircleMarker key={`route-${p.id}`} center={[p.lat, p.lng]} radius={0} pathOptions={{ opacity: 0 }}>
                    <Tooltip permanent direction="center" className="route-number-tooltip">
                      <div style={{ background: '#22c55e', color: '#000', fontWeight: 700, fontSize: '10px', width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {i + 1}
                      </div>
                    </Tooltip>
                  </CircleMarker>
                ))}
              </MapContainer>
            </>
          )}

          {/* Legend overlay */}
          {!isClusterMode && (
            <div className="absolute bottom-4 left-4 bg-gray-900/90 border border-gray-700 rounded-lg p-3 z-[400]">
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">Stage Legend</div>
              <div className="space-y-1">
                {STAGE_ORDER.map(stage => (
                  <div key={stage} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: STAGE_COLORS[stage] }} />
                    <span className="text-[10px] text-gray-300">{STAGE_LABELS[stage]}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1 border-t border-gray-700 mt-1">
                  <span className="w-3 h-3 rounded-full border-2 border-red-500 bg-red-500/50" />
                  <span className="text-[10px] text-red-400">Blocked</span>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-700 text-[9px] text-gray-500">
                Click a project to see nearby clusters
              </div>
            </div>
          )}

          {/* Cluster legend overlay */}
          {isClusterMode && (
            <div className="absolute bottom-4 left-4 bg-gray-900/90 border border-gray-700 rounded-lg p-3 z-[400]">
              <div className="text-[10px] text-gray-500 uppercase font-medium mb-2">Distance Tiers</div>
              <div className="space-y-1">
                {TIERS.map(t => (
                  <div key={t.key} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="text-[10px] text-gray-300">Tier {t.key}: {t.label}</span>
                    <span className="text-[10px] text-gray-500 ml-auto">{tierCounts[t.key]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Proximity sidebar */}
        {isClusterMode && selectedProject && (
          <div className="w-80 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden absolute md:relative right-0 top-0 bottom-0 z-[500]">
            {/* Header */}
            <div className="p-3 border-b border-gray-800 flex-shrink-0">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs font-bold text-white truncate">{selectedProject.name}</div>
                <button onClick={clearSelection} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="text-[10px] text-gray-400">{selectedProject.id} &middot; {selectedProject.city}</div>
              <div className="text-[10px] text-gray-500">{selectedProject.address}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: STAGE_FILL[selectedProject.stage], color: STAGE_COLORS[selectedProject.stage] }}>
                  {STAGE_LABELS[selectedProject.stage]}
                </span>
                <button onClick={() => openProject(selectedProject.id)} className="text-[10px] text-green-400 hover:text-green-300">Open Project</button>
              </div>
            </div>

            {/* Tier summary */}
            <div className="flex gap-1 p-2 border-b border-gray-800 flex-shrink-0">
              {TIERS.map(t => (
                <div key={t.key} className="flex-1 text-center rounded py-1" style={{ backgroundColor: t.color + '15' }}>
                  <div className="text-sm font-bold" style={{ color: t.color }}>{tierCounts[t.key]}</div>
                  <div className="text-[9px] text-gray-500">Tier {t.key}</div>
                </div>
              ))}
            </div>

            {/* Route controls */}
            {routeIds.size > 0 && (
              <div className="p-2 border-b border-gray-800 flex-shrink-0 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">{routeIds.size} selected for route</span>
                  <button onClick={() => setShowRoute(!showRoute)} className={cn('text-[10px] px-2 py-0.5 rounded font-medium', showRoute ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-300')}>
                    <Route className="w-3 h-3 inline mr-1" />{showRoute ? 'Hide Route' : 'Show Route'}
                  </button>
                </div>
                {showRoute && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">{totalRouteMiles} mi total</span>
                    {googleMapsUrl && (
                      <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                        <Navigation className="w-3 h-3" /> Google Maps
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Nearby project list */}
            <div className="flex-1 overflow-y-auto">
              {TIERS.map(t => {
                const tierProjects = nearby.filter(p => p.tier === t.key)
                if (tierProjects.length === 0) return null
                return (
                  <div key={t.key}>
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 bg-gray-900 z-10" style={{ color: t.color }}>
                      Tier {t.key} &middot; {t.label} &middot; {tierProjects.length} projects
                    </div>
                    {tierProjects.map(p => (
                      <div key={p.id}
                        className={cn('px-3 py-2 hover:bg-gray-800/50 cursor-pointer border-l-2 flex items-start gap-2', routeIds.has(p.id) ? 'border-green-500 bg-green-950/20' : 'border-transparent')}
                        onClick={() => toggleRouteProject(p.id)}
                      >
                        <input type="checkbox" checked={routeIds.has(p.id)} readOnly
                          className="mt-0.5 rounded border-gray-600 text-green-500 focus:ring-0 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white font-medium truncate">{p.name}</div>
                          <div className="text-[10px] text-gray-500">{p.id} &middot; {p.city}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-medium" style={{ color: STAGE_COLORS[p.stage] }}>{STAGE_LABELS[p.stage]}</span>
                            <span className="text-[10px] text-gray-500">{p.distance.toFixed(1)} mi</span>
                            {p.systemkw && <span className="text-[10px] text-gray-600">{p.systemkw} kW</span>}
                          </div>
                        </div>
                        {showRoute && routeIds.has(p.id) && (
                          <div className="text-[10px] font-bold text-green-400 flex-shrink-0">
                            #{routePoints.findIndex(r => r.id === p.id) + 1}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
              {nearby.length === 0 && (
                <div className="p-4 text-center text-gray-500 text-xs">No projects within 24 miles</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Project Panel */}
      {panelProject && (
        <ProjectPanel project={panelProject} onClose={() => setPanelProject(null)} onProjectUpdated={() => {}} />
      )}

      <style>{`
        .route-number-tooltip { background: transparent !important; border: none !important; box-shadow: none !important; padding: 0 !important; }
        .route-number-tooltip::before { display: none !important; }
      `}</style>
    </div>
  )
}
