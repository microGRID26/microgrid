'use client'

import { useEffect, useState, useCallback } from 'react'
import { Nav } from '@/components/Nav'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { cn, escapeIlike } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

interface AHJ {
  id: number
  name: string
  permit_phone: string | null
  permit_website: string | null
  max_duration: number | null
  electric_code: string | null
  permit_notes: string | null
  username: string | null
  password: string | null
}

interface Utility {
  id: number
  name: string
  phone: string | null
  website: string | null
  notes: string | null
}

type UserRole = 'super_admin' | 'admin' | 'finance' | 'manager' | 'user'

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  finance: 'Finance',
  manager: 'Manager',
  user: 'User',
}

const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: 'bg-red-900/40 text-red-400 border-red-800',
  admin: 'bg-amber-900/40 text-amber-400 border-amber-800',
  finance: 'bg-blue-900/40 text-blue-400 border-blue-800',
  manager: 'bg-purple-900/40 text-purple-400 border-purple-800',
  user: 'bg-gray-800 text-gray-400 border-gray-700',
}

interface User {
  id: string
  name: string
  email: string
  department: string | null
  position: string | null
  role: UserRole
  admin: boolean
  active: boolean
  color: string | null
  crew?: string | null
}

interface Crew {
  id: string
  name: string
  warehouse: string | null
  active: string
  license_holder: string | null
  electrician: string | null
  solar_lead: string | null
  battery_lead: string | null
  installer1: string | null
  installer2: string | null
  battery_tech1: string | null
  battery_tech2: string | null
  battery_apprentice: string | null
  mpu_electrician: string | null
}

interface SLAThreshold {
  stage: string
  target: number
  risk: number
  crit: number
}

interface CRMStats {
  projects: number
  ahjs: number
  utilities: number
  users: number
  crews: number
  serviceCalls: number
}

type Module = 'ahj' | 'utility' | 'users' | 'crews' | 'sla' | 'info' | 'releases' | 'feedback' | 'audit'

const DEPARTMENTS = [
  'Inside Operations', 'Sales', 'Executive', 'Field Operations',
  'Funding', 'Payroll', 'HR', 'Accounting', 'Dealer',
]

const STAGE_ORDER = ['evaluation', 'survey', 'design', 'permit', 'install', 'inspection', 'complete']
const STAGE_LABELS: Record<string, string> = {
  evaluation: 'Evaluation', survey: 'Site Survey', design: 'Design',
  permit: 'Permitting', install: 'Installation', inspection: 'Inspection', complete: 'Complete',
}

const DEFAULT_SLA: SLAThreshold[] = [
  { stage: 'evaluation', target: 3,  risk: 4,  crit: 6  },
  { stage: 'survey',     target: 3,  risk: 5,  crit: 10 },
  { stage: 'design',     target: 3,  risk: 5,  crit: 10 },
  { stage: 'permit',     target: 21, risk: 30, crit: 45 },
  { stage: 'install',    target: 5,  risk: 7,  crit: 10 },
  { stage: 'inspection', target: 14, risk: 21, crit: 30 },
  { stage: 'complete',   target: 3,  risk: 5,  crit: 7  },
]

const AVATAR_COLORS = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#64748b',
]

// ── Nav ──────────────────────────────────────────────────────────────────────



// ── Shared UI ─────────────────────────────────────────────────────────────────

function Input({ label, value, onChange, type = 'text', className = '' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; className?: string
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                   focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
      />
    </div>
  )
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 font-medium">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white
                   focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none"
      />
    </div>
  )
}

