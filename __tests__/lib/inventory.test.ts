import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockSupabase } from '../../vitest.setup'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a chainable mock that resolves to the given result on await */
function mockChain(result: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    in: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
    like: vi.fn(() => chain),
    or: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: vi.fn((cb: any) => Promise.resolve(result).then(cb)),
  }
  return chain
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── loadProjectMaterials ────────────────────────────────────────────────────

describe('loadProjectMaterials', () => {
  it('returns materials for a project', async () => {
    const materials = [
      { id: 'm1', project_id: 'PROJ-001', name: 'Panel X', category: 'module', quantity: 20, status: 'needed' },
      { id: 'm2', project_id: 'PROJ-001', name: 'Inverter Y', category: 'inverter', quantity: 1, status: 'ordered' },
    ]
    const chain = mockChain({ data: materials, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectMaterials } = await import('@/lib/api/inventory')
    const result = await loadProjectMaterials('PROJ-001')

    expect(mockSupabase.from).toHaveBeenCalledWith('project_materials')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-001')
    expect(chain.order).toHaveBeenCalledWith('category')
    expect(result).toEqual(materials)
    expect(result).toHaveLength(2)
  })

  it('returns empty array when no materials exist', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectMaterials } = await import('@/lib/api/inventory')
    const result = await loadProjectMaterials('PROJ-999')

    expect(result).toEqual([])
  })

  it('returns empty array and logs error on failure', async () => {
    const error = { message: 'connection failed' }
    const chain = mockChain({ data: null, error })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadProjectMaterials } = await import('@/lib/api/inventory')
    const result = await loadProjectMaterials('PROJ-001')

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith('[loadProjectMaterials]', 'connection failed')
    consoleSpy.mockRestore()
  })
})

// ── addProjectMaterial ──────────────────────────────────────────────────────

describe('addProjectMaterial', () => {
  it('inserts a material and returns the created item', async () => {
    const newMaterial = {
      project_id: 'PROJ-001',
      equipment_id: null,
      name: 'MC4 Connectors',
      category: 'electrical',
      quantity: 50,
      unit: 'each',
      source: 'warehouse',
      vendor: null,
      status: 'needed',
      po_number: null,
      expected_date: null,
      delivered_date: null,
      notes: null,
    }
    const created = { ...newMaterial, id: 'mat-abc', created_at: '2026-03-25', updated_at: '2026-03-25' }
    const chain = mockChain({ data: created, error: null })
    chain.single = vi.fn(() => Promise.resolve({ data: created, error: null }))
    mockSupabase.from.mockReturnValue(chain)

    const { addProjectMaterial } = await import('@/lib/api/inventory')
    const result = await addProjectMaterial(newMaterial)

    expect(mockSupabase.from).toHaveBeenCalledWith('project_materials')
    expect(chain.insert).toHaveBeenCalledWith(newMaterial)
    expect(chain.select).toHaveBeenCalled()
    expect(chain.single).toHaveBeenCalled()
    expect(result).toEqual(created)
  })

  it('returns null and logs error on failure', async () => {
    const error = { message: 'insert failed' }
    const chain = mockChain({ data: null, error })
    chain.single = vi.fn(() => Promise.resolve({ data: null, error }))
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { addProjectMaterial } = await import('@/lib/api/inventory')
    const result = await addProjectMaterial({
      project_id: 'PROJ-001', equipment_id: null, name: 'Test', category: 'other',
      quantity: 1, unit: 'each', source: 'tbd', vendor: null, status: 'needed',
      po_number: null, expected_date: null, delivered_date: null, notes: null,
    })

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith('[addProjectMaterial]', 'insert failed')
    consoleSpy.mockRestore()
  })
})

// ── updateProjectMaterial ───────────────────────────────────────────────────

