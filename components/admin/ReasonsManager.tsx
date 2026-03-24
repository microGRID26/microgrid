'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Input, Modal, SaveBtn, SearchBar, Badge } from './shared'

export function ReasonsManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [reasons, setReasons] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [filterTask, setFilterTask] = useState('')
  const [filterType, setFilterType] = useState<'' | 'pending' | 'revision'>('')
  const [editing, setEditing] = useState<any | null>(null)
  const [draft, setDraft] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    let q = (supabase as any).from('task_reasons').select('*').order('task_id').order('reason_type').order('sort_order')
    if (filterTask) q = q.eq('task_id', filterTask)
    if (filterType) q = q.eq('reason_type', filterType)
    if (search) q = q.ilike('reason', `%${escapeIlike(search)}%`)
    const { data } = await q
    setReasons(data ?? [])
  }, [search, filterTask, filterType])

  useEffect(() => { load() }, [load])

  const openEdit = (r: any) => { setEditing(r); setDraft({ ...r }) }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await (supabase as any).from('task_reasons').update({
      task_id: draft.task_id, reason_type: draft.reason_type, reason: draft.reason,
      active: draft.active, sort_order: draft.sort_order ?? 0,
    }).eq('id', editing.id)
    if (error) { setSaving(false); setToast('Save failed'); setTimeout(() => setToast(''), 2500); return }
    setSaving(false); setEditing(null); setToast('Reason saved'); setTimeout(() => setToast(''), 2500); load()
  }

  const createNew = async () => {
    if (!draft.task_id?.trim() || !draft.reason?.trim() || !draft.reason_type) return
    setSaving(true)
    const { error } = await (supabase as any).from('task_reasons').insert({
      task_id: draft.task_id, reason_type: draft.reason_type, reason: draft.reason,
      active: draft.active !== false, sort_order: draft.sort_order ?? 0,
    })
    if (error) { setSaving(false); setToast('Create failed'); setTimeout(() => setToast(''), 2500); return }
    setSaving(false); setShowNew(false); setDraft({}); setToast('Reason created'); setTimeout(() => setToast(''), 2500); load()
  }

  // Build unique task_id list from loaded data for filter dropdown
  const allTaskIds = useMemo(() => {
    const ids = new Set<string>()
    for (const r of reasons) ids.add(r.task_id)
    return Array.from(ids).sort()
  }, [reasons])

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Reasons Manager</h2>
          <p className="text-xs text-gray-500 mt-0.5">{reasons.length} reason records</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white">
            <option value="">All Types</option>
            <option value="pending">Pending Resolution</option>
            <option value="revision">Revision Required</option>
          </select>
          <select value={filterTask} onChange={e => setFilterTask(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white max-w-[160px]">
            <option value="">All Tasks/Stages</option>
            {allTaskIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <div className="w-48"><SearchBar value={search} onChange={setSearch} placeholder="Search reasons..." /></div>
          <button onClick={() => { setShowNew(true); setDraft({ active: true, sort_order: 0, reason_type: 'pending' }) }} className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Reason</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Task / Stage', 'Type', 'Reason', 'Order', 'Active'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {reasons.map((r, i) => (
              <tr key={r.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'} ${!r.active ? 'opacity-50' : ''}`} onClick={() => openEdit(r)}>
                <td className="px-3 py-2 text-white font-medium">{r.task_id}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    r.reason_type === 'pending' ? 'bg-red-900/40 text-red-400 border border-red-800' : 'bg-amber-900/40 text-amber-400 border border-amber-800'
                  }`}>{r.reason_type === 'pending' ? 'Pending' : 'Revision'}</span>
                </td>
                <td className="px-3 py-2 text-gray-300">{r.reason}</td>
                <td className="px-3 py-2 text-gray-500">{r.sort_order}</td>
                <td className="px-3 py-2"><Badge active={r.active} /></td>
                <td className="px-3 py-2"><button className="text-gray-500 hover:text-blue-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button></td>
              </tr>
            ))}
            {reasons.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-600 text-sm">No reasons found</td></tr>}
          </tbody>
        </table>
      </div>
      {(editing || showNew) && (
        <Modal title={editing ? `Edit Reason` : 'New Reason'} onClose={() => { setEditing(null); setShowNew(false) }}>
          <Input label="Task / Stage ID" value={draft.task_id ?? ''} onChange={v => setDraft((d: any) => ({ ...d, task_id: v }))} />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Type</label>
            <select value={draft.reason_type ?? 'pending'} onChange={e => setDraft((d: any) => ({ ...d, reason_type: e.target.value }))}
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
              <option value="pending">Pending Resolution</option>
              <option value="revision">Revision Required</option>
            </select>
          </div>
          <Input label="Reason" value={draft.reason ?? ''} onChange={v => setDraft((d: any) => ({ ...d, reason: v }))} />
          <Input label="Sort Order" value={String(draft.sort_order ?? 0)} onChange={v => setDraft((d: any) => ({ ...d, sort_order: v ? Number(v) : 0 }))} type="number" />
          <div className="flex items-center gap-2 py-1">
            <label className="text-xs text-gray-400 font-medium">Active</label>
            <button
              onClick={() => setDraft((d: any) => ({ ...d, active: !d.active }))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${draft.active !== false ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${draft.active !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button onClick={async () => {
                if (!confirm('DELETE this reason?')) return
                await (supabase as any).from('task_reasons').delete().eq('id', editing.id)
                setEditing(null); setToast('Reason deleted'); setTimeout(() => setToast(''), 2500); load()
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
