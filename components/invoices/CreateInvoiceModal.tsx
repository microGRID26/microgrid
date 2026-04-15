'use client'

import { useEffect, useState } from 'react'
import { searchProjects } from '@/lib/api'
import { createInvoice, generateInvoiceNumber, loadInvoiceRules, MILESTONE_LABELS } from '@/lib/api/invoices'
import type { InvoiceRule } from '@/lib/api/invoices'
import { db } from '@/lib/db'
import { fmt$, escapeIlike } from '@/lib/utils'
import { X, Plus } from 'lucide-react'

// ── Create Invoice Modal ─────────────────────────────────────────────────────

interface LineItemDraft {
  description: string
  quantity: number
  unit_price: number
  category: string
}

export function CreateInvoiceModal({
  onClose,
  onCreated,
  orgId,
  userId,
  userName,
}: {
  onClose: () => void
  onCreated: () => void
  orgId: string
  userId: string
  userName: string
}) {
  const [projectSearch, setProjectSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; stage: string }[]>([])
  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null)
  const [toOrg, setToOrg] = useState('')
  const [availableOrgs, setAvailableOrgs] = useState<{ id: string; name: string }[]>([])
  const [dueDate, setDueDate] = useState('')
  const [milestone, setMilestone] = useState('')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([{ description: '', quantity: 1, unit_price: 0, category: '' }])
  const [saving, setSaving] = useState(false)
  const [invoiceRules, setInvoiceRules] = useState<InvoiceRule[]>([])
  const [selectedRuleId, setSelectedRuleId] = useState('')

  // Load active invoice rules
  useEffect(() => {
    loadInvoiceRules(true).then(setInvoiceRules)
  }, [])

  function applyRule(ruleId: string) {
    setSelectedRuleId(ruleId)
    if (!ruleId) return
    const rule = invoiceRules.find(r => r.id === ruleId)
    if (!rule) return
    // Auto-populate milestone from the rule
    setMilestone(rule.milestone)
    // Convert rule line_items to draft format
    const items: LineItemDraft[] = (rule.line_items as Record<string, unknown>[]).map(item => ({
      description: (item.description as string) ?? '',
      quantity: (item.quantity as number) ?? 1,
      unit_price: (item.unit_price as number) ?? 0,
      category: (item.category as string) ?? '',
    }))
    if (items.length > 0) setLineItems(items)
  }

  // Escape key to close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Load available recipient orgs
  useEffect(() => {
    async function load() {
      const supabase = db()
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('active', true)
        .neq('id', orgId)
        .order('name')
      if (data) setAvailableOrgs(data as { id: string; name: string }[])
    }
    load()
  }, [orgId])

  // Search projects for autocomplete
  useEffect(() => {
    if (projectSearch.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      const supabase = db()
      const q = escapeIlike(projectSearch)
      let query = supabase
        .from('projects')
        .select('id, name, stage')
        .or(`name.ilike.%${q}%,id.ilike.%${q}%`)
        .limit(10)
      if (orgId) query = query.eq('org_id', orgId)
      const { data } = await query
      setSearchResults((data ?? []) as { id: string; name: string; stage: string }[])
    }, 200)
    return () => clearTimeout(timer)
  }, [projectSearch])

  function addLineItemRow() {
    setLineItems(prev => [...prev, { description: '', quantity: 1, unit_price: 0, category: '' }])
  }

  function removeLineItemRow(index: number) {
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  function updateLineItem(index: number, field: keyof LineItemDraft, value: string | number) {
    setLineItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const subtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)

  async function handleCreate() {
    if (!toOrg) return
    const validItems = lineItems.filter(item => item.description.trim() && item.unit_price > 0)
    if (validItems.length === 0) return

    setSaving(true)
    const invoiceNumber = await generateInvoiceNumber()

    const result = await createInvoice({
      invoice_number: invoiceNumber,
      project_id: selectedProject?.id ?? null,
      from_org: orgId,
      to_org: toOrg,
      milestone: milestone || null,
      due_date: dueDate || null,
      notes: notes || null,
      created_by: userName,
      created_by_id: userId,
    }, validItems.map((item, i) => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      category: item.category || null,
      sort_order: i,
    })))

    setSaving(false)
    if (result) {
      onCreated()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Create Invoice</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Project search (optional) */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Project (optional)</label>
            {selectedProject ? (
              <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                <span className="text-white text-sm">{selectedProject.id} — {selectedProject.name}</span>
                <button onClick={() => { setSelectedProject(null); setProjectSearch('') }} className="text-gray-400 hover:text-white ml-auto"><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="relative">
                <input
                  value={projectSearch}
                  onChange={e => setProjectSearch(e.target.value)}
                  placeholder="Search by name or PROJ-XXXXX"
                  className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
                />
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-gray-800 border border-gray-700 rounded-lg mt-1 max-h-48 overflow-y-auto z-10">
                    {searchResults.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedProject({ id: p.id, name: p.name }); setSearchResults([]) }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                      >
                        <span className="text-green-400">{p.id}</span> — {p.name} <span className="text-gray-500 text-xs">({p.stage})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Apply Rule Template */}
          {invoiceRules.length > 0 && (
            <div>
              <label className="text-xs text-gray-400 block mb-1">Apply Rule Template</label>
              <select
                value={selectedRuleId}
                onChange={e => applyRule(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">-- Select a rule to auto-populate --</option>
                {invoiceRules.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.from_org_type} → {r.to_org_type} @ {MILESTONE_LABELS[r.milestone] ?? r.milestone})
                  </option>
                ))}
              </select>
              {selectedRuleId && (
                <p className="text-[10px] text-gray-500 mt-1">
                  Rule applied — line items and milestone populated. You can still modify them below.
                </p>
              )}
            </div>
          )}

          {/* To Org + Milestone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Bill To *</label>
              <select
                value={toOrg}
                onChange={e => setToOrg(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">-- Select Organization --</option>
                {availableOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Milestone</label>
              <select
                value={milestone}
                onChange={e => setMilestone(e.target.value)}
                className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">-- None --</option>
                <option value="contract_signed">Contract Signed</option>
                <option value="ntp">NTP Approved</option>
                <option value="design_complete">Design Complete</option>
                <option value="permit_approved">Permit Approved</option>
                <option value="installation">Installation</option>
                <option value="install_complete">Install Complete</option>
                <option value="inspection_passed">Inspection Passed</option>
                <option value="pto">PTO Received</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-400">Line Items *</label>
              <button onClick={addLineItemRow} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add Line
              </button>
            </div>
            <div className="space-y-2">
              {lineItems.map((item, i) => (
                <div key={i} className="bg-gray-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={item.description}
                      onChange={e => updateLineItem(i, 'description', e.target.value)}
                      placeholder="Description"
                      className="flex-1 bg-gray-700 text-white border border-gray-600 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-green-500"
                    />
                    {lineItems.length > 1 && (
                      <button onClick={() => removeLineItemRow(i)} className="text-gray-500 hover:text-red-400"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500">Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={e => updateLineItem(i, 'quantity', parseInt(e.target.value) || 1)}
                        className="w-full bg-gray-700 text-white border border-gray-600 rounded px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Unit Price ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price || ''}
                        onChange={e => updateLineItem(i, 'unit_price', parseFloat(e.target.value) || 0)}
                        className="w-full bg-gray-700 text-white border border-gray-600 rounded px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Total</label>
                      <div className="bg-gray-700 text-gray-300 border border-gray-600 rounded px-2 py-1.5 text-xs">
                        {fmt$(item.quantity * item.unit_price)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-2">
              <div className="text-sm text-white font-medium">Subtotal: {fmt$(subtotal)}</div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-gray-400 block mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Payment terms, additional notes..."
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={saving || !toOrg || lineItems.every(i => !i.description.trim() || i.unit_price <= 0)}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

