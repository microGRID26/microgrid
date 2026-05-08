'use client'

import { useEffect, useState, useCallback } from 'react'
import { db } from '@/lib/db'

// Mirror of CostLineItemTemplate from lib/cost/calculator.ts (subset).
type Template = {
  id: string
  sort_order: number
  section: string
  category: string | null
  system_bucket: string
  item_name: string
  default_raw_cost: number
  default_unit_basis: string
  pcs_key: string | null
  active: boolean
}

type ActiveScenario = {
  id: string
  name: string
  config: {
    pcsUnitRates?: Record<string, number>
  } | null
}

const BASIS_LABELS: Record<string, string> = {
  flat: 'flat',
  per_kw: '/ kW',
  per_kwh: '/ kWh',
  per_battery: '/ battery',
  per_inverter: '/ inverter',
  per_panel: '/ panel',
  per_panel_pair: '/ panel pair',
  per_watt: '/ watt',
}

function fmtCost(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function CostCatalogManager({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = db()
  const [templates, setTemplates] = useState<Template[]>([])
  const [scenario, setScenario] = useState<ActiveScenario | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState<string>('')
  const [draftReason, setDraftReason] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null)
  const [loading, setLoading] = useState(true)

  const flash = (msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [tplRes, scenRes] = await Promise.all([
      supabase
        .from('project_cost_line_item_templates')
        .select('id, sort_order, section, category, system_bucket, item_name, default_raw_cost, default_unit_basis, pcs_key, active')
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('edge_model_scenarios')
        .select('id, name, config')
        .eq('is_active_for_pull', true)
        .maybeSingle(),
    ])
    setTemplates((tplRes.data ?? []) as Template[])
    setScenario((scenRes.data ?? null) as ActiveScenario | null)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  const startEdit = (t: Template) => {
    setEditingId(t.id)
    setDraftValue(String(t.default_raw_cost))
    setDraftReason('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraftValue('')
    setDraftReason('')
  }

  const saveEdit = async (t: Template) => {
    const newVal = Number(draftValue)
    if (!Number.isFinite(newVal) || newVal < 0) {
      flash('Raw cost must be a non-negative number', 'err')
      return
    }
    if (newVal === t.default_raw_cost) {
      cancelEdit()
      return
    }
    setSaving(true)
    const { error } = await supabase.rpc('atlas_set_template_raw_cost', {
      p_template_id: t.id,
      p_new_raw_cost: newVal,
      p_reason: draftReason.trim() || null,
    })
    setSaving(false)
    if (error) {
      flash(`Save failed: ${error.message}`, 'err')
      return
    }
    flash(`Saved. New invoices will pick up within ~30s.`)
    cancelEdit()
    load()
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-base font-semibold text-white">Cost Catalog</h2>
        <p className="text-sm text-gray-500 mt-2">super_admin access required to edit unit rates.</p>
      </div>
    )
  }

  const overlayRates = scenario?.config?.pcsUnitRates ?? {}
  const grouped = templates.reduce<Record<string, Template[]>>((acc, t) => {
    if (!acc[t.section]) acc[t.section] = []
    acc[t.section].push(t)
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full">
      {toast && (
        <div className={`fixed bottom-5 right-5 text-white text-xs px-4 py-2 rounded-md shadow-lg z-[200] ${toast.tone === 'ok' ? 'bg-green-700' : 'bg-red-700'}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">Cost Catalog</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {templates.length} active templates. Changes write to <code className="text-gray-400">project_cost_line_item_templates.default_raw_cost</code> via the <code className="text-gray-400">atlas_set_template_raw_cost</code> RPC. Audit-logged. New invoices generated after a save pick up the new rate within ~5 min (cache TTL).
        </p>
        {scenario && (
          <p className="text-xs text-amber-400/80 mt-2">
            Active Paul-model scenario: <span className="font-mono text-amber-300">{scenario.name}</span>. Templates with a <code>pcs_key</code> get their unit rate <span className="text-white">overlaid</span> from this scenario at read time — see the &quot;effective&quot; column.
          </p>
        )}
      </div>

      {loading && <div className="text-xs text-gray-500 px-4 py-6">Loading…</div>}

      {!loading && Object.entries(grouped).map(([section, rows]) => (
        <div key={section} className="mb-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 px-1">{section}</h3>
          <div className="border border-gray-800 rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-900/60 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Item</th>
                  <th className="text-left px-3 py-2 font-medium w-24">Bucket</th>
                  <th className="text-right px-3 py-2 font-medium w-32">Default rate</th>
                  <th className="text-left px-3 py-2 font-medium w-28">Basis</th>
                  <th className="text-right px-3 py-2 font-medium w-32">Effective rate</th>
                  <th className="text-right px-3 py-2 font-medium w-32"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const isEditing = editingId === t.id
                  const overlaidRate = t.pcs_key ? overlayRates[t.pcs_key] : undefined
                  const effectiveRate = typeof overlaidRate === 'number' ? overlaidRate : t.default_raw_cost
                  const isOverlaid = typeof overlaidRate === 'number' && overlaidRate !== t.default_raw_cost
                  return (
                    <tr key={t.id} className="border-t border-gray-800 hover:bg-gray-900/30">
                      <td className="px-3 py-2 text-white">
                        <div className="font-medium">{t.item_name}</div>
                        {t.pcs_key && (
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">pcs_key: {t.pcs_key}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-400">{t.system_bucket}</td>
                      <td className="px-3 py-2 text-right">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              autoFocus
                              value={draftValue}
                              onChange={(e) => setDraftValue(e.target.value)}
                              className="bg-gray-800 border border-blue-700 rounded px-2 py-1 text-white text-right w-28"
                              disabled={saving}
                            />
                            <input
                              type="text"
                              placeholder="reason (optional)"
                              value={draftReason}
                              onChange={(e) => setDraftReason(e.target.value)}
                              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-300 text-[10px] w-28"
                              disabled={saving}
                            />
                          </div>
                        ) : (
                          <span className="text-white font-mono">${fmtCost(t.default_raw_cost)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-400">{BASIS_LABELS[t.default_unit_basis] ?? t.default_unit_basis}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {isOverlaid ? (
                          <span className="text-amber-300" title={`Overlaid from active scenario: $${fmtCost(overlaidRate as number)}`}>
                            ${fmtCost(effectiveRate)}
                          </span>
                        ) : (
                          <span className="text-gray-500">${fmtCost(effectiveRate)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => saveEdit(t)}
                              disabled={saving}
                              className="text-[11px] px-2 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded disabled:opacity-50"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(t)}
                            className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
