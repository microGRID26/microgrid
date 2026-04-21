'use client'

// components/project/InvoicesTab.tsx — Per-project invoice viewer
//
// Surfaces the invoices that reference this project (milestone + chain),
// grouped and labeled for a non-technical reader. Added for the CFO
// orientation so Paul + Mark can open one project and see its full
// invoicing state without leaving the project panel.

import { useCallback, useEffect, useState } from 'react'
import { FileText, AlertCircle, Plus, ChevronDown, ChevronUp } from 'lucide-react'

import {
  loadProjectInvoices,
  loadInvoice,
  loadOrgNames,
  updateInvoiceStatus,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_BADGE,
  MILESTONE_LABELS,
} from '@/lib/api/invoices'
import type { Invoice, InvoiceLineItem, InvoiceStatus } from '@/lib/api/invoices'
import type { Project } from '@/types/database'
import { useCurrentUser } from '@/lib/useCurrentUser'
import { useOrg } from '@/lib/hooks'
import { CreateInvoiceModal, InvoiceDetail, MarkPaidModal } from '@/components/invoices'

interface InvoicesTabProps {
  project: Project
}

// ── Pure helpers (unit-testable) ────────────────────────────────────────────

export type InvoiceKind = 'milestone' | 'chain' | 'other'

/** Classify an invoice by its number prefix. INV- = customer milestone, CHN- = chain. */
export function classifyInvoice(inv: Pick<Invoice, 'invoice_number'>): InvoiceKind {
  const n = inv.invoice_number ?? ''
  if (n.startsWith('INV-')) return 'milestone'
  if (n.startsWith('CHN-')) return 'chain'
  return 'other'
}

/** Partition a project's invoices into milestone / chain / other buckets. */
export function partitionInvoices(invoices: Invoice[]): {
  milestone: Invoice[]
  chain: Invoice[]
  other: Invoice[]
} {
  const milestone: Invoice[] = []
  const chain: Invoice[] = []
  const other: Invoice[] = []
  for (const inv of invoices) {
    const kind = classifyInvoice(inv)
    if (kind === 'milestone') milestone.push(inv)
    else if (kind === 'chain') chain.push(inv)
    else other.push(inv)
  }
  return { milestone, chain, other }
}

function fmtMoney(v: number | string | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v ?? 0)
  if (!Number.isFinite(n)) return '$0.00'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Component ───────────────────────────────────────────────────────────────

