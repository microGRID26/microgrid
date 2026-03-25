'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Project } from '@/types/database'
import {
  loadProjectMaterials,
  addProjectMaterial,
  updateProjectMaterial,
  deleteProjectMaterial,
  autoGenerateMaterials,
  createPurchaseOrder,
  generatePONumber,
  MATERIAL_STATUSES,
  MATERIAL_SOURCES,
  MATERIAL_CATEGORIES,
} from '@/lib/api/inventory'
import type { ProjectMaterial, MaterialStatus } from '@/lib/api/inventory'
import { Package, Plus, Wand2, Trash2, ChevronDown, ChevronUp, X, ShoppingCart, Check } from 'lucide-react'

// ── Category badge colors ──────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  module: 'bg-blue-500/20 text-blue-400',
  inverter: 'bg-purple-500/20 text-purple-400',
  battery: 'bg-emerald-500/20 text-emerald-400',
  optimizer: 'bg-amber-500/20 text-amber-400',
  racking: 'bg-orange-500/20 text-orange-400',
  electrical: 'bg-red-500/20 text-red-400',
  other: 'bg-gray-500/20 text-gray-400',
}

// ── Status badge colors ────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  needed: 'bg-gray-500/20 text-gray-400',
  ordered: 'bg-blue-500/20 text-blue-400',
  shipped: 'bg-amber-500/20 text-amber-400',
  delivered: 'bg-green-500/20 text-green-400',
  installed: 'bg-emerald-500/20 text-emerald-300',
}

interface MaterialsTabProps {
  project: Project
}