describe('updateProjectMaterial', () => {
  it('updates fields and returns true on success', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updateProjectMaterial } = await import('@/lib/api/inventory')
    const result = await updateProjectMaterial('mat-123', { status: 'delivered', vendor: 'CED' })

    expect(mockSupabase.from).toHaveBeenCalledWith('project_materials')
    expect(chain.update).toHaveBeenCalled()
    // Verify update was called with the fields plus updated_at
    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg.status).toBe('delivered')
    expect(updateArg.vendor).toBe('CED')
    expect(updateArg.updated_at).toBeDefined()
    expect(chain.eq).toHaveBeenCalledWith('id', 'mat-123')
    expect(result).toBe(true)
  })

  it('returns false and logs error on failure', async () => {
    const error = { message: 'update failed' }
    const chain = mockChain({ data: null, error })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updateProjectMaterial } = await import('@/lib/api/inventory')
    const result = await updateProjectMaterial('mat-123', { status: 'ordered' })

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith('[updateProjectMaterial]', 'update failed')
    consoleSpy.mockRestore()
  })
})

// ── deleteProjectMaterial ───────────────────────────────────────────────────

describe('deleteProjectMaterial', () => {
  it('deletes by ID and returns true on success', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { deleteProjectMaterial } = await import('@/lib/api/inventory')
    const result = await deleteProjectMaterial('mat-123')

    expect(mockSupabase.from).toHaveBeenCalledWith('project_materials')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'mat-123')
    expect(result).toBe(true)
  })

  it('returns false and logs error on failure', async () => {
    const error = { message: 'delete failed' }
    const chain = mockChain({ data: null, error })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deleteProjectMaterial } = await import('@/lib/api/inventory')
    const result = await deleteProjectMaterial('mat-123')

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith('[deleteProjectMaterial]', 'delete failed')
    consoleSpy.mockRestore()
  })
})

// ── autoGenerateMaterials ───────────────────────────────────────────────────

