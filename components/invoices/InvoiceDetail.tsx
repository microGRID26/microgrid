'use client'

import { useEffect, useState } from 'react'
import { fmtDate, fmt$ } from '@/lib/utils'
import type { Invoice, InvoiceLineItem, InvoiceStatus } from '@/lib/api/invoices'
import { Send, CheckCircle, Ban, AlertTriangle, Zap, RefreshCw, FileText } from 'lucide-react'

// ── Invoice Detail (Expandable Row) ──────────────────────────────────────────

export function InvoiceDetail({
  invoice,
  lineItems,
  isSender,
  orgMap,
  onStatusChange,
  onMarkPaid,
  onOpenProject,
  onChainRegenerated,
}: {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  isSender: boolean
  orgMap: Record<string, string>
  onStatusChange: (status: InvoiceStatus) => void
  onMarkPaid: () => void
  onOpenProject?: (projectId: string) => void
  /** Optional: parent passes this so the invoice list can refetch after a
   *  successful chain regen. M5 — Mark/Greg call 2026-05-08, action #670. */
  onChainRegenerated?: (newSnapshotId: string, createdCount: number) => void
}) {
  // ── M5 drift detection ────────────────────────────────────────────────
  // Chain invoices (rule_id != null) carry a snapshot_id from mig 251. If
  // the project's currently-active snapshot != this invoice's snapshot,
  // Paul's model changed since this was generated — surface the popup.
  const isChainInvoice = invoice.rule_id != null && invoice.snapshot_id != null
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null)
  const [driftDismissed, setDriftDismissed] = useState(false)
  const [regenLoading, setRegenLoading] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  // finance-auditor R1 M2 (2026-05-09): surface "couldn't check for updates"
  // if the cost-basis fetch fails (commonly: expired JWT). Otherwise the
  // banner silently never shows and the user sends a stale invoice without
  // realizing it. feedback_silent_401_jwt_expiry.md anchor.
  const [driftCheckFailed, setDriftCheckFailed] = useState(false)

  useEffect(() => {
    if (!isChainInvoice || !invoice.project_id) return
    let cancelled = false
    const fetchActive = async () => {
      try {
        const res = await fetch(
          `/api/projects/${invoice.project_id}/cost-basis`,
          { cache: 'no-store' },
        )
        if (!res.ok) {
          if (!cancelled) setDriftCheckFailed(true)
          return
        }
        const json = (await res.json()) as { activeSnapshotId?: string | null; lineItems?: Array<{ snapshot_id?: string }> }
        const sid = json.activeSnapshotId
          ?? (json.lineItems?.[0]?.snapshot_id ?? null)
        if (!cancelled) {
          setActiveSnapshotId(sid ?? null)
          setDriftCheckFailed(false)
        }
      } catch {
        if (!cancelled) setDriftCheckFailed(true)
      }
    }
    void fetchActive()
    return () => { cancelled = true }
  }, [invoice.project_id, isChainInvoice])

  const isStale = isChainInvoice
    && activeSnapshotId != null
    && invoice.snapshot_id != null
    && activeSnapshotId !== invoice.snapshot_id

  const regenChain = async () => {
    if (!invoice.project_id) return
    setRegenLoading(true)
    setRegenError(null)
    try {
      const res = await fetch(`/api/projects/${invoice.project_id}/regen-chain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: `M5 invoice-open regen from ${invoice.invoice_number}` }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { snapshot_id: string; created: Array<unknown> }
      onChainRegenerated?.(json.snapshot_id, json.created.length)
      // Hide the banner — it will not re-appear since the new active
      // snapshot now matches the freshly-stamped new invoices. The OLD
      // invoice (this one) will continue to surface drift on next open
      // because its snapshot_id is now historical — which is correct UX.
      setDriftDismissed(true)
    } catch (e) {
      setRegenError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setRegenLoading(false)
    }
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mt-2 space-y-3">
      {/* finance-auditor M2: subtle indicator when drift check fails (e.g.
          expired JWT). Without this the banner silently never shows. */}
      {isChainInvoice && driftCheckFailed && (
        <div className="text-[11px] text-gray-500 italic">
          Couldn't check for model updates (auth or network issue). Refresh to retry.
        </div>
      )}

      {/* M5 drift banner — fires when invoice's source snapshot != project's
          active snapshot. Mark/Greg call 2026-05-08, action #670. Mark
          explicit: opt-in only, never auto-regen, never overwrite history. */}
      {isStale && !driftDismissed && (
        <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">
              Pricing in the model has changed since this invoice was generated
            </div>
            <div className="text-amber-200/70 mt-1">
              Paul's project cost schedule has been updated. You can generate
              a new chain invoice with today's rates — the existing one will
              be preserved as history.
            </div>
            {regenError && (
              <div className="text-red-300 text-[11px] mt-2">
                Failed to regenerate: {regenError}
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                onClick={regenChain}
                disabled={regenLoading}
                className="px-3 py-1 text-xs font-medium text-white bg-amber-700 hover:bg-amber-600 rounded transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {regenLoading ? (
                  <>Generating…</>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" />
                    Generate new chain invoices
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDriftDismissed(true)}
                disabled={regenLoading}
                className="px-3 py-1 text-xs text-amber-300 border border-amber-800 hover:bg-amber-900/40 rounded transition-colors disabled:opacity-50"
              >
                Keep current
              </button>
            </div>
          </div>
        </div>
      )}

      {invoice.generated_by === 'rule' && (
        <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-800 rounded px-3 py-2">
          <Zap className="w-3 h-3 text-amber-400" />
          <span className="text-xs text-amber-300">
            Auto-generated from invoice rule — review before sending
          </span>
        </div>
      )}
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
        {/* View PDF — read-only render, no state change. Available on every status. */}
        <button
          onClick={() => window.open(`/api/invoices/${invoice.id}/preview-pdf`, '_blank', 'noopener')}
          className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center gap-1"
          title="Open the rendered PDF in a new tab — does NOT send the invoice"
        >
          <FileText className="w-3 h-3" /> View PDF
        </button>
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
        {invoice.project_id && onOpenProject && (
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

