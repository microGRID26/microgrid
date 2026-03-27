'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { cn, fmtDate, fmt$, escapeIlike } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import {
  loadAllWarranties,
  loadOpenClaims,
  loadExpiringWarranties,
  WARRANTY_EQUIPMENT_TYPES,
} from '@/lib/api/warranties'
import type { EquipmentWarranty, WarrantyClaim } from '@/lib/api/warranties'
import { createClient } from '@/lib/supabase/client'
import type { Project } from '@/types/database'
import { Shield, Search, Download, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

function warrantyStatus(w: EquipmentWarranty): 'active' | 'expiring' | 'expired' | 'unknown' {
  if (!w.warranty_end_date) return 'unknown'
  const end = new Date(w.warranty_end_date + 'T00:00:00')
  const daysLeft = Math.floor((end.getTime() - Date.now()) / 86400000)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 90) return 'expiring'
  return 'active'
}

function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null
  const end = new Date(endDate + 'T00:00:00')
  return Math.floor((end.getTime() - Date.now()) / 86400000)
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  expiring: 'bg-amber-500/20 text-amber-400',
  expired: 'bg-red-500/20 text-red-400',
  unknown: 'bg-gray-500/20 text-gray-400',
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  expiring: 'Expiring Soon',
  expired: 'Expired',
  unknown: 'No End Date',
}