describe('autoGenerateMaterials', () => {
  it('creates materials from project equipment fields', async () => {
    // First call: loadProjectMaterials returns empty (no existing)
    const emptyChain = mockChain({ data: [], error: null })
    // Second call: equipment lookup
    const equipChain = mockChain({ data: [{ id: 'eq-1', name: 'REC Alpha 400W' }], error: null })
    // Third call: insert
    const insertedMaterials = [
      { id: 'm1', name: 'REC Alpha 400W', category: 'module', quantity: 20, source: 'dropship', status: 'needed' },
      { id: 'm2', name: 'Enphase IQ8+', category: 'inverter', quantity: 20, source: 'dropship', status: 'needed' },
    ]
    const insertChain = mockChain({ data: insertedMaterials, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation((table: string) => {
      callCount++
      if (callCount === 1) return emptyChain    // loadProjectMaterials
      if (callCount === 2) return equipChain     // equipment lookup
      return insertChain                          // insert
    })

    const { autoGenerateMaterials } = await import('@/lib/api/inventory')
    const result = await autoGenerateMaterials('PROJ-001', {
      module: 'REC Alpha 400W',
      module_qty: 20,
      inverter: 'Enphase IQ8+',
      inverter_qty: 20,
      battery: null,
      battery_qty: null,
      optimizer: null,
      optimizer_qty: null,
    })

    expect(result).toEqual(insertedMaterials)
    expect(result).toHaveLength(2)
  })

  it('deduplicates against existing materials', async () => {
    // Existing materials already has the module
    const existingChain = mockChain({
      data: [{ id: 'm-exist', name: 'REC Alpha 400W', category: 'module', quantity: 20 }],
      error: null,
    })
    // Equipment lookup
    const equipChain = mockChain({ data: [{ id: 'eq-2', name: 'Enphase IQ8+' }], error: null })
    // Insert only the non-duplicate
    const insertChain = mockChain({
      data: [{ id: 'm-new', name: 'Enphase IQ8+', category: 'inverter', quantity: 1, source: 'dropship', status: 'needed' }],
      error: null,
    })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return existingChain
      if (callCount === 2) return equipChain
      return insertChain
    })

    const { autoGenerateMaterials } = await import('@/lib/api/inventory')
    const result = await autoGenerateMaterials('PROJ-001', {
      module: 'REC Alpha 400W',
      module_qty: 20,
      inverter: 'Enphase IQ8+',
      inverter_qty: 1,
      battery: null,
      battery_qty: null,
      optimizer: null,
      optimizer_qty: null,
    })

    // Only the inverter should be inserted (module already existed)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Enphase IQ8+')
  })

  it('sets dropship source for modules, inverters, and batteries', async () => {
    const emptyChain = mockChain({ data: [], error: null })
    const equipChain = mockChain({ data: [], error: null })
    const insertChain = mockChain({ data: [], error: null })
    // Capture the insert call
    insertChain.insert = vi.fn((rows: any) => {
      // Verify sources
      for (const row of rows) {
        if (['module', 'inverter', 'battery'].includes(row.category)) {
          expect(row.source).toBe('dropship')
        }
      }
      return insertChain
    })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return emptyChain
      if (callCount === 2) return equipChain
      return insertChain
    })

    const { autoGenerateMaterials } = await import('@/lib/api/inventory')
    await autoGenerateMaterials('PROJ-001', {
      module: 'Test Module',
      module_qty: 10,
      inverter: 'Test Inverter',
      inverter_qty: 1,
      battery: 'Test Battery',
      battery_qty: 2,
      optimizer: null,
      optimizer_qty: null,
    })

    expect(insertChain.insert).toHaveBeenCalled()
    const insertedRows = insertChain.insert.mock.calls[0][0]
    const moduleRow = insertedRows.find((r: any) => r.category === 'module')
    const inverterRow = insertedRows.find((r: any) => r.category === 'inverter')
    const batteryRow = insertedRows.find((r: any) => r.category === 'battery')
    expect(moduleRow.source).toBe('dropship')
    expect(inverterRow.source).toBe('dropship')
    expect(batteryRow.source).toBe('dropship')
  })

  it('sets tbd source for optimizers', async () => {
    const emptyChain = mockChain({ data: [], error: null })
    const equipChain = mockChain({ data: [], error: null })
    const insertChain = mockChain({ data: [], error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return emptyChain
      if (callCount === 2) return equipChain
      return insertChain
    })

    const { autoGenerateMaterials } = await import('@/lib/api/inventory')
    await autoGenerateMaterials('PROJ-001', {
      module: null,
      module_qty: null,
      inverter: null,
      inverter_qty: null,
      battery: null,
      battery_qty: null,
      optimizer: 'SolarEdge P505',
      optimizer_qty: 20,
    })

    expect(insertChain.insert).toHaveBeenCalled()
    const insertedRows = insertChain.insert.mock.calls[0][0]
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].category).toBe('optimizer')
    expect(insertedRows[0].source).toBe('tbd')
  })

  it('returns empty array when all equipment fields are null', async () => {
    const emptyChain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(emptyChain)

    const { autoGenerateMaterials } = await import('@/lib/api/inventory')
    const result = await autoGenerateMaterials('PROJ-001', {
      module: null,
      module_qty: null,
      inverter: null,
      inverter_qty: null,
      battery: null,
      battery_qty: null,
      optimizer: null,
      optimizer_qty: null,
    })

    expect(result).toEqual([])
  })

  it('skips equipment with zero quantity', async () => {
    const emptyChain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(emptyChain)

    const { autoGenerateMaterials } = await import('@/lib/api/inventory')
    const result = await autoGenerateMaterials('PROJ-001', {
      module: 'REC Alpha 400W',
      module_qty: 0,
      inverter: 'Enphase IQ8+',
      inverter_qty: 0,
      battery: null,
      battery_qty: null,
      optimizer: null,
      optimizer_qty: null,
    })

    expect(result).toEqual([])
  })

  it('returns empty array on insert error', async () => {
    const emptyChain = mockChain({ data: [], error: null })
    const equipChain = mockChain({ data: [], error: null })
    const errorChain = mockChain({ data: null, error: { message: 'insert failed' } })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return emptyChain
      if (callCount === 2) return equipChain
      return errorChain
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { autoGenerateMaterials } = await import('@/lib/api/inventory')
    const result = await autoGenerateMaterials('PROJ-001', {
      module: 'Panel X',
      module_qty: 10,
      inverter: null, inverter_qty: null,
      battery: null, battery_qty: null,
      optimizer: null, optimizer_qty: null,
    })

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith('[autoGenerateMaterials]', 'insert failed')
    consoleSpy.mockRestore()
  })
})

