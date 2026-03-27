'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn, fmtDate, fmt$ } from '@/lib/utils'
import {
  loadVehicles,
  addVehicle,
  updateVehicle,
  deleteVehicle,
  loadVehicleMaintenance,
  addMaintenance,
  VEHICLE_STATUSES,
  MAINTENANCE_TYPES,
  MAINTENANCE_TYPE_LABELS,
} from '@/lib/api/fleet'
import type { Vehicle, MaintenanceRecord, VehicleStatus, MaintenanceType } from '@/lib/api/fleet'
import { loadActiveCrews } from '@/lib/api/crews'
import {
  Truck, Search, Plus, X, ChevronDown, ChevronUp, Wrench, AlertTriangle,
  Download, ChevronLeft, ChevronRight, Calendar, Gauge, Shield, LogIn,
} from 'lucide-react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

const STATUS_COLORS: Record<VehicleStatus, string> = {
  active: 'bg-green-500/20 text-green-400',
  maintenance: 'bg-amber-500/20 text-amber-400',
  out_of_service: 'bg-red-500/20 text-red-400',
  retired: 'bg-gray-500/20 text-gray-400',
}

const STATUS_LABELS: Record<VehicleStatus, string> = {
  active: 'Active',
  maintenance: 'Maintenance',
  out_of_service: 'Out of Service',
  retired: 'Retired',
}

const MAINT_TYPE_COLORS: Record<MaintenanceType, string> = {
  oil_change: 'bg-blue-500/20 text-blue-400',
  tire_rotation: 'bg-purple-500/20 text-purple-400',
  brake_service: 'bg-red-500/20 text-red-400',
  inspection: 'bg-amber-500/20 text-amber-400',
  repair: 'bg-orange-500/20 text-orange-400',
  other: 'bg-gray-500/20 text-gray-400',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(d: string | null): number | null {
  if (!d) return null
  const target = new Date(d + 'T00:00:00')
  return Math.floor((target.getTime() - Date.now()) / 86400000)
}

function expiryBadge(d: string | null): { label: string; cls: string } | null {
  if (!d) return null
  const days = daysUntil(d)
  if (days === null) return null
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, cls: 'bg-red-500/20 text-red-400' }
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-amber-500/20 text-amber-400' }
  return null
}