const TYPE_COLORS: Record<string, string> = {
  panel: 'bg-blue-500/20 text-blue-400',
  inverter: 'bg-purple-500/20 text-purple-400',
  battery: 'bg-emerald-500/20 text-emerald-400',
  optimizer: 'bg-amber-500/20 text-amber-400',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WarrantyPage() {
  const { user: currentUser, loading: authLoading } = useCurrentUser()

  const [warranties, setWarranties] = useState<EquipmentWarranty[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  // Filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [mfgFilter, setMfgFilter] = useState('')

  // Summary stats
  const [activeCount, setActiveCount] = useState(0)
  const [expiringCount, setExpiringCount] = useState(0)
  const [expiredCount, setExpiredCount] = useState(0)
  const [openClaimCount, setOpenClaimCount] = useState(0)

  // Sort
  const [sortCol, setSortCol] = useState<string>('warranty_end_date')
  const [sortAsc, setSortAsc] = useState(true)

  // ProjectPanel
  const [panelProject, setPanelProject] = useState<Project | null>(null)

  // ── Load data ─────────────────────────────────────────────────────────────
  const fetchWarranties = useCallback(async () => {
    setLoading(true)
    const { data, total: t } = await loadAllWarranties(page, PAGE_SIZE, {
      search: search || undefined,
      equipmentType: typeFilter || undefined,
      manufacturer: mfgFilter || undefined,
    })
    // Client-side status filter (depends on date math)
    const filtered = statusFilter
      ? data.filter(w => warrantyStatus(w) === statusFilter)
      : data
    setWarranties(filtered)
    setTotal(statusFilter ? filtered.length : t)
    setLoading(false)
  }, [page, search, typeFilter, mfgFilter, statusFilter])

  const fetchSummary = useCallback(async () => {
    // Fetch all for summary counts (first page unfiltered)
    const { data: all } = await loadAllWarranties(1, 10000)
    setActiveCount(all.filter(w => warrantyStatus(w) === 'active').length)
    setExpiringCount(all.filter(w => warrantyStatus(w) === 'expiring').length)
    setExpiredCount(all.filter(w => warrantyStatus(w) === 'expired').length)

    const claims = await loadOpenClaims()
    setOpenClaimCount(claims.length)
  }, [])

  useEffect(() => { fetchWarranties() }, [fetchWarranties])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [search, typeFilter, statusFilter, mfgFilter])

  // ── Manufacturers for dropdown ──────────────────────────────────────────
  const [allMfgs, setAllMfgs] = useState<string[]>([])
  useEffect(() => {
    async function loadMfgs() {
      const { data } = await loadAllWarranties(1, 10000)
      const mfgs = Array.from(new Set(data.map(w => w.manufacturer).filter(Boolean) as string[])).sort()
      setAllMfgs(mfgs)
    }
    loadMfgs()
  }, [])

  // ── Sort handler ────────────────────────────────────────────────────────
  function handleSort(col: string) {
    if (sortCol === col) {
      setSortAsc(!sortAsc)
    } else {
      setSortCol(col)
      setSortAsc(true)
    }
  }

  const sortedWarranties = useMemo(() => {
    const sorted = [...warranties]
    sorted.sort((a, b) => {
      let va: string | number | null = null
      let vb: string | number | null = null
      switch (sortCol) {
        case 'project_id': va = a.project_id; vb = b.project_id; break
        case 'equipment_type': va = a.equipment_type; vb = b.equipment_type; break
        case 'manufacturer': va = a.manufacturer; vb = b.manufacturer; break
        case 'model': va = a.model; vb = b.model; break
        case 'serial_number': va = a.serial_number; vb = b.serial_number; break
        case 'warranty_end_date': va = a.warranty_end_date; vb = b.warranty_end_date; break
        case 'warranty_start_date': va = a.warranty_start_date; vb = b.warranty_start_date; break
        default: va = a.warranty_end_date; vb = b.warranty_end_date
      }
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      if (va < vb) return sortAsc ? -1 : 1
      if (va > vb) return sortAsc ? 1 : -1
      return 0
    })
    return sorted
  }, [warranties, sortCol, sortAsc])

  // ── Open ProjectPanel ───────────────────────────────────────────────────
  async function openProject(projectId: string) {
    const supabase = createClient()
    const { data } = await supabase.from('projects').select('*').eq('id', projectId).single()
    if (data) setPanelProject(data as Project)
  }

  // ── CSV Export ──────────────────────────────────────────────────────────
  function exportCSV() {
    const headers = ['Project ID', 'Type', 'Manufacturer', 'Model', 'Serial Number', 'Qty', 'Install Date', 'Warranty Start', 'Warranty End', 'Years', 'Status', 'Days Remaining']
    const rows = sortedWarranties.map(w => {
      const days = daysRemaining(w.warranty_end_date)
      return [
        w.project_id,
        w.equipment_type,
        w.manufacturer ?? '',
        w.model ?? '',
        w.serial_number ?? '',
        String(w.quantity),
        w.install_date ?? '',
        w.warranty_start_date ?? '',
        w.warranty_end_date ?? '',
        w.warranty_years != null ? String(w.warranty_years) : '',
        warrantyStatus(w),
        days != null ? String(days) : '',
      ]
    })
    const csv = [headers, ...rows].map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `warranties-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Pagination ──────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ── Sort indicator ──────────────────────────────────────────────────────
  function SortArrow({ col }: { col: string }) {
    if (sortCol !== col) return null
    return <span className="ml-1 text-green-400">{sortAsc ? '\u2191' : '\u2193'}</span>
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Nav active="Warranty" />

      <main className="flex-1 p-4 md:p-6 max-w-[1600px] mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-green-400" />
            <h1 className="text-xl font-bold text-white">Warranty Tracking</h1>
          </div>
          <button onClick={exportCSV}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <button onClick={() => setStatusFilter(statusFilter === '' ? '' : '')}
            className={cn(
              'bg-gray-800 border rounded-lg p-4 text-left transition-colors',
              statusFilter === '' ? 'border-green-500/50' : 'border-gray-700 hover:border-gray-600'
            )}>
            <div className="text-xs text-gray-400">Total Active</div>
            <div className="text-2xl font-bold text-green-400">{activeCount}</div>
          </button>
          <button onClick={() => setStatusFilter(statusFilter === 'expiring' ? '' : 'expiring')}
            className={cn(
              'bg-gray-800 border rounded-lg p-4 text-left transition-colors',
              statusFilter === 'expiring' ? 'border-amber-500/50' : 'border-gray-700 hover:border-gray-600'
            )}>
            <div className="text-xs text-gray-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" /> Expiring Soon
            </div>
            <div className={cn('text-2xl font-bold', expiringCount > 0 ? 'text-amber-400' : 'text-gray-400')}>
              {expiringCount}
            </div>
          </button>
          <button onClick={() => setStatusFilter(statusFilter === 'expired' ? '' : 'expired')}
            className={cn(
              'bg-gray-800 border rounded-lg p-4 text-left transition-colors',
              statusFilter === 'expired' ? 'border-red-500/50' : 'border-gray-700 hover:border-gray-600'
            )}>
            <div className="text-xs text-gray-400">Expired</div>
            <div className={cn('text-2xl font-bold', expiredCount > 0 ? 'text-red-400' : 'text-gray-400')}>
              {expiredCount}
            </div>
          </button>
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="text-xs text-gray-400">Open Claims</div>
            <div className={cn('text-2xl font-bold', openClaimCount > 0 ? 'text-blue-400' : 'text-gray-400')}>
              {openClaimCount}
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search project, manufacturer, model, serial..."
              className="w-full bg-gray-800 text-white text-sm rounded-lg pl-9 pr-3 py-2 border border-gray-700 focus:border-green-500 focus:outline-none"
            />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            className="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700">
            <option value="">All Types</option>
            {WARRANTY_EQUIPMENT_TYPES.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="expiring">Expiring Soon</option>
            <option value="expired">Expired</option>
          </select>
          <select value={mfgFilter} onChange={e => setMfgFilter(e.target.value)}
            className="bg-gray-800 text-white text-sm rounded-lg px-3 py-2 border border-gray-700">
            <option value="">All Manufacturers</option>
            {allMfgs.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs">
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('project_id')}>
                    Project <SortArrow col="project_id" />
                  </th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('equipment_type')}>
                    Type <SortArrow col="equipment_type" />
                  </th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('manufacturer')}>
                    Manufacturer <SortArrow col="manufacturer" />
                  </th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('model')}>
                    Model <SortArrow col="model" />
                  </th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('serial_number')}>
                    Serial # <SortArrow col="serial_number" />
                  </th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('warranty_start_date')}>
                    Start <SortArrow col="warranty_start_date" />
                  </th>
                  <th className="text-left px-4 py-3 cursor-pointer hover:text-white" onClick={() => handleSort('warranty_end_date')}>
                    End <SortArrow col="warranty_end_date" />
                  </th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Days Left</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-500">Loading...</td></tr>
                ) : sortedWarranties.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-500">No warranties found</td></tr>
                ) : sortedWarranties.map(w => {
                  const status = warrantyStatus(w)
                  const days = daysRemaining(w.warranty_end_date)
                  return (
                    <tr key={w.id} className="border-b border-gray-700/50 hover:bg-gray-750 transition-colors">
                      <td className="px-4 py-2.5">
                        <button onClick={() => openProject(w.project_id)}
                          className="text-green-400 hover:text-green-300 hover:underline text-xs font-mono">
                          {w.project_id}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded ${TYPE_COLORS[w.equipment_type] ?? 'bg-gray-500/20 text-gray-400'}`}>
                          {w.equipment_type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-300">{w.manufacturer ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-300 max-w-[200px] truncate">{w.model ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{w.serial_number ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtDate(w.warranty_start_date)}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{fmtDate(w.warranty_end_date)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BADGE[status]}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {days !== null ? (
                          <span className={cn('text-xs font-medium',
                            days < 0 ? 'text-red-400' : days <= 90 ? 'text-amber-400' : 'text-green-400'
                          )}>
                            {days >= 0 ? days : `${Math.abs(days)} overdue`}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
              <div className="text-xs text-gray-400">{total} warranties</div>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-400">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ProjectPanel */}
      {panelProject && (
        <ProjectPanel
          project={panelProject}
          onClose={() => setPanelProject(null)}
          onProjectUpdated={() => fetchWarranties()}
          initialTab="warranty"
        />
      )}
    </div>
  )
}
