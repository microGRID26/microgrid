'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { db } from '@/lib/db'
import { handleApiError } from '@/lib/errors'
import { TICKET_CATEGORIES, TICKET_CATEGORY_COLORS } from '@/lib/api/tickets'
import type { TicketCategory, TicketResolutionCode } from '@/lib/api/tickets'
import { Plus, Pencil, Search, X } from 'lucide-react'

// ── Ticket Category & Resolution Code Manager ────────────────────────────────

export function TicketConfigManager() {
  const [tab, setTab] = useState<'categories' | 'resolutions'>('categories')
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [resolutions, setResolutions] = useState<TicketResolutionCode[]>([])
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, any>>({})

  const reload = () => {
    db().from('ticket_categories').select('*').order('sort_order').limit(500).then(({ data }: { data: TicketCategory[] | null }) => setCategories(data ?? []))
      .catch((err: unknown) => handleApiError(err, '[TicketConfig] categories load'))
    db().from('ticket_resolution_codes').select('*').order('sort_order').limit(200).then(({ data }: { data: TicketResolutionCode[] | null }) => setResolutions(data ?? []))
      .catch((err: unknown) => handleApiError(err, '[TicketConfig] resolutions load'))
  }

  useEffect(() => { reload() }, [])

  // ── Categories ─────────────────────────────────────────────────────────────

  const filteredCats = useMemo(() => {
    let list = [...categories]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(c => c.label.toLowerCase().includes(q) || (c.subcategory ?? '').toLowerCase().includes(q))
    }
    if (filterCat) list = list.filter(c => c.category === filterCat)
    return list
  }, [categories, search, filterCat])

  const startEditCat = (c: TicketCategory) => {
    setEditingId(c.id)
    setDraft({ category: c.category, subcategory: c.subcategory ?? '', label: c.label, description: c.description ?? '', default_priority: c.default_priority, default_sla_response: c.default_sla_response, default_sla_resolution: c.default_sla_resolution, active: c.active, sort_order: c.sort_order })
  }

  const saveCat = async () => {
    if (editingId) {
      await db().from('ticket_categories').update(draft).eq('id', editingId)
      setEditingId(null)
    }
    reload()
  }

  const addCat = async () => {
    await db().from('ticket_categories').insert({
      category: draft.category || 'other',
      subcategory: draft.subcategory || null,
      label: draft.label || 'New Category',
      description: draft.description || null,
      default_priority: draft.default_priority || 'normal',
      default_sla_response: draft.default_sla_response || 24,
      default_sla_resolution: draft.default_sla_resolution || 72,
      active: true,
      sort_order: categories.length,
    })
    setShowAdd(false)
    setDraft({})
    reload()
  }

  const toggleActive = async (id: string, active: boolean) => {
    await db().from('ticket_categories').update({ active: !active }).eq('id', id)
    reload()
  }

  // ── Resolution Codes ───────────────────────────────────────────────────────

  const filteredRes = useMemo(() => {
    if (!search) return resolutions
    const q = search.toLowerCase()
    return resolutions.filter(r => r.label.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
  }, [resolutions, search])

  const startEditRes = (r: TicketResolutionCode) => {
    setEditingId(r.id)
    setDraft({ code: r.code, label: r.label, description: r.description ?? '', applies_to: (r.applies_to ?? []).join(', '), active: r.active, sort_order: r.sort_order })
  }

  const saveRes = async () => {
    if (editingId) {
      const appliesTo = draft.applies_to ? draft.applies_to.split(',').map((s: string) => s.trim()).filter(Boolean) : null
      await db().from('ticket_resolution_codes').update({ ...draft, applies_to: appliesTo }).eq('id', editingId)
      setEditingId(null)
    }
    reload()
  }

  const addRes = async () => {
    const appliesTo = draft.applies_to ? draft.applies_to.split(',').map((s: string) => s.trim()).filter(Boolean) : null
    await db().from('ticket_resolution_codes').insert({
      code: draft.code || 'new_code',
      label: draft.label || 'New Resolution',
      description: draft.description || null,
      applies_to: appliesTo,
      active: true,
      sort_order: resolutions.length,
    })
    setShowAdd(false)
    setDraft({})
    reload()
  }

  return (
    <div className="space-y-4">
      {/* Tab toggle */}
      <div className="flex gap-2 border-b border-gray-700 pb-2">
        <button onClick={() => { setTab('categories'); setSearch(''); setEditingId(null) }}
          className={`text-xs px-3 py-1.5 rounded-t ${tab === 'categories' ? 'bg-gray-800 text-white font-medium' : 'text-gray-400 hover:text-white'}`}>
          Categories ({categories.length})
        </button>
        <button onClick={() => { setTab('resolutions'); setSearch(''); setEditingId(null) }}
          className={`text-xs px-3 py-1.5 rounded-t ${tab === 'resolutions' ? 'bg-gray-800 text-white font-medium' : 'text-gray-400 hover:text-white'}`}>
          Resolution Codes ({resolutions.length})
        </button>
      </div>

      {/* Search + Add */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-white placeholder-gray-500" />
        </div>
        {tab === 'categories' && (
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white">
            <option value="">All Categories</option>
            {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <button onClick={() => { setShowAdd(true); setDraft({}) }}
          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs rounded-md">
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {/* Categories Table */}
      {tab === 'categories' && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Subcategory</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">SLA Resp</th>
                <th className="px-3 py-2 font-medium">SLA Res</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCats.map(c => (
                <React.Fragment key={c.id}>
                  <tr className="border-b border-gray-700/50 hover:bg-gray-750">
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${TICKET_CATEGORY_COLORS[c.category] ?? 'bg-gray-700 text-gray-400'}`}>{c.category}</span></td>
                    <td className="px-3 py-2 text-gray-300">{c.subcategory ?? '\u2014'}</td>
                    <td className="px-3 py-2 text-white font-medium">{c.label}</td>
                    <td className="px-3 py-2 text-gray-300 capitalize">{c.default_priority}</td>
                    <td className="px-3 py-2 text-gray-300">{c.default_sla_response}h</td>
                    <td className="px-3 py-2 text-gray-300">{c.default_sla_resolution}h</td>
                    <td className="px-3 py-2">
                      <button onClick={() => toggleActive(c.id, c.active)} className={`w-3 h-3 rounded-full ${c.active ? 'bg-green-500' : 'bg-gray-600'}`} />
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => startEditCat(c)} className="text-blue-400 hover:text-blue-300"><Pencil className="w-3 h-3" /></button>
                    </td>
                  </tr>
                  {editingId === c.id && (
                    <tr><td colSpan={8} className="px-3 py-3 bg-gray-900/50">
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div><label className="text-[10px] text-gray-500">Category</label>
                          <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                            {TICKET_CATEGORIES.map(c2 => <option key={c2} value={c2}>{c2}</option>)}
                          </select>
                        </div>
                        <div><label className="text-[10px] text-gray-500">Subcategory</label>
                          <input value={draft.subcategory} onChange={e => setDraft(d => ({ ...d, subcategory: e.target.value }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div><label className="text-[10px] text-gray-500">Label</label>
                          <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div><label className="text-[10px] text-gray-500">Default Priority</label>
                          <select value={draft.default_priority} onChange={e => setDraft(d => ({ ...d, default_priority: e.target.value }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white">
                            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="critical">Critical</option>
                          </select>
                        </div>
                        <div><label className="text-[10px] text-gray-500">SLA Response (hrs)</label>
                          <input type="number" value={draft.default_sla_response} onChange={e => setDraft(d => ({ ...d, default_sla_response: parseInt(e.target.value) || 24 }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div><label className="text-[10px] text-gray-500">SLA Resolution (hrs)</label>
                          <input type="number" value={draft.default_sla_resolution} onChange={e => setDraft(d => ({ ...d, default_sla_resolution: parseInt(e.target.value) || 72 }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div><label className="text-[10px] text-gray-500">Sort Order</label>
                          <input type="number" value={draft.sort_order} onChange={e => setDraft(d => ({ ...d, sort_order: parseInt(e.target.value) || 0 }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div className="flex items-end gap-2">
                          <button onClick={saveCat} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-[10px] text-white font-medium">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-[10px] text-gray-400 hover:text-white">Cancel</button>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resolution Codes Table */}
      {tab === 'resolutions' && (
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Applies To</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRes.map(r => (
                <React.Fragment key={r.id}>
                  <tr className="border-b border-gray-700/50 hover:bg-gray-750">
                    <td className="px-3 py-2 text-white font-mono">{r.code}</td>
                    <td className="px-3 py-2 text-white font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-gray-400 max-w-[200px] truncate">{r.description ?? '\u2014'}</td>
                    <td className="px-3 py-2">{r.applies_to ? r.applies_to.map(a => <span key={a} className={`px-1 py-0.5 rounded text-[9px] font-medium mr-1 ${TICKET_CATEGORY_COLORS[a] ?? 'bg-gray-700 text-gray-400'}`}>{a}</span>) : <span className="text-gray-500 text-[10px]">All</span>}</td>
                    <td className="px-3 py-2"><span className={`w-3 h-3 rounded-full inline-block ${r.active ? 'bg-green-500' : 'bg-gray-600'}`} /></td>
                    <td className="px-3 py-2">
                      <button onClick={() => startEditRes(r)} className="text-blue-400 hover:text-blue-300"><Pencil className="w-3 h-3" /></button>
                    </td>
                  </tr>
                  {editingId === r.id && (
                    <tr><td colSpan={6} className="px-3 py-3 bg-gray-900/50">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div><label className="text-[10px] text-gray-500">Code</label>
                          <input value={draft.code} onChange={e => setDraft(d => ({ ...d, code: e.target.value }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white font-mono" />
                        </div>
                        <div><label className="text-[10px] text-gray-500">Label</label>
                          <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div><label className="text-[10px] text-gray-500">Applies To (comma-separated)</label>
                          <input value={draft.applies_to} onChange={e => setDraft(d => ({ ...d, applies_to: e.target.value }))} placeholder="service, sales, warranty" className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div className="col-span-2"><label className="text-[10px] text-gray-500">Description</label>
                          <input value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} className="w-full mt-0.5 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white" />
                        </div>
                        <div className="flex items-end gap-2">
                          <button onClick={saveRes} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-[10px] text-white font-medium">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-[10px] text-gray-400 hover:text-white">Cancel</button>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowAdd(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Add {tab === 'categories' ? 'Category' : 'Resolution Code'}</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {tab === 'categories' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Category</label>
                      <select value={draft.category ?? 'service'} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                        {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Subcategory</label>
                      <input value={draft.subcategory ?? ''} onChange={e => setDraft(d => ({ ...d, subcategory: e.target.value }))} placeholder="e.g. panel_damage" className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Label *</label>
                    <input value={draft.label ?? ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Display name" className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Priority</label>
                      <select value={draft.default_priority ?? 'normal'} onChange={e => setDraft(d => ({ ...d, default_priority: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white">
                        <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">SLA Resp (hrs)</label>
                      <input type="number" value={draft.default_sla_response ?? 24} onChange={e => setDraft(d => ({ ...d, default_sla_response: parseInt(e.target.value) || 24 }))} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">SLA Res (hrs)</label>
                      <input type="number" value={draft.default_sla_resolution ?? 72} onChange={e => setDraft(d => ({ ...d, default_sla_resolution: parseInt(e.target.value) || 72 }))} className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Code *</label>
                      <input value={draft.code ?? ''} onChange={e => setDraft(d => ({ ...d, code: e.target.value }))} placeholder="e.g. equipment_swap" className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white font-mono" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Label *</label>
                      <input value={draft.label ?? ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Display name" className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Applies To (comma-separated categories, leave blank for all)</label>
                    <input value={draft.applies_to ?? ''} onChange={e => setDraft(d => ({ ...d, applies_to: e.target.value }))} placeholder="service, warranty" className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white" />
                  </div>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">Cancel</button>
              <button onClick={tab === 'categories' ? addCat : addRes} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-md">
                Add {tab === 'categories' ? 'Category' : 'Resolution Code'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
