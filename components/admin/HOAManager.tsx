'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Input, Textarea, Modal, SaveBtn, SearchBar } from './shared'

export function HOAManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [hoas, setHoas] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any | null>(null)
  const [draft, setDraft] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    let q = (supabase as any).from('hoas').select('*').order('name')
    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    const { data } = await q
    setHoas(data ?? [])
  }, [search])

  useEffect(() => { load() }, [load])

  const openEdit = (h: any) => { setEditing(h); setDraft({ ...h }) }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await (supabase as any).from('hoas').update({
      name: draft.name, phone: draft.phone, website: draft.website,
      contact_name: draft.contact_name, contact_email: draft.contact_email, notes: draft.notes,
    }).eq('id', editing.id)
    if (error) { setSaving(false); setToast('Save failed'); setTimeout(() => setToast(''), 2500); return }
    setSaving(false); setEditing(null); setToast('HOA saved'); setTimeout(() => setToast(''), 2500); load()
  }

  const createNew = async () => {
    if (!draft.name?.trim()) return
    setSaving(true)
    const { error } = await (supabase as any).from('hoas').insert({
      name: draft.name, phone: draft.phone, website: draft.website,
      contact_name: draft.contact_name, contact_email: draft.contact_email, notes: draft.notes,
    })
    if (error) { setSaving(false); setToast('Create failed'); setTimeout(() => setToast(''), 2500); return }
    setSaving(false); setShowNew(false); setDraft({}); setToast('HOA created'); setTimeout(() => setToast(''), 2500); load()
  }

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">HOA Manager</h2>
          <p className="text-xs text-gray-500 mt-0.5">{hoas.length} HOA records</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-64"><SearchBar value={search} onChange={setSearch} placeholder="Search HOAs…" /></div>
          <button onClick={() => { setShowNew(true); setDraft({}) }} className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New HOA</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Name', 'Phone', 'Contact', 'Email', 'Website', 'Notes'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {hoas.map((h, i) => (
              <tr key={h.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`} onClick={() => openEdit(h)}>
                <td className="px-3 py-2 text-white font-medium">{h.name}</td>
                <td className="px-3 py-2 text-gray-400">{h.phone || '—'}</td>
                <td className="px-3 py-2 text-gray-400">{h.contact_name || '—'}</td>
                <td className="px-3 py-2 text-gray-400">{h.contact_email || '—'}</td>
                <td className="px-3 py-2 text-gray-400 max-w-[180px] truncate">{h.website ? <a href={h.website.startsWith('http') ? h.website : 'https://'+h.website} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300" onClick={e => e.stopPropagation()}>{h.website.replace(/^https?:\/\//, '').slice(0,30)}</a> : '—'}</td>
                <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{h.notes || '—'}</td>
                <td className="px-3 py-2"><button className="text-gray-500 hover:text-blue-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></button></td>
              </tr>
            ))}
            {hoas.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-600 text-sm">No HOAs found</td></tr>}
          </tbody>
        </table>
      </div>
      {(editing || showNew) && (
        <Modal title={editing ? `Edit HOA — ${editing.name}` : 'New HOA'} onClose={() => { setEditing(null); setShowNew(false) }}>
          <Input label="Name" value={draft.name ?? ''} onChange={v => setDraft((d: any) => ({ ...d, name: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" value={draft.phone ?? ''} onChange={v => setDraft((d: any) => ({ ...d, phone: v }))} />
            <Input label="Website" value={draft.website ?? ''} onChange={v => setDraft((d: any) => ({ ...d, website: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Contact Name" value={draft.contact_name ?? ''} onChange={v => setDraft((d: any) => ({ ...d, contact_name: v }))} />
            <Input label="Contact Email" value={draft.contact_email ?? ''} onChange={v => setDraft((d: any) => ({ ...d, contact_email: v }))} />
          </div>
          <Textarea label="Notes" value={draft.notes ?? ''} onChange={v => setDraft((d: any) => ({ ...d, notes: v }))} />
          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button onClick={async () => {
                if (!confirm(`DELETE HOA "${editing.name}"?`)) return
                await (supabase as any).from('hoas').delete().eq('id', editing.id)
                setEditing(null); setToast('HOA deleted'); setTimeout(() => setToast(''), 2500); load()
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
