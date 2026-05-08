'use client'

import { useEffect, useState } from 'react'
import { updateInvoiceStatus } from '@/lib/api/invoices'
import type { Invoice } from '@/lib/api/invoices'
import { fmt$ } from '@/lib/utils'
import { X } from 'lucide-react'

// ── Mark Paid Modal ──────────────────────────────────────────────────────────

export function MarkPaidModal({
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
              max={invoice.total}
              step="0.01"
              value={paidAmount}
              onChange={e => setPaidAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
            {paidAmount > invoice.total && (
              <p className="text-xs text-amber-400 mt-1">
                ⚠ Amount exceeds invoice total ({fmt$(invoice.total)}). Use the invoice total or refuse to overpay.
              </p>
            )}
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

