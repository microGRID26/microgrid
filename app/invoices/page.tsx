'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Nav } from '@/components/Nav'
import { ProjectPanel } from '@/components/project/ProjectPanel'
import { cn, fmtDate, daysAgo, fmt$, escapeIlike } from '@/lib/utils'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg, useRealtimeSubscription } from '@/lib/hooks'
import {
  loadInvoices, createInvoice, updateInvoiceStatus, addLineItem, deleteLineItem,
  INVOICE_STATUS_LABELS, INVOICE_STATUS_BADGE, generateInvoiceNumber,
  loadInvoiceRules, MILESTONE_LABELS,
} from '@/lib/api/invoices'
import type { Invoice, InvoiceLineItem, InvoiceStatus, InvoiceRule } from '@/lib/api/invoices'
import type { Project } from '@/types/database'
import { loadProjectById } from '@/lib/api'
import { db } from '@/lib/db'
import {
  Receipt, Plus, ChevronDown, ChevronUp, X, Search, Download, Send,
  CheckCircle, Ban, AlertTriangle, DollarSign, FileText, Clock,
} from 'lucide-react'

// ── Create Invoice Modal ─────────────────────────────────────────────────────

interface LineItemDraft {
  description: string
  quantity: number
  unit_price: number
  category: string
}

