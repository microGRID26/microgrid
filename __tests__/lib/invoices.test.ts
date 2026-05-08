import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockSupabase } from '../../vitest.setup'

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    like: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: any) => Promise.resolve(result).then(cb)),
  }
  return chain
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'INV-20260328-001',
  project_id: 'PROJ-00001',
  from_org: 'org-eng-1',
  to_org: 'org-epc-1',
  status: 'draft',
  milestone: null,
  subtotal: 5000,
  tax: 0,
  total: 5000,
  due_date: '2026-04-28',
  notes: null,
  sent_at: null,
  viewed_at: null,
  paid_at: null,
  paid_amount: null,
  payment_method: null,
  payment_reference: null,
  created_by: 'Jane Engineer',
  created_by_id: 'user-eng-1',
  created_at: '2026-03-28T12:00:00Z',
  updated_at: '2026-03-28T12:00:00Z',
}

const INVOICE_SENT = {
  ...INVOICE,
  id: 'inv-2',
  invoice_number: 'INV-20260328-002',
  status: 'sent',
  sent_at: '2026-03-28T14:00:00Z',
}

const INVOICE_PAID = {
  ...INVOICE,
  id: 'inv-3',
  status: 'paid',
  paid_at: '2026-03-30T10:00:00Z',
  paid_amount: 5000,
}

const LINE_ITEM = {
  id: 'li-1',
  invoice_id: 'inv-1',
  description: 'Plan set design — new residential',
  quantity: 1,
  unit_price: 3000,
  total: 3000,
  category: 'design',
  sort_order: 0,
  created_at: '2026-03-28T12:00:00Z',
}

const LINE_ITEM_2 = {
  id: 'li-2',
  invoice_id: 'inv-1',
  description: 'Engineering stamp',
  quantity: 1,
  unit_price: 2000,
  total: 2000,
  category: 'stamp',
  sort_order: 1,
  created_at: '2026-03-28T12:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  // clearAllMocks doesn't drain mockReturnValueOnce / mockImplementationOnce
  // queues — leftovers from a prior test that aborted before consuming all
  // queued mocks will leak into the next test and corrupt its first from()
  // call. Reset and reinstall the default chainable behavior.
  mockSupabase.from.mockReset()
  mockSupabase.from.mockImplementation(() => mockChain({ data: null, error: null }))
  mockSupabase.rpc.mockReset()
  mockSupabase.rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }) as any)
})

// ── Constants ────────────────────────────────────────────────────────────────

describe('Invoice constants', () => {
  it('exports all invoice statuses', async () => {
    const { INVOICE_STATUSES } = await import('@/lib/api/invoices')
    expect(INVOICE_STATUSES).toEqual([
      'draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled', 'disputed',
    ])
  })

  it('exports status labels for all statuses', async () => {
    const { INVOICE_STATUS_LABELS, INVOICE_STATUSES } = await import('@/lib/api/invoices')
    for (const s of INVOICE_STATUSES) {
      expect(INVOICE_STATUS_LABELS[s]).toBeDefined()
    }
    expect(Object.keys(INVOICE_STATUS_LABELS)).toHaveLength(7)
  })

  it('exports status badges for all statuses', async () => {
    const { INVOICE_STATUS_BADGE, INVOICE_STATUSES } = await import('@/lib/api/invoices')
    for (const s of INVOICE_STATUSES) {
      expect(INVOICE_STATUS_BADGE[s]).toBeDefined()
      expect(INVOICE_STATUS_BADGE[s]).toContain('bg-')
      expect(INVOICE_STATUS_BADGE[s]).toContain('text-')
    }
  })
})

// ── loadInvoices ─────────────────────────────────────────────────────────────

