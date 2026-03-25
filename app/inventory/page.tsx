'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { loadAllProjectMaterials, loadWarehouseStock, MATERIAL_STATUSES, MATERIAL_SOURCES, MATERIAL_CATEGORIES } from '@/lib/api/inventory'
import type { ProjectMaterial, WarehouseStock } from '@/lib/api/inventory'
import { loadProjects } from '@/lib/api'
import { escapeIlike } from '@/lib/utils'
import { Package, Search, Warehouse } from 'lucide-react'

// ── Category badge colors ──────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  module: 'bg-blue-500/20 text-blue-400',
  inverter: 'bg-purple-500/20 text-purple-400',
  battery: 'bg-emerald-500/20 text-emerald-400',
  optimizer: 'bg-amber-500/20 text-amber-400',
  racking: 'bg-orange-500/20 text-orange-400',
  electrical: 'bg-red-500/20 text-red-400',
  other: 'bg-gray-500/20 text-gray-400',
}

const STATUS_COLORS: Record<string, string> = {
  needed: 'bg-gray-500/20 text-gray-400',
  ordered: 'bg-blue-500/20 text-blue-400',
  shipped: 'bg-amber-500/20 text-amber-400',
  delivered: 'bg-green-500/20 text-green-400',
  installed: 'bg-emerald-500/20 text-emerald-300',
}

