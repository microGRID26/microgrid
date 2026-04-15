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
import type { Invoice, InvoiceLineItem, InvoiceStatus } from '@/lib/api/invoices'
import type { Project } from '@/types/database'
import { loadProjectById, loadOrgNames } from '@/lib/api'
import { db } from '@/lib/db'
import {
  Receipt, Plus, ChevronDown, ChevronUp, X, Search, Download, Send,
  CheckCircle, Ban, AlertTriangle, DollarSign, FileText, Clock,
} from 'lucide-react'

import { CreateInvoiceModal, MarkPaidModal, InvoiceDetail, SummaryCard } from '@/components/invoices'

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

    const orgNameMap = await loadOrgNames(allOrgIds)
    setOrgMap(orgNameMap)

    // Load line items for all invoices
    if (data.length > 0) {
      const invoiceIds = data.map(inv => inv.id)
      const { data: items, error: itemsErr } = await supabase
        .from('invoice_line_items')
        .select('*')
        .in('invoice_id', invoiceIds)
        .order('sort_order', { ascending: true })
        .limit(5000)
      if (itemsErr) console.error('[invoices] line items load failed:', itemsErr.message)
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

  // Status change handler — intercepts draft→sent to trigger the actual send
  // route (renders PDF, emails via Resend, transitions status). Other
  // transitions bypass that and hit the DB directly via updateInvoiceStatus.
  async function handleStatusChange(invoice: Invoice, newStatus: InvoiceStatus) {
    if (newStatus === 'sent' && invoice.status === 'draft') {
      try {
        const resp = await fetch(`/api/invoices/${invoice.id}/send`, { method: 'POST' })
        const body = await resp.json().catch(() => ({}))
        if (!resp.ok) {
          const msg = (body as { error?: string })?.error ?? `Send failed (HTTP ${resp.status})`
          alert(`Could not send invoice: ${msg}`)
          return
        }
        loadData()
      } catch (err) {
        console.error('[invoice send]', err)
        alert('Could not send invoice — network error')
      }
      return
    }
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
      <div className="min-h-screen bg-gray-900">
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
    <div className="min-h-screen bg-gray-900">
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