describe('loadInvoices', () => {
  it('loads all invoices without filters', async () => {
    const chain = mockChain({ data: [INVOICE, INVOICE_SENT], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadInvoices } = await import('@/lib/api/invoices')
    const result = await loadInvoices()

    expect(mockSupabase.from).toHaveBeenCalledWith('invoices')
    expect(chain.select).toHaveBeenCalled()
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(500)
    expect(chain.or).not.toHaveBeenCalled()
    expect(chain.eq).not.toHaveBeenCalled()
    expect(result).toHaveLength(2)
  })

  it('filters by org when orgId provided', async () => {
    const chain = mockChain({ data: [INVOICE], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadInvoices } = await import('@/lib/api/invoices')
    await loadInvoices('org-epc-1')

    expect(chain.or).toHaveBeenCalledWith('from_org.eq.org-epc-1,to_org.eq.org-epc-1')
  })

  it('filters by status when status provided', async () => {
    const chain = mockChain({ data: [INVOICE], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadInvoices } = await import('@/lib/api/invoices')
    await loadInvoices(undefined, 'draft')

    expect(chain.eq).toHaveBeenCalledWith('status', 'draft')
  })

  it('applies both org and status filters', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadInvoices } = await import('@/lib/api/invoices')
    await loadInvoices('org-epc-1', 'sent')

    expect(chain.or).toHaveBeenCalledWith('from_org.eq.org-epc-1,to_org.eq.org-epc-1')
    expect(chain.eq).toHaveBeenCalledWith('status', 'sent')
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'db error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadInvoices } = await import('@/lib/api/invoices')
    const result = await loadInvoices()

    expect(result).toEqual([])
  })
})

// ── loadInvoice ──────────────────────────────────────────────────────────────

describe('loadInvoice', () => {
  it('loads invoice with its line items via parallel queries', async () => {
    // loadInvoice makes two parallel from() calls — one for invoice, one for line items
    const invChain = mockChain({ data: INVOICE, error: null })
    const itemsChain = mockChain({ data: [LINE_ITEM, LINE_ITEM_2], error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (table === 'invoices') return invChain
      if (table === 'invoice_line_items') return itemsChain
      return invChain
    })

    const { loadInvoice } = await import('@/lib/api/invoices')
    const result = await loadInvoice('inv-1')

    expect(mockSupabase.from).toHaveBeenCalledWith('invoices')
    expect(mockSupabase.from).toHaveBeenCalledWith('invoice_line_items')
    expect(invChain.eq).toHaveBeenCalledWith('id', 'inv-1')
    expect(itemsChain.eq).toHaveBeenCalledWith('invoice_id', 'inv-1')
    expect(itemsChain.order).toHaveBeenCalledWith('sort_order', { ascending: true })
    expect(result).toEqual({
      invoice: INVOICE,
      lineItems: [LINE_ITEM, LINE_ITEM_2],
    })
  })

  it('returns null when invoice not found', async () => {
    const invChain = mockChain({ data: null, error: { message: 'not found' } })
    const itemsChain = mockChain({ data: [], error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'invoices') return invChain
      return itemsChain
    })

    const { loadInvoice } = await import('@/lib/api/invoices')
    const result = await loadInvoice('inv-999')

    expect(result).toBeNull()
  })
})

// ── loadProjectInvoices ──────────────────────────────────────────────────────

describe('loadProjectInvoices', () => {
  it('loads all invoices for a project', async () => {
    const chain = mockChain({ data: [INVOICE, INVOICE_SENT], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectInvoices } = await import('@/lib/api/invoices')
    const result = await loadProjectInvoices('PROJ-00001')

    expect(mockSupabase.from).toHaveBeenCalledWith('invoices')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-00001')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(50)
    expect(result).toHaveLength(2)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'db error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectInvoices } = await import('@/lib/api/invoices')
    const result = await loadProjectInvoices('PROJ-00001')

    expect(result).toEqual([])
  })
})

// ── generateInvoiceNumber ────────────────────────────────────────────────────

describe('generateInvoiceNumber', () => {
  it('generates INV-YYYYMMDD-001 when no existing invoices for today', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generateInvoiceNumber } = await import('@/lib/api/invoices')
    const result = await generateInvoiceNumber()

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    expect(result).toBe(`INV-${today}-001`)
    expect(chain.like).toHaveBeenCalledWith('invoice_number', `INV-${today}-%`)
  })

  it('increments the number when existing invoices exist', async () => {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const chain = mockChain({ data: [{ invoice_number: `INV-${today}-005` }], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generateInvoiceNumber } = await import('@/lib/api/invoices')
    const result = await generateInvoiceNumber()

    expect(result).toBe(`INV-${today}-006`)
  })

  it('pads the number to 3 digits', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generateInvoiceNumber } = await import('@/lib/api/invoices')
    const result = await generateInvoiceNumber()

    // Should end in -001
    expect(result).toMatch(/-\d{3}$/)
  })
})

// ── createInvoice ────────────────────────────────────────────────────────────