// ── loadWarehouseStock ──────────────────────────────────────────────────────

describe('loadWarehouseStock', () => {
  it('returns all stock when no category filter', async () => {
    const stock = [
      { id: 'ws-1', name: 'MC4 Connectors', category: 'electrical', quantity_on_hand: 500 },
      { id: 'ws-2', name: 'Rail Mount', category: 'racking', quantity_on_hand: 200 },
    ]
    const chain = mockChain({ data: stock, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadWarehouseStock } = await import('@/lib/api/inventory')
    const result = await loadWarehouseStock()

    expect(mockSupabase.from).toHaveBeenCalledWith('warehouse_stock')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.order).toHaveBeenCalledWith('category')
    expect(result).toEqual(stock)
    expect(result).toHaveLength(2)
  })

  it('filters by category when provided', async () => {
    const stock = [{ id: 'ws-1', name: 'MC4 Connectors', category: 'electrical', quantity_on_hand: 500 }]
    const chain = mockChain({ data: stock, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadWarehouseStock } = await import('@/lib/api/inventory')
    const result = await loadWarehouseStock('electrical')

    expect(chain.eq).toHaveBeenCalledWith('category', 'electrical')
    expect(result).toEqual(stock)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'db error' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadWarehouseStock } = await import('@/lib/api/inventory')
    const result = await loadWarehouseStock()

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith('[loadWarehouseStock]', 'db error')
    consoleSpy.mockRestore()
  })
})

// ── generatePONumber ────────────────────────────────────────────────────────

describe('generatePONumber', () => {
  it('returns PO-YYYYMMDD-001 when no existing POs for today', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generatePONumber } = await import('@/lib/api/inventory')
    const result = await generatePONumber()

    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    expect(result).toBe(`PO-${today}-001`)
    expect(mockSupabase.from).toHaveBeenCalledWith('purchase_orders')
    expect(chain.like).toHaveBeenCalled()
  })

  it('increments sequence from existing POs', async () => {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const chain = mockChain({ data: [{ po_number: `PO-${today}-005` }], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generatePONumber } = await import('@/lib/api/inventory')
    const result = await generatePONumber()

    expect(result).toBe(`PO-${today}-006`)
  })

  it('pads sequence number to 3 digits', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generatePONumber } = await import('@/lib/api/inventory')
    const result = await generatePONumber()

    // Should end with 001
    expect(result).toMatch(/PO-\d{8}-001$/)
  })
})

// ── createPurchaseOrder ─────────────────────────────────────────────────────