type SortField = 'project_id' | 'name' | 'category' | 'quantity' | 'status' | 'expected_date'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<'materials' | 'warehouse'>('materials')
  const [materials, setMaterials] = useState<(ProjectMaterial & { project_name?: string })[]>([])
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStock[]>([])
  const [projects, setProjects] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'project_id', dir: 'asc' })
  const [page, setPage] = useState(1)

  // ── ProjectPanel state (for clicking into a project) ─────────────────────
  const [selectedProject, setSelectedProject] = useState<any>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [mats, projResult] = await Promise.all([
        loadAllProjectMaterials(),
        loadProjects({ limit: 2000 }),
      ])
      setMaterials(mats)
      const pMap: Record<string, string> = {}
      for (const p of (projResult.data ?? [])) pMap[p.id] = p.name
      setProjects(pMap)
      setLoading(false)
    }
    load()
  }, [])

  // Load warehouse when tab switches
  useEffect(() => {
    if (activeTab === 'warehouse' && warehouseStock.length === 0) {
      loadWarehouseStock().then(setWarehouseStock)
    }
  }, [activeTab, warehouseStock.length])

  // ── Filtered + sorted materials ──────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = materials

    // Status filter
    if (filterStatus) {
      list = list.filter(m => m.status === filterStatus)
    }
    // Category filter
    if (filterCategory) {
      list = list.filter(m => m.category === filterCategory)
    }
    // Source filter
    if (filterSource) {
      list = list.filter(m => m.source === filterSource)
    }
    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(m => {
        const pName = (m.project_name || projects[m.project_id] || '').toLowerCase()
        return (
          m.name.toLowerCase().includes(q) ||
          m.project_id.toLowerCase().includes(q) ||
          pName.includes(q) ||
          (m.vendor ?? '').toLowerCase().includes(q)
        )
      })
    }

    // Sort
    list = [...list].sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      const av = (a as any)[sort.field] ?? ''
      const bv = (b as any)[sort.field] ?? ''
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })

    return list
  }, [materials, filterStatus, filterCategory, filterSource, search, sort, projects])

  // ── Summary counts ───────────────────────────────────────────────────────
  const summaryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of MATERIAL_STATUSES) counts[s] = 0
    for (const m of materials) {
      counts[m.status] = (counts[m.status] || 0) + 1
    }
    return counts
  }, [materials])

  // ── Pagination ───────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pagedMaterials = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [filterStatus, filterCategory, filterSource, search])

  function toggleSort(field: SortField) {
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  function sortIcon(field: SortField) {
    if (sort.field !== field) return ''
    return sort.dir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      <Nav active="Inventory" />

      <div className="flex-1 p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto w-full">
        {/* Header */}
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-green-400" />
            Inventory
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Project materials and warehouse stock</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setActiveTab('materials')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'materials' ? 'border-b-2 border-green-400 text-green-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" /> Project Materials
          </button>
          <button
            onClick={() => setActiveTab('warehouse')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'warehouse' ? 'border-b-2 border-green-400 text-green-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Warehouse className="w-3.5 h-3.5" /> Warehouse
          </button>
        </div>

        {/* PROJECT MATERIALS TAB */}
        {activeTab === 'materials' && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(['needed', 'ordered', 'shipped', 'delivered'] as const).map(s => (
                <div key={s} className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xs text-gray-400 capitalize">{s}</div>
                  <div className="text-xl font-bold text-white mt-1">{summaryCounts[s] || 0}</div>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search project, item, vendor..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-gray-500"
                />
              </div>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="">All Statuses</option>
                {MATERIAL_STATUSES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <select
                value={filterCategory}
                onChange={e => setFilterCategory(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="">All Categories</option>
                {MATERIAL_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
              <select
                value={filterSource}
                onChange={e => setFilterSource(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="">All Sources</option>
                {MATERIAL_SOURCES.map(s => (
                  <option key={s} value={s}>{s === 'tbd' ? 'TBD' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* Table */}
            {loading ? (
              <div className="text-gray-500 text-sm py-8 text-center">Loading materials...</div>
            ) : filtered.length === 0 ? (
              <div className="text-gray-500 text-sm py-8 text-center">
                {materials.length === 0 ? 'No project materials found. Add materials from individual project panels.' : 'No materials match your filters.'}
              </div>
            ) : (
              <>
                <div className="bg-gray-800 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700 text-gray-400 text-xs">
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('project_id')}>
                            Project{sortIcon('project_id')}
                          </th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('name')}>
                            Item{sortIcon('name')}
                          </th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('category')}>
                            Category{sortIcon('category')}
                          </th>
                          <th className="text-center px-3 py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('quantity')}>
                            Qty{sortIcon('quantity')}
                          </th>
                          <th className="text-left px-3 py-2">Source</th>
                          <th className="text-left px-3 py-2">Vendor</th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('status')}>
                            Status{sortIcon('status')}
                          </th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" onClick={() => toggleSort('expected_date')}>
                            Expected{sortIcon('expected_date')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedMaterials.map(m => (
                          <tr key={m.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                            <td className="px-3 py-2">
                              <span className="text-green-400 font-mono text-xs">{m.project_id}</span>
                              <div className="text-xs text-gray-500 truncate max-w-[150px]">
                                {m.project_name || projects[m.project_id] || ''}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-white">{m.name}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[m.category] || CATEGORY_COLORS.other}`}>
                                {m.category}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center text-gray-300">{m.quantity}</td>
                            <td className="px-3 py-2 text-xs text-gray-400">
                              {m.source === 'tbd' ? 'TBD' : m.source}
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-400 truncate max-w-[120px]">{m.vendor || '\u2014'}</td>
                            <td className="px-3 py-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[m.status] || STATUS_COLORS.needed}`}>
                                {m.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-400">
                              {m.expected_date || '\u2014'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</span>
                  <Pagination
                    currentPage={page}
                    totalCount={filtered.length}
                    pageSize={PAGE_SIZE}
                    hasMore={page < totalPages}
                    onPrevPage={() => setPage(p => Math.max(1, p - 1))}
                    onNextPage={() => setPage(p => Math.min(totalPages, p + 1))}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* WAREHOUSE TAB */}
        {activeTab === 'warehouse' && (
          <div className="text-center py-16">
            <Warehouse className="w-10 h-10 text-gray-600 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-400 mb-2">Warehouse Stock Tracking</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Warehouse inventory management coming in Phase 3. This will track BOS materials, reorder points, and bin locations for the warehouse team.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