export function MaterialsTab({ project }: MaterialsTabProps) {
  const [materials, setMaterials] = useState<ProjectMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // ── Add form state ──────────────────────────────────────────────────────
  const [addName, setAddName] = useState('')
  const [addCategory, setAddCategory] = useState('other')
  const [addQty, setAddQty] = useState(1)
  const [addUnit, setAddUnit] = useState('each')
  const [addSource, setAddSource] = useState('tbd')
  const [addVendor, setAddVendor] = useState('')
  const [addSaving, setAddSaving] = useState(false)

  // ── PO creation state ──────────────────────────────────────────────────
  const [selectedForPO, setSelectedForPO] = useState<Set<string>>(new Set())
  const [showPOForm, setShowPOForm] = useState(false)
  const [poVendor, setPOVendor] = useState('')
  const [poCreating, setPOCreating] = useState(false)

  // ── Inline edit state ───────────────────────────────────────────────────
  const [editDraft, setEditDraft] = useState<Partial<ProjectMaterial>>({})
  const [editSaving, setEditSaving] = useState(false)

  const showToastMsg = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  const fetchMaterials = useCallback(async () => {
    setLoading(true)
    const data = await loadProjectMaterials(project.id)
    setMaterials(data)
    setLoading(false)
  }, [project.id])

  useEffect(() => { fetchMaterials() }, [fetchMaterials])

  // ── Status counts ────────────────────────────────────────────────────────
  const statusCounts = materials.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] || 0) + 1
    return acc
  }, {})

  // ── Cycle status on click ────────────────────────────────────────────────
  async function cycleStatus(material: ProjectMaterial) {
    const idx = MATERIAL_STATUSES.indexOf(material.status as MaterialStatus)
    const next = MATERIAL_STATUSES[(idx + 1) % MATERIAL_STATUSES.length]
    const updates: Partial<ProjectMaterial> = { status: next }
    if (next === 'delivered' && !material.delivered_date) {
      updates.delivered_date = new Date().toISOString().split('T')[0]
    }
    const ok = await updateProjectMaterial(material.id, updates)
    if (ok) {
      setMaterials(prev => prev.map(m => m.id === material.id ? { ...m, ...updates } : m))
    } else {
      showToastMsg('Failed to update status')
    }
  }

  // ── Add material ─────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!addName.trim() || addQty <= 0) return
    setAddSaving(true)
    const result = await addProjectMaterial({
      project_id: project.id,
      equipment_id: null,
      name: addName.trim(),
      category: addCategory,
      quantity: addQty,
      unit: addUnit,
      source: addSource,
      vendor: addVendor.trim() || null,
      status: 'needed',
      po_number: null,
      expected_date: null,
      delivered_date: null,
      notes: null,
    })
    if (result) {
      setMaterials(prev => [...prev, result])
      setShowAddForm(false)
      setAddName('')
      setAddCategory('other')
      setAddQty(1)
      setAddUnit('each')
      setAddSource('tbd')
      setAddVendor('')
      showToastMsg('Material added')
    } else {
      showToastMsg('Failed to add material')
    }
    setAddSaving(false)
  }

  // ── Auto-generate ────────────────────────────────────────────────────────
  async function handleAutoGenerate() {
    setGenerating(true)
    const created = await autoGenerateMaterials(project.id, {
      module: project.module,
      module_qty: project.module_qty,
      inverter: project.inverter,
      inverter_qty: project.inverter_qty,
      battery: project.battery,
      battery_qty: project.battery_qty,
      optimizer: project.optimizer,
      optimizer_qty: project.optimizer_qty,
    })
    if (created.length > 0) {
      setMaterials(prev => [...prev, ...created])
      showToastMsg(`Added ${created.length} material${created.length > 1 ? 's' : ''} from project equipment`)
    } else {
      showToastMsg('No new materials to add (all equipment already listed)')
    }
    setConfirmGenerate(false)
    setGenerating(false)
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    const ok = await deleteProjectMaterial(id)
    if (ok) {
      setMaterials(prev => prev.filter(m => m.id !== id))
      if (expandedId === id) setExpandedId(null)
      showToastMsg('Material removed')
    } else {
      showToastMsg('Failed to remove material')
    }
  }

  // ── Save expanded detail edits ───────────────────────────────────────────
  async function saveDetail(id: string) {
    setEditSaving(true)
    const ok = await updateProjectMaterial(id, editDraft)
    if (ok) {
      setMaterials(prev => prev.map(m => m.id === id ? { ...m, ...editDraft } : m))
      showToastMsg('Updated')
    } else {
      showToastMsg('Failed to update')
    }
    setEditSaving(false)
  }

  // ── Count how many items auto-generate would add ──────────────────────────
  function countAutoItems(): number {
    const existingKeys = new Set(materials.map(m => `${m.category}:${m.name}`))
    let count = 0
    if (project.module && (project.module_qty ?? 0) > 0 && !existingKeys.has(`module:${project.module}`)) count++
    if (project.inverter && (project.inverter_qty ?? 0) > 0 && !existingKeys.has(`inverter:${project.inverter}`)) count++
    if (project.battery && (project.battery_qty ?? 0) > 0 && !existingKeys.has(`battery:${project.battery}`)) count++
    if (project.optimizer && (project.optimizer_qty ?? 0) > 0 && !existingKeys.has(`optimizer:${project.optimizer}`)) count++
    return count
  }

  // ── Toggle PO selection ─────────────────────────────────────────────────
  function togglePOSelect(id: string) {
    setSelectedForPO(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Create PO from selected materials ──────────────────────────────────
  async function handleCreatePO() {
    if (!poVendor.trim() || selectedForPO.size === 0) return
    setPOCreating(true)
    try {
      const poNumber = await generatePONumber()
      const selectedMats = materials.filter(m => selectedForPO.has(m.id))
      const lineItems = selectedMats.map(m => ({
        material_id: m.id,
        equipment_id: m.equipment_id ?? null,
        name: m.name,
        quantity: m.quantity,
        unit_price: null as number | null,
        total_price: null as number | null,
        notes: null as string | null,
      }))

      const result = await createPurchaseOrder(
        {
          po_number: poNumber,
          vendor: poVendor.trim(),
          project_id: project.id,
          status: 'draft',
          total_amount: null,
          notes: null,
          created_by: null,
          submitted_at: null,
          confirmed_at: null,
          shipped_at: null,
          delivered_at: null,
          tracking_number: null,
          expected_delivery: null,
        },
        lineItems
      )

      if (result) {
        // Update local materials with PO number and ordered status
        setMaterials(prev =>
          prev.map(m =>
            selectedForPO.has(m.id) ? { ...m, po_number: result.po_number, status: 'ordered' } : m
          )
        )
        setSelectedForPO(new Set())
        setShowPOForm(false)
        setPOVendor('')
        const warning = (result as any)._materialWarning
        if (warning) {
          showToastMsg(`Created ${result.po_number} — warning: ${warning}`)
        } else {
          showToastMsg(`Created ${result.po_number} with ${lineItems.length} item${lineItems.length !== 1 ? 's' : ''}`)
        }
      } else {
        showToastMsg('Failed to create purchase order')
      }
    } catch (err) {
      console.error('[handleCreatePO]', err)
      showToastMsg('Failed to create purchase order')
    }
    setPOCreating(false)
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto p-5">
        <div className="text-gray-500 text-sm">Loading materials...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[200] bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-green-400" />
          <h3 className="text-sm font-semibold text-white">Materials</h3>
          <span className="text-xs text-gray-500">({materials.length} item{materials.length !== 1 ? 's' : ''})</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedForPO.size > 0 && (
            <button
              onClick={() => setShowPOForm(true)}
              className="text-xs px-3 py-1.5 rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors flex items-center gap-1"
            >
              <ShoppingCart className="w-3 h-3" /> Create PO ({selectedForPO.size})
            </button>
          )}
          <button
            onClick={() => setConfirmGenerate(true)}
            className="text-xs px-3 py-1.5 rounded-md bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors flex items-center gap-1"
          >
            <Wand2 className="w-3 h-3" /> Auto-generate
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="text-xs px-3 py-1.5 rounded-md bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Item
          </button>
        </div>
      </div>

      {/* Status summary bar */}
      {materials.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {MATERIAL_STATUSES.map(s => {
            const count = statusCounts[s] || 0
            if (count === 0) return null
            return (
              <span key={s} className={`px-2 py-0.5 rounded ${STATUS_COLORS[s]}`}>
                {count} {s}
              </span>
            )
          })}
        </div>
      )}

      {/* Auto-generate confirmation */}
      {confirmGenerate && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
          <p className="text-sm text-white mb-3">
            Generate materials from project equipment? This will add {countAutoItems()} item{countAutoItems() !== 1 ? 's' : ''}.
          </p>
          {countAutoItems() === 0 && (
            <p className="text-xs text-amber-400 mb-3">All project equipment is already in the material list.</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleAutoGenerate}
              disabled={generating || countAutoItems() === 0}
              className="text-xs px-3 py-1.5 rounded bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
            <button
              onClick={() => setConfirmGenerate(false)}
              className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Create PO form */}
      {showPOForm && (
        <div className="bg-gray-800 border border-blue-700/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-blue-400" />
              Create Purchase Order
            </h4>
            <button onClick={() => setShowPOForm(false)} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400">
            {selectedForPO.size} item{selectedForPO.size !== 1 ? 's' : ''} selected for this PO.
          </p>
          <div className="space-y-2">
            {materials.filter(m => selectedForPO.has(m.id)).map(m => (
              <div key={m.id} className="flex items-center justify-between text-xs bg-gray-900 rounded px-3 py-1.5">
                <span className="text-white">{m.name}</span>
                <span className="text-gray-400">x{m.quantity}</span>
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="mat-po-vendor" className="text-xs text-gray-400 block mb-1">Vendor *</label>
            <input
              id="mat-po-vendor"
              value={poVendor}
              onChange={e => setPOVendor(e.target.value)}
              placeholder="e.g., CED Greentech"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setShowPOForm(false); setSelectedForPO(new Set()) }}
              className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreatePO}
              disabled={!poVendor.trim() || poCreating}
              className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {poCreating ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">Add Material</h4>
            <button onClick={() => setShowAddForm(false)} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label htmlFor="mat-add-name" className="text-xs text-gray-400 block mb-1">Item Name *</label>
              <input
                id="mat-add-name"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="e.g., MC4 Connectors"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
              />
            </div>
            <div>
              <label htmlFor="mat-add-category" className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                id="mat-add-category"
                value={addCategory}
                onChange={e => setAddCategory(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
              >
                {MATERIAL_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="mat-add-qty" className="text-xs text-gray-400 block mb-1">Qty</label>
                <input
                  id="mat-add-qty"
                  type="number"
                  min={1}
                  value={addQty}
                  onChange={e => setAddQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="mat-add-unit" className="text-xs text-gray-400 block mb-1">Unit</label>
                <select
                  id="mat-add-unit"
                  value={addUnit}
                  onChange={e => setAddUnit(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                >
                  <option value="each">each</option>
                  <option value="ft">ft</option>
                  <option value="box">box</option>
                  <option value="roll">roll</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="mat-add-source" className="text-xs text-gray-400 block mb-1">Source</label>
              <select
                id="mat-add-source"
                value={addSource}
                onChange={e => setAddSource(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
              >
                {MATERIAL_SOURCES.map(s => (
                  <option key={s} value={s}>{s === 'tbd' ? 'TBD' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mat-add-vendor" className="text-xs text-gray-400 block mb-1">Vendor</label>
              <input
                id="mat-add-vendor"
                value={addVendor}
                onChange={e => setAddVendor(e.target.value)}
                placeholder="Optional"
                className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setShowAddForm(false)}
              className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!addName.trim() || addSaving}
              className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {addSaving ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Materials table */}
      {materials.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No materials listed yet</p>
          <p className="text-xs text-gray-600 mt-1">
            Click &quot;Auto-generate&quot; to create from project equipment, or add items manually.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Table header */}
          <div className="grid grid-cols-[24px_1fr_80px_50px_80px_80px_80px_auto] gap-2 text-xs text-gray-500 font-medium px-3 py-1.5">
            <span></span>
            <span>Item</span>
            <span>Category</span>
            <span>Qty</span>
            <span>Source</span>
            <span>Vendor</span>
            <span>Status</span>
            <span></span>
          </div>

          {materials.map(m => (
            <div key={m.id}>
              {/* Row */}
              <div
                className={`grid grid-cols-[24px_1fr_80px_50px_80px_80px_80px_auto] gap-2 items-center text-sm px-3 py-2 rounded-lg transition-colors cursor-pointer ${
                  expandedId === m.id ? 'bg-gray-800 border border-gray-700' : 'hover:bg-gray-800/50'
                }`}
                onClick={() => {
                  if (expandedId === m.id) {
                    setExpandedId(null)
                    setEditDraft({})
                  } else {
                    setExpandedId(m.id)
                    setEditDraft({
                      vendor: m.vendor,
                      po_number: m.po_number,
                      expected_date: m.expected_date,
                      delivered_date: m.delivered_date,
                      notes: m.notes,
                    })
                  }
                }}
              >
                <button
                  onClick={e => { e.stopPropagation(); togglePOSelect(m.id) }}
                  className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    selectedForPO.has(m.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-600 hover:border-gray-400'
                  }`}
                  title={m.po_number ? `Already on ${m.po_number}` : 'Select for PO'}
                >
                  {selectedForPO.has(m.id) && <Check className="w-3 h-3 text-white" />}
                </button>
                <span className="text-white truncate">{m.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded text-center ${CATEGORY_COLORS[m.category] || CATEGORY_COLORS.other}`}>
                  {m.category}
                </span>
                <span className="text-gray-300 text-center">{m.quantity}</span>
                <span className="text-xs text-gray-400 text-center">
                  {m.source === 'tbd' ? 'TBD' : m.source}
                </span>
                <span className="text-xs text-gray-400 truncate">{m.vendor || '\u2014'}</span>
                <button
                  onClick={e => { e.stopPropagation(); cycleStatus(m) }}
                  className={`text-xs px-1.5 py-0.5 rounded text-center transition-colors ${STATUS_COLORS[m.status] || STATUS_COLORS.needed}`}
                  title="Click to cycle status"
                >
                  {m.status}
                </button>
                <div className="flex items-center gap-1">
                  {expandedId === m.id ? (
                    <ChevronUp className="w-3 h-3 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-gray-500" />
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expandedId === m.id && (
                <div className="bg-gray-800 border border-gray-700 border-t-0 rounded-b-lg p-4 space-y-3 -mt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="mat-edit-vendor" className="text-xs text-gray-400 block mb-1">Vendor</label>
                      <input
                        id="mat-edit-vendor"
                        value={editDraft.vendor ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, vendor: e.target.value || null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="mat-edit-po" className="text-xs text-gray-400 block mb-1">PO Number</label>
                      <input
                        id="mat-edit-po"
                        value={editDraft.po_number ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, po_number: e.target.value || null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="mat-edit-expected" className="text-xs text-gray-400 block mb-1">Expected Date</label>
                      <input
                        id="mat-edit-expected"
                        type="date"
                        value={editDraft.expected_date ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, expected_date: e.target.value || null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label htmlFor="mat-edit-delivered" className="text-xs text-gray-400 block mb-1">Delivered Date</label>
                      <input
                        id="mat-edit-delivered"
                        type="date"
                        value={editDraft.delivered_date ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, delivered_date: e.target.value || null }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                      />
                    </div>
                    <div className="col-span-2">
                      <label htmlFor="mat-edit-notes" className="text-xs text-gray-400 block mb-1">Notes</label>
                      <textarea
                        id="mat-edit-notes"
                        value={editDraft.notes ?? ''}
                        onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value || null }))}
                        rows={2}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white resize-none"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <button
                      onClick={() => handleDelete(m.id)}
                      className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                    <button
                      onClick={() => saveDetail(m.id)}
                      disabled={editSaving}
                      className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
                    >
                      {editSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