export function InvoicesTab({ project }: InvoicesTabProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [orgMap, setOrgMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [lineItemsMap, setLineItemsMap] = useState<Record<string, InvoiceLineItem[]>>({})
  const [markPaidInvoice, setMarkPaidInvoice] = useState<Invoice | null>(null)
  const { user: currentUser } = useCurrentUser()
  const { orgId, orgType } = useOrg()
  const isPlatform = orgType === 'platform'
  const canCreate = !!currentUser && (currentUser.isAdmin || currentUser.isFinance)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await loadProjectInvoices(project.id)
      setInvoices(data)
      const orgIds = Array.from(new Set([...data.map((r) => r.from_org), ...data.map((r) => r.to_org)])).filter(Boolean)
      if (orgIds.length > 0) {
        const names = await loadOrgNames(orgIds)
        setOrgMap(names)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    void load()
  }, [load])

  // Lazy-load line items when a row is expanded for the first time.
  const handleToggleExpand = useCallback(
    async (invoiceId: string) => {
      if (expandedId === invoiceId) {
        setExpandedId(null)
        return
      }
      setExpandedId(invoiceId)
      if (!lineItemsMap[invoiceId]) {
        const result = await loadInvoice(invoiceId)
        if (result) {
          setLineItemsMap((m) => ({ ...m, [invoiceId]: result.lineItems }))
        }
      }
    },
    [expandedId, lineItemsMap],
  )

  // Draft → sent routes through the /send endpoint which renders the PDF,
  // emails it, and transitions the row. Every other transition hits the DB
  // directly. Mirrors the global /invoices page.
  const handleStatusChange = useCallback(
    async (invoice: Invoice, newStatus: InvoiceStatus) => {
      if (newStatus === 'sent' && invoice.status === 'draft') {
        try {
          const resp = await fetch(`/api/invoices/${invoice.id}/send`, { method: 'POST' })
          const body = (await resp.json().catch(() => ({}))) as { error?: string }
          if (!resp.ok) {
            alert(`Could not send invoice: ${body.error ?? `HTTP ${resp.status}`}`)
            return
          }
          await load()
        } catch {
          alert('Could not send invoice — network error')
        }
        return
      }
      const updated = await updateInvoiceStatus(invoice.id, newStatus)
      if (updated) await load()
    },
    [load],
  )

  if (loading) {
    return <div className="p-5 text-sm text-gray-400">Loading invoices…</div>
  }

  if (error) {
    return (
      <div className="p-5 text-sm text-red-400 flex items-center gap-2">
        <AlertCircle size={14} />
        {error}
      </div>
    )
  }

  const { milestone, chain, other } = partitionInvoices(invoices)

  const createButton = canCreate && orgId ? (
    <button
      onClick={() => setShowCreateModal(true)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-md"
    >
      <Plus size={12} /> Create Invoice
    </button>
  ) : null

  const modal = showCreateModal && orgId && currentUser ? (
    <CreateInvoiceModal
      onClose={() => setShowCreateModal(false)}
      onCreated={() => { void load() }}
      orgId={orgId}
      userId={currentUser.id}
      userName={currentUser.name}
      prefilledProject={{ id: project.id, name: project.name }}
    />
  ) : null

  if (invoices.length === 0) {
    return (
      <>
        <div className="p-8 text-center text-sm text-gray-400">
          <FileText size={24} className="mx-auto mb-2 text-gray-600" />
          <div className="mb-1 text-gray-300">No invoices generated yet for this project.</div>
          <div className="text-xs text-gray-500 max-w-md mx-auto leading-relaxed mb-4">
            Milestone invoices (<span className="font-mono">INV-</span>) fire automatically at NTP, Install, and PTO.
            Chain invoices (<span className="font-mono">CHN-</span>) generate on demand via the chain orchestrator
            (DSE Corp → NewCo → EPC → EDGE, plus Rush and MG Sales).
          </div>
          {createButton}
        </div>
        {modal}
      </>
    )
  }

  const groupProps = {
    orgMap,
    orgId,
    isPlatform,
    expandedId,
    lineItemsMap,
    onToggleExpand: handleToggleExpand,
    onStatusChange: handleStatusChange,
    onMarkPaid: (inv: Invoice) => setMarkPaidInvoice(inv),
  }

  return (
    <>
      <div className="p-5 space-y-6">
        {createButton && (
          <div className="flex justify-end">{createButton}</div>
        )}
        {milestone.length > 0 && (
          <InvoiceGroup
            title="Milestone Invoices"
            subtitle="Customer-facing — automatic on NTP / Install / PTO"
            invoices={milestone}
            {...groupProps}
          />
        )}
        {chain.length > 0 && (
          <InvoiceGroup
            title="Chain Invoices"
            subtitle="Tax-substantiation chain — DSE Corp → NewCo → EPC → EDGE (plus Rush + MG Sales)"
            invoices={chain}
            {...groupProps}
          />
        )}
        {other.length > 0 && (
          <InvoiceGroup
            title="Other"
            subtitle="Manually created or non-standard invoices"
            invoices={other}
            {...groupProps}
          />
        )}
      </div>
      {modal}
      {markPaidInvoice && (
        <MarkPaidModal
          invoice={markPaidInvoice}
          onClose={() => setMarkPaidInvoice(null)}
          onPaid={() => { void load(); setMarkPaidInvoice(null) }}
        />
      )}
    </>
  )
}

// ── Group row ───────────────────────────────────────────────────────────────

interface InvoiceGroupProps {
  title: string
  subtitle: string
  invoices: Invoice[]
  orgMap: Record<string, string>
  orgId: string | null
  isPlatform: boolean
  expandedId: string | null
  lineItemsMap: Record<string, InvoiceLineItem[]>
  onToggleExpand: (invoiceId: string) => void
  onStatusChange: (invoice: Invoice, status: InvoiceStatus) => void
  onMarkPaid: (invoice: Invoice) => void
}

function InvoiceGroup({ title, subtitle, invoices, ...rowProps }: InvoiceGroupProps) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-1">{title}</div>
      <div className="text-xs text-gray-500 mb-3">{subtitle}</div>
      <div className="space-y-2">
        {invoices.map((inv) => (
          <InvoiceRow key={inv.id} invoice={inv} {...rowProps} />
        ))}
      </div>
    </div>
  )
}

function InvoiceRow({
  invoice,
  orgMap,
  orgId,
  isPlatform,
  expandedId,
  lineItemsMap,
  onToggleExpand,
  onStatusChange,
  onMarkPaid,
}: Omit<InvoiceGroupProps, 'title' | 'subtitle' | 'invoices'> & { invoice: Invoice }) {
  const fromName = orgMap[invoice.from_org] ?? invoice.from_org
  const toName = orgMap[invoice.to_org] ?? invoice.to_org
  const status = invoice.status as InvoiceStatus
  const milestoneLabel =
    invoice.milestone && invoice.milestone !== 'chain' ? MILESTONE_LABELS[invoice.milestone] ?? invoice.milestone : null
  const isExpanded = expandedId === invoice.id
  const isSender = invoice.from_org === orgId || isPlatform
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 overflow-hidden">
      <button
        type="button"
        onClick={() => onToggleExpand(invoice.id)}
        className="w-full text-left p-3 flex items-center gap-3 hover:bg-gray-800/60 transition-colors"
        aria-expanded={isExpanded}
        aria-label={isExpanded ? `Collapse invoice ${invoice.invoice_number}` : `Expand invoice ${invoice.invoice_number}`}
      >
        <span className="text-gray-500 shrink-0">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm text-white">{invoice.invoice_number}</div>
          <div className="text-xs text-gray-400 truncate">
            {fromName} → {toName}
            {milestoneLabel && <span className="text-gray-500"> · {milestoneLabel}</span>}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${INVOICE_STATUS_BADGE[status] ?? 'bg-gray-700 text-gray-300'}`}>
          {INVOICE_STATUS_LABELS[status] ?? status}
        </span>
        <div className="text-right whitespace-nowrap">
          <div className="text-sm font-semibold text-white">{fmtMoney(invoice.total)}</div>
          {invoice.created_at && <div className="text-xs text-gray-500">{fmtDate(invoice.created_at)}</div>}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3">
          <InvoiceDetail
            invoice={invoice}
            lineItems={lineItemsMap[invoice.id] ?? []}
            isSender={isSender}
            orgMap={orgMap}
            onStatusChange={(s) => onStatusChange(invoice, s)}
            onMarkPaid={() => onMarkPaid(invoice)}
          />
        </div>
      )}
    </div>
  )
}
