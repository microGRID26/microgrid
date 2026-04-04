'use client'

import { useState, useEffect, useCallback } from 'react'
import { db } from '@/lib/db'
import { cn } from '@/lib/utils'
import { Plus, X } from 'lucide-react'

const ROLES = ['sales', 'user', 'manager', 'finance', 'admin', 'super_admin'] as const
const ROLE_LABELS: Record<string, string> = { sales: 'Sales', user: 'User', manager: 'Manager', finance: 'Finance', admin: 'Admin', super_admin: 'Super Admin' }
const ACCESS_OPTIONS = ['—', 'R', 'R*', 'W', 'RW', 'D', 'RWD'] as const

const ACCESS_BADGE: Record<string, string> = {
  'R': 'bg-blue-900/50 text-blue-300 border-blue-800',
  'R*': 'bg-blue-900/50 text-blue-300 border-blue-800',
  'W': 'bg-green-900/50 text-green-300 border-green-800',
  'RW': 'bg-green-900/50 text-green-300 border-green-800',
  'RWD': 'bg-amber-900/50 text-amber-300 border-amber-800',
  'D': 'bg-red-900/50 text-red-300 border-red-800',
  '—': 'bg-gray-800/30 text-gray-600 border-gray-800',
}

interface PermRow {
  id: string
  feature: string
  role: string
  access: string
  sort_order: number
}

export function PermissionMatrix({ isSuperAdmin }: { isSuperAdmin?: boolean }) {
  const [rows, setRows] = useState<PermRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newFeature, setNewFeature] = useState('')

  const load = useCallback(async () => {
    const { data } = await db().from('permission_matrix').select('*').order('sort_order').order('role').limit(1000)
    setRows((data ?? []) as PermRow[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Group by feature
  const features = Array.from(new Map(
    rows.sort((a, b) => a.sort_order - b.sort_order).map(r => [r.feature, r.sort_order])
  ).entries()).map(([feature]) => feature)

  const getAccess = (feature: string, role: string): string => {
    return rows.find(r => r.feature === feature && r.role === role)?.access ?? '—'
  }

  const cycleAccess = async (feature: string, role: string) => {
    if (!isSuperAdmin) return
    const current = getAccess(feature, role)
    const idx = (ACCESS_OPTIONS as readonly string[]).indexOf(current)
    const next = ACCESS_OPTIONS[(idx + 1) % ACCESS_OPTIONS.length]
    const existing = rows.find(r => r.feature === feature && r.role === role)
    if (existing) {
      await db().from('permission_matrix').update({ access: next }).eq('id', existing.id)
    } else {
      const maxSort = Math.max(...rows.filter(r => r.feature === feature).map(r => r.sort_order), 0)
      await db().from('permission_matrix').insert({ feature, role, access: next, sort_order: maxSort })
    }
    load()
  }

  const addFeature = async () => {
    if (!newFeature.trim()) return
    const maxSort = features.length > 0 ? Math.max(...rows.map(r => r.sort_order)) + 1 : 0
    const inserts = ROLES.map(role => ({
      feature: newFeature.trim(),
      role,
      access: '—',
      sort_order: maxSort,
    }))
    await db().from('permission_matrix').insert(inserts)
    setNewFeature('')
    setShowAdd(false)
    load()
  }

  const deleteFeature = async (feature: string) => {
    if (!confirm(`Delete all permissions for "${feature}"?`)) return
    await db().from('permission_matrix').delete().eq('feature', feature)
    load()
  }

  if (loading) return <div className="text-gray-500 text-xs py-8 text-center">Loading permissions...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white mb-1">Permission Matrix</h2>
          <p className="text-xs text-gray-500">
            {isSuperAdmin ? 'Click any cell to cycle access level. R = Read, W = Write, D = Delete, R* = Own only, — = No access' : 'R = Read, W = Write, D = Delete, R* = Own only, — = No access'}
          </p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-md">
            <Plus className="w-3.5 h-3.5" /> Add Feature
          </button>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-800/50">
              <th className="text-xs text-gray-400 font-medium text-left px-4 py-2.5">Feature ({features.length})</th>
              {ROLES.map(r => (
                <th key={r} className="text-xs text-gray-400 font-medium text-center px-3 py-2.5">{ROLE_LABELS[r]}</th>
              ))}
              {isSuperAdmin && <th className="text-xs text-gray-400 font-medium text-center px-2 py-2.5 w-8"></th>}
            </tr>
          </thead>
          <tbody>
            {features.map(feature => (
              <tr key={feature} className="border-t border-gray-800/50 hover:bg-gray-800/20">
                <td className="text-xs text-gray-200 px-4 py-2">{feature}</td>
                {ROLES.map(role => {
                  const val = getAccess(feature, role)
                  return (
                    <td key={role} className="text-center px-3 py-2">
                      <button
                        onClick={() => cycleAccess(feature, role)}
                        disabled={!isSuperAdmin}
                        className={cn(
                          'text-[10px] px-2 py-0.5 rounded border transition-colors',
                          ACCESS_BADGE[val] ?? ACCESS_BADGE['—'],
                          isSuperAdmin && 'cursor-pointer hover:opacity-80'
                        )}
                        title={isSuperAdmin ? `Click to cycle: ${ACCESS_OPTIONS.join(' → ')}` : val}
                      >
                        {val}
                      </button>
                    </td>
                  )
                })}
                {isSuperAdmin && (
                  <td className="text-center px-2 py-2">
                    <button onClick={() => deleteFeature(feature)} className="text-gray-600 hover:text-red-400" title="Delete feature row">
                      <X className="w-3 h-3" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {features.length === 0 && (
              <tr><td colSpan={ROLES.length + 2} className="text-center py-8 text-gray-600 text-xs">No permissions configured. Run migration 065 to seed defaults.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-gray-600 mt-3">
        {isSuperAdmin ? 'Changes save immediately. Access cycle: — → R → R* → W → RW → D → RWD → —' : 'Contact a Super Admin to modify permissions.'}
      </p>

      {/* Add Feature Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowAdd(false)} />
          <div className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <h2 className="text-sm font-semibold text-white">Add Feature</h2>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4">
              <label className="text-xs text-gray-400 block mb-1">Feature Name</label>
              <input value={newFeature} onChange={e => setNewFeature(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addFeature()}
                placeholder="e.g. Custom Reports"
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-green-500" />
              <p className="text-[10px] text-gray-500 mt-2">All roles will start with — (no access). Click cells to set permissions.</p>
            </div>
            <div className="px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
              <button onClick={addFeature} disabled={!newFeature.trim()} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-xs font-medium rounded-md">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