describe('createInvoice', () => {
  it('creates an invoice with line items and calculated totals', async () => {
    // First call: insert invoice
    const invChain = mockChain({ data: INVOICE, error: null })
    // Second call: insert line items
    const itemsChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      return callCount === 1 ? invChain : itemsChain
    })

    const { createInvoice } = await import('@/lib/api/invoices')
    const result = await createInvoice(
      {
        invoice_number: 'INV-20260328-001',
        project_id: 'PROJ-00001',
        from_org: 'org-eng-1',
        to_org: 'org-epc-1',
      },
      [
        { description: 'Design', quantity: 1, unit_price: 3000 },
        { description: 'Stamp', quantity: 1, unit_price: 2000 },
      ],
    )

    // Verify invoice insert with calculated totals (3000 + 2000 = 5000)
    expect(invChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      invoice_number: 'INV-20260328-001',
      project_id: 'PROJ-00001',
      from_org: 'org-eng-1',
      to_org: 'org-epc-1',
      status: 'draft',
      subtotal: 5000,
      tax: 0,
      total: 5000,
    }))
    expect(invChain.select).toHaveBeenCalled()

    // Verify line items insert
    expect(itemsChain.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Design', quantity: 1, unit_price: 3000, total: 3000, sort_order: 0 }),
        expect.objectContaining({ description: 'Stamp', quantity: 1, unit_price: 2000, total: 2000, sort_order: 1 }),
      ]),
    )

    expect(result).toEqual(INVOICE)
  })

  it('creates an invoice with no line items', async () => {
    const invChain = mockChain({ data: INVOICE, error: null })
    mockSupabase.from.mockReturnValue(invChain)

    const { createInvoice } = await import('@/lib/api/invoices')
    const result = await createInvoice(
      {
        invoice_number: 'INV-20260328-001',
        project_id: null,
        from_org: 'org-eng-1',
        to_org: 'org-epc-1',
      },
      [],
    )

    expect(invChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: 0,
      total: 0,
    }))
    // Should only be called once (no line items insert)
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
    expect(result).toEqual(INVOICE)
  })

  it('uses optional fields when provided', async () => {
    const invChain = mockChain({ data: INVOICE, error: null })
    mockSupabase.from.mockReturnValue(invChain)

    const { createInvoice } = await import('@/lib/api/invoices')
    await createInvoice(
      {
        invoice_number: 'INV-20260328-001',
        project_id: 'PROJ-00001',
        from_org: 'org-eng-1',
        to_org: 'org-epc-1',
        milestone: 'design_complete',
        due_date: '2026-04-28',
        notes: 'Net 30',
        created_by: 'Jane',
        created_by_id: 'user-eng-1',
      },
      [],
    )

    expect(invChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      milestone: 'design_complete',
      due_date: '2026-04-28',
      notes: 'Net 30',
      created_by: 'Jane',
      created_by_id: 'user-eng-1',
    }))
  })

  it('returns null on invoice insert error', async () => {
    const chain = mockChain({ data: null, error: { message: 'insert error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { createInvoice } = await import('@/lib/api/invoices')
    const result = await createInvoice(
      { invoice_number: 'INV-X', project_id: null, from_org: 'a', to_org: 'b' },
      [{ description: 'x', quantity: 1, unit_price: 100 }],
    )

    expect(result).toBeNull()
  })
})

// ── updateInvoiceStatus ──────────────────────────────────────────────────────

describe('updateInvoiceStatus', () => {
  it('sets sent_at when status is sent', async () => {
    // First .from() call reads current status, second .from() call does the update
    const readChain = mockChain({ data: { status: 'draft' }, error: null })
    const updateChain = mockChain({ data: INVOICE_SENT, error: null })
    mockSupabase.from
      .mockReturnValueOnce(readChain)   // status read
      .mockReturnValueOnce(updateChain) // update

    const { updateInvoiceStatus } = await import('@/lib/api/invoices')
    const result = await updateInvoiceStatus('inv-1', 'sent')

    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'sent',
      sent_at: expect.any(String),
    }))
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'inv-1')
    expect(result).toBeTruthy()
  })

  it('routes paid transitions through apply_paid_invoice RPC with paid_at', async () => {
    // #613: paid path moved to apply_paid_invoice RPC (atomic invoice + funding-
    // deduction TX). The non-paid `update()` shape is no longer hit on this path.
    const readChain = mockChain({ data: { status: 'sent' }, error: null })
    mockSupabase.from.mockReturnValueOnce(readChain)
    const rpcSingle = vi.fn(() => Promise.resolve({
      data: { invoice: INVOICE_PAID, applied_ids: [], total_deducted: 0, net_amount: 5000, gross_amount: 5000 },
      error: null,
    }))
    mockSupabase.rpc.mockReturnValueOnce({ single: rpcSingle } as any)

    const { updateInvoiceStatus } = await import('@/lib/api/invoices')
    await updateInvoiceStatus('inv-1', 'paid')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('apply_paid_invoice', expect.objectContaining({
      p_invoice_id: 'inv-1',
      p_current_status: 'sent',
      p_paid_at: expect.any(String),
    }))
  })

  it('passes payment details through the RPC when paid with details', async () => {
    const readChain = mockChain({ data: { status: 'sent' }, error: null })
    mockSupabase.from.mockReturnValueOnce(readChain)
    const rpcSingle = vi.fn(() => Promise.resolve({
      data: { invoice: INVOICE_PAID, applied_ids: [], total_deducted: 0, net_amount: 5000, gross_amount: 5000 },
      error: null,
    }))
    mockSupabase.rpc.mockReturnValueOnce({ single: rpcSingle } as any)

    const { updateInvoiceStatus } = await import('@/lib/api/invoices')
    await updateInvoiceStatus('inv-1', 'paid', {
      paid_amount: 5000,
      payment_method: 'ACH',
      payment_reference: 'REF-12345',
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith('apply_paid_invoice', expect.objectContaining({
      p_invoice_id: 'inv-1',
      p_current_status: 'sent',
      p_paid_at: expect.any(String),
      p_payment_method: 'ACH',
      p_payment_reference: 'REF-12345',
      p_explicit_paid_amount: 5000,
    }))
  })

  it('does not set timestamps for non-special statuses', async () => {
    // sent → viewed is a valid transition
    const readChain = mockChain({ data: { status: 'sent' }, error: null })
    const updateChain = mockChain({ data: { ...INVOICE, status: 'viewed' }, error: null })
    mockSupabase.from
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(updateChain)

    const { updateInvoiceStatus } = await import('@/lib/api/invoices')
    await updateInvoiceStatus('inv-1', 'viewed')

    const updateArg = updateChain.update.mock.calls[0][0]
    expect(updateArg).toEqual({ status: 'viewed' })
    expect(updateArg).not.toHaveProperty('sent_at')
    expect(updateArg).not.toHaveProperty('paid_at')
  })

  it('returns null for invalid transition', async () => {
    // paid is terminal — cannot transition to sent
    const readChain = mockChain({ data: { status: 'paid' }, error: null })
    mockSupabase.from.mockReturnValueOnce(readChain)

    const { updateInvoiceStatus } = await import('@/lib/api/invoices')
    const result = await updateInvoiceStatus('inv-1', 'sent')

    expect(result).toBeNull()
  })

  it('returns null on error', async () => {
    const readChain = mockChain({ data: { status: 'draft' }, error: null })
    const updateChain = mockChain({ data: null, error: { message: 'update error' } })
    mockSupabase.from
      .mockReturnValueOnce(readChain)
      .mockReturnValueOnce(updateChain)

    const { updateInvoiceStatus } = await import('@/lib/api/invoices')
    const result = await updateInvoiceStatus('inv-1', 'sent')

    expect(result).toBeNull()
  })
})

