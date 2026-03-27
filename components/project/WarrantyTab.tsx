'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Project } from '@/types/database'
import {
  loadProjectWarranties,
  addWarranty,
  updateWarranty,
  deleteWarranty,
  loadWarrantyClaims,
  addClaim,
  updateClaim,
  WARRANTY_EQUIPMENT_TYPES,
  CLAIM_STATUSES,
} from '@/lib/api/warranties'
import type { EquipmentWarranty, WarrantyClaim } from '@/lib/api/warranties'
import { fmtDate } from '@/lib/utils'
import { Shield, Plus, Trash2, ChevronDown, ChevronUp, Wand2, AlertTriangle, FileText } from 'lucide-react'

// ── Status helpers ────────────────────────────────────────────────────────────

function warrantyStatus(w: EquipmentWarranty): 'active' | 'expiring' | 'expired' | 'unknown' {
  if (!w.warranty_end_date) return 'unknown'
  const end = new Date(w.warranty_end_date + 'T00:00:00')
  const now = new Date()
  const daysLeft = Math.floor((end.getTime() - now.getTime()) / 86400000)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 90) return 'expiring'
  return 'active'
}

function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null
  const end = new Date(endDate + 'T00:00:00')
  return Math.floor((end.getTime() - Date.now()) / 86400000)
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  expiring: 'bg-amber-500/20 text-amber-400',
  expired: 'bg-red-500/20 text-red-400',
  unknown: 'bg-gray-500/20 text-gray-400',
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  expiring: 'Expiring Soon',
  expired: 'Expired',
  unknown: 'No End Date',
}

const TYPE_COLORS: Record<string, string> = {
  panel: 'bg-blue-500/20 text-blue-400',
  inverter: 'bg-purple-500/20 text-purple-400',
  battery: 'bg-emerald-500/20 text-emerald-400',
  optimizer: 'bg-amber-500/20 text-amber-400',
}

