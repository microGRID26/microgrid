'use client'

import { Pagination } from '@/components/Pagination'
import { MATERIAL_STATUSES, MATERIAL_SOURCES, MATERIAL_CATEGORIES } from '@/lib/api/inventory'
import type { ProjectMaterial } from '@/lib/api/inventory'
import { Search, Download } from 'lucide-react'

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

export interface MaterialsTabProps {
  materials: (ProjectMaterial & { project_name: string | null })[]
  projects: Record<string, string>
  loading: boolean
  // Filter state
  search: string
  onSearchChange: (val: string) => void
  filterStatus: string
  onFilterStatusChange: (val: string) => void
  filterCategory: string
  onFilterCategoryChange: (val: string) => void
  filterSource: string
  onFilterSourceChange: (val: string) => void
  // Sort state
  sort: { field: SortField; dir: SortDir }
  onSortChange: (sort: { field: SortField; dir: SortDir }) => void
  // Pagination state
  page: number
  onPageChange: (page: number) => void
  pageSize: number
  // Derived data
  filtered: (ProjectMaterial & { project_name: string | null })[]
  summaryCounts: Record<string, number>
}

export function MaterialsTab({
  materials,
  projects,
  loading,
  search,
  onSearchChange,
  filterStatus,
  onFilterStatusChange,
  filterCategory,
  onFilterCategoryChange,
  filterSource,
  onFilterSourceChange,
  sort,
  onSortChange,
  page,
  onPageChange,
  pageSize,
  filtered,
  summaryCounts,
}: MaterialsTabProps) {
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pagedMaterials = filtered.slice((page - 1) * pageSize, page * pageSize)

  function toggleSort(field: SortField) {
    onSortChange({
      field,
      dir: sort.field === field && sort.dir === 'asc' ? 'desc' : 'asc',
    })
  }

  function sortIcon(field: SortField) {
    if (sort.field !== field) return ''
    return sort.dir === 'asc' ? ' \u25B2' : ' \u25BC'
  }

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

  return (
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
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search project, item, vendor..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-gray-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => onFilterStatusChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Statuses</option>
          {MATERIAL_STATUSES.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={e => onFilterCategoryChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Categories</option>
          {MATERIAL_CATEGORIES.map(c => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
        <select
          value={filterSource}
          onChange={e => onFilterSourceChange(e.target.value)}
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
              pageSize={pageSize}
              hasMore={page < totalPages}
              onPrevPage={() => onPageChange(Math.max(1, page - 1))}
              onNextPage={() => onPageChange(Math.min(totalPages, page + 1))}
            />
          </div>
        </>
      )}
    </>
  )
}
