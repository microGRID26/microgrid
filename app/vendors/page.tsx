'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { loadVendors, addVendor, updateVendor, deleteVendor, VENDOR_CATEGORIES, EQUIPMENT_TYPE_OPTIONS } from '@/lib/api/vendors'
import type { Vendor } from '@/lib/api/vendors'
import { Search, Plus, X, Building2, ChevronDown, ChevronUp, Truck, Phone, Mail, Globe } from 'lucide-react'

const CATEGORY_COLORS: Record<string, string> = {
  manufacturer: 'bg-blue-500/20 text-blue-400',
  distributor: 'bg-purple-500/20 text-purple-400',
  subcontractor: 'bg-amber-500/20 text-amber-400',
  other: 'bg-gray-500/20 text-gray-400',
}

export default function VendorsPage() {
  const { user: authUser } = useCurrentUser()
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
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
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
                <label className="text-xs text-gray-400 block mb-1">Name *</label>
                <input
                  value={addDraft.name ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))}
                  placeholder="Vendor name"
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Category</label>
                <select
                  value={addDraft.category ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, category: e.target.value || null }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                >
                  <option value="">Select...</option>
                  {VENDOR_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Contact Name</label>
                <input
                  value={addDraft.contact_name ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, contact_name: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Phone</label>
                <input
                  value={addDraft.contact_phone ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, contact_phone: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Email</label>
                <input
                  value={addDraft.contact_email ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, contact_email: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Website</label>
                <input
                  value={addDraft.website ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, website: e.target.value }))}
                  placeholder="https://..."
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Address</label>
                <input
                  value={addDraft.address ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, address: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 block mb-1">City</label>
                  <input
                    value={addDraft.city ?? ''}
                    onChange={e => setAddDraft(d => ({ ...d, city: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                  />
                </div>
                <div className="w-16">
                  <label className="text-xs text-gray-400 block mb-1">State</label>
                  <input
                    value={addDraft.state ?? ''}
                    onChange={e => setAddDraft(d => ({ ...d, state: e.target.value }))}
                    maxLength={2}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                  />
                </div>
                <div className="w-20">
                  <label className="text-xs text-gray-400 block mb-1">ZIP</label>
                  <input
                    value={addDraft.zip ?? ''}
                    onChange={e => setAddDraft(d => ({ ...d, zip: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Lead Time (days)</label>
                <input
                  type="number"
                  min={0}
                  value={addDraft.lead_time_days ?? ''}
                  onChange={e => setAddDraft(d => ({ ...d, lead_time_days: e.target.value ? parseInt(e.target.value) : null }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Payment Terms</label>
                <input
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
              <label className="text-xs text-gray-400 block mb-1">Notes</label>
              <textarea
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
                        } else {
                          setExpandedId(v.id)
                          setEditDraft({ ...v })
                        }
                      }}
                    >
                      <td className="px-3 py-2 text-white font-medium">{v.name}</td>
                      <td className="px-3 py-2">
                        {v.category ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${CATEGORY_COLORS[v.category] ?? CATEGORY_COLORS.other}`}>
                            {v.category}
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
                      <label className="text-xs text-gray-400 block mb-1">Name</label>
                      <input
                        value={editDraft.name ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Category</label>
                      <select
                        value={editDraft.category ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, category: e.target.value || null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      >
                        <option value="">Select...</option>
                        {VENDOR_CATEGORIES.map(c => (
                          <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Contact Name</label>
                      <input
                        value={editDraft.contact_name ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, contact_name: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Phone</label>
                      <input
                        value={editDraft.contact_phone ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, contact_phone: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Email</label>
                      <input
                        value={editDraft.contact_email ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, contact_email: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Website</label>
                      <input
                        value={editDraft.website ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, website: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Address</label>
                      <input
                        value={editDraft.address ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, address: e.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 block mb-1">City</label>
                        <input
                          value={editDraft.city ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, city: e.target.value }))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                        />
                      </div>
                      <div className="w-16">
                        <label className="text-xs text-gray-400 block mb-1">State</label>
                        <input
                          value={editDraft.state ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, state: e.target.value }))}
                          maxLength={2}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                        />
                      </div>
                      <div className="w-20">
                        <label className="text-xs text-gray-400 block mb-1">ZIP</label>
                        <input
                          value={editDraft.zip ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, zip: e.target.value }))}
                          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Lead Time (days)</label>
                      <input
                        type="number"
                        min={0}
                        value={editDraft.lead_time_days ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, lead_time_days: e.target.value ? parseInt(e.target.value) : null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Payment Terms</label>
                      <input
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
                    <label className="text-xs text-gray-400 block mb-1">Notes</label>
                    <textarea
                      value={editDraft.notes ?? ''}
                      onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                      rows={2}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white resize-none"
                    />
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
