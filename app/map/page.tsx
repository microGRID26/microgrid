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
import { Search, Layers, X } from 'lucide-react'

// Dynamic import for Leaflet (SSR incompatible)
const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(m => m.TileLayer), { ssr: false })
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false })
const Popup = dynamic(() => import('react-leaflet').then(m => m.Popup), { ssr: false })
const Tooltip = dynamic(() => import('react-leaflet').then(m => m.Tooltip), { ssr: false })

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

// ── Zip Code Geocoding Cache ─────────────────────────────────────────────────

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

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MapPage() {
  const { user, loading: authLoading } = useCurrentUser()
  const isManager = user?.isManager ?? false
  const { orgId } = useOrg()

  const [projects, setProjects] = useState<MapProject[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<Set<string>>(new Set())
  const [panelProject, setPanelProject] = useState<Project | null>(null)

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

      const typedData = data as { id: string; name: string; city: string | null; address: string | null; zip: string | null; stage: string; pm: string | null; blocker: string | null; systemkw: number | null }[]
      const zips = [...new Set(typedData.map(p => p.zip).filter((z): z is string => Boolean(z)))]
      await Promise.all(zips.map(z => geocodeZip(z)))

      const mapped: MapProject[] = []
      for (const p of typedData) {
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

  const toggleStage = (stage: string) => {
    setStageFilter(prev => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  const openProject = async (id: string) => {
    const p = await loadProjectById(id)
    if (p) setPanelProject(p)
  }

  if (authLoading) return <div className="min-h-screen bg-gray-900"><Nav active="Map" /></div>
  if (!isManager) return <div className="min-h-screen bg-gray-900"><Nav active="Map" /><div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">Not authorized.</div></div>

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      <Nav active="Map" />

      {/* Controls bar */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-3 flex-wrap z-[10]">
        <div className="flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-semibold text-gray-400">Project Map</span>
          <span className="text-[10px] text-gray-500 ml-1">{filtered.length} of {projects.length} projects</span>
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, city, PM..."
            className="w-full pl-9 pr-3 py-1 bg-gray-800 border border-gray-700 rounded-md text-xs text-white placeholder-gray-500 focus:outline-none focus:border-green-500" />
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

      {/* Map */}
      <div className="flex-1 relative">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <div className="text-gray-500 text-sm">Loading {projects.length > 0 ? `${projects.length} projects...` : 'map...'}</div>
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
              {filtered.map(p => (
                <CircleMarker
                  key={p.id}
                  center={[p.lat, p.lng]}
                  radius={p.blocker ? 8 : 6}
                  pathOptions={{
                    color: p.blocker ? '#ef4444' : STAGE_COLORS[p.stage] ?? '#6b7280',
                    fillColor: p.blocker ? '#ef444480' : STAGE_FILL[p.stage] ?? '#6b728080',
                    fillOpacity: 0.8,
                    weight: p.blocker ? 2 : 1.5,
                  }}
                  eventHandlers={{ click: () => openProject(p.id) }}
                >
                  <Tooltip direction="top" offset={[0, -8]} className="leaflet-dark-tooltip">
                    <div style={{ background: '#1f2937', color: '#e5e7eb', padding: '6px 10px', borderRadius: '6px', fontSize: '11px', border: '1px solid #374151', minWidth: '180px' }}>
                      <div style={{ fontWeight: 600, color: '#fff', marginBottom: '2px' }}>{p.name}</div>
                      <div style={{ color: '#9ca3af', fontSize: '10px' }}>{p.id} &middot; {p.city}</div>
                      <div style={{ marginTop: '4px', display: 'flex', gap: '8px', fontSize: '10px' }}>
                        <span style={{ color: STAGE_COLORS[p.stage], fontWeight: 600 }}>{STAGE_LABELS[p.stage]}</span>
                        {p.systemkw && <span style={{ color: '#9ca3af' }}>{p.systemkw} kW</span>}
                        {p.pm && <span style={{ color: '#6b7280' }}>{p.pm}</span>}
                      </div>
                      {p.blocker && <div style={{ color: '#ef4444', fontSize: '10px', marginTop: '2px' }}>Blocked: {p.blocker}</div>}
                    </div>
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </>
        )}

        {/* Legend overlay */}
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
        </div>
      </div>

      {/* Project Panel */}
      {panelProject && (
        <ProjectPanel project={panelProject} onClose={() => setPanelProject(null)} onProjectUpdated={() => {}} />
      )}
    </div>
  )
}
