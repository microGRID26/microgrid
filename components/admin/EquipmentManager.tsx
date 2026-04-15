'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Input, Textarea, Modal, SaveBtn, SearchBar } from './shared'
import { EQUIPMENT_CATEGORIES } from '@/lib/api/equipment'
import type { Equipment, EquipmentCategory } from '@/lib/api/equipment'

const CATEGORY_COLORS: Record<string, string> = {
  module: 'bg-blue-900/40 text-blue-400 border-blue-800',
  inverter: 'bg-amber-900/40 text-amber-400 border-amber-800',
  battery: 'bg-green-900/40 text-green-400 border-green-800',
  optimizer: 'bg-purple-900/40 text-purple-400 border-purple-800',
  racking: 'bg-cyan-900/40 text-cyan-400 border-cyan-800',
  electrical: 'bg-red-900/40 text-red-400 border-red-800',
  adder: 'bg-pink-900/40 text-pink-400 border-pink-800',
  other: 'bg-gray-800 text-gray-400 border-gray-700',
}

export function EquipmentManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Equipment | null>(null)
  const [draft, setDraft] = useState<Partial<Equipment>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    let q = supabase.from('equipment').select('*').order('category').order('sort_order').order('name')
    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    if (catFilter !== 'all') q = q.eq('category', catFilter)
    const { data } = await q
    setEquipment(data ?? [])
  }, [search, catFilter])

  useEffect(() => { load() }, [load])

  const openEdit = (item: Equipment) => { setEditing(item); setDraft({ ...item }) }

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('equipment').update({
      name: draft.name, manufacturer: draft.manufacturer, model: draft.model,
      category: draft.category, watts: draft.watts ? Number(draft.watts) : null,
      description: draft.description, active: draft.active, sort_order: draft.sort_order ? Number(draft.sort_order) : 0,
      sourcing: draft.sourcing || null, raw_price: draft.raw_price ? Number(draft.raw_price) : null,
      sell_price: draft.sell_price ? Number(draft.sell_price) : null,
    }).eq('id', editing.id)
    setSaving(false)
    if (error) { flash('Save failed'); return }
    setEditing(null); flash('Equipment saved'); load()
  }

  const createNew = async () => {
    if (!draft.name?.trim() || !draft.category) return
    setSaving(true)
    const { error } = await supabase.from('equipment').insert({
      name: draft.name, manufacturer: draft.manufacturer || null, model: draft.model || null,
      category: draft.category, watts: draft.watts ? Number(draft.watts) : null,
      description: draft.description || null, active: draft.active ?? true,
      sort_order: draft.sort_order ? Number(draft.sort_order) : 0,
      sourcing: draft.sourcing || null, raw_price: draft.raw_price ? Number(draft.raw_price) : null,
      sell_price: draft.sell_price ? Number(draft.sell_price) : null,
    })
    setSaving(false)
    if (error) { flash('Create failed'); return }
    setShowNew(false); setDraft({}); flash('Equipment created'); load()
  }

  const toggleActive = async (item: Equipment) => {
    await supabase.from('equipment').update({ active: !item.active }).eq('id', item.id)
    load()
  }

  // Group by category for display
  const grouped = equipment.reduce<Record<string, Equipment[]>>((acc, item) => {
    const cat = item.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {})

  const catLabel = (cat: string) => EQUIPMENT_CATEGORIES.find(c => c.value === cat)?.label ?? cat

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Equipment Catalog</h2>
          <p className="text-xs text-gray-500 mt-0.5">{equipment.length} equipment records</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={catFilter}
            onChange={e => setCatFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-green-500"
          >
            <option value="all">All Categories</option>
            {EQUIPMENT_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div className="w-64"><SearchBar value={search} onChange={setSearch} placeholder="Search equipment..." /></div>
          <button onClick={() => { setShowNew(true); setDraft({ active: true, category: 'module' }) }}
            className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Equipment</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Name', 'Category', 'Manufacturer', 'Watts', 'Sourcing', 'Sell Price', 'Status'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {equipment.map((item, i) => (
              <tr key={item.id}
                className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                onClick={() => openEdit(item)}>
                <td className="px-3 py-2 text-white font-medium max-w-[300px] truncate">{item.name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other}`}>
                    {catLabel(item.category)}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-400">{item.manufacturer || '--'}</td>
                <td className="px-3 py-2 text-gray-400">{item.watts ? `${item.watts}W` : '--'}</td>
                <td className="px-3 py-2 text-gray-400">{item.sourcing || '--'}</td>
                <td className="px-3 py-2 text-gray-400">{item.sell_price != null ? `$${Number(item.sell_price).toFixed(2)}` : '--'}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleActive(item) }}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                      item.active
                        ? 'bg-green-900/40 text-green-400 border-green-800 hover:bg-green-900/60'
                        : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700'
                    }`}
                    title={item.active ? 'Click to deactivate' : 'Click to activate'}
                  >
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${item.active ? 'bg-green-400' : 'bg-gray-600'}`} />
                    {item.active ? 'Active' : 'Inactive'}
                  </button>
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
            {equipment.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-600 text-sm">No equipment found</td></tr>}
          </tbody>
        </table>
      </div>
      {(editing || showNew) && (
        <Modal title={editing ? `Edit Equipment -- ${editing.name}` : 'New Equipment'} onClose={() => { setEditing(null); setShowNew(false) }}>
          <Input label="Name" value={draft.name ?? ''} onChange={v => setDraft(d => ({ ...d, name: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Category</label>
              <select
                value={draft.category ?? 'module'}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value as EquipmentCategory }))}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors"
              >
                {EQUIPMENT_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Input label="Watts" value={draft.watts?.toString() ?? ''} onChange={v => setDraft(d => ({ ...d, watts: v ? parseInt(v) : null }))} type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Manufacturer" value={draft.manufacturer ?? ''} onChange={v => setDraft(d => ({ ...d, manufacturer: v || null }))} />
            <Input label="Model" value={draft.model ?? ''} onChange={v => setDraft(d => ({ ...d, model: v || null }))} />
          </div>
          <Input label="Sort Order" value={draft.sort_order?.toString() ?? '0'} onChange={v => setDraft(d => ({ ...d, sort_order: parseInt(v) || 0 }))} type="number" />
          <Input label="Sourcing" value={draft.sourcing ?? ''} onChange={v => setDraft(d => ({ ...d, sourcing: v || null }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Raw Price ($)" value={draft.raw_price?.toString() ?? ''} onChange={v => setDraft(d => ({ ...d, raw_price: v ? parseFloat(v) : null }))} type="number" />
            <Input label="Sell Price ($)" value={draft.sell_price?.toString() ?? ''} onChange={v => setDraft(d => ({ ...d, sell_price: v ? parseFloat(v) : null }))} type="number" />
          </div>
          <Textarea label="Description" value={draft.description ?? ''} onChange={v => setDraft(d => ({ ...d, description: v || null }))} />
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={draft.active ?? true}
              onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}
              className="rounded bg-gray-800 border-gray-700 text-green-500 focus:ring-green-500" />
            <label className="text-xs text-gray-400">Active</label>
          </div>
          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button onClick={async () => {
                if (!confirm(`DELETE "${editing.name}"?`)) return
                await supabase.from('equipment').delete().eq('id', editing.id)
                setEditing(null); flash('Equipment deleted'); load()
              }} className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md">Delete</button>
            ) : <div />}
            <div className="flex gap-2">
              {editing && (
                <button onClick={() => toggleActive(editing)}
                  className={`px-3 py-1.5 text-xs rounded-md ${editing.active ? 'text-amber-400 hover:bg-amber-900/20' : 'text-green-400 hover:bg-green-900/20'}`}>
                  {editing.active ? 'Deactivate' : 'Activate'}
                </button>
              )}
              <button onClick={() => { setEditing(null); setShowNew(false) }} className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <SaveBtn onClick={editing ? save : createNew} saving={saving} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
