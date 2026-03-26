'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Input, Textarea, Modal, SaveBtn, SearchBar } from './shared'
import { VENDOR_CATEGORIES, EQUIPMENT_TYPE_OPTIONS } from '@/lib/api/vendors'

export function VendorManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [vendors, setVendors] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [draft, setDraft] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    let q = supabase.from('vendors').select('*').order('name')
    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    if (filterCategory) q = q.eq('category', filterCategory)
    const { data } = await q
    setVendors(data ?? [])
  }, [search, filterCategory])

  useEffect(() => { load() }, [load])

  const openEdit = (v: any) => { setEditing(v); setDraft({ ...v, equipment_types: v.equipment_types ?? [] }) }

  function toggleEquipType(types: string[], type: string): string[] {
    return types.includes(type) ? types.filter((t: string) => t !== type) : [...types, type]
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('vendors').update({
      name: draft.name,
      contact_name: draft.contact_name,
      contact_email: draft.contact_email,
      contact_phone: draft.contact_phone,
      website: draft.website,
      address: draft.address,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
      category: draft.category || null,
      equipment_types: draft.equipment_types?.length ? draft.equipment_types : null,
      lead_time_days: draft.lead_time_days ?? null,
      payment_terms: draft.payment_terms,
      notes: draft.notes,
      active: draft.active,
    }).eq('id', editing.id)
    if (error) { setSaving(false); setToast('Save failed'); setTimeout(() => setToast(''), 2500); return }
    setSaving(false); setEditing(null); setToast('Vendor saved'); setTimeout(() => setToast(''), 2500); load()
  }

  const createNew = async () => {
    if (!draft.name?.trim()) return
    setSaving(true)
    const { error } = await supabase.from('vendors').insert({
      name: draft.name,
      contact_name: draft.contact_name || null,
      contact_email: draft.contact_email || null,
      contact_phone: draft.contact_phone || null,
      website: draft.website || null,
      address: draft.address || null,
      city: draft.city || null,
      state: draft.state || null,
      zip: draft.zip || null,
      category: draft.category || null,
      equipment_types: draft.equipment_types?.length ? draft.equipment_types : null,
      lead_time_days: draft.lead_time_days ?? null,
      payment_terms: draft.payment_terms || null,
      notes: draft.notes || null,
    })
    if (error) { setSaving(false); setToast('Create failed'); setTimeout(() => setToast(''), 2500); return }
    setSaving(false); setShowNew(false); setDraft({}); setToast('Vendor created'); setTimeout(() => setToast(''), 2500); load()
  }

  const toggleActive = async (v: any) => {
    const { error } = await supabase.from('vendors').update({ active: !v.active }).eq('id', v.id)
    if (!error) { setToast(v.active ? 'Deactivated' : 'Activated'); setTimeout(() => setToast(''), 2500); load() }
  }

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Vendor Manager</h2>
          <p className="text-xs text-gray-500 mt-0.5">{vendors.length} vendor records</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-64"><SearchBar value={search} onChange={setSearch} placeholder="Search vendors..." /></div>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
          >
            <option value="">All Categories</option>
            {VENDOR_CATEGORIES.map(c => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <button onClick={() => { setShowNew(true); setDraft({ equipment_types: [] }) }} className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Vendor</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Name', 'Category', 'Contact', 'Phone', 'Email', 'Equipment', 'Lead Time', 'Active'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {vendors.map((v, i) => (
              <tr
                key={v.id}
                className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'} ${!v.active ? 'opacity-50' : ''}`}
                onClick={() => openEdit(v)}
              >
                <td className="px-3 py-2 text-white font-medium">{v.name}</td>
                <td className="px-3 py-2 text-gray-400">{v.category || '\u2014'}</td>
                <td className="px-3 py-2 text-gray-400">{v.contact_name || '\u2014'}</td>
                <td className="px-3 py-2 text-gray-400">{v.contact_phone || '\u2014'}</td>
                <td className="px-3 py-2 text-gray-400 max-w-[160px] truncate">{v.contact_email || '\u2014'}</td>
                <td className="px-3 py-2 text-gray-500">
                  {v.equipment_types?.length ? v.equipment_types.join(', ') : '\u2014'}
                </td>
                <td className="px-3 py-2 text-gray-400">{v.lead_time_days != null ? `${v.lead_time_days}d` : '\u2014'}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={e => { e.stopPropagation(); toggleActive(v) }}
                    className={`w-3 h-3 rounded-full border-2 ${v.active ? 'bg-green-500 border-green-500' : 'border-gray-600'}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <button className="text-gray-500 hover:text-blue-400">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {vendors.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-600 text-sm">No vendors found</td></tr>}
          </tbody>
        </table>
      </div>
      {(editing || showNew) && (
        <Modal title={editing ? `Edit Vendor \u2014 ${editing.name}` : 'New Vendor'} onClose={() => { setEditing(null); setShowNew(false) }}>
          <Input label="Name" value={draft.name ?? ''} onChange={v => setDraft((d: any) => ({ ...d, name: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                value={draft.category ?? ''}
                onChange={e => setDraft((d: any) => ({ ...d, category: e.target.value || null }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
              >
                <option value="">Select...</option>
                {VENDOR_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <Input label="Payment Terms" value={draft.payment_terms ?? ''} onChange={v => setDraft((d: any) => ({ ...d, payment_terms: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact Name" value={draft.contact_name ?? ''} onChange={v => setDraft((d: any) => ({ ...d, contact_name: v }))} />
            <Input label="Phone" value={draft.contact_phone ?? ''} onChange={v => setDraft((d: any) => ({ ...d, contact_phone: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Email" value={draft.contact_email ?? ''} onChange={v => setDraft((d: any) => ({ ...d, contact_email: v }))} />
            <Input label="Website" value={draft.website ?? ''} onChange={v => setDraft((d: any) => ({ ...d, website: v }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Address" value={draft.address ?? ''} onChange={v => setDraft((d: any) => ({ ...d, address: v }))} />
            <Input label="City" value={draft.city ?? ''} onChange={v => setDraft((d: any) => ({ ...d, city: v }))} />
            <div className="flex gap-2">
              <div className="flex-1">
                <Input label="State" value={draft.state ?? ''} onChange={v => setDraft((d: any) => ({ ...d, state: v }))} />
              </div>
              <div className="flex-1">
                <Input label="ZIP" value={draft.zip ?? ''} onChange={v => setDraft((d: any) => ({ ...d, zip: v }))} />
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Lead Time (days)</label>
            <input
              type="number"
              min={0}
              value={draft.lead_time_days ?? ''}
              onChange={e => setDraft((d: any) => ({ ...d, lead_time_days: e.target.value ? parseInt(e.target.value) : null }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Equipment Types</label>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_TYPE_OPTIONS.map(t => {
                const selected = (draft.equipment_types ?? []).includes(t)
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDraft((d: any) => ({ ...d, equipment_types: toggleEquipType(d.equipment_types ?? [], t) }))}
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
          <Textarea label="Notes" value={draft.notes ?? ''} onChange={v => setDraft((d: any) => ({ ...d, notes: v }))} />
          {editing && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraft((d: any) => ({ ...d, active: !d.active }))}
                className={`w-4 h-4 rounded-full border-2 transition-colors ${
                  draft.active ? 'bg-green-500 border-green-500' : 'bg-transparent border-gray-600'
                }`}
              />
              <span className="text-xs text-gray-400">{draft.active ? 'Active' : 'Inactive'}</span>
            </div>
          )}
          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button onClick={async () => {
                if (!confirm(`DELETE Vendor "${editing.name}"?`)) return
                await supabase.from('vendors').delete().eq('id', editing.id)
                setEditing(null); setToast('Vendor deleted'); setTimeout(() => setToast(''), 2500); load()
              }} className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md">Delete</button>
            ) : <div />}
            <div className="flex gap-2">
              <button onClick={() => { setEditing(null); setShowNew(false) }} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <SaveBtn onClick={editing ? save : createNew} saving={saving} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
