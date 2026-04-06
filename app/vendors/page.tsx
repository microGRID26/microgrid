'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { loadVendors, addVendor, updateVendor, deleteVendor, VENDOR_CATEGORIES, EQUIPMENT_TYPE_OPTIONS, loadVendorDocs, addVendorDoc, updateVendorDocStatus, deleteVendorDoc, initVendorOnboarding, VENDOR_DOC_TYPES, VENDOR_DOC_STATUSES } from '@/lib/api/vendors'
import type { VendorOnboardingDoc } from '@/lib/api/vendors'
import type { Vendor } from '@/lib/api/vendors'
import { Search, Plus, X, Building2, ChevronDown, ChevronUp, Truck, Phone, Mail, Globe } from 'lucide-react'

const CATEGORY_COLORS: Record<string, string> = {
  manufacturer: 'bg-blue-500/20 text-blue-400',
  distributor: 'bg-purple-500/20 text-purple-400',
  install_partner: 'bg-amber-500/20 text-amber-400',
  electrical: 'bg-cyan-500/20 text-cyan-400',
  plumbing: 'bg-sky-500/20 text-sky-400',
  hvac: 'bg-orange-500/20 text-orange-400',
  roofing: 'bg-red-500/20 text-red-400',
  interior: 'bg-pink-500/20 text-pink-400',
  other: 'bg-gray-500/20 text-gray-400',
}

const CATEGORY_LABELS: Record<string, string> = {
  manufacturer: 'Manufacturer',
  distributor: 'Distributor',
  install_partner: 'Install Partner',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  roofing: 'Roofing',
  interior: 'Interior',
  other: 'Other',
}

