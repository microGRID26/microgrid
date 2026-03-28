'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'
import { escapeIlike } from '@/lib/utils'
import { Input, Textarea, Modal, SaveBtn, SearchBar } from './shared'
import type { FeatureFlag } from '@/lib/useFeatureFlags'
import { clearFlagsCache } from '@/lib/useFeatureFlags'

const ALL_ROLES = ['super_admin', 'admin', 'finance', 'manager', 'user', 'sales'] as const
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', admin: 'Admin', finance: 'Finance',
  manager: 'Manager', user: 'User', sales: 'Sales',
}

export function FeatureFlagManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<FeatureFlag | null>(null)
  const [draft, setDraft] = useState<Partial<FeatureFlag & { draftRoles: string[] }>>({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [showNew, setShowNew] = useState(false)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const load = useCallback(async () => {
    const supabase = db()
    let q = supabase.from('feature_flags').select('*').order('label')
    if (search) q = q.ilike('label', `%${escapeIlike(search)}%`)
    const { data } = await q
    setFlags((data as FeatureFlag[] | null) ?? [])
  }, [search])

  useEffect(() => { load() }, [load])

  const openEdit = (f: FeatureFlag) => {
    setEditing(f)
    setDraft({ ...f, draftRoles: f.allowed_roles ?? [] })
  }

  const toggleEnabled = async (f: FeatureFlag) => {
    const { error } = await db().from('feature_flags')
      .update({ enabled: !f.enabled, updated_at: new Date().toISOString() })
      .eq('id', f.id)
    if (error) { showToast('Toggle failed'); return }
    clearFlagsCache()
    load()
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    const roles = draft.draftRoles?.length ? draft.draftRoles : null
    const { error } = await db().from('feature_flags').update({
      label: draft.label,
      description: draft.description ?? null,
      rollout_percentage: Math.max(0, Math.min(100, Number(draft.rollout_percentage) || 100)),
      allowed_roles: roles,
      updated_at: new Date().toISOString(),
    }).eq('id', editing.id)
    if (error) { setSaving(false); showToast('Save failed'); return }
    setSaving(false); setEditing(null); clearFlagsCache(); showToast('Flag saved'); load()
  }

  const createNew = async () => {
    if (!draft.flag_key?.trim() || !draft.label?.trim()) { showToast('Key and label are required'); return }
    setSaving(true)
    const roles = draft.draftRoles?.length ? draft.draftRoles : null
    const { error } = await db().from('feature_flags').insert({
      flag_key: draft.flag_key!.trim().toLowerCase().replace(/\s+/g, '_'),
      label: draft.label,
      description: draft.description ?? null,
      enabled: draft.enabled ?? true,
      rollout_percentage: Math.max(0, Math.min(100, Number(draft.rollout_percentage) || 100)),
      allowed_roles: roles,
    })
    if (error) { setSaving(false); showToast(error.message?.includes('duplicate') ? 'Flag key already exists' : 'Create failed'); return }
    setSaving(false); setShowNew(false); setDraft({}); clearFlagsCache(); showToast('Flag created'); load()
  }

  const toggleRole = (role: string) => {
    setDraft(d => {
      const current = d.draftRoles ?? []
      const next = current.includes(role) ? current.filter(r => r !== role) : [...current, role]
      return { ...d, draftRoles: next }
    })
  }

  return (
    <div className="flex flex-col h-full">
      {toast && <div className="fixed bottom-5 right-5 bg-green-700 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200]">{toast}</div>}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Feature Flags</h2>
          <p className="text-xs text-gray-500 mt-0.5">{flags.length} flags configured</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-64"><SearchBar value={search} onChange={setSearch} placeholder="Search flags..." /></div>
          <button onClick={() => { setShowNew(true); setDraft({ enabled: true, rollout_percentage: 100, draftRoles: [] }) }}
            className="px-3 py-1.5 text-xs bg-green-700 text-white rounded-md hover:bg-green-600">+ New Flag</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
            <tr>
              {['Status', 'Key', 'Label', 'Rollout %', 'Allowed Roles', 'Description'].map(h => (
                <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {flags.map((f, i) => (
              <tr key={f.id} className={`border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-900/20'}`}>
                <td className="px-3 py-2">
                  <button
                    onClick={() => toggleEnabled(f)}
                    role="switch"
                    aria-checked={f.enabled}
                    aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.label}`}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      f.enabled ? 'bg-green-600' : 'bg-gray-700'
                    }`}
                    title={f.enabled ? 'Click to disable' : 'Click to enable'}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      f.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </td>
                <td className="px-3 py-2 text-gray-300 font-mono text-[11px]">{f.flag_key}</td>
                <td className="px-3 py-2 text-white font-medium">{f.label}</td>
                <td className="px-3 py-2 text-gray-400">
                  {f.rollout_percentage === 100 ? (
                    <span className="text-green-400">100%</span>
                  ) : (
                    <span className="text-amber-400">{f.rollout_percentage}%</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {f.allowed_roles && f.allowed_roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {f.allowed_roles.map(r => (
                        <span key={r} className="px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400 border border-gray-700">
                          {ROLE_LABELS[r] ?? r}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-600">All roles</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500 max-w-[250px] truncate">{f.description || '—'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => openEdit(f)} className="text-gray-500 hover:text-blue-400">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {flags.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-600 text-sm">No feature flags found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit / New Modal */}
      {(editing || showNew) && (
        <Modal title={editing ? `Edit Flag — ${editing.label}` : 'New Feature Flag'} onClose={() => { setEditing(null); setShowNew(false) }}>
          {showNew && (
            <Input label="Flag Key (lowercase, underscores)" value={draft.flag_key ?? ''} onChange={v => setDraft(d => ({ ...d, flag_key: v }))} />
          )}
          {editing && (
            <div className="text-xs text-gray-500">Key: <span className="font-mono text-gray-300">{editing.flag_key}</span></div>
          )}
          <Input label="Label" value={draft.label ?? ''} onChange={v => setDraft(d => ({ ...d, label: v }))} />
          <Textarea label="Description" value={draft.description ?? ''} onChange={v => setDraft(d => ({ ...d, description: v }))} />
          <Input label="Rollout Percentage (0-100)" value={String(draft.rollout_percentage ?? 100)} type="number"
            onChange={v => setDraft(d => ({ ...d, rollout_percentage: Math.max(0, Math.min(100, parseInt(v) || 0)) }))} />

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-medium">Allowed Roles (empty = all roles)</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {ALL_ROLES.map(role => {
                const selected = (draft.draftRoles ?? []).includes(role)
                return (
                  <button key={role} onClick={() => toggleRole(role)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                      selected
                        ? 'bg-green-900/40 text-green-400 border-green-700'
                        : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-600'
                    }`}>
                    {ROLE_LABELS[role]}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-between pt-2">
            {editing && isSuperAdmin ? (
              <button onClick={async () => {
                if (!confirm(`DELETE flag "${editing.flag_key}"?`)) return
                await db().from('feature_flags').delete().eq('id', editing.id)
                setEditing(null); clearFlagsCache(); showToast('Flag deleted'); load()
              }} className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-md">Delete</button>
            ) : <div />}
            <div className="flex gap-2">
              <button onClick={() => { setEditing(null); setShowNew(false) }}
                className="px-4 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-md">Cancel</button>
              <SaveBtn onClick={editing ? save : createNew} saving={saving} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
