import { describe, it, expect } from 'vitest'

import { classifyInvoice, partitionInvoices } from '@/components/project/InvoicesTab'
import type { Invoice } from '@/lib/api/invoices'

function inv(invoice_number: string, overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: `id-${invoice_number}`,
    invoice_number,
    project_id: 'PROJ-29087',
    from_org: 'org-a',
    to_org: 'org-b',
    status: 'draft',
    milestone: 'ntp',
    subtotal: 1000,
    tax: 0,
    total: 1000,
    due_date: '2026-05-20',
    sent_at: null,
    viewed_at: null,
    paid_at: null,
    paid_amount: null,
    payment_method: null,
    payment_reference: null,
    notes: null,
    generated_by: 'rule',
    rule_id: null,
    created_by: null,
    created_by_id: null,
    created_at: '2026-04-20T10:00:00Z',
    updated_at: '2026-04-20T10:00:00Z',
    ...overrides,
  } as Invoice
}

describe('classifyInvoice', () => {
  it('classifies INV-YYYYMMDD-NNN as milestone', () => {
    expect(classifyInvoice(inv('INV-20260420-001'))).toBe('milestone')
  })

  it('classifies CHN-YYYYMMDD-NNN as chain', () => {
    expect(classifyInvoice(inv('CHN-20260420-005'))).toBe('chain')
  })

  it('classifies any other prefix as other', () => {
    expect(classifyInvoice(inv('MANUAL-001'))).toBe('other')
    expect(classifyInvoice(inv('LEG-2024-99'))).toBe('other')
  })

  it('handles empty invoice_number safely', () => {
    expect(classifyInvoice({ invoice_number: '' } as Invoice)).toBe('other')
  })

  it('does not confuse a description that includes INV- mid-string', () => {
    expect(classifyInvoice(inv('X-INV-MANUAL'))).toBe('other')
  })
})

describe('partitionInvoices', () => {
  it('returns empty buckets when no invoices', () => {
    const result = partitionInvoices([])
    expect(result.milestone).toEqual([])
    expect(result.chain).toEqual([])
    expect(result.other).toEqual([])
  })

  it('buckets 3 milestone + 5 chain + 1 other correctly', () => {
    const invoices = [
      inv('INV-20260420-001', { milestone: 'ntp' }),
      inv('INV-20260420-002', { milestone: 'installation' }),
      inv('INV-20260420-003', { milestone: 'pto' }),
      inv('CHN-20260420-001'),
      inv('CHN-20260420-002'),
      inv('CHN-20260420-003'),
      inv('CHN-20260420-004'),
      inv('CHN-20260420-005'),
      inv('MANUAL-9999'),
    ]
    const result = partitionInvoices(invoices)
    expect(result.milestone).toHaveLength(3)
    expect(result.chain).toHaveLength(5)
    expect(result.other).toHaveLength(1)
  })

  it('preserves input order within each bucket', () => {
    const a = inv('INV-A')
    const b = inv('INV-B')
    const c = inv('CHN-C')
    const result = partitionInvoices([c, a, b]) // chain first, then two milestones
    expect(result.milestone.map((i) => i.invoice_number)).toEqual(['INV-A', 'INV-B'])
    expect(result.chain.map((i) => i.invoice_number)).toEqual(['CHN-C'])
  })

  it('is pure — does not mutate input array', () => {
    const invoices = [inv('INV-1'), inv('CHN-1')]
    const snapshot = [...invoices]
    partitionInvoices(invoices)
    expect(invoices).toEqual(snapshot)
  })
})
