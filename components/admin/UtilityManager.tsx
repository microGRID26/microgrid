'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Utility, Input, Textarea, Modal, SaveBtn, SearchBar } from './shared'

export function UtilityManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [utilities, setUtilities] = useState<Utility[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Utility | null>(null)
  const [draft, setDraft] = useState<Partial<Utility>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    let q = supabase.from('utilities').select('*').order('name')
    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    const { data } = await q
    setUtilities(data ?? [])
  }, [search])

  useEffect(() => { load() }, [load])

  const openEdit = (u: Utility) => { setEditing(u); setDraft({ ...u }) }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('utilities').update({
      name: draft.name,
      phone: draft.phone,
      website: draft.website,
      notes: draft.notes,
    }).eq('id', editing.id)
    if (error) { console.error('Utility save failed:', error); setSaving(false); return }
    setSaving(false)
    setEditing(null)
    setToast('Utility saved')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Utility Manager</h2>
          <p className="text-xs text-gray-500 mt-0.5">{utilities.length} utility companies</p>
        </div>
        <div className="w-64">
          <SearchBar value={search} onChange={setSearch} placeholder="Search utilities…" />
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Name', 'Phone', 'Website', 'Notes'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {utilities.map((u, i) => (
              <tr key={u.id}
                className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                onClick={() => openEdit(u)}>
                <td className="px-3 py-2 text-white font-medium">{u.name}</td>
                <td className="px-3 py-2 text-gray-400">{u.phone || '—'}</td>
                <td className="px-3 py-2 text-gray-400 max-w-[200px] truncate">
                  {u.website
                    ? <a href={u.website} target="_blank" rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300" onClick={e => e.stopPropagation()}>
                        {u.website.replace(/^https?:\/\//, '').slice(0, 35)}
                      </a>
                    : '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 max-w-[240px] truncate">{u.notes || '—'}</td>
                <td className="px-3 py-2">
                  <button className="text-gray-500 hover:text-blue-400 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {utilities.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-600 text-sm">No utilities found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={`Edit Utility — ${editing.name}`} onClose={() => setEditing(null)}>
          <Input label="Name" value={draft.name ?? ''} onChange={v => setDraft(d => ({ ...d, name: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" value={draft.phone ?? ''} onChange={v => setDraft(d => ({ ...d, phone: v }))} />
            <Input label="Website" value={draft.website ?? ''} onChange={v => setDraft(d => ({ ...d, website: v }))} />
          </div>
          <Textarea label="Notes" value={draft.notes ?? ''} onChange={v => setDraft(d => ({ ...d, notes: v }))} />
          <div className="flex justify-between pt-2">
            {isSuperAdmin ? (
              <button
                onClick={async () => {
                  if (!confirm(`DELETE Utility "${editing.name}"? Projects referencing it will keep the name as text.`)) return
                  const { error } = await supabase.from('utilities').delete().eq('id', editing.id)
                  if (error) { console.error('Utility delete failed:', error); return }
                  setEditing(null)
                  setToast('Utility deleted')
                  setTimeout(() => setToast(''), 2500)
                  load()
                }}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md transition-colors"
              >Delete</button>
            ) : <div />}
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors">
                Cancel
              </button>
              <SaveBtn onClick={save} saving={saving} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