describe('createPurchaseOrder', () => {
  it('creates PO with line items and updates linked materials to ordered', async () => {
    const createdPO = {
      id: 'po-1',
      po_number: 'PO-20260325-001',
      vendor: 'CED Greentech',
      project_id: 'PROJ-001',
      status: 'draft',
      total_amount: null,
      created_at: '2026-03-25',
      updated_at: '2026-03-25',
    }

    // First call: create PO
    const poChain = mockChain({ data: createdPO, error: null })
    poChain.single = vi.fn(() => Promise.resolve({ data: createdPO, error: null }))
    // Second call: insert line items
    const itemsChain = mockChain({ data: null, error: null })
    // Third call: update material status
    const updateChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return poChain
      if (callCount === 2) return itemsChain
      return updateChain
    })

    const { createPurchaseOrder } = await import('@/lib/api/inventory')
    const result = await createPurchaseOrder(
      {
        po_number: 'PO-20260325-001',
        vendor: 'CED Greentech',
        project_id: 'PROJ-001',
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
      [
        { material_id: 'mat-1', equipment_id: 'eq-1', name: 'Panel X', quantity: 20, unit_price: null, total_price: null, notes: null },
      ]
    )

    expect(result).toEqual(createdPO)
    // PO was created
    expect(poChain.insert).toHaveBeenCalled()
    // Line items were inserted
    expect(itemsChain.insert).toHaveBeenCalled()
    const insertedItems = itemsChain.insert.mock.calls[0][0]
    expect(insertedItems[0].po_id).toBe('po-1')
    // Material was updated to ordered
    expect(updateChain.update).toHaveBeenCalled()
    const updateArg = updateChain.update.mock.calls[0][0]
    expect(updateArg.po_number).toBe('PO-20260325-001')
    expect(updateArg.status).toBe('ordered')
  })

  it('returns null on PO creation error', async () => {
    const chain = mockChain({ data: null, error: { message: 'PO insert failed' } })
    chain.single = vi.fn(() => Promise.resolve({ data: null, error: { message: 'PO insert failed' } }))
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { createPurchaseOrder } = await import('@/lib/api/inventory')
    const result = await createPurchaseOrder(
      {
        po_number: 'PO-20260325-001', vendor: 'Test', project_id: null,
        status: 'draft', total_amount: null, notes: null, created_by: null,
        submitted_at: null, confirmed_at: null, shipped_at: null, delivered_at: null,
        tracking_number: null, expected_delivery: null,
      },
      []
    )

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith('[createPurchaseOrder]', 'PO insert failed')
    consoleSpy.mockRestore()
  })

  it('skips line item insert when items array is empty', async () => {
    const createdPO = { id: 'po-2', po_number: 'PO-20260325-002', vendor: 'Test', status: 'draft' }
    const poChain = mockChain({ data: createdPO, error: null })
    poChain.single = vi.fn(() => Promise.resolve({ data: createdPO, error: null }))

    mockSupabase.from.mockReturnValue(poChain)

    const { createPurchaseOrder } = await import('@/lib/api/inventory')
    const result = await createPurchaseOrder(
      {
        po_number: 'PO-20260325-002', vendor: 'Test', project_id: null,
        status: 'draft', total_amount: null, notes: null, created_by: null,
        submitted_at: null, confirmed_at: null, shipped_at: null, delivered_at: null,
        tracking_number: null, expected_delivery: null,
      },
      []
    )

    expect(result).toEqual(createdPO)
    // from() called once for PO only, not for line items
    expect(mockSupabase.from).toHaveBeenCalledTimes(1)
  })

  it('skips material update for items without material_id', async () => {
    const createdPO = { id: 'po-3', po_number: 'PO-20260325-003', vendor: 'Test', status: 'draft' }
    const poChain = mockChain({ data: createdPO, error: null })
    poChain.single = vi.fn(() => Promise.resolve({ data: createdPO, error: null }))
    const itemsChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return poChain
      return itemsChain
    })

    const { createPurchaseOrder } = await import('@/lib/api/inventory')
    await createPurchaseOrder(
      {
        po_number: 'PO-20260325-003', vendor: 'Test', project_id: null,
        status: 'draft', total_amount: null, notes: null, created_by: null,
        submitted_at: null, confirmed_at: null, shipped_at: null, delivered_at: null,
        tracking_number: null, expected_delivery: null,
      },
      [{ material_id: null, equipment_id: null, name: 'Misc Item', quantity: 5, unit_price: null, total_price: null, notes: null }]
    )

    // Only 2 calls: PO insert + line items insert. No material update since material_id is null.
    expect(mockSupabase.from).toHaveBeenCalledTimes(2)
  })
})

// ── updatePurchaseOrderStatus ───────────────────────────────────────────────