// ── addLineItem ──────────────────────────────────────────────────────────────

describe('addLineItem', () => {
  it('adds a line item with next sort_order and recalculates totals', async () => {
    // Call 1: read existing sort_order
    const readChain = mockChain({ data: [{ sort_order: 2 }], error: null })
    // Call 2: insert new line item
    const insertChain = mockChain({ data: LINE_ITEM, error: null })
    // Call 3: recalc — read all line item totals (Promise.all)
    const recalcReadChain = mockChain({ data: [{ total: 3000 }, { total: 2000 }, { total: 1500 }], error: null })
    // Call 4: recalc — read invoice tax (Promise.all)
    const recalcTaxChain = mockChain({ data: { tax: 0 }, error: null })
    // Call 5: recalc — update invoice totals
    const recalcWriteChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return readChain
      if (callCount === 2) return insertChain
      if (callCount === 3) return recalcReadChain
      if (callCount === 4) return recalcTaxChain
      return recalcWriteChain
    })

    const { addLineItem } = await import('@/lib/api/invoices')
    const result = await addLineItem('inv-1', {
      description: 'Additional review',
      quantity: 1,
      unit_price: 1500,
    })

    // Verify read existing sort_order
    expect(readChain.eq).toHaveBeenCalledWith('invoice_id', 'inv-1')
    expect(readChain.order).toHaveBeenCalledWith('sort_order', { ascending: false })

    // Verify insert with sort_order = 3 (existing max 2 + 1)
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      invoice_id: 'inv-1',
      description: 'Additional review',
      quantity: 1,
      unit_price: 1500,
      total: 1500,
      sort_order: 3,
    }))

    expect(result).toEqual(LINE_ITEM)
  })

  it('uses sort_order 0 when no existing items', async () => {
    const readChain = mockChain({ data: [], error: null })
    const insertChain = mockChain({ data: LINE_ITEM, error: null })
    const recalcReadChain = mockChain({ data: [{ total: 3000 }], error: null })
    const recalcTaxChain = mockChain({ data: { tax: 0 }, error: null })
    const recalcWriteChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return readChain
      if (callCount === 2) return insertChain
      if (callCount === 3) return recalcReadChain
      if (callCount === 4) return recalcTaxChain
      return recalcWriteChain
    })

    const { addLineItem } = await import('@/lib/api/invoices')
    await addLineItem('inv-1', { description: 'First item', quantity: 1, unit_price: 3000 })

    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      sort_order: 0,
    }))
  })

  it('returns null on insert error', async () => {
    const readChain = mockChain({ data: [], error: null })
    const insertChain = mockChain({ data: null, error: { message: 'insert error' } })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      return callCount === 1 ? readChain : insertChain
    })

    const { addLineItem } = await import('@/lib/api/invoices')
    const result = await addLineItem('inv-1', { description: 'x', quantity: 1, unit_price: 100 })

    expect(result).toBeNull()
  })
})