export default function VendorsPage() {
  const { user: authUser, loading: authLoading } = useCurrentUser()
  const isManager = authUser?.isManager ?? false
  const isSuperAdmin = authUser?.isSuperAdmin ?? false
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterEquipType, setFilterEquipType] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // ── Edit state ──────────────────────────────────────────────────────────
  const [editDraft, setEditDraft] = useState<Partial<Vendor>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [vendorDocs, setVendorDocs] = useState<VendorOnboardingDoc[]>([])

  // Load onboarding docs when a vendor is expanded
  const loadDocs = useCallback(async (vendorId: string) => {
    const docs = await loadVendorDocs(vendorId)
    setVendorDocs(docs)
  }, [])

  // ── Add form state ──────────────────────────────────────────────────────
  const [addDraft, setAddDraft] = useState<Partial<Vendor>>({ active: true, equipment_types: [] })
  const [addSaving, setAddSaving] = useState(false)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    const data = await loadVendors()
    setVendors(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchVendors() }, [fetchVendors])

  // ── Filtered vendors ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = vendors
    if (filterCategory) {
      list = list.filter(v => v.category === filterCategory)
    }
    if (filterEquipType) {
      list = list.filter(v => v.equipment_types?.includes(filterEquipType))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(v => {
        if (v.name.toLowerCase().includes(q)) return true
        if ((v.contact_name ?? '').toLowerCase().includes(q)) return true
        if ((v.city ?? '').toLowerCase().includes(q)) return true
        if ((v.contact_email ?? '').toLowerCase().includes(q)) return true
        return false
      })
    }
    return list
  }, [vendors, filterCategory, filterEquipType, search])

  // ── Counts ──────────────────────────────────────────────────────────────
  const activeCount = vendors.filter(v => v.active).length
  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const v of vendors) {
      const cat = v.category ?? 'other'
      c[cat] = (c[cat] || 0) + 1
    }
    return c
  }, [vendors])

  // ── Add vendor ──────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!addDraft.name?.trim()) return
    setAddSaving(true)
    const result = await addVendor({
      name: addDraft.name.trim(),
      contact_name: addDraft.contact_name || null,
      contact_email: addDraft.contact_email || null,
      contact_phone: addDraft.contact_phone || null,
      website: addDraft.website || null,
      address: addDraft.address || null,
      city: addDraft.city || null,
      state: addDraft.state || null,
      zip: addDraft.zip || null,
      category: addDraft.category || null,
      equipment_types: addDraft.equipment_types?.length ? addDraft.equipment_types : null,
      lead_time_days: addDraft.lead_time_days ?? null,
      payment_terms: addDraft.payment_terms || null,
      notes: addDraft.notes || null,
      active: true,
    })
    if (result) {
      setVendors(prev => [...prev, result].sort((a, b) => a.name.localeCompare(b.name)))
      setShowAddForm(false)
      setAddDraft({ active: true, equipment_types: [] })
      showToast('Vendor added')
    } else {
      showToast('Failed to add vendor')
    }
    setAddSaving(false)
  }

  // ── Save edits ──────────────────────────────────────────────────────────
  async function handleSave(id: string) {
    setEditSaving(true)
    const ok = await updateVendor(id, editDraft)
    if (ok) {
      setVendors(prev => prev.map(v => v.id === id ? { ...v, ...editDraft } : v))
      showToast('Vendor updated')
    } else {
      showToast('Failed to update vendor')
    }
    setEditSaving(false)
  }

  // ── Toggle active ──────────────────────────────────────────────────────
  async function toggleActive(v: Vendor) {
    const ok = await updateVendor(v.id, { active: !v.active })
    if (ok) {
      setVendors(prev => prev.map(x => x.id === v.id ? { ...x, active: !v.active } : x))
      if (expandedId === v.id) setEditDraft(d => ({ ...d, active: !v.active }))
      showToast(v.active ? 'Vendor deactivated' : 'Vendor activated')
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────
  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete vendor "${name}"? This cannot be undone.`)) return
    const ok = await deleteVendor(id)
    if (ok) {
      setVendors(prev => prev.filter(v => v.id !== id))
      if (expandedId === id) setExpandedId(null)
      showToast('Vendor deleted')
    } else {
      showToast('Failed to delete vendor')
    }
  }

  // ── Equipment types toggle ──────────────────────────────────────────────
  function toggleEquipType(types: string[] | null | undefined, type: string): string[] {
    const arr = types ?? []
    return arr.includes(type) ? arr.filter(t => t !== type) : [...arr, type]
  }

  // ── Auth gate: Manager+ required ──────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Checking permissions…</div>
      </div>
    )
  }

  if (!isManager) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col">
        <Nav active="Vendors" />
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
      <Nav active="Vendors" />

      <div className="flex-1 p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto w-full">
        {/* Toast */}
        {toast && (
          <div className="fixed top-4 right-4 z-[200] bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <Building2 className="w-5 h-5 text-green-400" />
              Vendors
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Manage suppliers and contractors — {activeCount} active, {vendors.length} total
            </p>
          </div>
          <button
            onClick={() => { setShowAddForm(true); setAddDraft({ active: true, equipment_types: [] }) }}
            className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600 transition-colors flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Vendor
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {VENDOR_CATEGORIES.map(cat => (
            <div key={cat} className="bg-gray-800 rounded-lg p-3">
              <div className="text-xs text-gray-400 capitalize">{cat}s</div>
              <div className="text-xl font-bold text-white mt-1">{categoryCounts[cat] || 0}</div>
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
              placeholder="Search name, contact, city, email..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder-gray-500"
            />
          </div>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">All Categories</option>
            {VENDOR_CATEGORIES.map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
          <select
            value={filterEquipType}
            onChange={e => setFilterEquipType(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
          >
            <option value="">All Equipment Types</option>
            {EQUIPMENT_TYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Add vendor form */}
        {showAddForm && (
          <div className="bg-gray-800 border border-green-700/50 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-green-400" /> New Vendor
              </h3>
              <button onClick={() => setShowAddForm(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label htmlFor="add-vendor-name" className="text-xs text-gray-400 block mb-1">Name *</label>
                <input
                  id="add-vendor-name"
                  value={addDraft.name ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="Vendor name"
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label htmlFor="add-vendor-category" className="text-xs text-gray-400 block mb-1">Category</label>
                <select
                  id="add-vendor-category"
                  value={addDraft.category ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, category: e.target.value || null }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                >
                  <option value="">Select...</option>
                  {VENDOR_CATEGORIES.map(c => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="add-vendor-contact" className="text-xs text-gray-400 block mb-1">Contact Name</label>
                <input
                  id="add-vendor-contact"
                  value={addDraft.contact_name ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, contact_name: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label htmlFor="add-vendor-phone" className="text-xs text-gray-400 block mb-1">Phone</label>
                <input
                  id="add-vendor-phone"
                  value={addDraft.contact_phone ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, contact_phone: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label htmlFor="add-vendor-email" className="text-xs text-gray-400 block mb-1">Email</label>
                <input
                  id="add-vendor-email"
                  value={addDraft.contact_email ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, contact_email: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label htmlFor="add-vendor-website" className="text-xs text-gray-400 block mb-1">Website</label>
                <input
                  id="add-vendor-website"
                  value={addDraft.website ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, website: e.target.value }))}
                  placeholder="https://..."
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label htmlFor="add-vendor-address" className="text-xs text-gray-400 block mb-1">Address</label>
                <input
                  id="add-vendor-address"
                  value={addDraft.address ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, address: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label htmlFor="add-vendor-city" className="text-xs text-gray-400 block mb-1">City</label>
                  <input
                    id="add-vendor-city"
                    value={addDraft.city ?? ''}
                    onChange={e => setAddDraft(d => ({ ...d, city: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                  />
                </div>
                <div className="w-16">
                  <label htmlFor="add-vendor-state" className="text-xs text-gray-400 block mb-1">State</label>
                  <input
                    id="add-vendor-state"
                    value={addDraft.state ?? ''}
                    onChange={e => setAddDraft(d => ({ ...d, state: e.target.value }))}
                    maxLength={2}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                  />
                </div>
                <div className="w-20">
                  <label htmlFor="add-vendor-zip" className="text-xs text-gray-400 block mb-1">ZIP</label>
                  <input
                    id="add-vendor-zip"
                    value={addDraft.zip ?? ''}
                    onChange={e => setAddDraft(d => ({ ...d, zip: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="add-vendor-lead-time" className="text-xs text-gray-400 block mb-1">Lead Time (days)</label>
                <input
                  id="add-vendor-lead-time"
                  type="number"
                  min={0}
                  value={addDraft.lead_time_days ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, lead_time_days: e.target.value ? parseInt(e.target.value) : null }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label htmlFor="add-vendor-payment" className="text-xs text-gray-400 block mb-1">Payment Terms</label>
                <input
                  id="add-vendor-payment"
                  value={addDraft.payment_terms ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, payment_terms: e.target.value }))}
                  placeholder="e.g., Net 30"
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Equipment Types</label>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_TYPE_OPTIONS.map(t => {
                  const selected = addDraft.equipment_types?.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setAddDraft(d => ({ ...d, equipment_types: toggleEquipType(d.equipment_types, t) }))}
                      className={`text-xs px-2 py-1 rounded transition-colors ${
                        selected ? 'bg-green-600/30 text-green-400 border border-green-600' : 'bg-gray-900 text-gray-400 border border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label htmlFor="add-vendor-notes" className="text-xs text-gray-400 block mb-1">Notes</label>
              <textarea
                id="add-vendor-notes"
                value={addDraft.notes ?? ''}
                onChange={e => setAddDraft(d => ({ ...d, notes: e.target.value }))}
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowAddForm(false)} className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">Cancel</button>
              <button
                onClick={handleAdd}
                disabled={!addDraft.name?.trim() || addSaving}
                className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
              >
                {addSaving ? 'Adding...' : 'Add Vendor'}
              </button>
            </div>
          </div>
        )}

        {/* Vendor table */}
        {loading ? (
          <div className="text-gray-500 text-sm py-8 text-center">Loading vendors...</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-500 text-sm py-8 text-center">
            {vendors.length === 0 ? 'No vendors yet. Click "Add Vendor" to get started.' : 'No vendors match your filters.'}
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400 text-xs">
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Category</th>
                    <th className="text-left px-3 py-2">Contact</th>
                    <th className="text-left px-3 py-2">Phone</th>
                    <th className="text-left px-3 py-2">Email</th>
                    <th className="text-left px-3 py-2">Equipment Types</th>
                    <th className="text-center px-3 py-2">Lead Time</th>
                    <th className="text-center px-3 py-2">Active</th>
                    <th className="px-3 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(v => (
                    <tr
                      key={v.id}
                      className={`border-b border-gray-700/50 transition-colors cursor-pointer ${
                        !v.active ? 'opacity-50' : ''
                      } ${expandedId === v.id ? 'bg-gray-700/40' : 'hover:bg-gray-700/30'}`}
                      onClick={() => {
                        if (expandedId === v.id) {
                          setExpandedId(null)
                          setEditDraft({})
                          setVendorDocs([])
                        } else {
                          setExpandedId(v.id)
                          setEditDraft({ ...v })
                          loadDocs(v.id)
                        }
                      }}
                    >
                      <td className="px-3 py-2 text-white font-medium">{v.name}</td>
                      <td className="px-3 py-2">
                        {v.category ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[v.category] ?? CATEGORY_COLORS.other}`}>
                            {CATEGORY_LABELS[v.category] ?? v.category}
                          </span>
                        ) : (
                          <span className="text-gray-600">{'\u2014'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{v.contact_name || '\u2014'}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs">{v.contact_phone || '\u2014'}</td>
                      <td className="px-3 py-2 text-gray-400 text-xs truncate max-w-[180px]">{v.contact_email || '\u2014'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {v.equipment_types?.map(t => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{t}</span>
                          )) ?? <span className="text-gray-600 text-xs">{'\u2014'}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-gray-400">
                        {v.lead_time_days != null ? `${v.lead_time_days}d` : '\u2014'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={e => { e.stopPropagation(); toggleActive(v) }}
                          className={`w-4 h-4 rounded-full border-2 transition-colors ${
                            v.active ? 'bg-green-500 border-green-500' : 'bg-transparent border-gray-600'
                          }`}
                          title={v.active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {expandedId === v.id
                          ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                          : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Expanded edit panel — rendered below table */}
            {expandedId && (() => {
              const v = vendors.find(x => x.id === expandedId)
              if (!v) return null
              return (
                <div className="border-t border-gray-700 p-5 space-y-4 bg-gray-800">
                  <h3 className="text-sm font-semibold text-white">Edit Vendor — {v.name}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <label htmlFor="edit-vendor-name" className="text-xs text-gray-400 block mb-1">Name</label>
                      <input
                        id="edit-vendor-name"
                        value={editDraft.name ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-category" className="text-xs text-gray-400 block mb-1">Category</label>
                      <select
                        id="edit-vendor-category"
                        value={editDraft.category ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, category: e.target.value || null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      >
                        <option value="">Select...</option>
                        {VENDOR_CATEGORIES.map(c => (
                          <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-contact" className="text-xs text-gray-400 block mb-1">Contact Name</label>
                      <input
                        id="edit-vendor-contact"
                        value={editDraft.contact_name ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, contact_name: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-phone" className="text-xs text-gray-400 block mb-1">Phone</label>
                      <input
                        id="edit-vendor-phone"
                        value={editDraft.contact_phone ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, contact_phone: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-email" className="text-xs text-gray-400 block mb-1">Email</label>
                      <input
                        id="edit-vendor-email"
                        value={editDraft.contact_email ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, contact_email: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-website" className="text-xs text-gray-400 block mb-1">Website</label>
                      <input
                        id="edit-vendor-website"
                        value={editDraft.website ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, website: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-address" className="text-xs text-gray-400 block mb-1">Address</label>
                      <input
                        id="edit-vendor-address"
                        value={editDraft.address ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, address: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label htmlFor="edit-vendor-city" className="text-xs text-gray-400 block mb-1">City</label>
                        <input
                          id="edit-vendor-city"
                          value={editDraft.city ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, city: e.target.value }))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                        />
                      </div>
                      <div className="w-16">
                        <label htmlFor="edit-vendor-state" className="text-xs text-gray-400 block mb-1">State</label>
                        <input
                          id="edit-vendor-state"
                          value={editDraft.state ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, state: e.target.value }))}
                          maxLength={2}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                        />
                      </div>
                      <div className="w-20">
                        <label htmlFor="edit-vendor-zip" className="text-xs text-gray-400 block mb-1">ZIP</label>
                        <input
                          id="edit-vendor-zip"
                          value={editDraft.zip ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, zip: e.target.value }))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-lead-time" className="text-xs text-gray-400 block mb-1">Lead Time (days)</label>
                      <input
                        id="edit-vendor-lead-time"
                        type="number"
                        min={0}
                        value={editDraft.lead_time_days ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, lead_time_days: e.target.value ? parseInt(e.target.value) : null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="edit-vendor-payment" className="text-xs text-gray-400 block mb-1">Payment Terms</label>
                      <input
                        id="edit-vendor-payment"
                        value={editDraft.payment_terms ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, payment_terms: e.target.value }))}
                        placeholder="e.g., Net 30"
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Equipment Types</label>
                    <div className="flex flex-wrap gap-2">
                      {EQUIPMENT_TYPE_OPTIONS.map(t => {
                        const selected = editDraft.equipment_types?.includes(t)
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setEditDraft(d => ({ ...d, equipment_types: toggleEquipType(d.equipment_types, t) }))}
                            className={`text-xs px-2 py-1 rounded transition-colors ${
                              selected ? 'bg-green-600/30 text-green-400 border border-green-600' : 'bg-gray-900 text-gray-400 border border-gray-700 hover:border-gray-500'
                            }`}
                          >
                            {t}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="edit-vendor-notes" className="text-xs text-gray-400 block mb-1">Notes</label>
                    <textarea
                      id="edit-vendor-notes"
                      value={editDraft.notes ?? ''}
                      onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                      rows={2}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white resize-none"
                    />
                  </div>
                  {/* Onboarding Documents */}
                  <div className="border-t border-gray-700 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Onboarding Documents</h4>
                      {vendorDocs.length === 0 && (
                        <button onClick={async () => { await initVendorOnboarding(v.id); loadDocs(v.id) }}
                          className="text-[10px] text-green-400 hover:text-green-300 px-2 py-1 bg-green-900/30 rounded">
                          + Initialize Standard Docs
                        </button>
                      )}
                    </div>
                    {vendorDocs.length > 0 ? (
                      <div className="space-y-1.5">
                        {vendorDocs.map(doc => {
                          const statusColors: Record<string, string> = {
                            needed: 'bg-red-900/40 text-red-400',
                            sent: 'bg-blue-900/40 text-blue-400',
                            received: 'bg-amber-900/40 text-amber-400',
                            verified: 'bg-green-900/40 text-green-400',
                            rejected: 'bg-red-900/40 text-red-400',
                            expired: 'bg-gray-700 text-gray-400',
                          }
                          return (
                            <div key={doc.id} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                              <span className="text-xs text-gray-300 flex-1">{doc.label}</span>
                              <select value={doc.status}
                                onChange={async (e) => {
                                  const ok = await updateVendorDocStatus(doc.id, e.target.value, authUser?.name)
                                  if (ok) loadDocs(v.id)
                                }}
                                className={`text-[10px] px-2 py-0.5 rounded border-none cursor-pointer ${statusColors[doc.status] ?? 'bg-gray-700 text-gray-400'}`}>
                                {VENDOR_DOC_STATUSES.map(s => (
                                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                                ))}
                              </select>
                              <button onClick={async () => { await deleteVendorDoc(doc.id); loadDocs(v.id) }}
                                className="text-gray-600 hover:text-red-400 text-xs">×</button>
                            </div>
                          )
                        })}
                        <button onClick={async () => {
                          const type = VENDOR_DOC_TYPES.find(t => !vendorDocs.some(d => d.doc_type === t.type))
                          if (type) { await addVendorDoc({ vendor_id: v.id, doc_type: type.type, label: type.label }); loadDocs(v.id) }
                        }} className="text-[10px] text-gray-500 hover:text-gray-300">+ Add document</button>
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-600">No onboarding documents yet. Click "Initialize" to add the standard set.</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                    {isSuperAdmin ? (
                      <button
                        onClick={() => handleDelete(v.id, v.name)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete vendor
                      </button>
                    ) : <div />}
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setExpandedId(null); setEditDraft({}) }}
                        className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSave(v.id)}
                        disabled={editSaving}
                        className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
                      >
                        {editSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* Total count */}
        <div className="text-xs text-gray-500">
          {filtered.length} vendor{filtered.length !== 1 ? 's' : ''} shown
        </div>
      </div>
    </div>
  )
}