describe('updatePurchaseOrderStatus', () => {
  it('advances status and sets submitted_at timestamp', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updatePurchaseOrderStatus } = await import('@/lib/api/inventory')
    const result = await updatePurchaseOrderStatus('po-1', 'submitted')

    expect(result).toBe(true)
    expect(chain.update).toHaveBeenCalled()
    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg.status).toBe('submitted')
    expect(updateArg.submitted_at).toBeDefined()
    expect(updateArg.updated_at).toBeDefined()
  })

  it('sets confirmed_at when status is confirmed', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updatePurchaseOrderStatus } = await import('@/lib/api/inventory')
    await updatePurchaseOrderStatus('po-1', 'confirmed')

    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg.confirmed_at).toBeDefined()
  })

  it('sets shipped_at when status is shipped', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updatePurchaseOrderStatus } = await import('@/lib/api/inventory')
    await updatePurchaseOrderStatus('po-1', 'shipped')

    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg.shipped_at).toBeDefined()
  })

  it('auto-updates linked materials to delivered on delivery', async () => {
    // First call: update PO status
    const updateChain = mockChain({ data: null, error: null })
    // Second call: load line items
    const lineItemsChain = mockChain({
      data: [{ material_id: 'mat-1' }, { material_id: 'mat-2' }, { material_id: null }],
      error: null,
    })
    // Remaining calls: update each material
    const matUpdateChain = mockChain({ data: null, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return updateChain
      if (callCount === 2) return lineItemsChain
      return matUpdateChain
    })

    const { updatePurchaseOrderStatus } = await import('@/lib/api/inventory')
    const result = await updatePurchaseOrderStatus('po-1', 'delivered')

    expect(result).toBe(true)
    // PO updated
    const poUpdate = updateChain.update.mock.calls[0][0]
    expect(poUpdate.status).toBe('delivered')
    expect(poUpdate.delivered_at).toBeDefined()
    // Line items were queried
    expect(lineItemsChain.eq).toHaveBeenCalledWith('po_id', 'po-1')
    // Materials updated (only mat-1 and mat-2, not the null one)
    // matUpdateChain.update should have been called (for each material)
    expect(matUpdateChain.update).toHaveBeenCalled()
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'status update failed' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updatePurchaseOrderStatus } = await import('@/lib/api/inventory')
    const result = await updatePurchaseOrderStatus('po-1', 'confirmed')

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith('[updatePurchaseOrderStatus]', 'status update failed')
    consoleSpy.mockRestore()
  })

  it('does not set timestamps for statuses without timestamp mapping', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updatePurchaseOrderStatus } = await import('@/lib/api/inventory')
    await updatePurchaseOrderStatus('po-1', 'cancelled')

    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg.status).toBe('cancelled')
    expect(updateArg.submitted_at).toBeUndefined()
    expect(updateArg.confirmed_at).toBeUndefined()
    expect(updateArg.shipped_at).toBeUndefined()
    expect(updateArg.delivered_at).toBeUndefined()
  })
})

// ── loadPurchaseOrders ──────────────────────────────────────────────────────

describe('loadPurchaseOrders', () => {
  it('returns all POs when no filters', async () => {
    const orders = [
      { id: 'po-1', po_number: 'PO-20260325-001', vendor: 'CED', status: 'draft' },
      { id: 'po-2', po_number: 'PO-20260325-002', vendor: 'BayWa', status: 'submitted' },
    ]
    const chain = mockChain({ data: orders, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadPurchaseOrders } = await import('@/lib/api/inventory')
    const result = await loadPurchaseOrders()

    expect(mockSupabase.from).toHaveBeenCalledWith('purchase_orders')
    expect(result).toEqual(orders)
    expect(result).toHaveLength(2)
  })

  it('filters by status', async () => {
    const chain = mockChain({ data: [{ id: 'po-1', status: 'draft' }], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadPurchaseOrders } = await import('@/lib/api/inventory')
    await loadPurchaseOrders({ status: 'draft' })

    expect(chain.eq).toHaveBeenCalledWith('status', 'draft')
  })

  it('filters by vendor', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadPurchaseOrders } = await import('@/lib/api/inventory')
    await loadPurchaseOrders({ vendor: 'CED Greentech' })

    expect(chain.eq).toHaveBeenCalledWith('vendor', 'CED Greentech')
  })

  it('filters by projectId', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadPurchaseOrders } = await import('@/lib/api/inventory')
    await loadPurchaseOrders({ projectId: 'PROJ-001' })

    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-001')
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'query failed' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadPurchaseOrders } = await import('@/lib/api/inventory')
    const result = await loadPurchaseOrders()

    expect(result).toEqual([])
    consoleSpy.mockRestore()
  })
})