// ── deleteLineItem ───────────────────────────────────────────────────────────

describe('deleteLineItem', () => {
  it('deletes a line item and recalculates totals', async () => {
    // Call 1: delete
    const deleteChain = mockChain({ data: null, error: null })
    // Call 2: recalc — read line item totals (Promise.all)
    const recalcReadChain = mockChain({ data: [{ total: 2000 }], error: null })
    // Call 3: recalc — read invoice tax (Promise.all)
    const recalcTaxChain = mockChain({ data: { tax: 0 }, error: null })
    // Call 4: recalc — update invoice totals
    const recalcWriteChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return deleteChain
      if (callCount === 2) return recalcReadChain
      if (callCount === 3) return recalcTaxChain
      return recalcWriteChain
    })

    const { deleteLineItem } = await import('@/lib/api/invoices')
    const result = await deleteLineItem('li-1', 'inv-1')

    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'li-1')
    expect(result).toBe(true)
  })

  it('returns false on delete error', async () => {
    const chain = mockChain({ data: null, error: { message: 'delete error' } })
    mockSupabase.from.mockReturnValue(chain)

    const { deleteLineItem } = await import('@/lib/api/invoices')
    const result = await deleteLineItem('li-999', 'inv-1')

    expect(result).toBe(false)
  })
})

// ── getValidInvoiceTransitions ──────────────────────────────────────────────

describe('getValidInvoiceTransitions', () => {
  it('returns correct transitions for draft', async () => {
    const { getValidInvoiceTransitions } = await import('@/lib/api/invoices')
    expect(getValidInvoiceTransitions('draft')).toEqual(['sent', 'cancelled'])
  })

  it('returns correct transitions for sent', async () => {
    const { getValidInvoiceTransitions } = await import('@/lib/api/invoices')
    expect(getValidInvoiceTransitions('sent')).toEqual(['viewed', 'paid', 'overdue', 'cancelled', 'disputed'])
  })

  it('returns correct transitions for viewed', async () => {
    const { getValidInvoiceTransitions } = await import('@/lib/api/invoices')
    expect(getValidInvoiceTransitions('viewed')).toEqual(['paid', 'overdue', 'cancelled', 'disputed'])
  })

  it('returns correct transitions for overdue', async () => {
    const { getValidInvoiceTransitions } = await import('@/lib/api/invoices')
    expect(getValidInvoiceTransitions('overdue')).toEqual(['paid', 'cancelled', 'disputed'])
  })

  it('returns correct transitions for disputed', async () => {
    const { getValidInvoiceTransitions } = await import('@/lib/api/invoices')
    expect(getValidInvoiceTransitions('disputed')).toEqual(['sent', 'cancelled'])
  })

  it('returns empty array for terminal status paid', async () => {
    const { getValidInvoiceTransitions } = await import('@/lib/api/invoices')
    expect(getValidInvoiceTransitions('paid')).toEqual([])
  })

  it('returns empty array for terminal status cancelled', async () => {
    const { getValidInvoiceTransitions } = await import('@/lib/api/invoices')
    expect(getValidInvoiceTransitions('cancelled')).toEqual([])
  })
})