function Badge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      active ? 'bg-green-900/40 text-green-400 border border-green-800' : 'bg-gray-800 text-gray-500 border border-gray-700'
    }`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">{children}</div>
      </div>
    </div>
  )
}

function SaveBtn({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors">
      {saving ? 'Saving…' : 'Save'}
    </button>
  )
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-sm text-white
                   placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  )
}

// ── AHJ Manager ──────────────────────────────────────────────────────────────

function AHJManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = createClient()
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
    let q = (supabase as any).from('ahjs').select('*', { count: 'exact' })
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
    await (supabase as any).from('ahjs').update({
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
                        {a.username}
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
          </div>
          <div className="flex justify-between pt-2">
            {isSuperAdmin ? (
              <button
                onClick={async () => {
                  if (!confirm(`DELETE AHJ "${editing.name}"? Projects referencing it will keep the name as text.`)) return
                  await (supabase as any).from('ahjs').delete().eq('id', editing.id)
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

// ── Utility Manager ───────────────────────────────────────────────────────────

function UtilityManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = createClient()
  const [utilities, setUtilities] = useState<Utility[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Utility | null>(null)
  const [draft, setDraft] = useState<Partial<Utility>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    let q = (supabase as any).from('utilities').select('*').order('name')
    if (search) q = q.ilike('name', `%${escapeIlike(search)}%`)
    const { data } = await q
    setUtilities(data ?? [])
  }, [search])

  useEffect(() => { load() }, [load])

  const openEdit = (u: Utility) => { setEditing(u); setDraft({ ...u }) }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    await (supabase as any).from('utilities').update({
      name: draft.name,
      phone: draft.phone,
      website: draft.website,
      notes: draft.notes,
    }).eq('id', editing.id)
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
                  await (supabase as any).from('utilities').delete().eq('id', editing.id)
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

// ── Users ─────────────────────────────────────────────────────────────────────

function UsersManager({ currentUserRole }: { currentUserRole: UserRole }) {
  const supabase = createClient()
  const [users, setUsers] = useState<User[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<User | null>(null)
  const [draft, setDraft] = useState<Partial<User>>({})
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from('users').select('*').order('name')
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
      await (supabase as any).from('users').insert({
        name: draft.name,
        email: draft.email,
        department: draft.department,
        position: draft.position,
        role: draft.role ?? 'user',
        admin: (draft.role === 'admin' || draft.role === 'super_admin'),
        active: draft.active ?? true,
        color: draft.color,
      })
    } else if (editing) {
      await (supabase as any).from('users').update({
        name: draft.name,
        email: draft.email,
        department: draft.department,
        position: draft.position,
        role: draft.role,
        admin: (draft.role === 'admin' || draft.role === 'super_admin'),
        active: draft.active,
        color: draft.color,
      }).eq('id', editing.id)
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

// ── Crews ─────────────────────────────────────────────────────────────────────

function CrewsManager() {
  const supabase = createClient()
  const [crews, setCrews] = useState<Crew[]>([])
  const [editing, setEditing] = useState<Crew | null>(null)
  const [draft, setDraft] = useState<Partial<Crew>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    const { data: crewData } = await (supabase as any).from('crews').select('*').order('name')
    setCrews(crewData ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing) return
    setSaving(true)
    await (supabase as any).from('crews').update({
      name: draft.name,
      warehouse: draft.warehouse,
      active: draft.active,
      license_holder: draft.license_holder || null,
      electrician: draft.electrician || null,
      solar_lead: draft.solar_lead || null,
      battery_lead: draft.battery_lead || null,
      installer1: draft.installer1 || null,
      installer2: draft.installer2 || null,
      battery_tech1: draft.battery_tech1 || null,
      battery_tech2: draft.battery_tech2 || null,
      battery_apprentice: draft.battery_apprentice || null,
      mpu_electrician: draft.mpu_electrician || null,
    }).eq('id', editing.id)
    setSaving(false)
    setEditing(null)
    setToast('Crew saved')
    setTimeout(() => setToast(''), 2500)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">Crews</h2>
        {/* NB: crews.active is stored as STRING 'TRUE'/'FALSE', not a boolean — see CLAUDE.md "Crews Table Quirk" */}
        <p className="text-xs text-gray-500 mt-0.5">{crews.filter(c => c.active === 'TRUE' || c.active === 'true').length} active crews</p>
      </div>

      <div className="grid grid-cols-1 gap-3 overflow-auto">
        {crews.map(crew => (
          <div key={crew.id} className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${crew.active === 'TRUE' || crew.active === 'true' ? 'bg-green-400' : 'bg-gray-600'}`} />
                <div>
                  <h3 className="text-sm font-semibold text-white">{crew.name}</h3>
                  <p className="text-xs text-gray-500">{crew.warehouse ? `Warehouse: ${crew.warehouse}` : 'No warehouse set'}</p>
                </div>
                <Badge active={crew.active === 'TRUE' || crew.active === 'true'} />
              </div>
              <button onClick={() => { setEditing(crew); setDraft({ ...crew }) }}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-600 rounded-md transition-colors">
                Edit
              </button>
            </div>
            {(() => {
              const roles = [
                { label: 'License Holder', value: crew.license_holder },
                { label: 'Electrician', value: crew.electrician },
                { label: 'Solar Lead', value: crew.solar_lead },
                { label: 'Battery Lead', value: crew.battery_lead },
                { label: 'Installer 1', value: crew.installer1 },
                { label: 'Installer 2', value: crew.installer2 },
                { label: 'Battery Tech 1', value: crew.battery_tech1 },
                { label: 'Battery Tech 2', value: crew.battery_tech2 },
                { label: 'Battery Apprentice', value: crew.battery_apprentice },
                { label: 'MPU Electrician', value: crew.mpu_electrician },
              ].filter(r => r.value)
              return roles.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {roles.map(r => (
                    <div key={r.label} className="flex items-center gap-1.5 bg-gray-700/50 rounded-full px-2.5 py-1">
                      <span className="text-[10px] text-gray-500">{r.label}:</span>
                      <span className="text-xs text-gray-300">{r.value}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-600 italic">No members assigned</p>
            })()}
          </div>
        ))}
        {crews.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">No crews found</div>
        )}
      </div>

      {editing && (
        <Modal title={`Edit Crew — ${editing.name}`} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Crew Name" value={draft.name ?? ''} onChange={v => setDraft(d => ({ ...d, name: v }))} />
            <Input label="Warehouse" value={draft.warehouse ?? ''} onChange={v => setDraft(d => ({ ...d, warehouse: v }))} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox"
              checked={draft.active === 'TRUE' || draft.active === 'true'}
              onChange={e => setDraft(d => ({ ...d, active: e.target.checked ? 'TRUE' : 'FALSE' }))}
              className="rounded border-gray-600 bg-gray-800 text-green-500 focus:ring-green-500" />
            <span className="text-xs text-gray-300">Active</span>
          </label>
          <div className="border-t border-gray-800 pt-3">
            <p className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-wide">Crew Members</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="License Holder" value={draft.license_holder ?? ''} onChange={v => setDraft(d => ({ ...d, license_holder: v }))} />
              <Input label="Electrician" value={draft.electrician ?? ''} onChange={v => setDraft(d => ({ ...d, electrician: v }))} />
              <Input label="Solar Lead" value={draft.solar_lead ?? ''} onChange={v => setDraft(d => ({ ...d, solar_lead: v }))} />
              <Input label="Battery Lead" value={draft.battery_lead ?? ''} onChange={v => setDraft(d => ({ ...d, battery_lead: v }))} />
              <Input label="Installer 1" value={draft.installer1 ?? ''} onChange={v => setDraft(d => ({ ...d, installer1: v }))} />
              <Input label="Installer 2" value={draft.installer2 ?? ''} onChange={v => setDraft(d => ({ ...d, installer2: v }))} />
              <Input label="Battery Tech 1" value={draft.battery_tech1 ?? ''} onChange={v => setDraft(d => ({ ...d, battery_tech1: v }))} />
              <Input label="Battery Tech 2" value={draft.battery_tech2 ?? ''} onChange={v => setDraft(d => ({ ...d, battery_tech2: v }))} />
              <Input label="Battery Apprentice" value={draft.battery_apprentice ?? ''} onChange={v => setDraft(d => ({ ...d, battery_apprentice: v }))} />
              <Input label="MPU Electrician" value={draft.mpu_electrician ?? ''} onChange={v => setDraft(d => ({ ...d, mpu_electrician: v }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditing(null)}
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

// ── SLA Thresholds ────────────────────────────────────────────────────────────

function SLAManager() {
  const supabase = createClient()
  const [thresholds, setThresholds] = useState<SLAThreshold[]>(DEFAULT_SLA)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [tableExists, setTableExists] = useState<boolean | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data, error } = await (supabase as any).from('sla_thresholds').select('*')
      if (error) {
        setTableExists(false)
      } else {
        setTableExists(true)
        if (data && data.length > 0) {
          setThresholds(data.map((row: any) => ({
            stage: row.stage,
            target: row.target,
            risk: row.risk,
            crit: row.crit,
          })))
        }
      }
    }
    init()
  }, [])

  const update = (stage: string, field: keyof SLAThreshold, val: number) => {
    setThresholds(ts => ts.map(t => t.stage === stage ? { ...t, [field]: val } : t))
  }

  const save = async () => {
    setSaving(true)
    if (!tableExists) {
      // Table doesn't exist yet — show instructions
      setToast('Create sla_thresholds table first (see console)')
      console.log(`
-- Run this in Supabase SQL editor:
CREATE TABLE sla_thresholds (
  stage text PRIMARY KEY,
  target integer NOT NULL,
  risk   integer NOT NULL,
  crit   integer NOT NULL
);
INSERT INTO sla_thresholds (stage, target, risk, crit) VALUES
  ('evaluation', 3,  4,  6),
  ('survey',     3,  5,  10),
  ('design',     3,  5,  10),
  ('permit',     21, 30, 45),
  ('install',    5,  7,  10),
  ('inspection', 14, 21, 30),
  ('complete',   3,  5,  7);
      `)
      setSaving(false)
      return
    }
    for (const t of thresholds) {
      await (supabase as any).from('sla_thresholds').upsert({
        stage: t.stage,
        target: t.target,
        risk: t.risk,
        crit: t.crit,
      }, { onConflict: 'stage' })
    }
    setSaving(false)
    setToast('SLA thresholds saved')
    setTimeout(() => setToast(''), 2500)
  }

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">SLA Thresholds</h2>
          <p className="text-xs text-gray-500 mt-0.5">Days in stage before escalation</p>
        </div>
        {tableExists === false && (
          <span className="text-xs text-amber-400 border border-amber-800 bg-amber-900/20 px-3 py-1.5 rounded-md">
            sla_thresholds table not yet created — see console for SQL
          </span>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              <th className="text-left px-4 py-3 text-gray-400 font-medium w-40">Stage</th>
              <th className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-gray-400 font-medium">Target (days)</span>
                </div>
              </th>
              <th className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-gray-400 font-medium">Risk (days)</span>
                </div>
              </th>
              <th className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-gray-400 font-medium">Critical (days)</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {thresholds.map((t, i) => (
              <tr key={t.stage} className={`border-b border-gray-800/50 ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                    <span className="text-white font-medium">{STAGE_LABELS[t.stage]}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <input type="number" min={1} value={t.target}
                      onChange={e => update(t.stage, 'target', Number(e.target.value))}
                      className="w-20 text-center bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-green-400
                                 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <input type="number" min={1} value={t.risk}
                      onChange={e => update(t.stage, 'risk', Number(e.target.value))}
                      className="w-20 text-center bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-amber-400
                                 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <input type="number" min={1} value={t.crit}
                      onChange={e => update(t.stage, 'crit', Number(e.target.value))}
                      className="w-20 text-center bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-sm text-red-400
                                 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 p-4 bg-gray-800/30 border border-gray-700/50 rounded-lg">
        <p className="text-xs text-gray-500 leading-relaxed">
          <strong className="text-gray-400">How SLA colors work:</strong> A project at a stage shows
          <span className="text-green-400 mx-1">green</span> under Target days,
          <span className="text-amber-400 mx-1">amber</span> between Target and Risk,
          <span className="text-red-400 mx-1">red</span> beyond Risk, and
          <span className="text-red-600 mx-1">flashing red</span> at Critical. Changes here update all views that use SLA coloring.
        </p>
      </div>

      <div className="flex justify-end mt-4">
        <SaveBtn onClick={save} saving={saving} />
      </div>
    </div>
  )
}

// ── CRM Info ──────────────────────────────────────────────────────────────────

// ── Release Notes ─────────────────────────────────────────────────────────────

function ReleaseNotes() {
  const sectionCls = "text-xs font-bold text-gray-500 uppercase tracking-widest mt-6 mb-3 px-1"
  const cardCls = "bg-gray-900 border border-gray-800 rounded-lg px-5 py-4 mb-3"
  const titleCls = "text-sm font-semibold text-white mb-1"
  const bodyCls = "text-sm text-gray-400 leading-relaxed"
  const bullet = (items: string[]) => (
    <ul className="mt-2 space-y-1">
      {items.map((item, i) => <li key={i} className="flex items-start gap-2"><span className="text-gray-600 mt-0.5">-</span><span>{item}</span></li>)}
    </ul>
  )

  return (
    <div className="max-w-3xl">
      <h2 className="text-base font-semibold text-white mb-1">Release Notes</h2>
      <p className="text-xs text-gray-500 mb-4">Internal version history for MicroGRID CRM</p>

      <div className={sectionCls}>Session 10 - March 20, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Task System Overhaul</div>
        <div className={bodyCls}>
          Complete rewrite of the Tasks tab in ProjectPanel.
          {bullet([
            'Stage navigation pills — click any stage to view its tasks with completion fractions (e.g., "Design 6/12")',
            'Table layout with color-coded rows: green (complete), red (pending), amber (revision), blue (in progress)',
            'Inline task history — click ▸ to expand any task and see its full revision trail',
            'Duration tracking — blue badges show days from started to completed',
            'Revision cascade — setting a task to Revision Required auto-resets downstream tasks with confirmation dialog',
            'Free-text reason input for tasks without predefined reason dropdowns',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Automation Engine</div>
        <div className={bodyCls}>
          11 automations now fire when task statuses change:
          {bullet([
            'Auto-populate project dates — 11 task-to-date mappings (survey_date, install_complete_date, pto_date, etc.)',
            'Auto-advance stage — completing last required task auto-advances to next stage',
            'Auto-detect blockers — Pending Resolution auto-sets project blocker with ⏸ prefix',
            'Auto-clear blockers — resolving stuck task auto-clears blocker if no other tasks stuck',
            'Funding milestone triggers — Installation Complete → M2 Eligible, PTO → M3 Eligible',
            'Task duration tracking — started_date auto-set when task moves to In Progress',
            'Cascade date clearing — revision cascade also clears corresponding project dates',
            'Auto-set In Service disposition when In Service task completed',
            'Task history logging — all status/reason changes recorded to task_history table',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Change Order Queue (New Page)</div>
        <div className={bodyCls}>
          Full change order management system at /change-orders, modeled after NetSuite Cases.
          {bullet([
            'Queue table with status/PM/search filters and realtime subscription',
            'Detail panel with editable status, priority, type, reason, origin, assignment',
            '6-step design workflow with auto-status (Open → In Progress → Complete)',
            'Design comparison table — original vs new values with green diff highlighting',
            'Chronological timestamped notes with user name',
            'Project integration — badge in ProjectPanel header links to filtered change orders',
            'Clickable project names in queue table open ProjectPanel directly',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Google Drive Integration</div>
        <div className={bodyCls}>
          New projects auto-create folder structure in MicroGRID Projects shared drive via Google Apps Script.
          16 subfolders created automatically (01 Proposal through 20 Cases).
          Drive link saved to project_folders table and accessible from Files tab.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Feedback System</div>
        <div className={bodyCls}>
          Floating feedback button on every page. Users submit bugs, feature requests, improvements, or questions.
          Auto-captures user name, email, and current page. Admin portal feedback manager with clickable type/status
          filter badges, admin notes, and super-admin delete.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Audit Trail</div>
        <div className={bodyCls}>
          Session tracking — automatic login detection with 60-second heartbeat showing current page and duration.
          Change log — all project field changes with old/new values, who changed it, and when.
          Project deletions now logged to audit trail before cascade delete.
          Admin portal Audit Trail module with Sessions and Changes tabs.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Command Center Updates</div>
        <div className={bodyCls}>
          {bullet([
            'New "Pending Resolution" section between Blocked and Critical (orange)',
            'Pending metric card in top bar',
            'All sections start collapsed — click metric cards to expand',
            'Cancelled projects filtered from active pipeline sections',
            'Overlapping section membership bug fixed (pending excludes crit/risk)',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Infrastructure & Code Quality</div>
        <div className={bodyCls}>
          {bullet([
            'Shared task constants extracted to lib/tasks.ts — single source of truth, eliminates duplication',
            'Task history logging fixed — pm_id column bug was silently failing all inserts',
            'All fire-and-forget DB inserts (void) converted to awaited with error logging',
            'Audit log inserts converted from void to awaited',
            'Help page updated with interactive visual mockups for all sections',
            'Project creation form: state dropdown (defaults TX), phone type=tel, zip maxLength=5',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Security & Permissions</div>
        <div className={bodyCls}>
          {bullet([
            'All authenticated users can now create and edit projects (not just admins)',
            'Feedback RLS fix — insert uses SECURITY DEFINER function to bypass RLS',
            'Session tracking auth fallback fix — handles edge case when session not yet available',
            'Phone/email validation on project create and edit forms',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Platform-Wide Fixes</div>
        <div className={bodyCls}>
          {bullet([
            'Pipeline Cancelled filtering — cancelled projects properly excluded from active pipeline',
            'escapeIlike() applied to all Supabase .ilike() search queries across all pages',
            'fmtDate() used consistently across all date displays for uniform formatting',
            'Cycle detection added to task prerequisite graph — prevents circular dependencies',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Audit Fixes — 6 Critical/High</div>
        <div className={bodyCls}>
          {bullet([
            'Task history pm_id column bug — was silently failing all task_history inserts',
            'Fire-and-forget DB inserts converted to awaited with error logging',
            'Audit log inserts converted from void to awaited',
            'Pending Resolution section excludes projects already in Critical/At Risk',
            'Stage advance prerequisite check hardened',
            'Cascade reset clears corresponding auto-populated project dates',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Audit Fixes — 4 Medium</div>
        <div className={bodyCls}>
          {bullet([
            'State dropdown added to new project form (defaults to TX)',
            'Phone field uses type=tel, zip code has maxLength=5',
            'Free-text reason input for tasks without predefined reason lists',
            'Overlapping section membership bug fixed in Command Center',
          ])}
        </div>
      </div>

      <div className={sectionCls}>Session 9 - March 19, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Roles System — 5-Level Permissions</div>
        <div className={bodyCls}>
          Replaced admin/super_admin booleans with a single role column: Super Admin, Admin, Finance, Manager, User. useCurrentUser hook returns computed permission helpers. Admin nav link hidden for non-admin roles. Users module shows role dropdown with color-coded badges. Migration backfills existing users from old booleans.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Bug Fixes - 11 issues resolved</div>
        <div className={bodyCls}>
          {bullet([
            'Funding pending amount now sums all milestones (was only counting M3)',
            'Pipeline and Service search no longer overrides dropdown filters',
            'Auth callback redirects to login on failure instead of blank page',
            'cycleDays falls back to stage_date when sale_date is null',
            'Pipeline cycle sort now descending (oldest first) to match other sorts',
            'ProjectPanel AHJ/Utility refreshes when switching between projects',
            'NewProjectModal stage history insert now checks for errors',
            'Funding days waiting handles malformed dates (no more NaN)',
            'Schedule conflict check re-runs when switching create/edit mode',
            'Middleware cookie errors no longer crash with 500',
            'ProjectPanel fetches full project on open (fixes missing fields)',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Security - RLS + Role-Based Permissions</div>
        <div className={bodyCls}>
          Row-level security enabled on all tables. PMs can only edit their own projects.
          Admins have full write access. Super admin role added for destructive operations (delete).
          User auto-provisioning on first Google login. Name cascade trigger keeps PM field in sync.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Performance Audit</div>
        <div className={bodyCls}>
          All 8 pages optimized: select(*) replaced with explicit columns (10-13 vs 50+).
          Schedule page now filters by visible week instead of loading entire history.
          Service and Schedule pages use nested joins instead of loading all projects for name lookup.
          Queue removed redundant PM query. Analytics filters In Service at DB level.
          Database indexes added on stage, disposition, financier, schedule date, service call status.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Funding Page Overhaul</div>
        <div className={bodyCls}>
          Complete rewrite for Taylor Pratt. One row per project with M1/M2/M3 side by side.
          Inline editing for amount, funded date, status, and notes. Searchable nonfunded code picker
          with all 218 codes from the master list. Per-milestone status tracking
          (Not Submitted / Submitted / Funded / Rejected / Complete).
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Project Creation Overhaul</div>
        <div className={bodyCls}>
          {bullet([
            'Required fields: Customer Name, Address, Phone, Email, Dealer, Financier',
            'Equipment section: Module, Inverter, Battery with quantities',
            'AHJ and Utility use searchable autocomplete from reference tables',
            'Added zip code, HOA, consultant email fields',
            'Evaluation tasks auto-set to Ready To Start on creation',
            'New Project button available on Command, Queue, and Pipeline pages',
          ])}
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Project Lifecycle</div>
        <div className={bodyCls}>
          Cancel Project sets disposition to Cancelled (removed from active pipeline).
          Reactivate restores cancelled projects. Delete is super-admin-only with double
          confirmation and full cascade across all related tables.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>Testing & CI</div>
        <div className={bodyCls}>
          156 automated tests (Vitest + React Testing Library) covering utility functions,
          SLA logic, funding calculations, filter composition, BOM, task detection, auth flow.
          Pre-commit hook blocks commits with failing tests. GitHub Actions CI runs tests + build
          on every push.
        </div>
      </div>

      <div className={cardCls}>
        <div className={titleCls}>AHJ & Utility Edit Popups</div>
        <div className={bodyCls}>
          Clicking the AHJ or Utility name in ProjectPanel opens an edit popup for the
          reference record (phone, website, permit notes, electric code). Changes save
          directly to the AHJ/utility table and refresh inline.
        </div>
      </div>

      <div className={sectionCls}>Session 8 - March 18, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Full codebase audit</div>
        <div className={bodyCls}>
          Every file audited for bugs, silent failures, and architecture issues.
          ProjectPanel Info fields fully editable. Save Changes pre-loads all current values.
          AHJ info card uses fuzzy match. Drive folder lookup fixed. Header syncs after stage advance.
        </div>
      </div>

      <div className={sectionCls}>Session 7 - March 18, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Bug fixes and refactoring</div>
        <div className={bodyCls}>
          {bullet([
            'AHJ, Utility, and HOA clickable info modals in ProjectPanel',
            'Stage label corrected, funding days waiting fixed, BOM key error fixed',
            'SLA thresholds and task lists centralized in lib/utils.ts',
          ])}
        </div>
      </div>

      <div className={sectionCls}>Session 6 - March 17, 2026</div>

      <div className={cardCls}>
        <div className={titleCls}>Admin Portal</div>
        <div className={bodyCls}>
          AHJ Manager (1,633 records, paginated), Utility Manager, Users CRUD,
          Crews with role-based members, SLA Thresholds editor, CRM Info stats.
          AHJ/Utility autocomplete in project edit. Export field picker. Help page.
        </div>
      </div>

      <div className={sectionCls}>Sessions 3-5 - Earlier</div>

      <div className={cardCls}>
        <div className={titleCls}>Core Features</div>
        <div className={bodyCls}>
          Schedule view with crew calendar. Service calls with status tracking.
          Funding milestones (M1/M2/M3). ProjectPanel Info tab edit mode with
          stage advance and prerequisite checking.
        </div>
      </div>
    </div>
  )
}

function CRMInfo() {
  const supabase = createClient()
  const [stats, setStats] = useState<CRMStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [stageBreakdown, setStageBreakdown] = useState<Record<string, number>>({})

  useEffect(() => {
    const load = async () => {
      const [
        { count: projects },
        { count: ahjs },
        { count: utilities },
        { count: users },
        { count: crews },
        { count: serviceCalls },
        { data: stageData },
      ] = await Promise.all([
        (supabase as any).from('projects').select('*', { count: 'exact', head: true }),
        (supabase as any).from('ahjs').select('*', { count: 'exact', head: true }),
        (supabase as any).from('utilities').select('*', { count: 'exact', head: true }),
        (supabase as any).from('users').select('*', { count: 'exact', head: true }),
        (supabase as any).from('crews').select('*', { count: 'exact', head: true }),
        (supabase as any).from('service_calls').select('*', { count: 'exact', head: true }),
        (supabase as any).from('projects').select('stage'),
      ])
      setStats({ projects: projects ?? 0, ahjs: ahjs ?? 0, utilities: utilities ?? 0, users: users ?? 0, crews: crews ?? 0, serviceCalls: serviceCalls ?? 0 })
      const breakdown: Record<string, number> = {}
      ;(stageData ?? []).forEach((r: { stage: string }) => {
        breakdown[r.stage] = (breakdown[r.stage] || 0) + 1
      })
      setStageBreakdown(breakdown)
      setLoading(false)
    }
    load()
  }, [])

  const statCards = [
    { label: 'Projects', value: stats?.projects, icon: '📋', color: 'text-blue-400' },
    { label: 'AHJs', value: stats?.ahjs, icon: '🏛️', color: 'text-purple-400' },
    { label: 'Utilities', value: stats?.utilities, icon: '⚡', color: 'text-yellow-400' },
    { label: 'Users', value: stats?.users, icon: '👥', color: 'text-green-400' },
    { label: 'Crews', value: stats?.crews, icon: '🔧', color: 'text-orange-400' },
    { label: 'Service Calls', value: stats?.serviceCalls, icon: '🛎️', color: 'text-red-400' },
  ]

  const totalProjects = stats?.projects ?? 0

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">CRM Info</h2>
        <p className="text-xs text-gray-500 mt-0.5">Live database statistics</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-gray-500 text-sm">Loading stats…</div>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {statCards.map(s => (
              <div key={s.label} className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value?.toLocaleString() ?? '—'}</p>
                  </div>
                  <span className="text-xl">{s.icon}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Stage breakdown */}
          <div className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4 mb-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Projects by Stage</h3>
            <div className="space-y-2">
              {STAGE_ORDER.map(stage => {
                const count = stageBreakdown[stage] ?? 0
                const pct = totalProjects ? (count / totalProjects) * 100 : 0
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-24 shrink-0">{STAGE_LABELS[stage]}</span>
                    <div className="flex-1 bg-gray-700/50 rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-white w-8 text-right shrink-0">{count}</span>
                    <span className="text-xs text-gray-600 w-10 shrink-0">{pct.toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* System info */}
          <div className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">System</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { label: 'Stack',      value: 'Next.js 16 + TypeScript + Tailwind v4' },
                { label: 'Database',   value: 'Supabase (PostgreSQL)' },
                { label: 'Hosting',    value: 'Vercel Hobby' },
                { label: 'Auth',       value: 'Google OAuth (@gomicrogridenergy.com + 1 more)' },
                { label: 'Repo',       value: 'github.com/microGRID26/microgrid-crm' },
                { label: 'Phase',      value: 'Phase 3 — Admin Portal' },
              ].map(r => (
                <div key={r.label} className="flex flex-col gap-0.5">
                  <span className="text-gray-500">{r.label}</span>
                  <span className="text-gray-300">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Feedback Manager ──────────────────────────────────────────────────────

interface FeedbackEntry {
  id: number
  user_name: string | null
  user_email: string | null
  type: string
  page: string | null
  message: string
  status: string
  admin_notes: string | null
  created_at: string
}

const FEEDBACK_STATUSES = ['New', 'Reviewing', 'In Progress', 'Addressed', "Won't Fix"] as const
const FEEDBACK_TYPES_LIST = ['Bug', 'Feature Request', 'Improvement', 'Question'] as const

const TYPE_COLORS: Record<string, string> = {
  'Bug': 'bg-red-900/40 text-red-400 border-red-800',
  'Feature Request': 'bg-blue-900/40 text-blue-400 border-blue-800',
  'Improvement': 'bg-green-900/40 text-green-400 border-green-800',
  'Question': 'bg-purple-900/40 text-purple-400 border-purple-800',
}

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-amber-900/40 text-amber-400 border-amber-800',
  'Reviewing': 'bg-blue-900/40 text-blue-400 border-blue-800',
  'In Progress': 'bg-purple-900/40 text-purple-400 border-purple-800',
  'Addressed': 'bg-green-900/40 text-green-400 border-green-800',
  "Won't Fix": 'bg-gray-800 text-gray-400 border-gray-700',
}

function FeedbackManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = createClient()
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [toast, setToast] = useState('')

  const [allEntries, setAllEntries] = useState<FeedbackEntry[]>([])

  const load = useCallback(async () => {
    const { data } = await (supabase as any).from('feedback').select('*').order('created_at', { ascending: false })
    setAllEntries(data ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  // Filter client-side from all entries
  const entries = allEntries.filter(e => {
    if (filterType && e.type !== filterType) return false
    if (filterStatus && e.status !== filterStatus) return false
    return true
  })

  const updateField = async (id: number, field: string, value: string) => {
    const { error } = await (supabase as any).from('feedback').update({ [field]: value }).eq('id', id)
    if (error) {
      console.error('feedback update failed:', error)
      setToast('Update failed')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setAllEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e))
    setToast('Updated')
    setTimeout(() => setToast(''), 2000)
  }

  const deleteFeedback = async (id: number) => {
    if (!confirm('Delete this feedback entry? This cannot be undone.')) return
    const { error } = await (supabase as any).from('feedback').delete().eq('id', id)
    if (error) {
      console.error('feedback delete failed:', error)
      setToast('Delete failed')
      setTimeout(() => setToast(''), 2000)
      return
    }
    setAllEntries(prev => prev.filter(e => e.id !== id))
    setToast('Deleted')
    setTimeout(() => setToast(''), 2000)
  }

  // Counts from ALL entries (unfiltered)
  const typeCounts: Record<string, number> = {}
  const statusCounts: Record<string, number> = {}
  allEntries.forEach(e => {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1
  })

  return (
    <div className="flex flex-col h-full overflow-auto">
      {toast && (
        <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Feedback</h2>
          <p className="text-xs text-gray-500 mt-0.5">{entries.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Types</option>
            {FEEDBACK_TYPES_LIST.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Statuses</option>
            {FEEDBACK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Summary counts — clickable to filter */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FEEDBACK_TYPES_LIST.map(t => (
          <button key={t} onClick={() => setFilterType(filterType === t ? '' : t)}
            className={`text-[10px] px-2 py-1 border rounded transition-colors ${TYPE_COLORS[t]} ${filterType === t ? 'ring-1 ring-white' : 'opacity-70 hover:opacity-100'}`}>
            {t}: {typeCounts[t] || 0}
          </button>
        ))}
        <span className="text-gray-700 mx-1">|</span>
        {FEEDBACK_STATUSES.map(s => (
          <button key={s} onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
            className={`text-[10px] px-2 py-1 border rounded transition-colors ${STATUS_COLORS[s]} ${filterStatus === s ? 'ring-1 ring-white' : 'opacity-70 hover:opacity-100'}`}>
            {s}: {statusCounts[s] || 0}
          </button>
        ))}
      </div>

      {/* Entries */}
      <div className="space-y-3">
        {entries.map(entry => (
          <div key={entry.id} className="bg-gray-800/40 border border-gray-700/60 rounded-xl p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2 py-0.5 border rounded ${TYPE_COLORS[entry.type] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                  {entry.type}
                </span>
                <span className={`text-[10px] px-2 py-0.5 border rounded ${STATUS_COLORS[entry.status] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                  {entry.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600">
                  {entry.created_at ? new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </span>
                {isSuperAdmin && (
                  <button onClick={() => deleteFeedback(entry.id)}
                    className="text-[10px] text-gray-600 hover:text-red-400 transition-colors" title="Delete feedback">
                    ×
                  </button>
                )}
              </div>
            </div>

            <p className="text-sm text-white mb-2 whitespace-pre-wrap">{entry.message}</p>

            <div className="flex items-center gap-4 text-[10px] text-gray-500 mb-3">
              <span>{entry.user_name ?? 'Unknown'}</span>
              {entry.user_email && <span>{entry.user_email}</span>}
              {entry.page && <span>Page: {entry.page}</span>}
            </div>

            <div className="flex items-center gap-3 border-t border-gray-700/50 pt-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500">Status</label>
                <select
                  value={entry.status}
                  onChange={e => updateField(entry.id, 'status', e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-white
                             focus:outline-none focus:border-blue-500 transition-colors"
                >
                  {FEEDBACK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[10px] text-gray-500">Admin Notes</label>
                <textarea
                  defaultValue={entry.admin_notes ?? ''}
                  onBlur={e => {
                    if (e.target.value !== (entry.admin_notes ?? '')) {
                      updateField(entry.id, 'admin_notes', e.target.value)
                    }
                  }}
                  rows={1}
                  placeholder="Add notes..."
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-white
                             placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                />
              </div>
            </div>
          </div>
        ))}

        {entries.length === 0 && (
          <div className="text-center py-12 text-gray-600 text-sm">No feedback entries found</div>
        )}
      </div>
    </div>
  )
}

// ── Audit Trail ──────────────────────────────────────────────────────────────

interface AuditSession {
  id: string
  user_id: string
  user_name: string
  user_email: string
  logged_in_at: string
  last_active_at: string
  page: string | null
}

interface AuditChange {
  id: string
  project_id: string
  field: string
  old_value: string | null
  new_value: string | null
  changed_by: string
  changed_by_id: string | null
  changed_at: string
}

type AuditTab = 'sessions' | 'changes'
type DateRange = 'today' | '7days' | '30days' | 'all'

function formatDuration(startStr: string, endStr: string): string {
  const start = new Date(startStr).getTime()
  const end = new Date(endStr).getTime()
  if (isNaN(start) || isNaN(end)) return '—'
  const diffMs = Math.max(0, end - start)
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0 && minutes === 0) return '<1m'
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function isOnline(lastActive: string): boolean {
  const diff = Date.now() - new Date(lastActive).getTime()
  return diff < 5 * 60 * 1000
}

function getDateRangeStart(range: DateRange): string | null {
  if (range === 'all') return null
  const now = new Date()
  if (range === 'today') {
    now.setHours(0, 0, 0, 0)
  } else if (range === '7days') {
    now.setDate(now.getDate() - 7)
  } else if (range === '30days') {
    now.setDate(now.getDate() - 30)
  }
  return now.toISOString()
}

function AuditTrailManager() {
  const supabase = createClient()
  const [tab, setTab] = useState<AuditTab>('sessions')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-base font-semibold text-white">Audit Trail</h2>
        <div className="flex bg-gray-800 rounded-lg p-0.5">
          <button
            onClick={() => setTab('sessions')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              tab === 'sessions' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            )}>
            Sessions
          </button>
          <button
            onClick={() => setTab('changes')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-colors',
              tab === 'changes' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            )}>
            Changes
          </button>
        </div>
      </div>
      {tab === 'sessions' ? <SessionsTab /> : <ChangesTab />}
    </div>
  )
}

function SessionsTab() {
  const supabase = createClient()
  const [sessions, setSessions] = useState<AuditSession[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>('today')
  const [userNames, setUserNames] = useState<string[]>([])

  const load = useCallback(async () => {
    let q = (supabase as any)
      .from('user_sessions')
      .select('*')
      .order('logged_in_at', { ascending: false })
      .limit(500)

    if (userFilter) {
      q = q.eq('user_name', userFilter)
    }

    const rangeStart = getDateRangeStart(dateRange)
    if (rangeStart) {
      q = q.gte('logged_in_at', rangeStart)
    }

    const { data } = await q
    setSessions(data ?? [])
  }, [userFilter, dateRange])

  useEffect(() => { load() }, [load])

  // Load distinct user names
  useEffect(() => {
    ;(supabase as any)
      .from('user_sessions')
      .select('user_name')
      .then(({ data }: { data: { user_name: string }[] | null }) => {
        if (data) {
          const unique = [...new Set(data.map(d => d.user_name))].sort()
          setUserNames(unique)
        }
      })
  }, [])

  const onlineCount = sessions.filter(s => isOnline(s.last_active_at)).length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-green-900/30 border border-green-800 rounded-md px-2.5 py-1">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-400 font-medium">{onlineCount} Online</span>
          </div>
          <span className="text-xs text-gray-500">{sessions.length} sessions</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Users</option>
            {userNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Status', 'User', 'Email', 'Logged In', 'Last Active', 'Duration', 'Page'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr key={s.id} className={cn(
                'border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors',
                i % 2 !== 0 && 'bg-gray-900/20'
              )}>
                <td className="px-3 py-2">
                  <span className={cn(
                    'w-2.5 h-2.5 rounded-full inline-block',
                    isOnline(s.last_active_at) ? 'bg-green-400' : 'bg-gray-600'
                  )} />
                </td>
                <td className="px-3 py-2 text-white font-medium">{s.user_name}</td>
                <td className="px-3 py-2 text-gray-400">{s.user_email}</td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                  {new Date(s.logged_in_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                  {new Date(s.last_active_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2 text-gray-400">{formatDuration(s.logged_in_at, s.last_active_at)}</td>
                <td className="px-3 py-2 text-gray-500 font-mono">{s.page || '—'}</td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-600 text-sm">No sessions found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChangesTab() {
  const supabase = createClient()
  const [changes, setChanges] = useState<AuditChange[]>([])
  const [userFilter, setUserFilter] = useState('')
  const [fieldFilter, setFieldFilter] = useState('')
  const [dateRange, setDateRange] = useState<DateRange>('7days')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(200)
  const [hasMore, setHasMore] = useState(false)
  const [userNames, setUserNames] = useState<string[]>([])
  const [fieldNames, setFieldNames] = useState<string[]>([])

  const load = useCallback(async () => {
    let q = (supabase as any)
      .from('audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(limit + 1)

    if (userFilter) q = q.eq('changed_by', userFilter)
    if (fieldFilter) q = q.eq('field', fieldFilter)
    if (search.trim()) q = q.ilike('project_id', `%${escapeIlike(search.trim())}%`)

    const rangeStart = getDateRangeStart(dateRange)
    if (rangeStart) q = q.gte('changed_at', rangeStart)

    const { data } = await q
    const rows: AuditChange[] = data ?? []
    setHasMore(rows.length > limit)
    setChanges(rows.slice(0, limit))
  }, [userFilter, fieldFilter, dateRange, search, limit])

  useEffect(() => { load() }, [load])

  // Load distinct values for filters
  useEffect(() => {
    ;(supabase as any)
      .from('audit_log')
      .select('changed_by, field')
      .limit(2000)
      .then(({ data }: { data: { changed_by: string; field: string }[] | null }) => {
        if (data) {
          setUserNames([...new Set(data.map(d => d.changed_by))].sort())
          setFieldNames([...new Set(data.map(d => d.field))].sort())
        }
      })
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">{changes.length} changes</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Project ID…"
              className="w-36 pl-8 pr-2 py-1.5 bg-gray-800 border border-gray-700 rounded-md text-xs text-white
                         placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Users</option>
            {userNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select
            value={fieldFilter}
            onChange={e => setFieldFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="">All Fields</option>
            {fieldNames.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRange)}
            className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white
                       focus:outline-none focus:border-blue-500 transition-colors">
            <option value="today">Today</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Project', 'Field', 'Old Value', '', 'New Value', 'Changed By', 'Time'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {changes.map((c, i) => (
              <tr key={c.id} className={cn(
                'border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors',
                i % 2 !== 0 && 'bg-gray-900/20'
              )}>
                <td className="px-3 py-2">
                  <a href={`/queue?search=${c.project_id}`}
                    className="text-blue-400 hover:text-blue-300 font-mono transition-colors">
                    {c.project_id}
                  </a>
                </td>
                <td className="px-3 py-2 text-white font-medium">{c.field}</td>
                <td className="px-3 py-2 text-red-400 max-w-[150px] truncate" title={c.old_value ?? ''}>
                  {c.old_value || '—'}
                </td>
                <td className="px-1 py-2 text-gray-600">&rarr;</td>
                <td className="px-3 py-2 text-green-400 max-w-[150px] truncate" title={c.new_value ?? ''}>
                  {c.new_value || '—'}
                </td>
                <td className="px-3 py-2 text-gray-400">{c.changed_by}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                  {new Date(c.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </td>
              </tr>
            ))}
            {changes.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-gray-600 text-sm">No changes found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-3 text-center">
          <button
            onClick={() => setLimit(prev => prev + 200)}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-xs font-medium rounded-md transition-colors">
            Load More
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const SIDEBAR_ITEMS: { id: Module; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    id: 'ahj', label: 'AHJ Manager', desc: '1,633 AHJs',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
  },
  {
    id: 'utility', label: 'Utility Manager', desc: '203 utilities',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  },
  {
    id: 'users', label: 'Users', desc: 'Team members',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  },
  {
    id: 'crews', label: 'Crews', desc: '5 active crews',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  },
  {
    id: 'sla', label: 'SLA Thresholds', desc: '7 stages',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  },
  {
    id: 'info', label: 'CRM Info', desc: 'Live stats',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  },
  {
    id: 'releases', label: 'Release Notes', desc: 'Version history',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
  },
  {
    id: 'feedback', label: 'Feedback', desc: 'User feedback',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>,
  },
  {
    id: 'audit', label: 'Audit Trail', desc: 'Sessions & changes',
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>,
  },
]

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const supabase = createClient()
  const { user: authUser, loading } = useCurrentUser()
  const isSuperAdmin = authUser?.isSuperAdmin ?? false
  const isAdmin = authUser?.isAdmin ?? false
  const [activeModule, setActiveModule] = useState<Module>('ahj')

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Checking permissions…</div>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col">
        <Nav active="Admin" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-white mb-2">Admin Access Required</h1>
            <p className="text-sm text-gray-500">You don't have permission to view this page.</p>
            <a href="/command" className="inline-block mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              ← Back to Command Center
            </a>
          </div>
        </div>
      </div>
    )
  }

  const activeItem = SIDEBAR_ITEMS.find(s => s.id === activeModule)

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Nav active="Admin" />

      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="px-4 py-4 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-gray-700 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">Admin</p>
                <p className="text-[10px] text-gray-500">MicroGRID CRM</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-2 space-y-0.5">
            {SIDEBAR_ITEMS.map(item => (
              <button key={item.id} onClick={() => setActiveModule(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                  activeModule === item.id
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}>
                <span className={activeModule === item.id ? 'text-white' : 'text-gray-500'}>{item.icon}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{item.label}</p>
                  <p className="text-[10px] text-gray-500">{item.desc}</p>
                </div>
              </button>
            ))}
          </nav>

          <div className="p-2 border-t border-gray-800 space-y-0.5">
            <a href="/crew" className="flex items-center gap-3 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
              <div><p className="text-xs font-medium">Crew App</p><p className="text-[10px] text-gray-500">Mobile view</p></div>
            </a>
            <div className="text-[10px] text-gray-600 text-center pt-2">
              Admin only · {authUser?.name?.split(' ')[0] ?? ''}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="border-b border-gray-800 px-6 py-3 flex items-center gap-2">
            <span className="text-gray-500">{activeItem?.icon}</span>
            <h1 className="text-sm font-semibold text-white">{activeItem?.label}</h1>
          </div>
          <div className="flex-1 overflow-hidden p-6">
            {activeModule === 'ahj'     && <AHJManager isSuperAdmin={isSuperAdmin} />}
            {activeModule === 'utility' && <UtilityManager isSuperAdmin={isSuperAdmin} />}
            {activeModule === 'users'   && <UsersManager currentUserRole={authUser?.role ?? 'user'} />}
            {activeModule === 'crews'   && <CrewsManager />}
            {activeModule === 'sla'     && <SLAManager />}
            {activeModule === 'info'    && <CRMInfo />}
            {activeModule === 'releases' && <ReleaseNotes />}
            {activeModule === 'feedback' && <FeedbackManager isSuperAdmin={isSuperAdmin} />}
            {activeModule === 'audit'    && <AuditTrailManager />}
          </div>
        </main>
      </div>
    </div>
  )
}