// ── loadPurchaseOrder (single) ──────────────────────────────────────────────

describe('loadPurchaseOrder', () => {
  it('returns PO with line items on success', async () => {
    const po = { id: 'po-1', po_number: 'PO-20260325-001', vendor: 'CED', status: 'draft' }
    const items = [
      { id: 'li-1', po_id: 'po-1', name: 'Panel X', quantity: 20 },
      { id: 'li-2', po_id: 'po-1', name: 'Inverter Y', quantity: 1 },
    ]

    const poChain = mockChain({ data: po, error: null })
    poChain.single = vi.fn(() => Promise.resolve({ data: po, error: null }))
    const itemsChain = mockChain({ data: items, error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return poChain
      return itemsChain
    })

    const { loadPurchaseOrder } = await import('@/lib/api/inventory')
    const result = await loadPurchaseOrder('po-1')

    expect(result).not.toBeNull()
    expect(result!.po).toEqual(po)
    expect(result!.items).toEqual(items)
    expect(result!.items).toHaveLength(2)
  })

  it('returns null when PO not found', async () => {
    const chain = mockChain({ data: null, error: null })
    chain.single = vi.fn(() => Promise.resolve({ data: null, error: null }))
    mockSupabase.from.mockReturnValue(chain)

    const { loadPurchaseOrder } = await import('@/lib/api/inventory')
    const result = await loadPurchaseOrder('po-nonexistent')

    expect(result).toBeNull()
  })

  it('returns null on PO query error', async () => {
    const chain = mockChain({ data: null, error: { message: 'not found' } })
    chain.single = vi.fn(() => Promise.resolve({ data: null, error: { message: 'not found' } }))
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadPurchaseOrder } = await import('@/lib/api/inventory')
    const result = await loadPurchaseOrder('po-bad')

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith('[loadPurchaseOrder]', 'not found')
    consoleSpy.mockRestore()
  })

  it('returns PO with empty items array when line items query fails', async () => {
    const po = { id: 'po-1', po_number: 'PO-001', vendor: 'Test', status: 'draft' }
    const poChain = mockChain({ data: po, error: null })
    poChain.single = vi.fn(() => Promise.resolve({ data: po, error: null }))
    const itemsChain = mockChain({ data: null, error: { message: 'items error' } })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return poChain
      return itemsChain
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadPurchaseOrder } = await import('@/lib/api/inventory')
    const result = await loadPurchaseOrder('po-1')

    expect(result).not.toBeNull()
    expect(result!.po).toEqual(po)
    expect(result!.items).toEqual([])
    consoleSpy.mockRestore()
  })
})

// ── Constants and types ─────────────────────────────────────────────────────

describe('inventory constants', () => {
  it('MATERIAL_STATUSES has correct order', async () => {
    const { MATERIAL_STATUSES } = await import('@/lib/api/inventory')
    expect(MATERIAL_STATUSES).toEqual(['needed', 'ordered', 'shipped', 'delivered', 'installed'])
  })

  it('MATERIAL_SOURCES has correct values', async () => {
    const { MATERIAL_SOURCES } = await import('@/lib/api/inventory')
    expect(MATERIAL_SOURCES).toEqual(['dropship', 'warehouse', 'tbd'])
  })

  it('MATERIAL_CATEGORIES has correct values', async () => {
    const { MATERIAL_CATEGORIES } = await import('@/lib/api/inventory')
    expect(MATERIAL_CATEGORIES).toEqual(['module', 'inverter', 'battery', 'optimizer', 'racking', 'electrical', 'other'])
  })

  it('PO_STATUSES has correct order', async () => {
    const { PO_STATUSES } = await import('@/lib/api/inventory')
    expect(PO_STATUSES).toEqual(['draft', 'submitted', 'confirmed', 'shipped', 'delivered', 'cancelled'])
  })

  it('PO_STATUS_COLORS has entries for all PO statuses', async () => {
    const { PO_STATUSES, PO_STATUS_COLORS } = await import('@/lib/api/inventory')
    for (const status of PO_STATUSES) {
      expect(PO_STATUS_COLORS[status]).toBeDefined()
    }
  })
})

