'use client'

import { fmtDate, fmt$ } from '@/lib/utils'
import type { Invoice, InvoiceLineItem, InvoiceStatus } from '@/lib/api/invoices'
import { Send, CheckCircle, Ban, AlertTriangle, Zap } from 'lucide-react'

// ── Invoice Detail (Expandable Row) ──────────────────────────────────────────

export function InvoiceDetail({
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
  onOpenProject?: (projectId: string) => void
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mt-2 space-y-3">
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

