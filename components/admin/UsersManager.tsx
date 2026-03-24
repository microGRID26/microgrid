'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { User, UserRole, ROLE_LABELS, ROLE_COLORS, DEPARTMENTS, AVATAR_COLORS, Input, Modal, SaveBtn, SearchBar, Badge } from './shared'

export function UsersManager({ currentUserRole }: { currentUserRole: UserRole }) {
  const supabase = db()
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<User | null>(null)
  const [draft, setDraft] = useState<Partial<User>>({})
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('users').select('*').order('name')
    let filtered = data ?? []
    if (search) filtered = filtered.filter((u: User) => u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase()))
    setUsers(filtered)
  }, [search])

  useEffect(() => { load() }, [load])

  const openEdit = (u: User) => { setEditing(u); setDraft({ ...u }); setCreating(false) }
  const openCreate = () => {
    setEditing(null)
    setDraft({ name: '', email: '', department: '', position: '', role: 'user' as UserRole, admin: false, active: true, color: AVATAR_COLORS[0] })
    setCreating(true)
  }

  const save = async () => {
    setSaving(true)
    if (creating) {
      const { error } = await supabase.from('users').insert({
        name: draft.name,
        email: draft.email,
        department: draft.department,
        position: draft.position,
        role: draft.role ?? 'user',
        admin: (draft.role === 'admin' || draft.role === 'super_admin'),
        active: draft.active ?? true,
        color: draft.color,
      })
      if (error) { console.error('User insert failed:', error); setSaving(false); return }
    } else if (editing) {
      const { error } = await supabase.from('users').update({
        name: draft.name,
        email: draft.email,
        department: draft.department,
        position: draft.position,
        role: draft.role,
        admin: (draft.role === 'admin' || draft.role === 'super_admin'),
        active: draft.active,
        color: draft.color,
      }).eq('id', editing.id)
      if (error) { console.error('User update failed:', error); setSaving(false); return }
    }
    setSaving(false)
    setEditing(null)
    setCreating(false)
    setToast(creating ? 'User created' : 'User saved')
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
          <h2 className="text-base font-semibold text-white">Users</h2>
          <p className="text-xs text-gray-500 mt-0.5">{users.filter(u => u.active).length} active · {users.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-52">
            <SearchBar value={search} onChange={setSearch} placeholder="Search users…" />
          </div>
          <button onClick={openCreate}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add User
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Name', 'Email', 'Department', 'Position', 'Role', 'Status'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={u.id}
                className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}
                onClick={() => openEdit(u)}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: u.color || '#64748b' }}>
                      {u.name?.charAt(0) ?? '?'}
                    </div>
                    <span className="text-white font-medium">{u.name}</span>
                    {u.role && u.role !== 'user' && (
                      <span className={`text-[10px] px-1.5 py-0.5 border rounded ${ROLE_COLORS[u.role] ?? ROLE_COLORS.user}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-400">{u.email}</td>
                <td className="px-3 py-2 text-gray-400">{u.department || '—'}</td>
                <td className="px-3 py-2 text-gray-400">{u.position || '—'}</td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 border rounded ${ROLE_COLORS[u.role] ?? ROLE_COLORS.user}`}>
                    {ROLE_LABELS[u.role] ?? 'User'}
                  </span>
                </td>
                <td className="px-3 py-2"><Badge active={u.active} /></td>
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
            {users.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-600 text-sm">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <Modal title={creating ? 'Add User' : `Edit — ${editing?.name}`} onClose={() => { setEditing(null); setCreating(false) }}>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={draft.name ?? ''} onChange={v => setDraft(d => ({ ...d, name: v }))} />
            <Input label="Email" value={draft.email ?? ''} onChange={v => setDraft(d => ({ ...d, email: v }))} type="email" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Department</label>
              <select value={draft.department ?? ''} onChange={e => setDraft(d => ({ ...d, department: e.target.value }))}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                           focus:outline-none focus:border-blue-500 transition-colors">
                <option value="">— Select —</option>
                {DEPARTMENTS.map(dep => <option key={dep} value={dep}>{dep}</option>)}
              </select>
            </div>
            <Input label="Position" value={draft.position ?? ''} onChange={v => setDraft(d => ({ ...d, position: v }))} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Avatar Color</label>
            <div className="flex items-center gap-2">
              {AVATAR_COLORS.map(c => (
                <button key={c} onClick={() => setDraft(d => ({ ...d, color: c }))}
                  className={`w-6 h-6 rounded-full transition-transform ${draft.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }} />
              ))}
              {draft.name && (
                <div className="ml-2 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: draft.color || '#64748b' }}>
                  {draft.name.charAt(0)}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400 font-medium">Role</label>
              <select value={draft.role ?? 'user'}
                onChange={e => setDraft(d => ({ ...d, role: e.target.value as UserRole }))}
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                           focus:outline-none focus:border-blue-500 transition-colors">
                <option value="user">User</option>
                <option value="manager">Manager</option>
                <option value="finance">Finance</option>
                <option value="admin">Admin</option>
                {currentUserRole === 'super_admin' && (
                  <option value="super_admin">Super Admin</option>
                )}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-4">
              <input type="checkbox" checked={draft.active ?? true}
                onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}
                className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500" />
              <span className="text-xs text-gray-300">Active</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setEditing(null); setCreating(false) }}
              className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md transition-colors">
              Cancel
            </button>
            <SaveBtn onClick={save} saving={saving} />
          </div>
        </Modal>
      )}
    </div>
  )
}