const CLAIM_STATUS_BADGE: Record<string, string> = {
  draft: 'bg-gray-700 text-gray-300',
  submitted: 'bg-blue-900 text-blue-300',
  approved: 'bg-green-900 text-green-300',
  denied: 'bg-red-900 text-red-300',
  completed: 'bg-emerald-900 text-emerald-300',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface WarrantyTabProps {
  project: Project
}

export function WarrantyTab({ project }: WarrantyTabProps) {
  const [warranties, setWarranties] = useState<EquipmentWarranty[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [claims, setClaims] = useState<Record<string, WarrantyClaim[]>>({})
  const [toast, setToast] = useState<string | null>(null)

  // ── Add form state ──────────────────────────────────────────────────────
  const [addType, setAddType] = useState('panel')
  const [addMfg, setAddMfg] = useState('')
  const [addModel, setAddModel] = useState('')
  const [addSerial, setAddSerial] = useState('')
  const [addQty, setAddQty] = useState(1)
  const [addInstallDate, setAddInstallDate] = useState('')
  const [addStartDate, setAddStartDate] = useState('')
  const [addEndDate, setAddEndDate] = useState('')
  const [addYears, setAddYears] = useState<number | ''>('')
  const [addNotes, setAddNotes] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  // ── Claim form state ────────────────────────────────────────────────────
  const [showClaimForm, setShowClaimForm] = useState<string | null>(null)
  const [claimIssue, setClaimIssue] = useState('')
  const [claimSaving, setClaimSaving] = useState(false)

  const showToastMsg = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const fetchWarranties = useCallback(async () => {
    setLoading(true)
    const data = await loadProjectWarranties(project.id)
    setWarranties(data)
    setLoading(false)
  }, [project.id])

  useEffect(() => { fetchWarranties() }, [fetchWarranties])

  // ── Auto-populate from project equipment ────────────────────────────────
  async function autoPopulate() {
    const entries: { type: string; model: string | null; count: number }[] = []
    if (project.module) entries.push({ type: 'panel', model: project.module, count: project.module_qty ?? 1 })
    if (project.inverter) entries.push({ type: 'inverter', model: project.inverter, count: project.inverter_qty ?? 1 })
    if (project.battery) entries.push({ type: 'battery', model: project.battery, count: project.battery_qty ?? 1 })
    if (project.optimizer) entries.push({ type: 'optimizer', model: project.optimizer, count: project.optimizer_qty ?? 1 })

    if (entries.length === 0) {
      showToastMsg('No equipment found on project')
      return
    }

    // Dedup — skip if warranty with same type+model already exists
    const existing = new Set(warranties.map(w => `${w.equipment_type}|${w.model}`))
    const toAdd = entries.filter(e => !existing.has(`${e.type}|${e.model}`))
    if (toAdd.length === 0) {
      showToastMsg('All equipment already has warranty records')
      return
    }

    let added = 0
    for (const e of toAdd) {
      const result = await addWarranty({
        project_id: project.id,
        equipment_type: e.type,
        manufacturer: null,
        model: e.model,
        serial_number: null,
        quantity: e.count,
        install_date: project.install_complete_date ?? null,
        warranty_start_date: project.install_complete_date ?? null,
        warranty_end_date: null,
        warranty_years: null,
        notes: null,
      })
      if (result) added++
    }

    showToastMsg(`Added ${added} warranty record${added !== 1 ? 's' : ''}`)
    fetchWarranties()
  }

  // ── Add warranty ────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!addType) return
    setAddSaving(true)
    const result = await addWarranty({
      project_id: project.id,
      equipment_type: addType,
      manufacturer: addMfg || null,
      model: addModel || null,
      serial_number: addSerial || null,
      quantity: addQty,
      install_date: addInstallDate || null,
      warranty_start_date: addStartDate || null,
      warranty_end_date: addEndDate || null,
      warranty_years: addYears ? Number(addYears) : null,
      notes: addNotes || null,
    })
    setAddSaving(false)
    if (result) {
      showToastMsg('Warranty added')
      setShowAddForm(false)
      resetAddForm()
      fetchWarranties()
    }
  }

  function resetAddForm() {
    setAddType('panel')
    setAddMfg('')
    setAddModel('')
    setAddSerial('')
    setAddQty(1)
    setAddInstallDate('')
    setAddStartDate('')
    setAddEndDate('')
    setAddYears('')
    setAddNotes('')
  }

  // ── Delete warranty ─────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!confirm('Delete this warranty record and all associated claims?')) return
    const ok = await deleteWarranty(id)
    if (ok) {
      showToastMsg('Warranty deleted')
      fetchWarranties()
    }
  }

  // ── Load claims for expanded warranty ───────────────────────────────────
  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (!claims[id]) {
      const data = await loadWarrantyClaims(id)
      setClaims(prev => ({ ...prev, [id]: data }))
    }
  }

  // ── Add claim ───────────────────────────────────────────────────────────
  async function handleAddClaim(warrantyId: string) {
    if (!claimIssue.trim()) return
    setClaimSaving(true)
    const w = warranties.find(w => w.id === warrantyId)
    const result = await addClaim({
      warranty_id: warrantyId,
      project_id: project.id,
      claim_number: null,
      status: 'draft',
      issue_description: claimIssue,
      submitted_date: null,
      resolved_date: null,
      resolution_notes: null,
      replacement_serial: null,
      created_by: null,
    })
    setClaimSaving(false)
    if (result) {
      showToastMsg('Claim created')
      setShowClaimForm(null)
      setClaimIssue('')
      // Refresh claims for this warranty
      const data = await loadWarrantyClaims(warrantyId)
      setClaims(prev => ({ ...prev, [warrantyId]: data }))
    }
  }

  // ── Update claim status ─────────────────────────────────────────────────
  async function handleClaimStatusChange(claimId: string, warrantyId: string, newStatus: string) {
    const updates: Partial<WarrantyClaim> = { status: newStatus }
    if (newStatus === 'submitted') updates.submitted_date = new Date().toISOString().split('T')[0]
    if (newStatus === 'completed' || newStatus === 'denied') updates.resolved_date = new Date().toISOString().split('T')[0]
    const ok = await updateClaim(claimId, updates)
    if (ok) {
      const data = await loadWarrantyClaims(warrantyId)
      setClaims(prev => ({ ...prev, [warrantyId]: data }))
    }
  }

  // ── Summary counts ──────────────────────────────────────────────────────
  const activeCount = warranties.filter(w => warrantyStatus(w) === 'active').length
  const expiringCount = warranties.filter(w => warrantyStatus(w) === 'expiring').length
  const expiredCount = warranties.filter(w => warrantyStatus(w) === 'expired').length

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="text-gray-400 text-sm">Loading warranties...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-green-400" />
          <h3 className="text-white font-semibold">Equipment Warranties</h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={autoPopulate}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
            <Wand2 className="w-3.5 h-3.5" /> Auto-populate
          </button>
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-green-700 text-white hover:bg-green-600 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Warranty
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {warranties.length > 0 && (
        <div className="flex gap-3 mb-4 text-xs">
          <span className="px-2 py-1 rounded bg-green-500/20 text-green-400">{activeCount} Active</span>
          <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-400">{expiringCount} Expiring</span>
          <span className="px-2 py-1 rounded bg-red-500/20 text-red-400">{expiredCount} Expired</span>
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Type</label>
              <select value={addType} onChange={e => setAddType(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600">
                {WARRANTY_EQUIPMENT_TYPES.map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Manufacturer</label>
              <input value={addMfg} onChange={e => setAddMfg(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Model</label>
              <input value={addModel} onChange={e => setAddModel(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Serial Number</label>
              <input value={addSerial} onChange={e => setAddSerial(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Quantity</label>
              <input type="number" min={1} value={addQty} onChange={e => setAddQty(Number(e.target.value))}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Install Date</label>
              <input type="date" value={addInstallDate} onChange={e => setAddInstallDate(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Warranty Start</label>
              <input type="date" value={addStartDate} onChange={e => setAddStartDate(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Warranty End</label>
              <input type="date" value={addEndDate} onChange={e => setAddEndDate(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Warranty Years</label>
              <input type="number" min={1} value={addYears} onChange={e => setAddYears(e.target.value ? Number(e.target.value) : '')}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="text-xs text-gray-400 block mb-1">Notes</label>
              <input value={addNotes} onChange={e => setAddNotes(e.target.value)}
                className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowAddForm(false); resetAddForm() }}
              className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600">Cancel</button>
            <button onClick={handleAdd} disabled={addSaving}
              className="text-xs px-3 py-1.5 rounded bg-green-700 text-white hover:bg-green-600 disabled:opacity-50">
              {addSaving ? 'Saving...' : 'Save Warranty'}
            </button>
          </div>
        </div>
      )}

      {/* Warranty list */}
      {warranties.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No warranty records yet</p>
          <p className="text-xs mt-1">Click &quot;Auto-populate&quot; to create records from project equipment</p>
        </div>
      ) : (
        <div className="space-y-2">
          {warranties.map(w => {
            const status = warrantyStatus(w)
            const days = daysRemaining(w.warranty_end_date)
            const isExpanded = expandedId === w.id
            const wClaims = claims[w.id] ?? []

            return (
              <div key={w.id} className="bg-gray-800 border border-gray-700 rounded-lg">
                {/* Row */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-750 transition-colors"
                  onClick={() => toggleExpand(w.id)}
                >
                  <span className={`text-xs px-2 py-0.5 rounded ${TYPE_COLORS[w.equipment_type] ?? 'bg-gray-500/20 text-gray-400'}`}>
                    {w.equipment_type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate">
                      {[w.manufacturer, w.model].filter(Boolean).join(' ') || 'Unknown equipment'}
                    </div>
                    <div className="text-xs text-gray-400 flex gap-3 mt-0.5">
                      {w.serial_number && <span>SN: {w.serial_number}</span>}
                      {w.quantity > 1 && <span>Qty: {w.quantity}</span>}
                      {w.warranty_start_date && <span>Start: {fmtDate(w.warranty_start_date)}</span>}
                      {w.warranty_end_date && <span>End: {fmtDate(w.warranty_end_date)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {days !== null && status !== 'unknown' && (
                      <span className="text-xs text-gray-400">
                        {days >= 0 ? `${days}d left` : `${Math.abs(days)}d ago`}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_BADGE[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-700 px-4 py-3 space-y-3">
                    <div className="flex gap-4 text-xs text-gray-400">
                      {w.install_date && <span>Installed: {fmtDate(w.install_date)}</span>}
                      {w.warranty_years && <span>{w.warranty_years}-year warranty</span>}
                    </div>
                    {w.notes && <div className="text-xs text-gray-300 bg-gray-900 rounded p-2">{w.notes}</div>}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button onClick={() => { setShowClaimForm(showClaimForm === w.id ? null : w.id); setClaimIssue('') }}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-900 text-blue-300 hover:bg-blue-800">
                        <FileText className="w-3 h-3" /> New Claim
                      </button>
                      <button onClick={() => handleDelete(w.id)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-900/50 text-red-400 hover:bg-red-900">
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>

                    {/* Claim form */}
                    {showClaimForm === w.id && (
                      <div className="bg-gray-900 rounded p-3 space-y-2">
                        <label className="text-xs text-gray-400 block">Issue Description</label>
                        <textarea value={claimIssue} onChange={e => setClaimIssue(e.target.value)}
                          className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-600 h-20 resize-none" />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setShowClaimForm(null)}
                            className="text-xs px-3 py-1 rounded bg-gray-700 text-gray-300">Cancel</button>
                          <button onClick={() => handleAddClaim(w.id)} disabled={claimSaving || !claimIssue.trim()}
                            className="text-xs px-3 py-1 rounded bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-50">
                            {claimSaving ? 'Creating...' : 'Create Claim'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Claims list */}
                    {wClaims.length > 0 && (
                      <div className="space-y-1">
                        <h4 className="text-xs text-gray-400 font-medium">Claims ({wClaims.length})</h4>
                        {wClaims.map(c => (
                          <div key={c.id} className="bg-gray-900 rounded p-2 flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white">{c.issue_description || 'No description'}</div>
                              <div className="text-xs text-gray-400 flex gap-2 mt-0.5">
                                {c.claim_number && <span>#{c.claim_number}</span>}
                                {c.submitted_date && <span>Submitted: {fmtDate(c.submitted_date)}</span>}
                                {c.resolved_date && <span>Resolved: {fmtDate(c.resolved_date)}</span>}
                                {c.replacement_serial && <span>Replacement SN: {c.replacement_serial}</span>}
                              </div>
                              {c.resolution_notes && (
                                <div className="text-xs text-gray-300 mt-1">{c.resolution_notes}</div>
                              )}
                            </div>
                            <select value={c.status}
                              onChange={e => handleClaimStatusChange(c.id, w.id, e.target.value)}
                              className={`text-xs px-2 py-0.5 rounded border-0 ${CLAIM_STATUS_BADGE[c.status] ?? 'bg-gray-700 text-gray-300'}`}>
                              {CLAIM_STATUSES.map(s => (
                                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