// ── loadAllProjectMaterials ─────────────────────────────────────────────────

describe('loadAllProjectMaterials', () => {
  it('returns materials with project names when join succeeds', async () => {
    const data = [
      { id: 'm1', name: 'Panel X', project_id: 'PROJ-001', projects: { name: 'Smith Install' } },
    ]
    const chain = mockChain({ data, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadAllProjectMaterials } = await import('@/lib/api/inventory')
    const result = await loadAllProjectMaterials()

    expect(result[0].project_name).toBe('Smith Install')
    expect((result[0] as any).projects).toBeUndefined()
  })

  it('applies status filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadAllProjectMaterials } = await import('@/lib/api/inventory')
    await loadAllProjectMaterials({ status: 'needed' })

    expect(chain.eq).toHaveBeenCalledWith('status', 'needed')
  })

  it('applies category filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadAllProjectMaterials } = await import('@/lib/api/inventory')
    await loadAllProjectMaterials({ category: 'module' })

    expect(chain.eq).toHaveBeenCalledWith('category', 'module')
  })

  it('applies source filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadAllProjectMaterials } = await import('@/lib/api/inventory')
    await loadAllProjectMaterials({ source: 'dropship' })

    expect(chain.eq).toHaveBeenCalledWith('source', 'dropship')
  })

  it('falls back to query without join on error', async () => {
    // First call fails (join error), second call succeeds
    const errorChain = mockChain({ data: null, error: { message: 'FK error' } })
    const fallbackChain = mockChain({ data: [{ id: 'm1', name: 'Panel X' }], error: null })

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return errorChain
      return fallbackChain
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadAllProjectMaterials } = await import('@/lib/api/inventory')
    const result = await loadAllProjectMaterials()

    expect(result).toHaveLength(1)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[loadAllProjectMaterials]'), expect.any(String))
    consoleSpy.mockRestore()
  })
})

// ── updatePurchaseOrder ─────────────────────────────────────────────────────

describe('updatePurchaseOrder', () => {
  it('updates fields and returns true', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updatePurchaseOrder } = await import('@/lib/api/inventory')
    const result = await updatePurchaseOrder('po-1', { tracking_number: 'TRK123', notes: 'Shipped via UPS' })

    expect(result).toBe(true)
    const updateArg = chain.update.mock.calls[0][0]
    expect(updateArg.tracking_number).toBe('TRK123')
    expect(updateArg.notes).toBe('Shipped via UPS')
    expect(updateArg.updated_at).toBeDefined()
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'update failed' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updatePurchaseOrder } = await import('@/lib/api/inventory')
    const result = await updatePurchaseOrder('po-1', { notes: 'test' })

    expect(result).toBe(false)
    consoleSpy.mockRestore()
  })
})

// ── loadPOLineItems ─────────────────────────────────────────────────────────

describe('loadPOLineItems', () => {
  it('returns line items for a PO', async () => {
    const items = [
      { id: 'li-1', po_id: 'po-1', name: 'Panel X', quantity: 20 },
      { id: 'li-2', po_id: 'po-1', name: 'Inverter Y', quantity: 1 },
    ]
    const chain = mockChain({ data: items, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadPOLineItems } = await import('@/lib/api/inventory')
    const result = await loadPOLineItems('po-1')

    expect(mockSupabase.from).toHaveBeenCalledWith('po_line_items')
    expect(chain.eq).toHaveBeenCalledWith('po_id', 'po-1')
    expect(chain.order).toHaveBeenCalledWith('name')
    expect(result).toEqual(items)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'error' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadPOLineItems } = await import('@/lib/api/inventory')
    const result = await loadPOLineItems('po-bad')

    expect(result).toEqual([])
    consoleSpy.mockRestore()
  })
})
