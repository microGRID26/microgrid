'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { AHJ, Input, Textarea, Modal, SaveBtn, SearchBar } from './shared'

export function AHJManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [ahjs, setAhjs] = useState<AHJ[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<AHJ | null>(null)
  const [draft, setDraft] = useState<Partial<AHJ>>({})
  const [saving, setSaving] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [toast, setToast] = useState('')
  const PAGE_SIZE = 25

  const load = useCallback(async () => {
    let q = supabase.from('ahjs').select('*', { count: 'exact' })
    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    q = q.order('name').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const { data, count } = await q
    setAhjs(data ?? [])
    setTotal(count ?? 0)
  }, [search, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [search])

  const openEdit = (a: AHJ) => { setEditing(a); setDraft({ ...a }); setShowPw(false) }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase.from('ahjs').update({
      name: draft.name,
      permit_phone: draft.permit_phone,
      permit_website: draft.permit_website,
      max_duration: draft.max_duration,
      electric_code: draft.electric_code,
      permit_notes: draft.permit_notes,
      username: draft.username,
      password: draft.password,
    }).eq('id', editing.id)
    setSaving(false)
    if (error) { console.error('AHJ save failed:', error); return }
    setEditing(null)
    setToast('AHJ saved')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">AHJ Manager</h2>
          <p className="text-xs text-gray-500 mt-0.5">{total.toLocaleString()} Texas AHJs</p>
        </div>
        <div className="w-64">
          <SearchBar value={search} onChange={setSearch} placeholder="Search AHJs…" />
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Name', 'Phone', 'Website', 'Max Days', 'Electric Code', 'Portal Login'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {ahjs.map((a, i) => (
              <tr key={a.id}
                className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                onClick={() => openEdit(a)}>
                <td className="px-3 py-2 text-white font-medium max-w-[200px] truncate">{a.name}</td>
                <td className="px-3 py-2 text-gray-400">{a.permit_phone || '—'}</td>
                <td className="px-3 py-2 text-gray-400 max-w-[160px] truncate">
                  {a.permit_website
                    ? <a href={a.permit_website} target="_blank" rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300" onClick={e => e.stopPropagation()}>
                        {a.permit_website.replace(/^https?:\/\//, '').slice(0, 30)}
                      </a>
                    : '—'}
                </td>
                <td className="px-3 py-2 text-gray-400">{a.max_duration ?? '—'}</td>
                <td className="px-3 py-2 text-gray-400">{a.electric_code || '—'}</td>
                <td className="px-3 py-2">
                  {a.username
                    ? <span className="inline-flex items-center gap-1 text-green-400">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        {isSuperAdmin ? a.username : 'Has login'}
                      </span>
                    : <span className="text-gray-600">No login</span>}
                </td>
                <td className="px-3 py-2">
                  <button className="text-gray-500 hover:text-blue-400 transition-colors" onClick={e => { e.stopPropagation(); openEdit(a) }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {ahjs.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-600 text-sm">No AHJs found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-gray-500">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(0)} disabled={page === 0}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">«</button>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">‹</button>
          <span className="text-xs text-gray-400 px-2">Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">›</button>
          <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed">»</button>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <Modal title={`Edit AHJ — ${editing.name}`} onClose={() => setEditing(null)}>
          <Input label="Name" value={draft.name ?? ''} onChange={v => setDraft(d => ({ ...d, name: v }))} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Permit Phone" value={draft.permit_phone ?? ''} onChange={v => setDraft(d => ({ ...d, permit_phone: v }))} />
            <Input label="Max Duration (days)" value={String(draft.max_duration ?? '')} onChange={v => setDraft(d => ({ ...d, max_duration: v ? Number(v) : null }))} type="number" />
          </div>
          <Input label="Permit Website" value={draft.permit_website ?? ''} onChange={v => setDraft(d => ({ ...d, permit_website: v }))} />
          <Input label="Electric Code" value={draft.electric_code ?? ''} onChange={v => setDraft(d => ({ ...d, electric_code: v }))} />
          <Textarea label="Permit Notes" value={draft.permit_notes ?? ''} onChange={v => setDraft(d => ({ ...d, permit_notes: v }))} />
          <div className="border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-wide">Portal Login</p>
            {isSuperAdmin ? (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Username" value={draft.username ?? ''} onChange={v => setDraft(d => ({ ...d, username: v }))} />
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={draft.password ?? ''}
                      onChange={e => setDraft(d => ({ ...d, password: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                                 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 pr-9"
                    />
                    <button type="button" onClick={() => setShowPw(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showPw
                        ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      }
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Username</label>
                  <p className="text-sm text-gray-500 py-1.5">{draft.username ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '—'}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">Password</label>
                  <p className="text-sm text-gray-500 py-1.5">{draft.password ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '—'}</p>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-between pt-2">
            {isSuperAdmin ? (
              <button
                onClick={async () => {
                  if (!confirm(`DELETE AHJ "${editing.name}"? Projects referencing it will keep the name as text.`)) return
                  const { error } = await supabase.from('ahjs').delete().eq('id', editing.id)
                  if (error) { console.error('AHJ delete failed:', error); return }
                  setEditing(null)
                  setToast('AHJ deleted')
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
