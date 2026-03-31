'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { Pagination } from '@/components/Pagination'
import { WarehouseTab } from '@/components/inventory/WarehouseTab'
import {
  loadAllProjectMaterials, loadWarehouseStock, getLowStockItems,
  loadPurchaseOrders, loadPOLineItems, updatePurchaseOrderStatus, updatePurchaseOrder,
  MATERIAL_STATUSES, MATERIAL_SOURCES, MATERIAL_CATEGORIES,
  PO_STATUSES, PO_STATUS_COLORS,
} from '@/lib/api/inventory'
import type { ProjectMaterial, WarehouseStock, PurchaseOrder, POLineItem } from '@/lib/api/inventory'
import { loadProjects } from '@/lib/api'
import { escapeIlike, fmtDate, fmt$ } from '@/lib/utils'
import { Package, Search, Warehouse, ShoppingCart, ChevronDown, ChevronUp, Truck, CheckCircle2, X, AlertTriangle, Download } from 'lucide-react'
import { searchVendors } from '@/lib/api/vendors'
import type { Vendor } from '@/lib/api/vendors'
import { useCurrentUser } from '@/lib/useCurrentUser'

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
  const { user: authUser, loading: authLoading } = useCurrentUser()
  const [activeTab, setActiveTab] = useState<'materials' | 'warehouse' | 'purchase-orders'>('materials')
  const [materials, setMaterials] = useState<(ProjectMaterial & { project_name: string | null })[]>([])
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStock[]>([])
  const [projects, setProjects] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({ field: 'project_id', dir: 'asc' })
  const [page, setPage] = useState(1)

  // ── PO state ──────────────────────────────────────────────────────────────
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [poLoading, setPOLoading] = useState(false)
  const [poSearch, setPOSearch] = useState('')
  const [poFilterStatus, setPOFilterStatus] = useState('')
  const [expandedPO, setExpandedPO] = useState<string | null>(null)
  const [poLineItems, setPOLineItems] = useState<Record<string, POLineItem[]>>({})
  const [poPage, setPOPage] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ poId: string; newStatus: string; accurate?: boolean; discrepancy?: string } | null>(null)

  // ── Vendor contact lookup cache ────────────────────────────────────────────
  const [vendorInfoCache, setVendorInfoCache] = useState<Record<string, Vendor | null>>({})
  async function lookupVendor(vendorName: string) {
    if (vendorInfoCache[vendorName] !== undefined) return
    setVendorInfoCache(prev => ({ ...prev, [vendorName]: null }))
    const results = await searchVendors(vendorName)
    const match = results.find(v => v.name.toLowerCase() === vendorName.toLowerCase()) ?? results[0] ?? null
    setVendorInfoCache(prev => ({ ...prev, [vendorName]: match }))
  }

  // ── ProjectPanel state (for clicking into a project) ─────────────────────
  const [selectedProject, setSelectedProject] = useState<any>(null)

  // ── Low stock alert count (shown in header) ─────────────────────────────
  const [lowStockCount, setLowStockCount] = useState(0)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [mats, projResult, lowItems] = await Promise.all([
        loadAllProjectMaterials(),
        loadProjects({ limit: 2000 }),
        getLowStockItems(),
      ])
      setMaterials(mats)
      const pMap: Record<string, string> = {}
      for (const p of (projResult.data ?? [])) pMap[p.id] = p.name
      setProjects(pMap)
      setLowStockCount(lowItems.length)
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

  // Load POs when tab switches
  const loadPOs = useCallback(async () => {
    setPOLoading(true)
    const pos = await loadPurchaseOrders()
    setPurchaseOrders(pos)
    setPOLoading(false)
  }, [])

  useEffect(() => {
    if (activeTab === 'purchase-orders' && purchaseOrders.length === 0) {
      loadPOs()
    }
  }, [activeTab, purchaseOrders.length, loadPOs])

  // Load line items when expanding a PO
  async function handleExpandPO(poId: string) {
    if (expandedPO === poId) {
      setExpandedPO(null)
      return
    }
    setExpandedPO(poId)
    if (!poLineItems[poId]) {
      const items = await loadPOLineItems(poId)
      setPOLineItems(prev => ({ ...prev, [poId]: items }))
    }
    // Look up vendor contact info
    const po = purchaseOrders.find(p => p.id === poId)
    if (po?.vendor) lookupVendor(po.vendor)
  }

  // Status advance (with double-submit guard)
  const [poAdvancing, setPOAdvancing] = useState(false)
  async function handleStatusAdvance(poId: string, newStatus: string) {
    if (poAdvancing) return
    setPOAdvancing(true)
    // Save delivery accuracy when marking as delivered
    if (newStatus === 'delivered' && confirmAction) {
      const updates: Record<string, unknown> = {}
      if (confirmAction.accurate !== undefined) updates.delivery_accurate = confirmAction.accurate
      if (confirmAction.discrepancy) updates.delivery_discrepancy = confirmAction.discrepancy
      if (Object.keys(updates).length > 0) {
        await updatePurchaseOrder(poId, updates)
      }
    }
    setConfirmAction(null)
    const ok = await updatePurchaseOrderStatus(poId, newStatus)
    if (ok) {
      setPurchaseOrders(prev => prev.map(p => p.id === poId ? { ...p, status: newStatus, updated_at: new Date().toISOString() } : p))
      setToast(`PO updated to ${newStatus}`)
    } else {
      setToast('Failed to update PO status')
    }
    setTimeout(() => setToast(null), 3000)
    setPOAdvancing(false)
  }

  // Save PO field edits
  async function handleSavePOField(poId: string, updates: Partial<PurchaseOrder>) {
    const ok = await updatePurchaseOrder(poId, updates)
    if (ok) {
      setPurchaseOrders(prev => prev.map(p => p.id === poId ? { ...p, ...updates } : p))
      setToast('PO updated')
      setTimeout(() => setToast(null), 3000)
    }
  }

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
      const av = (a as unknown as Record<string, unknown>)[sort.field] ?? ''
      const bv = (b as unknown as Record<string, unknown>)[sort.field] ?? ''
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

  // ── Filtered POs ────────────────────────────────────────────────────────
  const filteredPOs = useMemo(() => {
    let list = purchaseOrders
    if (poFilterStatus) list = list.filter(p => p.status === poFilterStatus)
    if (poSearch.trim()) {
      const q = poSearch.toLowerCase()
      list = list.filter(p =>
        p.po_number.toLowerCase().includes(q) ||
        p.vendor.toLowerCase().includes(q) ||
        (p.project_id ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [purchaseOrders, poFilterStatus, poSearch])

  const PO_PAGE_SIZE = 50
  const poTotalPages = Math.max(1, Math.ceil(filteredPOs.length / PO_PAGE_SIZE))
  const pagedPOs = filteredPOs.slice((poPage - 1) * PO_PAGE_SIZE, poPage * PO_PAGE_SIZE)

  useEffect(() => { setPOPage(1) }, [poFilterStatus, poSearch])

  // ── PO status counts ───────────────────────────────────────────────────
  const poStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of PO_STATUSES) counts[s] = 0
    for (const p of purchaseOrders) counts[p.status] = (counts[p.status] || 0) + 1
    return counts
  }, [purchaseOrders])

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

  // ── CSV Export (materials tab) ──────────────────────────────────────────────
  function exportMaterialsCSV() {
    const headers = ['Project ID', 'Item Name', 'Category', 'Quantity', 'Unit', 'Source', 'Vendor', 'Sourcing', 'Sell Price', 'Status', 'PO Number', 'Expected Date', 'Delivered Date']
    const rows = filtered.map(m => [
      m.project_id,
      m.name,
      m.category ?? '',
      m.quantity ?? '',
      m.unit ?? '',
      m.source ?? '',
      m.vendor ?? '',
      m.sourcing ?? '',
      m.sell_price != null ? m.sell_price.toString() : '',
      m.status ?? '',
      m.po_number ?? '',
      m.expected_date ?? '',
      m.delivered_date ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `project-materials-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Auth gate: Manager+ required ──────────────────────────────────────────
  const isManager = authUser?.isManager ?? false

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Checking permissions…</div>
      </div>
    )
  }

  if (!isManager) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <Nav active="Inventory" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-white mb-2">Access Restricted</h1>
            <p className="text-sm text-gray-500">Manager or higher role required to view this page.</p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              ← Back to Command Center
            </a>
          </div>
        </div>
      </div>
    )
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

        {/* Low stock alert (header-level) */}
        {lowStockCount > 0 && activeTab !== 'warehouse' && (
          <button
            onClick={() => setActiveTab('warehouse')}
            className="w-full bg-amber-900/30 border border-amber-700/50 rounded-lg px-4 py-3 flex items-center gap-3 hover:bg-amber-900/40 transition-colors text-left"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-sm text-amber-300">
              {lowStockCount} warehouse item{lowStockCount !== 1 ? 's' : ''} below reorder point
            </span>
          </button>
        )}

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
            onClick={() => setActiveTab('purchase-orders')}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'purchase-orders' ? 'border-b-2 border-green-400 text-green-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" /> Purchase Orders
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
              <button onClick={exportMaterialsCSV} aria-label="Export materials to CSV"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors shrink-0 ml-auto">
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
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
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" role="button" tabIndex={0} onClick={() => toggleSort('project_id')} onKeyDown={e => e.key === 'Enter' && toggleSort('project_id')}>
                            Project{sortIcon('project_id')}
                          </th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" role="button" tabIndex={0} onClick={() => toggleSort('name')} onKeyDown={e => e.key === 'Enter' && toggleSort('name')}>
                            Item{sortIcon('name')}
                          </th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" role="button" tabIndex={0} onClick={() => toggleSort('category')} onKeyDown={e => e.key === 'Enter' && toggleSort('category')}>
                            Category{sortIcon('category')}
                          </th>
                          <th className="text-center px-3 py-2 cursor-pointer hover:text-white" role="button" tabIndex={0} onClick={() => toggleSort('quantity')} onKeyDown={e => e.key === 'Enter' && toggleSort('quantity')}>
                            Qty{sortIcon('quantity')}
                          </th>
                          <th className="text-left px-3 py-2">Source</th>
                          <th className="text-left px-3 py-2">Vendor</th>
                          <th className="text-left px-3 py-2">Sourcing</th>
                          <th className="text-right px-3 py-2">Sell Price</th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" role="button" tabIndex={0} onClick={() => toggleSort('status')} onKeyDown={e => e.key === 'Enter' && toggleSort('status')}>
                            Status{sortIcon('status')}
                          </th>
                          <th className="text-left px-3 py-2 cursor-pointer hover:text-white" role="button" tabIndex={0} onClick={() => toggleSort('expected_date')} onKeyDown={e => e.key === 'Enter' && toggleSort('expected_date')}>
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
                            <td className="px-3 py-2 text-xs text-gray-400 truncate max-w-[100px]">{m.sourcing || '\u2014'}</td>
                            <td className="px-3 py-2 text-xs text-gray-400 text-right">{m.sell_price != null ? `$${Number(m.sell_price).toFixed(2)}` : '\u2014'}</td>
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

        {/* PURCHASE ORDERS TAB */}
        {activeTab === 'purchase-orders' && (
          <>
            {/* Toast */}
            {toast && (
              <div className="fixed top-4 right-4 z-[200] bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
                {toast}
              </div>
            )}

            {/* Confirmation dialog */}
            {confirmAction && (
              <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center" onClick={() => setConfirmAction(null)}>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold text-white mb-2">Confirm Status Change</h3>
                  <p className="text-xs text-gray-400 mb-4">
                    Advance this PO to <span className={`px-1.5 py-0.5 rounded ${PO_STATUS_COLORS[confirmAction.newStatus]}`}>{confirmAction.newStatus}</span>?
                    {confirmAction.newStatus === 'delivered' && (
                      <span className="block mt-2 text-amber-400">This will also mark all linked materials as delivered.</span>
                    )}
                  </p>
                  {confirmAction.newStatus === 'delivered' && (
                    <div className="mb-4 space-y-3 border-t border-gray-700 pt-3">
                      <div className="text-[10px] text-gray-500 uppercase font-medium">Delivery Accuracy</div>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmAction(a => a ? { ...a, accurate: true } : a)}
                          className={`flex-1 text-xs py-1.5 rounded border ${confirmAction.accurate === true ? 'bg-green-900/40 border-green-500 text-green-400' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                          All Correct
                        </button>
                        <button onClick={() => setConfirmAction(a => a ? { ...a, accurate: false } : a)}
                          className={`flex-1 text-xs py-1.5 rounded border ${confirmAction.accurate === false ? 'bg-red-900/40 border-red-500 text-red-400' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                          Has Issues
                        </button>
                      </div>
                      {confirmAction.accurate === false && (
                        <input
                          placeholder="Describe discrepancy (missing items, wrong qty, damage...)"
                          value={confirmAction.discrepancy ?? ''}
                          onChange={e => setConfirmAction(a => a ? { ...a, discrepancy: e.target.value } : a)}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-xs text-white placeholder-gray-500"
                        />
                      )}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmAction(null)} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">Cancel</button>
                    <button
                      onClick={() => handleStatusAdvance(confirmAction.poId, confirmAction.newStatus)}
                      disabled={poAdvancing}
                      className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {poAdvancing ? 'Updating…' : 'Confirm'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(['draft', 'submitted', 'confirmed', 'shipped', 'delivered'] as const).map(s => (
                <div key={s} className="bg-gray-800 rounded-lg p-3">
                  <div className="text-xs text-gray-400 capitalize">{s}</div>
                  <div className="text-xl font-bold text-white mt-1">{poStatusCounts[s] || 0}</div>
                </div>
              ))}
            </div>

            {/* #5+#6: Vendor Performance — cycle times + accuracy */}
            {(() => {
              const delivered = purchaseOrders.filter(p => p.status === 'delivered')
              if (delivered.length === 0) return null
              const byVendor = new Map<string, { count: number; totalDays: number; accurate: number; rated: number }>()
              for (const po of delivered) {
                const v = byVendor.get(po.vendor) ?? { count: 0, totalDays: 0, accurate: 0, rated: 0 }
                v.count++
                if (po.submitted_at && po.delivered_at) {
                  v.totalDays += Math.round((new Date(po.delivered_at).getTime() - new Date(po.submitted_at).getTime()) / 86400000)
                }
                if (po.delivery_accurate === true) { v.accurate++; v.rated++ }
                else if (po.delivery_accurate === false) { v.rated++ }
                byVendor.set(po.vendor, v)
              }
              const vendors = [...byVendor.entries()].sort((a, b) => b[1].count - a[1].count)
              return (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h4 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Vendor Delivery Performance</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {vendors.map(([name, v]) => (
                      <div key={name} className="bg-gray-900 rounded-lg p-3">
                        <div className="text-xs font-medium text-white truncate mb-2">{name}</div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <div className="text-[10px] text-gray-500">POs</div>
                            <div className="text-sm font-bold text-white">{v.count}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-500">Avg Days</div>
                            <div className="text-sm font-bold text-blue-400">{v.count > 0 ? Math.round(v.totalDays / v.count) : '\u2014'}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-gray-500">Accuracy</div>
                            <div className={`text-sm font-bold ${v.rated > 0 ? (v.accurate / v.rated >= 0.9 ? 'text-green-400' : 'text-amber-400') : 'text-gray-500'}`}>
                              {v.rated > 0 ? `${Math.round(v.accurate / v.rated * 100)}%` : '\u2014'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={poSearch}
                  onChange={e => setPOSearch(e.target.value)}
                  placeholder="Search PO#, vendor, project..."
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-gray-500"
                />
              </div>
              <select
                value={poFilterStatus}
                onChange={e => setPOFilterStatus(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
              >
                <option value="">All Statuses</option>
                {PO_STATUSES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>

            {/* PO Table */}
            {poLoading ? (
              <div className="text-gray-500 text-sm py-8 text-center">Loading purchase orders...</div>
            ) : filteredPOs.length === 0 ? (
              <div className="text-gray-500 text-sm py-8 text-center">
                {purchaseOrders.length === 0
                  ? 'No purchase orders yet. Create POs from the Materials tab in a project panel.'
                  : 'No purchase orders match your filters.'}
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_120px_100px_80px_80px_100px_100px_auto] gap-2 text-xs text-gray-500 font-medium px-4 py-1.5">
                    <span>PO #</span>
                    <span>Vendor</span>
                    <span>Project</span>
                    <span className="text-center">Items</span>
                    <span className="text-right">Total</span>
                    <span className="text-center">Status</span>
                    <span>Expected</span>
                    <span></span>
                  </div>
                  {pagedPOs.map(po => {
                    const isExpanded = expandedPO === po.id
                    const items = poLineItems[po.id] ?? []
                    const statusIdx = (PO_STATUSES as readonly string[]).indexOf(po.status)
                    const nextStatus = statusIdx >= 0 && statusIdx < PO_STATUSES.length - 2
                      ? PO_STATUSES[statusIdx + 1]
                      : null

                    return (
                      <div key={po.id}>
                        {/* PO Row */}
                        <div
                          className={`grid grid-cols-[1fr_120px_100px_80px_80px_100px_100px_auto] gap-2 items-center text-sm px-4 py-3 rounded-lg transition-colors cursor-pointer ${
                            isExpanded ? 'bg-gray-800 border border-gray-700' : 'bg-gray-800/50 hover:bg-gray-800'
                          }`}
                          onClick={() => handleExpandPO(po.id)}
                        >
                          <div>
                            <span className="text-blue-400 font-mono text-xs font-medium">{po.po_number}</span>
                          </div>
                          <span className="text-white text-xs truncate">{po.vendor}</span>
                          <span className="text-green-400 font-mono text-xs">{po.project_id ?? '\u2014'}</span>
                          <span className="text-xs text-gray-400 text-center">{items.length > 0 ? items.length : '\u2014'}</span>
                          <span className="text-xs text-gray-300 text-right">{po.total_amount ? fmt$(po.total_amount) : '\u2014'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded text-center ${PO_STATUS_COLORS[po.status] ?? PO_STATUS_COLORS.draft}`}>
                            {po.status}
                          </span>
                          <span className="text-xs text-gray-400">{po.expected_delivery ?? '\u2014'}</span>
                          <span>
                            {isExpanded
                              ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                              : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                          </span>
                        </div>

                        {/* Expanded PO Detail */}
                        {isExpanded && (
                          <div className="bg-gray-800 border border-gray-700 border-t-0 rounded-b-lg p-5 space-y-4 -mt-1">
                            {/* Status timeline */}
                            <div className="flex items-center gap-1">
                              {PO_STATUSES.filter(s => s !== 'cancelled').map((s, i) => {
                                const currentIdx = (PO_STATUSES as readonly string[]).indexOf(po.status)
                                const thisIdx = PO_STATUSES.indexOf(s)
                                const isActive = thisIdx <= currentIdx && po.status !== 'cancelled'
                                const isCurrent = s === po.status
                                return (
                                  <div key={s} className="flex items-center gap-1">
                                    {i > 0 && (
                                      <div className={`w-6 h-0.5 ${isActive ? 'bg-green-500' : 'bg-gray-700'}`} />
                                    )}
                                    <div
                                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                                        isCurrent
                                          ? PO_STATUS_COLORS[s]
                                          : isActive
                                            ? 'bg-green-900/30 text-green-500'
                                            : 'bg-gray-900 text-gray-600'
                                      }`}
                                    >
                                      {s}
                                    </div>
                                  </div>
                                )
                              })}
                              {po.status === 'cancelled' && (
                                <span className="ml-2 px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 font-medium">cancelled</span>
                              )}
                            </div>

                            {/* Vendor contact info */}
                            {(() => {
                              const vi = vendorInfoCache[po.vendor]
                              if (!vi) return null
                              return (vi.contact_phone || vi.contact_email || vi.contact_name) ? (
                                <div className="bg-gray-900 rounded-lg px-3 py-2 flex flex-wrap gap-4 text-xs">
                                  <span className="text-gray-400 font-medium">Vendor Contact:</span>
                                  {vi.contact_name && <span className="text-gray-300">{vi.contact_name}</span>}
                                  {vi.contact_phone && <span className="text-blue-400">{vi.contact_phone}</span>}
                                  {vi.contact_email && <span className="text-blue-400">{vi.contact_email}</span>}
                                </div>
                              ) : null
                            })()}

                            {/* PO header details */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                              <div>
                                <span className="text-gray-500 block">Created</span>
                                <span className="text-gray-300">{fmtDate(po.created_at)}</span>
                              </div>
                              <div>
                                <span className="text-gray-500 block">Submitted</span>
                                <span className="text-gray-300">{po.submitted_at ? fmtDate(po.submitted_at) : '\u2014'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500 block">Tracking #</span>
                                <span className="text-gray-300">{po.tracking_number || '\u2014'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500 block">Expected Delivery</span>
                                <span className="text-gray-300">{po.expected_delivery || '\u2014'}</span>
                              </div>
                            </div>

                            {/* Line items table */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 mb-2">Line Items</h4>
                              {items.length === 0 ? (
                                <div className="text-xs text-gray-600 py-2">Loading line items...</div>
                              ) : (
                                <div className="bg-gray-900 rounded-lg overflow-hidden">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-gray-800 text-gray-500">
                                        <th className="text-left px-3 py-1.5">Item</th>
                                        <th className="text-center px-3 py-1.5">Qty</th>
                                        <th className="text-right px-3 py-1.5">Unit Price</th>
                                        <th className="text-right px-3 py-1.5">Total</th>
                                        <th className="text-left px-3 py-1.5">Notes</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map(item => (
                                        <tr key={item.id} className="border-b border-gray-800/50">
                                          <td className="px-3 py-1.5 text-white">{item.name}</td>
                                          <td className="px-3 py-1.5 text-center text-gray-300">{item.quantity}</td>
                                          <td className="px-3 py-1.5 text-right text-gray-300">{item.unit_price ? fmt$(item.unit_price) : '\u2014'}</td>
                                          <td className="px-3 py-1.5 text-right text-gray-300">{item.total_price ? fmt$(item.total_price) : '\u2014'}</td>
                                          <td className="px-3 py-1.5 text-gray-500 truncate max-w-[150px]">{item.notes || '\u2014'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>

                            {/* Notes */}
                            <div>
                              <h4 className="text-xs font-semibold text-gray-400 mb-1">Notes</h4>
                              <p className="text-xs text-gray-300">{po.notes || 'No notes.'}</p>
                            </div>

                            {/* #5: Cycle time + #6: Delivery accuracy */}
                            {po.status === 'delivered' && (
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-gray-700">
                                <div>
                                  <span className="text-gray-500 text-xs block">Cycle Time</span>
                                  <span className="text-white text-sm font-semibold">
                                    {po.submitted_at && po.delivered_at
                                      ? `${Math.round((new Date(po.delivered_at).getTime() - new Date(po.submitted_at).getTime()) / 86400000)}d`
                                      : '\u2014'}
                                  </span>
                                  <span className="text-[10px] text-gray-500 block">submit → deliver</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 text-xs block">Delivered</span>
                                  <span className="text-white text-sm">{fmtDate(po.delivered_at)}</span>
                                </div>
                                <div>
                                  <span className="text-gray-500 text-xs block">Accuracy</span>
                                  {po.delivery_accurate === true && <span className="text-green-400 text-sm font-medium">All Correct</span>}
                                  {po.delivery_accurate === false && <span className="text-red-400 text-sm font-medium">Has Issues</span>}
                                  {po.delivery_accurate == null && <span className="text-gray-500 text-sm">Not rated</span>}
                                </div>
                                {po.delivery_discrepancy && (
                                  <div>
                                    <span className="text-gray-500 text-xs block">Discrepancy</span>
                                    <span className="text-red-300 text-xs">{po.delivery_discrepancy}</span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2 pt-2 border-t border-gray-700">
                              {nextStatus && po.status !== 'cancelled' && (
                                <button
                                  onClick={() => setConfirmAction({ poId: po.id, newStatus: nextStatus })}
                                  className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 transition-colors flex items-center gap-1"
                                >
                                  {nextStatus === 'delivered' && <Truck className="w-3 h-3" />}
                                  {nextStatus === 'confirmed' && <CheckCircle2 className="w-3 h-3" />}
                                  Advance to {nextStatus}
                                </button>
                              )}
                              {po.status !== 'cancelled' && po.status !== 'delivered' && (
                                <button
                                  onClick={() => setConfirmAction({ poId: po.id, newStatus: 'cancelled' })}
                                  className="text-xs px-3 py-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors flex items-center gap-1"
                                >
                                  <X className="w-3 h-3" /> Cancel PO
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{filteredPOs.length} PO{filteredPOs.length !== 1 ? 's' : ''}</span>
                  <Pagination
                    currentPage={poPage}
                    totalCount={filteredPOs.length}
                    pageSize={PO_PAGE_SIZE}
                    hasMore={poPage < poTotalPages}
                    onPrevPage={() => setPOPage(p => Math.max(1, p - 1))}
                    onNextPage={() => setPOPage(p => Math.min(poTotalPages, p + 1))}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* WAREHOUSE TAB */}
        {activeTab === 'warehouse' && (
          <WarehouseTab projects={projects} />
        )}
      </div>
    </div>
  )
}
