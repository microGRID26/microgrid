'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { SearchBar, SaveBtn, Modal, Input } from './shared'
import {
  loadPayScales, addPayScale, updatePayScale, deletePayScale,
} from '@/lib/api'
import type { PayScale } from '@/lib/api'
import { useOrg } from '@/lib/hooks'
import { Pencil, Trash2, Plus } from 'lucide-react'

export function PayScaleManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const { orgId } = useOrg()
  const [scales, setScales] = useState<PayScale[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [perWattRate, setPerWattRate] = useState('')
  const [adderPct, setAdderPct] = useState('10')
  const [referralBonus, setReferralBonus] = useState('500')

  const load = useCallback(async () => {
    setLoading(true)
    const data = await loadPayScales(orgId)
    setScales(data)
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  const resetForm = () => {
    setName(''); setDescription(''); setPerWattRate(''); setAdderPct('10'); setReferralBonus('500')
  }

  const startEdit = (s: PayScale) => {
    setEditingId(s.id)
    setName(s.name)
    setDescription(s.description ?? '')
    setPerWattRate(String(s.per_watt_rate))
    setAdderPct(String(s.adder_percentage))
    setReferralBonus(String(s.referral_bonus))
    setShowAdd(false)
  }

  const handleSave = async () => {
    if (!name.trim() || !perWattRate) return
    setSaving(true)
    if (editingId) {
      await updatePayScale(editingId, {
        name: name.trim(),
        description: description.trim() || null,
        per_watt_rate: parseFloat(perWattRate) || 0,
        adder_percentage: parseFloat(adderPct) || 0,
        referral_bonus: parseFloat(referralBonus) || 0,
      })
    } else {
      await addPayScale({
        name: name.trim(),
        per_watt_rate: parseFloat(perWattRate) || 0,
        description: description.trim() || undefined,
        adder_percentage: parseFloat(adderPct) || 0,
        referral_bonus: parseFloat(referralBonus) || 0,
        sort_order: scales.length + 1,
        org_id: orgId || undefined,
      })
    }
    setSaving(false)
    resetForm()
    setEditingId(null)
    setShowAdd(false)
    load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this pay scale? Reps assigned to it will need a new scale.')) return
    await deletePayScale(id)
    load()
  }

  const handleToggle = async (s: PayScale) => {
    await updatePayScale(s.id, { active: !s.active })
    load()
  }

  const filtered = scales.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
  })

  if (loading) return <div className="text-gray-500 text-sm py-8 text-center">Loading pay scales...</div>

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} placeholder="Search pay scales..." /></div>
        <button onClick={() => { setShowAdd(true); setEditingId(null); resetForm() }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-md">
          <Plus className="w-3.5 h-3.5" /> Add Tier
        </button>
      </div>

      {/* Visual comparison */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {filtered.filter(s => s.active).map(s => (
          <div key={s.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-center relative group">
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(s)} className="text-gray-500 hover:text-white p-0.5"><Pencil className="w-3 h-3" /></button>
              {isSuperAdmin && <button onClick={() => handleDelete(s.id)} className="text-gray-500 hover:text-red-400 p-0.5"><Trash2 className="w-3 h-3" /></button>}
            </div>
            <p className="text-xs font-semibold text-white">{s.name}</p>
            <p className="text-2xl font-bold text-green-400 mt-1">${Number(s.per_watt_rate).toFixed(2)}<span className="text-sm text-green-500">/W</span></p>
            <div className="flex justify-center gap-3 mt-2 text-[10px] text-gray-400">
              <span>Adder: {Number(s.adder_percentage)}%</span>
              <span>Ref: ${Number(s.referral_bonus)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Full table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-gray-900">
            <tr className="border-b border-gray-700 text-[10px] uppercase tracking-wider text-gray-400">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Rate</th>
              <th className="px-3 py-2 font-medium">Adder %</th>
              <th className="px-3 py-2 font-medium">Referral</th>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                <td className="px-3 py-2">
                  <span className="text-white font-medium">{s.name}</span>
                  {s.description && <p className="text-[10px] text-gray-500">{s.description}</p>}
                </td>
                <td className="px-3 py-2 text-green-400 font-medium">${Number(s.per_watt_rate).toFixed(2)}/W</td>
                <td className="px-3 py-2 text-gray-300">{Number(s.adder_percentage)}%</td>
                <td className="px-3 py-2 text-gray-300">${Number(s.referral_bonus)}</td>
                <td className="px-3 py-2 text-gray-400">{s.sort_order}</td>
                <td className="px-3 py-2">
                  <button onClick={() => handleToggle(s)}
                    className={`w-3 h-3 rounded-full ${s.active ? 'bg-green-500' : 'bg-gray-600'}`}
                    title={s.active ? 'Active' : 'Inactive'} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button onClick={() => startEdit(s)} className="text-gray-500 hover:text-white"><Pencil className="w-3 h-3" /></button>
                    {isSuperAdmin && <button onClick={() => handleDelete(s.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {(showAdd || editingId) && (
        <Modal title={editingId ? 'Edit Pay Scale' : 'Add Pay Scale'} onClose={() => { setShowAdd(false); setEditingId(null); resetForm() }}>
          <Input label="Tier Name *" value={name} onChange={setName} />
          <Input label="Description" value={description} onChange={setDescription} />
          <Input label="Per-Watt Rate ($) *" value={perWattRate} onChange={setPerWattRate} type="number" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Adder Percentage" value={adderPct} onChange={setAdderPct} type="number" />
            <Input label="Referral Bonus ($)" value={referralBonus} onChange={setReferralBonus} type="number" />
          </div>
          <div className="flex justify-end pt-2">
            <SaveBtn onClick={handleSave} saving={saving} />
          </div>
        </Modal>
      )}
    </div>
  )
}