function CreateInvoiceModal({
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

// ── Mark Paid Modal ──────────────────────────────────────────────────────────

function MarkPaidModal({
  invoice,
  onClose,
  onPaid,
}: {
  invoice: Invoice
  onClose: () => void
  onPaid: () => void
}) {
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paidAmount, setPaidAmount] = useState(invoice.total)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleSubmit() {
    setSaving(true)
    const result = await updateInvoiceStatus(invoice.id, 'paid', {
      paid_amount: paidAmount,
      payment_method: paymentMethod || undefined,
      payment_reference: paymentReference || undefined,
    })
    setSaving(false)
    if (result) {
      onPaid()
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">Mark as Paid</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="text-xs text-gray-400">
            Invoice: <span className="text-white">{invoice.invoice_number}</span> — Total: <span className="text-green-400">{fmt$(invoice.total)}</span>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Amount Paid</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={paidAmount}
              onChange={e => setPaidAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">-- Select --</option>
              <option value="ach">ACH</option>
              <option value="wire">Wire Transfer</option>
              <option value="check">Check</option>
              <option value="credit_card">Credit Card</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Payment Reference</label>
            <input
              value={paymentReference}
              onChange={e => setPaymentReference(e.target.value)}
              placeholder="Check #, transaction ID, etc."
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-green-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-800">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving || paidAmount <= 0}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
          >
            {saving ? 'Processing...' : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Invoice Detail (Expandable Row) ──────────────────────────────────────────

function InvoiceDetail({
  invoice,
  lineItems,
  isSender,
  orgMap,
  onStatusChange,
  onMarkPaid,
  onOpenProject,
}: {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  isSender: boolean
  orgMap: Record<string, string>
  onStatusChange: (status: InvoiceStatus) => void
  onMarkPaid: () => void
  onOpenProject: (projectId: string) => void
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mt-2 space-y-3">
      {/* Invoice header details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-gray-500">From</div>
          <div className="text-sm text-white">{orgMap[invoice.from_org] ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">To</div>
          <div className="text-sm text-white">{orgMap[invoice.to_org] ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Milestone</div>
          <div className="text-sm text-white capitalize">{invoice.milestone?.replace(/_/g, ' ') ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Created By</div>
          <div className="text-sm text-white">{invoice.created_by ?? '—'}</div>
        </div>
      </div>

      {/* Line items table */}
      <div>
        <div className="text-xs text-gray-500 mb-1">Line Items</div>
        <div className="bg-gray-900 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-3 py-2 text-left text-gray-500 font-medium">Description</th>
                <th className="px-3 py-2 text-right text-gray-500 font-medium w-16">Qty</th>
                <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">Unit Price</th>
                <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map(item => (
                <tr key={item.id} className="border-b border-gray-800/50">
                  <td className="px-3 py-2 text-gray-300">{item.description}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{item.quantity}</td>
                  <td className="px-3 py-2 text-right text-gray-400">{fmt$(item.unit_price)}</td>
                  <td className="px-3 py-2 text-right text-white font-medium">{fmt$(item.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-700">
                <td colSpan={3} className="px-3 py-2 text-right text-gray-400 font-medium">Subtotal</td>
                <td className="px-3 py-2 text-right text-white font-medium">{fmt$(invoice.subtotal)}</td>
              </tr>
              {invoice.tax > 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right text-gray-400 font-medium">Tax</td>
                  <td className="px-3 py-2 text-right text-white">{fmt$(invoice.tax)}</td>
                </tr>
              )}
              <tr className="border-t border-gray-600">
                <td colSpan={3} className="px-3 py-2 text-right text-white font-bold">Total</td>
                <td className="px-3 py-2 text-right text-green-400 font-bold">{fmt$(invoice.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Payment details */}
      {invoice.status === 'paid' && (
        <div className="bg-green-900/20 border border-green-800 rounded p-2">
          <div className="text-xs text-green-400 mb-1">Payment Received</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><span className="text-gray-500">Amount: </span><span className="text-green-300">{fmt$(invoice.paid_amount ?? invoice.total)}</span></div>
            <div><span className="text-gray-500">Method: </span><span className="text-green-300">{invoice.payment_method ?? '—'}</span></div>
            <div><span className="text-gray-500">Reference: </span><span className="text-green-300">{invoice.payment_reference ?? '—'}</span></div>
            <div><span className="text-gray-500">Date: </span><span className="text-green-300">{invoice.paid_at ? fmtDate(invoice.paid_at) : '—'}</span></div>
          </div>
        </div>
      )}

      {/* Notes */}
      {invoice.notes && (
        <div>
          <div className="text-xs text-gray-500 mb-1">Notes</div>
          <div className="text-sm text-gray-300 bg-gray-900 rounded p-2">{invoice.notes}</div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-700">
        {isSender && invoice.status === 'draft' && (
          <>
            <button
              onClick={() => onStatusChange('sent')}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1"
            >
              <Send className="w-3 h-3" /> Send Invoice
            </button>
            <button
              onClick={() => { if (confirm('Cancel this invoice?')) onStatusChange('cancelled') }}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center gap-1"
            >
              <Ban className="w-3 h-3" /> Cancel
            </button>
          </>
        )}
        {isSender && invoice.status === 'sent' && (
          <button
            onClick={onMarkPaid}
            className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-1"
          >
            <CheckCircle className="w-3 h-3" /> Mark Paid
          </button>
        )}
        {!isSender && invoice.status === 'sent' && (
          <>
            <button
              onClick={onMarkPaid}
              className="px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-1"
            >
              <CheckCircle className="w-3 h-3" /> Mark Paid
            </button>
            <button
              onClick={() => onStatusChange('disputed')}
              className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded-lg flex items-center gap-1"
            >
              <AlertTriangle className="w-3 h-3" /> Dispute
            </button>
          </>
        )}
        {invoice.project_id && (
          <button
            onClick={() => onOpenProject(invoice.project_id!)}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg ml-auto"
          >
            Open Project
          </button>
        )}
      </div>
    </div>
  )
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  subValue,
  color,
  onClick,
  active,
}: {
  label: string
  value: number | string
  subValue?: string
  color: string
  onClick: () => void
  active: boolean
}) {
  const activeMap: Record<string, string> = {
    gray: 'border-gray-700 ring-1 ring-gray-500/50',
    amber: 'border-amber-700 ring-1 ring-amber-500/50',
    blue: 'border-blue-700 ring-1 ring-blue-500/50',
    green: 'border-green-700 ring-1 ring-green-500/50',
    red: 'border-red-700 ring-1 ring-red-500/50',
  }
  const textMap: Record<string, string> = {
    gray: 'text-white',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'bg-gray-900 border rounded-xl px-4 py-3 text-left transition-colors',
        active ? activeMap[color] : 'border-gray-800 hover:border-gray-700'
      )}
    >
      <div className="text-xs text-gray-400">{label}</div>
      <div className={cn('text-2xl font-bold', typeof value === 'number' && value > 0 ? textMap[color] : typeof value === 'string' ? textMap[color] : 'text-gray-500')}>{value}</div>
      {subValue && <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>}
    </button>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { user: currentUser, loading: userLoading } = useCurrentUser()
  const { orgId, orgType, orgName, loading: orgLoading } = useOrg()
  const isPlatform = orgType === 'platform'

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [lineItemsMap, setLineItemsMap] = useState<Record<string, InvoiceLineItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [markPaidInvoice, setMarkPaidInvoice] = useState<Invoice | null>(null)
  const [openProject, setOpenProject] = useState<Project | null>(null)
  const [sortCol, setSortCol] = useState<'created_at' | 'status' | 'total' | 'due_date' | 'invoice_number'>('created_at')
  const [sortAsc, setSortAsc] = useState(false)
  const [orgMap, setOrgMap] = useState<Record<string, string>>({})

  // Determine view mode: sender sees outgoing, receiver sees incoming
  // Platform users see all invoices
  const isSender = useCallback((inv: Invoice) => inv.from_org === orgId, [orgId])

  // Load invoices
  const loadData = useCallback(async () => {
    if (!orgId && !isPlatform) return
    setLoading(true)

    const data = await loadInvoices(orgId ?? undefined, statusFilter || undefined)
    setInvoices(data)

    // Load org names
    const allOrgIds = [...new Set([...data.map(r => r.from_org), ...data.map(r => r.to_org)])]
    const supabase = db()

    if (allOrgIds.length > 0) {
      const { data: orgs } = await supabase.from('organizations').select('id, name').in('id', allOrgIds)
      if (orgs) {
        const oMap: Record<string, string> = {}
        for (const o of orgs as { id: string; name: string }[]) {
          oMap[o.id] = o.name
        }
        setOrgMap(oMap)
      }
    }

    // Load line items for all invoices
    if (data.length > 0) {
      const invoiceIds = data.map(inv => inv.id)
      const { data: items } = await supabase
        .from('invoice_line_items')
        .select('*')
        .in('invoice_id', invoiceIds)
        .order('sort_order', { ascending: true })
      if (items) {
        const map: Record<string, InvoiceLineItem[]> = {}
        for (const item of items as InvoiceLineItem[]) {
          if (!map[item.invoice_id]) map[item.invoice_id] = []
          map[item.invoice_id].push(item)
        }
        setLineItemsMap(map)
      }
    }

    setLoading(false)
  }, [orgId, isPlatform, statusFilter])

  useEffect(() => { loadData() }, [loadData])

  // Realtime subscription
  useRealtimeSubscription('invoices', {
    event: '*',
    onChange: loadData,
    debounceMs: 500,
  })

  // Status change handler
  async function handleStatusChange(invoice: Invoice, newStatus: InvoiceStatus) {
    const result = await updateInvoiceStatus(invoice.id, newStatus)
    if (result) loadData()
  }

  // Open project panel
  async function openProjectPanel(projectId: string) {
    const data = await loadProjectById(projectId)
    if (data) setOpenProject(data)
  }

  // Filter + sort
  const filtered = useMemo(() => {
    let list = [...invoices]

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(inv => {
        return inv.invoice_number.toLowerCase().includes(q) ||
          (inv.project_id?.toLowerCase().includes(q)) ||
          (orgMap[inv.from_org]?.toLowerCase().includes(q)) ||
          (orgMap[inv.to_org]?.toLowerCase().includes(q))
      })
    }

    list.sort((a, b) => {
      let cmp = 0
      if (sortCol === 'created_at') cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      else if (sortCol === 'status') cmp = a.status.localeCompare(b.status)
      else if (sortCol === 'total') cmp = a.total - b.total
      else if (sortCol === 'invoice_number') cmp = a.invoice_number.localeCompare(b.invoice_number)
      else if (sortCol === 'due_date') {
        const da = a.due_date ? new Date(a.due_date).getTime() : Infinity
        const dbVal = b.due_date ? new Date(b.due_date).getTime() : Infinity
        cmp = da - dbVal
      }
      return sortAsc ? cmp : -cmp
    })

    return list
  }, [invoices, search, sortCol, sortAsc, orgMap])

  // Summary counts & amounts
  const counts = useMemo(() => {
    const c = { draft: 0, sent: 0, paid: 0, overdue: 0, disputed: 0, cancelled: 0, draftAmt: 0, sentAmt: 0, paidAmt: 0, overdueAmt: 0 }
    const now = new Date()
    for (const inv of invoices) {
      if (inv.status === 'draft') { c.draft++; c.draftAmt += inv.total }
      else if (inv.status === 'sent' || inv.status === 'viewed') {
        const isOverdue = inv.due_date && new Date(inv.due_date) < now
        if (isOverdue) { c.overdue++; c.overdueAmt += inv.total }
        else { c.sent++; c.sentAmt += inv.total }
      }
      else if (inv.status === 'paid') { c.paid++; c.paidAmt += (inv.paid_amount ?? inv.total) }
      else if (inv.status === 'disputed') { c.disputed++ }
      else if (inv.status === 'cancelled') { c.cancelled++ }
    }
    return c
  }, [invoices])

  // Determine if we show "Sender" view (from_org matches) or "Receiver" view (to_org matches)
  // For simplicity: show sender view if most invoices are from our org, or if we are engineering/platform
  const hasSentInvoices = useMemo(() => invoices.some(inv => inv.from_org === orgId), [invoices, orgId])
  const hasReceivedInvoices = useMemo(() => invoices.some(inv => inv.to_org === orgId), [invoices, orgId])
  const showSenderView = isPlatform || hasSentInvoices

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(false) }
  }

  // CSV Export
  function exportCSV() {
    const headers = ['Invoice #', 'Project', 'From', 'To', 'Status', 'Subtotal', 'Tax', 'Total', 'Due Date', 'Sent', 'Paid', 'Payment Method', 'Payment Reference', 'Notes']
    const rows = filtered.map(inv => [
      inv.invoice_number,
      inv.project_id ?? '',
      orgMap[inv.from_org] ?? inv.from_org,
      orgMap[inv.to_org] ?? inv.to_org,
      INVOICE_STATUS_LABELS[inv.status] ?? inv.status,
      inv.subtotal.toFixed(2),
      inv.tax.toFixed(2),
      inv.total.toFixed(2),
      inv.due_date ?? '',
      inv.sent_at?.slice(0, 10) ?? '',
      inv.paid_at?.slice(0, 10) ?? '',
      inv.payment_method ?? '',
      inv.payment_reference ?? '',
      inv.notes ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoices-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function sortIcon(col: typeof sortCol) {
    return sortCol === col ? (sortAsc ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />) : null
  }

  // Loading state
  if (userLoading || orgLoading) {
    return (
      <div className="min-h-screen bg-gray-950">
        <Nav active="Invoices" />
        <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
      </div>
    )
  }

  // Auth gate: require authenticated user
  if (!userLoading && !currentUser) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Please sign in to view this page.</div>
      </div>
    )
  }

  // Role gate: Admin or Finance
  if (currentUser && !currentUser.isAdmin && !currentUser.isFinance) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">You don&apos;t have permission to view this page.</div>
      </div>
    )
  }

  const isReceiverOnly = hasReceivedInvoices && !hasSentInvoices && !isPlatform

  return (
    <div className="min-h-screen bg-gray-950">
      <Nav active="Invoices" />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Receipt className="w-6 h-6 text-green-400" />
              {isReceiverOnly ? 'Bills & Payments' : 'Invoices'}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {isReceiverOnly
                ? 'Invoices received from partners'
                : isPlatform
                  ? 'All invoices across organizations'
                  : 'Create and manage invoices'}
            </p>
          </div>
          {!isReceiverOnly && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Create Invoice
            </button>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {isReceiverOnly ? (
            <>
              <SummaryCard label="Pending" value={counts.sent} subValue={counts.sentAmt > 0 ? fmt$(counts.sentAmt) : undefined} color="blue" onClick={() => setStatusFilter(statusFilter === 'sent' ? '' : 'sent')} active={statusFilter === 'sent'} />
              <SummaryCard label="Overdue" value={counts.overdue} subValue={counts.overdueAmt > 0 ? fmt$(counts.overdueAmt) : undefined} color="red" onClick={() => setStatusFilter(statusFilter === 'overdue' ? '' : 'overdue')} active={statusFilter === 'overdue'} />
              <SummaryCard label="Paid" value={counts.paid} subValue={counts.paidAmt > 0 ? fmt$(counts.paidAmt) : undefined} color="green" onClick={() => setStatusFilter(statusFilter === 'paid' ? '' : 'paid')} active={statusFilter === 'paid'} />
              <SummaryCard label="Disputed" value={counts.disputed} color="amber" onClick={() => setStatusFilter(statusFilter === 'disputed' ? '' : 'disputed')} active={statusFilter === 'disputed'} />
            </>
          ) : (
            <>
              <SummaryCard label="Draft" value={counts.draft} subValue={counts.draftAmt > 0 ? fmt$(counts.draftAmt) : undefined} color="gray" onClick={() => setStatusFilter(statusFilter === 'draft' ? '' : 'draft')} active={statusFilter === 'draft'} />
              <SummaryCard label="Sent" value={counts.sent} subValue={counts.sentAmt > 0 ? fmt$(counts.sentAmt) : undefined} color="blue" onClick={() => setStatusFilter(statusFilter === 'sent' ? '' : 'sent')} active={statusFilter === 'sent'} />
              <SummaryCard label="Paid" value={counts.paid} subValue={counts.paidAmt > 0 ? fmt$(counts.paidAmt) : undefined} color="green" onClick={() => setStatusFilter(statusFilter === 'paid' ? '' : 'paid')} active={statusFilter === 'paid'} />
              <SummaryCard label="Overdue" value={counts.overdue} subValue={counts.overdueAmt > 0 ? fmt$(counts.overdueAmt) : undefined} color="red" onClick={() => setStatusFilter(statusFilter === 'overdue' ? '' : 'overdue')} active={statusFilter === 'overdue'} />
            </>
          )}
        </div>

        {/* Search + Export */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by invoice number, project ID, or organization..."
              className="w-full bg-gray-900 text-white border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-green-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button onClick={exportCSV} aria-label="Export invoices to CSV"
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors shrink-0">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>

        {/* Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-500">Loading invoices...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Receipt className="w-8 h-8 mb-2 opacity-50" />
              <span className="text-sm">{search || statusFilter ? 'No matching invoices' : 'No invoices yet'}</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none" onClick={() => toggleSort('invoice_number')}>
                    Invoice # {sortIcon('invoice_number')}
                  </th>
                  <th className="px-4 py-3 text-gray-400 font-medium">Project</th>
                  <th className="px-4 py-3 text-gray-400 font-medium">{isReceiverOnly ? 'From' : 'To'}</th>
                  <th className="px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none" onClick={() => toggleSort('status')}>
                    Status {sortIcon('status')}
                  </th>
                  <th className="px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none text-right" onClick={() => toggleSort('total')}>
                    Total {sortIcon('total')}
                  </th>
                  <th className="px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none" onClick={() => toggleSort('due_date')}>
                    Due Date {sortIcon('due_date')}
                  </th>
                  <th className="px-4 py-3 text-gray-400 font-medium cursor-pointer hover:text-white select-none" onClick={() => toggleSort('created_at')}>
                    Created {sortIcon('created_at')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const isExpanded = expandedId === inv.id
                  const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'paid' && inv.status !== 'cancelled'
                  const thisSender = isSender(inv)

                  return (
                    <tr key={inv.id} className="border-b border-gray-800/50 last:border-0">
                      <td className="px-4 py-3" colSpan={7}>
                        <div className="flex items-center">
                          {/* Expand toggle */}
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                            className="text-gray-500 hover:text-white mr-2"
                            aria-label={isExpanded ? `Collapse details for ${inv.invoice_number}` : `Expand details for ${inv.invoice_number}`}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>

                          {/* Row content as grid */}
                          <div className="flex-1 grid grid-cols-7 items-center gap-4">
                            {/* Invoice # */}
                            <div className="text-white font-medium text-xs">{inv.invoice_number}</div>

                            {/* Project */}
                            <div>
                              {inv.project_id ? (
                                <button onClick={() => openProjectPanel(inv.project_id!)} className="text-green-400 hover:text-green-300 text-xs font-medium">
                                  {inv.project_id}
                                </button>
                              ) : (
                                <span className="text-gray-600 text-xs">—</span>
                              )}
                            </div>

                            {/* From/To org */}
                            <div className="text-gray-300 text-xs truncate">
                              {isReceiverOnly
                                ? orgMap[inv.from_org] ?? '—'
                                : orgMap[inv.to_org] ?? '—'}
                            </div>

                            {/* Status */}
                            <div>
                              <span className={cn(
                                'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                                isOverdue && inv.status !== 'paid' ? 'bg-red-900 text-red-300' : INVOICE_STATUS_BADGE[inv.status]
                              )}>
                                {isOverdue && inv.status !== 'paid' ? 'Overdue' : INVOICE_STATUS_LABELS[inv.status]}
                              </span>
                            </div>

                            {/* Total */}
                            <div className="text-white font-medium text-xs text-right">{fmt$(inv.total)}</div>

                            {/* Due Date */}
                            <div className={cn('text-xs', isOverdue ? 'text-red-400 font-medium' : 'text-gray-400')}>
                              {inv.due_date ? fmtDate(inv.due_date) : '—'}
                            </div>

                            {/* Created */}
                            <div className="text-gray-400 text-xs">
                              {fmtDate(inv.created_at)}
                            </div>
                          </div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <InvoiceDetail
                            invoice={inv}
                            lineItems={lineItemsMap[inv.id] ?? []}
                            isSender={thisSender || isPlatform}
                            orgMap={orgMap}
                            onStatusChange={(status) => handleStatusChange(inv, status)}
                            onMarkPaid={() => setMarkPaidInvoice(inv)}
                            onOpenProject={openProjectPanel}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Invoice Modal */}
      {showCreateModal && orgId && currentUser && (
        <CreateInvoiceModal
          onClose={() => setShowCreateModal(false)}
          onCreated={loadData}
          orgId={orgId}
          userId={currentUser.id}
          userName={currentUser.name}
        />
      )}

      {/* Mark Paid Modal */}
      {markPaidInvoice && (
        <MarkPaidModal
          invoice={markPaidInvoice}
          onClose={() => setMarkPaidInvoice(null)}
          onPaid={loadData}
        />
      )}

      {/* Project Panel */}
      {openProject && (
        <ProjectPanel
          project={openProject}
          onClose={() => setOpenProject(null)}
          onProjectUpdated={loadData}
        />
      )}
    </div>
  )
}