type SortField = 'vehicle_number' | 'make' | 'status' | 'assigned_crew' | 'odometer' | 'next_inspection_date' | 'insurance_expiry'

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FleetPage() {
  const { user: currentUser, loading: authLoading } = useCurrentUser()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [crewFilter, setCrewFilter] = useState('')
  const [crews, setCrews] = useState<{ id: string; name: string; active: string }[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<SortField>('vehicle_number')
  const [sortAsc, setSortAsc] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  // Add vehicle modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addDraft, setAddDraft] = useState<Partial<Vehicle>>({ status: 'active' })
  const [addSaving, setAddSaving] = useState(false)

  // Maintenance for expanded vehicle
  const [maintenance, setMaintenance] = useState<MaintenanceRecord[]>([])
  const [maintLoading, setMaintLoading] = useState(false)
  const [showAddMaint, setShowAddMaint] = useState(false)
  const [maintDraft, setMaintDraft] = useState<Partial<MaintenanceRecord>>({})
  const [maintSaving, setMaintSaving] = useState(false)

  // Edit mode
  const [editDraft, setEditDraft] = useState<Partial<Vehicle>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Data loading ────────────────────────────────────────────────────────────

  const fetchVehicles = useCallback(async () => {
    setLoading(true)
    const data = await loadVehicles()
    setVehicles(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchVehicles() }, [fetchVehicles])

  useEffect(() => {
    loadActiveCrews().then(res => setCrews((res.data ?? []) as { id: string; name: string; active: string }[]))
  }, [])

  // Load maintenance when expanding
  useEffect(() => {
    if (!expandedId) { setMaintenance([]); return }
    setMaintLoading(true)
    loadVehicleMaintenance(expandedId).then(data => {
      setMaintenance(data)
      setMaintLoading(false)
    })
    // Reset edit mode on expand
    setEditMode(false)
    setShowAddMaint(false)
  }, [expandedId])

  // ── Filtering + sorting ─────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = vehicles
    if (statusFilter) list = list.filter(v => v.status === statusFilter)
    if (crewFilter) list = list.filter(v => v.assigned_crew === crewFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(v => {
        if (v.vehicle_number.toLowerCase().includes(q)) return true
        if ((v.make ?? '').toLowerCase().includes(q)) return true
        if ((v.model ?? '').toLowerCase().includes(q)) return true
        if ((v.license_plate ?? '').toLowerCase().includes(q)) return true
        if ((v.assigned_driver ?? '').toLowerCase().includes(q)) return true
        if ((v.vin ?? '').toLowerCase().includes(q)) return true
        return false
      })
    }
    // Sort
    list = [...list].sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      switch (sortField) {
        case 'vehicle_number': av = a.vehicle_number; bv = b.vehicle_number; break
        case 'make': av = `${a.make ?? ''} ${a.model ?? ''}`; bv = `${b.make ?? ''} ${b.model ?? ''}`; break
        case 'status': av = a.status; bv = b.status; break
        case 'assigned_crew': av = a.assigned_crew ?? ''; bv = b.assigned_crew ?? ''; break
        case 'odometer': av = a.odometer ?? 0; bv = b.odometer ?? 0; break
        case 'next_inspection_date': av = a.next_inspection_date ?? '9999'; bv = b.next_inspection_date ?? '9999'; break
        case 'insurance_expiry': av = a.insurance_expiry ?? '9999'; bv = b.insurance_expiry ?? '9999'; break
      }
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [vehicles, statusFilter, crewFilter, search, sortField, sortAsc])

  // ── Summary counts ──────────────────────────────────────────────────────────

  const totalCount = vehicles.length
  const activeCount = vehicles.filter(v => v.status === 'active').length
  const maintCount = vehicles.filter(v => v.status === 'maintenance').length
  const upcomingServiceCount = useMemo(() => {
    return vehicles.filter(v => {
      const d = daysUntil(v.next_inspection_date)
      return d !== null && d >= 0 && d <= 30
    }).length
  }, [vehicles])

  // ── Pagination ──────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, statusFilter, crewFilter])

  // ── Crew names for dropdown ─────────────────────────────────────────────────

  const crewNames = useMemo(() => {
    const names = new Set<string>()
    for (const v of vehicles) {
      if (v.assigned_crew) names.add(v.assigned_crew)
    }
    for (const c of crews) names.add(c.name)
    return Array.from(names).sort()
  }, [vehicles, crews])

  // ── Sortable header helper ──────────────────────────────────────────────────

  function SortHeader({ field, label, className }: { field: SortField; label: string; className?: string }) {
    return (
      <th
        className={cn('px-3 py-2 text-left text-xs font-medium text-gray-400 cursor-pointer hover:text-white select-none', className)}
        onClick={() => {
          if (sortField === field) setSortAsc(!sortAsc)
          else { setSortField(field); setSortAsc(true) }
        }}
      >
        <span className="flex items-center gap-1">
          {label}
          {sortField === field && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </span>
      </th>
    )
  }

  // ── Add vehicle handler ─────────────────────────────────────────────────────

  async function handleAddVehicle() {
    if (!addDraft.vehicle_number?.trim()) return
    setAddSaving(true)
    const result = await addVehicle({
      vehicle_number: addDraft.vehicle_number.trim(),
      vin: addDraft.vin || null,
      year: addDraft.year ?? null,
      make: addDraft.make || null,
      model: addDraft.model || null,
      license_plate: addDraft.license_plate || null,
      color: addDraft.color || null,
      assigned_crew: addDraft.assigned_crew || null,
      assigned_driver: addDraft.assigned_driver || null,
      status: (addDraft.status as VehicleStatus) || 'active',
      odometer: addDraft.odometer ?? null,
      insurance_expiry: addDraft.insurance_expiry || null,
      registration_expiry: addDraft.registration_expiry || null,
      last_inspection_date: addDraft.last_inspection_date || null,
      next_inspection_date: addDraft.next_inspection_date || null,
      notes: addDraft.notes || null,
    })
    if (result) {
      setVehicles(prev => [...prev, result].sort((a, b) => a.vehicle_number.localeCompare(b.vehicle_number)))
      setShowAddModal(false)
      setAddDraft({ status: 'active' })
      showToast('Vehicle added')
    } else {
      showToast('Failed to add vehicle')
    }
    setAddSaving(false)
  }

  // ── Save edit handler ───────────────────────────────────────────────────────

  async function handleSaveEdit(id: string) {
    setEditSaving(true)
    const ok = await updateVehicle(id, editDraft)
    if (ok) {
      setVehicles(prev => prev.map(v => v.id === id ? { ...v, ...editDraft } : v))
      setEditMode(false)
      showToast('Vehicle updated')
    } else {
      showToast('Failed to save')
    }
    setEditSaving(false)
  }

  // ── Delete handler ──────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Delete this vehicle permanently?')) return
    const ok = await deleteVehicle(id)
    if (ok) {
      setVehicles(prev => prev.filter(v => v.id !== id))
      setExpandedId(null)
      showToast('Vehicle deleted')
    } else {
      showToast('Failed to delete — super admin required')
    }
  }

  // ── Add maintenance handler ─────────────────────────────────────────────────

  async function handleAddMaintenance() {
    if (!expandedId || !maintDraft.type) return
    setMaintSaving(true)
    const record = await addMaintenance({
      vehicle_id: expandedId,
      type: maintDraft.type as MaintenanceType,
      description: maintDraft.description || null,
      date: maintDraft.date || null,
      odometer: maintDraft.odometer ?? null,
      cost: maintDraft.cost ?? null,
      vendor: maintDraft.vendor || null,
      next_due_date: maintDraft.next_due_date || null,
      next_due_odometer: maintDraft.next_due_odometer ?? null,
      performed_by: maintDraft.performed_by || null,
      notes: maintDraft.notes || null,
    })
    if (record) {
      setMaintenance(prev => [record, ...prev])
      setShowAddMaint(false)
      setMaintDraft({})
      // Update vehicle odometer if maintenance has higher reading
      if (record.odometer) {
        const v = vehicles.find(v => v.id === expandedId)
        if (v && (v.odometer === null || record.odometer > v.odometer)) {
          await updateVehicle(expandedId, { odometer: record.odometer })
          setVehicles(prev => prev.map(veh => veh.id === expandedId ? { ...veh, odometer: record.odometer } : veh))
        }
      }
      showToast('Maintenance record added')
    } else {
      showToast('Failed to add record')
    }
    setMaintSaving(false)
  }

  // ── CSV export ──────────────────────────────────────────────────────────────

  function exportCSV() {
    const headers = ['Vehicle #', 'Year', 'Make', 'Model', 'VIN', 'License Plate', 'Color', 'Crew', 'Driver', 'Status', 'Odometer', 'Insurance Expiry', 'Registration Expiry', 'Last Inspection', 'Next Inspection']
    const rows = filtered.map(v => [
      v.vehicle_number, v.year ?? '', v.make ?? '', v.model ?? '', v.vin ?? '',
      v.license_plate ?? '', v.color ?? '', v.assigned_crew ?? '', v.assigned_driver ?? '',
      v.status, v.odometer ?? '', v.insurance_expiry ?? '', v.registration_expiry ?? '',
      v.last_inspection_date ?? '', v.next_inspection_date ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Auth gate ───────────────────────────────────────────────────────────────

  if (authLoading) return <div className="min-h-screen bg-gray-900" />
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <LogIn className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Please sign in to access Fleet.</p>
          <a href="/login" className="text-green-400 text-sm hover:underline mt-2 inline-block">Sign in</a>
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <Nav active="Fleet" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Truck className="w-6 h-6 text-green-400" />
            <h1 className="text-xl font-bold">Fleet Management</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="text-xs px-3 py-1.5 rounded-md bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors flex items-center gap-1.5">
              <Download className="w-3 h-3" /> Export
            </button>
            <button onClick={() => setShowAddModal(true)} className="text-xs px-3 py-1.5 rounded-md bg-green-700 hover:bg-green-600 text-white font-medium flex items-center gap-1.5">
              <Plus className="w-3 h-3" /> Add Vehicle
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <button
            onClick={() => { setStatusFilter(''); setCrewFilter('') }}
            className={cn('bg-gray-800 rounded-lg p-4 text-left transition-colors', !statusFilter && !crewFilter ? 'ring-1 ring-green-500/50' : 'hover:bg-gray-750')}
          >
            <p className="text-xs text-gray-400 mb-1">Total Vehicles</p>
            <p className="text-2xl font-bold text-white">{totalCount}</p>
          </button>
          <button
            onClick={() => setStatusFilter(statusFilter === 'active' ? '' : 'active')}
            className={cn('bg-gray-800 rounded-lg p-4 text-left transition-colors', statusFilter === 'active' ? 'ring-1 ring-green-500/50' : 'hover:bg-gray-750')}
          >
            <p className="text-xs text-gray-400 mb-1">Active</p>
            <p className="text-2xl font-bold text-green-400">{activeCount}</p>
          </button>
          <button
            onClick={() => setStatusFilter(statusFilter === 'maintenance' ? '' : 'maintenance')}
            className={cn('bg-gray-800 rounded-lg p-4 text-left transition-colors', statusFilter === 'maintenance' ? 'ring-1 ring-amber-500/50' : 'hover:bg-gray-750')}
          >
            <p className="text-xs text-gray-400 mb-1">In Maintenance</p>
            <p className={cn('text-2xl font-bold', maintCount > 0 ? 'text-amber-400' : 'text-white')}>{maintCount}</p>
          </button>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-1">Upcoming Service</p>
            <p className={cn('text-2xl font-bold', upcomingServiceCount > 0 ? 'text-amber-400' : 'text-white')}>
              {upcomingServiceCount}
            </p>
            <p className="text-[10px] text-gray-500">within 30 days</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search vehicles..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500"
          >
            <option value="">All Statuses</option>
            {VEHICLE_STATUSES.map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <select
            value={crewFilter}
            onChange={e => setCrewFilter(e.target.value)}
            className="text-xs px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500"
          >
            <option value="">All Crews</option>
            {crewNames.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {(statusFilter || crewFilter || search) && (
            <button
              onClick={() => { setStatusFilter(''); setCrewFilter(''); setSearch('') }}
              className="text-xs px-3 py-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-gray-500 text-sm">
              {vehicles.length === 0 ? 'No vehicles yet. Add your first vehicle above.' : 'No vehicles match your filters.'}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-800/50">
                      <SortHeader field="vehicle_number" label="Vehicle #" />
                      <SortHeader field="make" label="Make / Model" />
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Year</th>
                      <SortHeader field="assigned_crew" label="Crew" />
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Driver</th>
                      <SortHeader field="status" label="Status" />
                      <SortHeader field="odometer" label="Odometer" />
                      <SortHeader field="next_inspection_date" label="Next Service" />
                      <SortHeader field="insurance_expiry" label="Insurance" />
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">Alerts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(v => {
                      const isExpanded = expandedId === v.id
                      const insBadge = expiryBadge(v.insurance_expiry)
                      const regBadge = expiryBadge(v.registration_expiry)
                      const inspDays = daysUntil(v.next_inspection_date)
                      const hasAlerts = !!(insBadge || regBadge || (inspDays !== null && inspDays <= 30))
                      return (
                        <ExpandableRow
                          key={v.id}
                          v={v}
                          isExpanded={isExpanded}
                          onToggle={() => setExpandedId(isExpanded ? null : v.id)}
                          insBadge={insBadge}
                          regBadge={regBadge}
                          inspDays={inspDays}
                          hasAlerts={hasAlerts}
                          maintenance={maintenance}
                          maintLoading={maintLoading}
                          showAddMaint={showAddMaint}
                          setShowAddMaint={setShowAddMaint}
                          maintDraft={maintDraft}
                          setMaintDraft={setMaintDraft}
                          maintSaving={maintSaving}
                          handleAddMaintenance={handleAddMaintenance}
                          editMode={editMode}
                          setEditMode={setEditMode}
                          editDraft={editDraft}
                          setEditDraft={setEditDraft}
                          editSaving={editSaving}
                          handleSaveEdit={handleSaveEdit}
                          handleDelete={handleDelete}
                          crewNames={crewNames}
                          isSuperAdmin={currentUser?.isSuperAdmin ?? false}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
                  <span className="text-xs text-gray-400">{filtered.length} vehicles</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-gray-400">{page} / {totalPages}</span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Add Vehicle Modal ────────────────────────────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onKeyDown={e => { if (e.key === 'Escape') setShowAddModal(false) }}>
          <div role="dialog" aria-label="Add Vehicle" className="bg-gray-800 rounded-xl border border-gray-700 shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h2 className="text-sm font-semibold">Add Vehicle</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Vehicle # *</label>
                  <input value={addDraft.vehicle_number ?? ''} onChange={e => setAddDraft(d => ({ ...d, vehicle_number: e.target.value }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500"
                    placeholder="e.g. Truck 1" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">VIN</label>
                  <input value={addDraft.vin ?? ''} onChange={e => setAddDraft(d => ({ ...d, vin: e.target.value }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Year</label>
                  <input type="number" value={addDraft.year ?? ''} onChange={e => setAddDraft(d => ({ ...d, year: e.target.value ? Number(e.target.value) : undefined }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Make</label>
                  <input value={addDraft.make ?? ''} onChange={e => setAddDraft(d => ({ ...d, make: e.target.value }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500"
                    placeholder="e.g. Ford" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Model</label>
                  <input value={addDraft.model ?? ''} onChange={e => setAddDraft(d => ({ ...d, model: e.target.value }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500"
                    placeholder="e.g. F-250" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">License Plate</label>
                  <input value={addDraft.license_plate ?? ''} onChange={e => setAddDraft(d => ({ ...d, license_plate: e.target.value }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Color</label>
                  <input value={addDraft.color ?? ''} onChange={e => setAddDraft(d => ({ ...d, color: e.target.value }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Odometer</label>
                  <input type="number" value={addDraft.odometer ?? ''} onChange={e => setAddDraft(d => ({ ...d, odometer: e.target.value ? Number(e.target.value) : undefined }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Assigned Crew</label>
                  <select value={addDraft.assigned_crew ?? ''} onChange={e => setAddDraft(d => ({ ...d, assigned_crew: e.target.value || undefined }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500">
                    <option value="">None</option>
                    {crewNames.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Assigned Driver</label>
                  <input value={addDraft.assigned_driver ?? ''} onChange={e => setAddDraft(d => ({ ...d, assigned_driver: e.target.value }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Insurance Expiry</label>
                  <input type="date" value={addDraft.insurance_expiry ?? ''} onChange={e => setAddDraft(d => ({ ...d, insurance_expiry: e.target.value || undefined }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Registration Expiry</label>
                  <input type="date" value={addDraft.registration_expiry ?? ''} onChange={e => setAddDraft(d => ({ ...d, registration_expiry: e.target.value || undefined }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Next Inspection</label>
                  <input type="date" value={addDraft.next_inspection_date ?? ''} onChange={e => setAddDraft(d => ({ ...d, next_inspection_date: e.target.value || undefined }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase mb-1 block">Status</label>
                  <select value={addDraft.status ?? 'active'} onChange={e => setAddDraft(d => ({ ...d, status: e.target.value as VehicleStatus }))}
                    className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500">
                    {VEHICLE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 uppercase mb-1 block">Notes</label>
                <textarea value={addDraft.notes ?? ''} onChange={e => setAddDraft(d => ({ ...d, notes: e.target.value }))}
                  className="w-full px-3 py-1.5 text-xs bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:border-green-500 h-16 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-700">
              <button onClick={() => setShowAddModal(false)} className="text-xs px-4 py-1.5 rounded-md bg-gray-700 text-gray-300 hover:text-white">Cancel</button>
              <button onClick={handleAddVehicle} disabled={addSaving || !addDraft.vehicle_number?.trim()}
                className="text-xs px-4 py-1.5 rounded-md bg-green-700 hover:bg-green-600 text-white font-medium disabled:opacity-50">
                {addSaving ? 'Adding...' : 'Add Vehicle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-800 border border-gray-700 text-white text-xs px-4 py-2.5 rounded-lg shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}


// ── Expandable Row Component ─────────────────────────────────────────────────

interface ExpandableRowProps {
  v: Vehicle
  isExpanded: boolean
  onToggle: () => void
  insBadge: { label: string; cls: string } | null
  regBadge: { label: string; cls: string } | null
  inspDays: number | null
  hasAlerts: boolean
  maintenance: MaintenanceRecord[]
  maintLoading: boolean
  showAddMaint: boolean
  setShowAddMaint: (v: boolean) => void
  maintDraft: Partial<MaintenanceRecord>
  setMaintDraft: (v: Partial<MaintenanceRecord>) => void
  maintSaving: boolean
  handleAddMaintenance: () => void
  editMode: boolean
  setEditMode: (v: boolean) => void
  editDraft: Partial<Vehicle>
  setEditDraft: (v: Partial<Vehicle> | ((prev: Partial<Vehicle>) => Partial<Vehicle>)) => void
  editSaving: boolean
  handleSaveEdit: (id: string) => void
  handleDelete: (id: string) => void
  crewNames: string[]
  isSuperAdmin: boolean
}

function ExpandableRow({
  v, isExpanded, onToggle, insBadge, regBadge, inspDays, hasAlerts,
  maintenance, maintLoading, showAddMaint, setShowAddMaint,
  maintDraft, setMaintDraft, maintSaving, handleAddMaintenance,
  editMode, setEditMode, editDraft, setEditDraft, editSaving, handleSaveEdit, handleDelete,
  crewNames, isSuperAdmin,
}: ExpandableRowProps) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'border-b border-gray-700/50 cursor-pointer transition-colors',
          isExpanded ? 'bg-gray-700/30' : 'hover:bg-gray-700/20'
        )}
      >
        <td className="px-3 py-2.5 font-medium text-white">{v.vehicle_number}</td>
        <td className="px-3 py-2.5 text-gray-300">{[v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
        <td className="px-3 py-2.5 text-gray-400">{v.year ?? '—'}</td>
        <td className="px-3 py-2.5 text-gray-300">{v.assigned_crew ?? '—'}</td>
        <td className="px-3 py-2.5 text-gray-300">{v.assigned_driver ?? '—'}</td>
        <td className="px-3 py-2.5">
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[v.status])}>
            {STATUS_LABELS[v.status]}
          </span>
        </td>
        <td className="px-3 py-2.5 text-gray-400">{v.odometer ? v.odometer.toLocaleString() : '—'}</td>
        <td className="px-3 py-2.5 text-gray-400">
          {v.next_inspection_date ? fmtDate(v.next_inspection_date) : '—'}
          {inspDays !== null && inspDays <= 30 && inspDays >= 0 && (
            <span className="ml-1 text-[10px] text-amber-400">({inspDays}d)</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-gray-400">
          {v.insurance_expiry ? fmtDate(v.insurance_expiry) : '—'}
        </td>
        <td className="px-3 py-2.5">
          {hasAlerts ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <span className="text-gray-600">—</span>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr>
          <td colSpan={10} className="px-0 py-0">
            <div className="bg-gray-800/50 border-b border-gray-700 px-5 py-4">
              {/* Vehicle Details + Edit */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Truck className="w-4 h-4 text-green-400" />
                  {v.vehicle_number} — {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                </h3>
                <div className="flex gap-2">
                  {!editMode && (
                    <button onClick={() => { setEditMode(true); setEditDraft(v) }}
                      className="text-xs px-3 py-1 rounded-md bg-gray-700 text-gray-300 hover:text-white">
                      Edit
                    </button>
                  )}
                  {isSuperAdmin && !editMode && (
                    <button onClick={() => handleDelete(v.id)}
                      className="text-xs px-3 py-1 rounded-md bg-red-900/30 text-red-400 hover:bg-red-900/50">
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {editMode ? (
                <div className="mb-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    {([
                      ['vehicle_number', 'Vehicle #', 'text'],
                      ['vin', 'VIN', 'text'],
                      ['year', 'Year', 'number'],
                      ['make', 'Make', 'text'],
                      ['model', 'Model', 'text'],
                      ['license_plate', 'License Plate', 'text'],
                      ['color', 'Color', 'text'],
                      ['odometer', 'Odometer', 'number'],
                      ['assigned_driver', 'Driver', 'text'],
                      ['insurance_expiry', 'Insurance Expiry', 'date'],
                      ['registration_expiry', 'Registration Expiry', 'date'],
                      ['last_inspection_date', 'Last Inspection', 'date'],
                      ['next_inspection_date', 'Next Inspection', 'date'],
                    ] as const).map(([key, label, type]) => (
                      <div key={key}>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">{label}</label>
                        <input
                          type={type}
                          value={String((editDraft as Record<string, unknown>)[key] ?? '')}
                          onChange={e => {
                            const val = type === 'number' ? (e.target.value ? Number(e.target.value) : null) : (e.target.value || null)
                            setEditDraft((d: Partial<Vehicle>) => ({ ...d, [key]: val }))
                          }}
                          className="w-full px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase mb-1 block">Crew</label>
                      <select value={editDraft.assigned_crew ?? ''} onChange={e => setEditDraft((d: Partial<Vehicle>) => ({ ...d, assigned_crew: e.target.value || null }))}
                        className="w-full px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500">
                        <option value="">None</option>
                        {crewNames.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase mb-1 block">Status</label>
                      <select value={editDraft.status ?? 'active'} onChange={e => setEditDraft((d: Partial<Vehicle>) => ({ ...d, status: e.target.value as VehicleStatus }))}
                        className="w-full px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500">
                        {VEHICLE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="text-[10px] text-gray-400 uppercase mb-1 block">Notes</label>
                    <textarea value={editDraft.notes ?? ''} onChange={e => setEditDraft((d: Partial<Vehicle>) => ({ ...d, notes: e.target.value }))}
                      className="w-full px-2 py-1 text-xs bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500 h-12 resize-none" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleSaveEdit(v.id)} disabled={editSaving}
                      className="text-xs px-4 py-1.5 rounded-md bg-green-700 hover:bg-green-600 text-white font-medium disabled:opacity-50">
                      {editSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={() => setEditMode(false)} className="text-xs px-4 py-1.5 rounded-md bg-gray-700 text-gray-300 hover:text-white">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 mb-4 text-xs">
                  <div><span className="text-gray-500">VIN:</span> <span className="text-gray-300 ml-1">{v.vin || '—'}</span></div>
                  <div><span className="text-gray-500">License Plate:</span> <span className="text-gray-300 ml-1">{v.license_plate || '—'}</span></div>
                  <div><span className="text-gray-500">Color:</span> <span className="text-gray-300 ml-1">{v.color || '—'}</span></div>
                  <div><span className="text-gray-500">Odometer:</span> <span className="text-gray-300 ml-1">{v.odometer ? v.odometer.toLocaleString() + ' mi' : '—'}</span></div>
                  <div>
                    <span className="text-gray-500">Insurance:</span>
                    <span className="text-gray-300 ml-1">{v.insurance_expiry ? fmtDate(v.insurance_expiry) : '—'}</span>
                    {insBadge && <span className={cn('ml-1 text-[10px] px-1.5 py-0.5 rounded-full', insBadge.cls)}>{insBadge.label}</span>}
                  </div>
                  <div>
                    <span className="text-gray-500">Registration:</span>
                    <span className="text-gray-300 ml-1">{v.registration_expiry ? fmtDate(v.registration_expiry) : '—'}</span>
                    {regBadge && <span className={cn('ml-1 text-[10px] px-1.5 py-0.5 rounded-full', regBadge.cls)}>{regBadge.label}</span>}
                  </div>
                  <div><span className="text-gray-500">Last Inspection:</span> <span className="text-gray-300 ml-1">{v.last_inspection_date ? fmtDate(v.last_inspection_date) : '—'}</span></div>
                  <div><span className="text-gray-500">Next Inspection:</span> <span className="text-gray-300 ml-1">{v.next_inspection_date ? fmtDate(v.next_inspection_date) : '—'}</span></div>
                  {v.notes && (
                    <div className="col-span-full"><span className="text-gray-500">Notes:</span> <span className="text-gray-300 ml-1">{v.notes}</span></div>
                  )}
                </div>
              )}

              {/* Maintenance History */}
              <div className="border-t border-gray-700 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-gray-400" />
                    Maintenance History
                  </h4>
                  <button onClick={() => setShowAddMaint(!showAddMaint)}
                    className="text-xs px-3 py-1 rounded-md bg-gray-700 text-gray-300 hover:text-white flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add Record
                  </button>
                </div>

                {/* Add maintenance form */}
                {showAddMaint && (
                  <div className="bg-gray-900 rounded-lg p-4 mb-3 border border-gray-700">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Type *</label>
                        <select value={maintDraft.type ?? ''} onChange={e => setMaintDraft({ ...maintDraft, type: e.target.value as MaintenanceType })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500">
                          <option value="">Select...</option>
                          {MAINTENANCE_TYPES.map(t => <option key={t} value={t}>{MAINTENANCE_TYPE_LABELS[t]}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Date</label>
                        <input type="date" value={maintDraft.date ?? ''} onChange={e => setMaintDraft({ ...maintDraft, date: e.target.value || undefined })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Odometer</label>
                        <input type="number" value={maintDraft.odometer ?? ''} onChange={e => setMaintDraft({ ...maintDraft, odometer: e.target.value ? Number(e.target.value) : undefined })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Cost</label>
                        <input type="number" step="0.01" value={maintDraft.cost ?? ''} onChange={e => setMaintDraft({ ...maintDraft, cost: e.target.value ? Number(e.target.value) : undefined })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500"
                          placeholder="$" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Vendor</label>
                        <input value={maintDraft.vendor ?? ''} onChange={e => setMaintDraft({ ...maintDraft, vendor: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Performed By</label>
                        <input value={maintDraft.performed_by ?? ''} onChange={e => setMaintDraft({ ...maintDraft, performed_by: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Next Due Date</label>
                        <input type="date" value={maintDraft.next_due_date ?? ''} onChange={e => setMaintDraft({ ...maintDraft, next_due_date: e.target.value || undefined })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Next Due Odometer</label>
                        <input type="number" value={maintDraft.next_due_odometer ?? ''} onChange={e => setMaintDraft({ ...maintDraft, next_due_odometer: e.target.value ? Number(e.target.value) : undefined })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Description</label>
                        <input value={maintDraft.description ?? ''} onChange={e => setMaintDraft({ ...maintDraft, description: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase mb-1 block">Notes</label>
                        <input value={maintDraft.notes ?? ''} onChange={e => setMaintDraft({ ...maintDraft, notes: e.target.value })}
                          className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:border-green-500" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleAddMaintenance} disabled={maintSaving || !maintDraft.type}
                        className="text-xs px-4 py-1.5 rounded-md bg-green-700 hover:bg-green-600 text-white font-medium disabled:opacity-50">
                        {maintSaving ? 'Adding...' : 'Add Record'}
                      </button>
                      <button onClick={() => { setShowAddMaint(false); setMaintDraft({}) }}
                        className="text-xs px-4 py-1.5 rounded-md bg-gray-700 text-gray-300 hover:text-white">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Maintenance table */}
                {maintLoading ? (
                  <div className="text-center py-4">
                    <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                ) : maintenance.length === 0 ? (
                  <p className="text-xs text-gray-500 py-2">No maintenance records yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Date</th>
                          <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Type</th>
                          <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Description</th>
                          <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Odometer</th>
                          <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Cost</th>
                          <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Vendor</th>
                          <th className="px-2 py-1.5 text-left text-gray-500 font-medium">Next Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {maintenance.map(m => (
                          <tr key={m.id} className="border-b border-gray-700/30">
                            <td className="px-2 py-1.5 text-gray-300">{m.date ? fmtDate(m.date) : '—'}</td>
                            <td className="px-2 py-1.5">
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', MAINT_TYPE_COLORS[m.type as MaintenanceType] ?? MAINT_TYPE_COLORS.other)}>
                                {MAINTENANCE_TYPE_LABELS[m.type as MaintenanceType] ?? m.type}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-gray-300 max-w-[200px] truncate">{m.description || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-400">{m.odometer ? m.odometer.toLocaleString() : '—'}</td>
                            <td className="px-2 py-1.5 text-gray-300">{m.cost ? fmt$(m.cost) : '—'}</td>
                            <td className="px-2 py-1.5 text-gray-400">{m.vendor || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-400">{m.next_due_date ? fmtDate(m.next_due_date) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
