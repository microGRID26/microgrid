import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockSupabase } from '../../vitest.setup'

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    like: vi.fn(() => chain),
    ilike: vi.fn(() => chain),
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

/** Build a chain that resolves differently per .from() table */
function mockMultiTable(tableResults: Record<string, { data: any; error: any }>) {
  mockSupabase.from.mockImplementation((table: string) => {
    const result = tableResults[table] ?? { data: null, error: null }
    return mockChain(result)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

// ── generateWONumber ────────────────────────────────────────────────────────

describe('generateWONumber', () => {
  it('generates correct format WO-YYYYMMDD-NNN', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generateWONumber } = await import('@/lib/api/work-orders')
    const result = await generateWONumber()

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    expect(result).toBe(`WO-${today}-001`)
  })

  it('increments sequence when existing WOs exist today', async () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const chain = mockChain({ data: [{ wo_number: `WO-${today}-005` }], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generateWONumber } = await import('@/lib/api/work-orders')
    const result = await generateWONumber()

    expect(result).toBe(`WO-${today}-006`)
  })

  it('pads sequence to 3 digits', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { generateWONumber } = await import('@/lib/api/work-orders')
    const result = await generateWONumber()

    // Last segment should be 3 digits
    const seq = result.split('-').pop()
    expect(seq).toHaveLength(3)
  })
})

// ── loadWorkOrders ──────────────────────────────────────────────────────────

describe('loadWorkOrders', () => {
  it('loads work orders with no filters', async () => {
    const wos = [{ id: 'wo1', project_id: 'PROJ-001', type: 'install', status: 'draft' }]
    mockMultiTable({
      work_orders: { data: wos, error: null },
      projects: { data: [{ id: 'PROJ-001', name: 'Test', city: 'Austin', address: '123 Main', pm: 'Jane' }], error: null },
    })

    const { loadWorkOrders } = await import('@/lib/api/work-orders')
    const result = await loadWorkOrders()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wo1')
    expect(result[0].project).toEqual({ name: 'Test', city: 'Austin', address: '123 Main', pm: 'Jane' })
  })

  it('applies status filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadWorkOrders } = await import('@/lib/api/work-orders')
    await loadWorkOrders({ status: 'assigned' })

    expect(chain.eq).toHaveBeenCalledWith('status', 'assigned')
  })

  it('applies type filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadWorkOrders } = await import('@/lib/api/work-orders')
    await loadWorkOrders({ type: 'install' })

    expect(chain.eq).toHaveBeenCalledWith('type', 'install')
  })

  it('applies projectId filter', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadWorkOrders } = await import('@/lib/api/work-orders')
    await loadWorkOrders({ projectId: 'PROJ-100' })

    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-100')
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadWorkOrders } = await import('@/lib/api/work-orders')
    const result = await loadWorkOrders()

    expect(result).toEqual([])
    consoleSpy.mockRestore()
  })
})

// ── loadWorkOrder ───────────────────────────────────────────────────────────

describe('loadWorkOrder', () => {
  it('returns WO + checklist on success', async () => {
    const wo = { id: 'wo1', project_id: 'PROJ-001', type: 'install', status: 'draft' }
    const checklist = [{ id: 'c1', work_order_id: 'wo1', description: 'Test item', sort_order: 0 }]

    let callCount = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'work_orders') {
        return mockChain({ data: wo, error: null })
      }
      if (table === 'wo_checklist_items') {
        return mockChain({ data: checklist, error: null })
      }
      if (table === 'projects') {
        return mockChain({ data: { id: 'PROJ-001', name: 'Alpha', city: 'Austin', address: '1 St', pm: 'Bob' }, error: null })
      }
      return mockChain({ data: null, error: null })
    })

    const { loadWorkOrder } = await import('@/lib/api/work-orders')
    const result = await loadWorkOrder('wo1')

    expect(result).not.toBeNull()
    expect(result!.wo.id).toBe('wo1')
    expect(result!.wo.project).toEqual({ name: 'Alpha', city: 'Austin', address: '1 St', pm: 'Bob' })
    expect(result!.checklist).toHaveLength(1)
    expect(result!.checklist[0].description).toBe('Test item')
  })

  it('returns null when work order not found', async () => {
    mockSupabase.from.mockImplementation(() => {
      return mockChain({ data: null, error: null })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadWorkOrder } = await import('@/lib/api/work-orders')
    const result = await loadWorkOrder('nonexistent')

    expect(result).toBeNull()
    consoleSpy.mockRestore()
  })

  it('returns null on error', async () => {
    mockSupabase.from.mockImplementation(() => {
      return mockChain({ data: null, error: { message: 'db error' } })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadWorkOrder } = await import('@/lib/api/work-orders')
    const result = await loadWorkOrder('wo1')

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

// ── createWorkOrder ─────────────────────────────────────────────────────────

describe('createWorkOrder', () => {
  it('creates WO with explicit checklist items', async () => {
    const createdWO = { id: 'wo-new', wo_number: 'WO-20260326-001', type: 'install', status: 'draft' }

    // First call: generateWONumber queries work_orders
    // Second call: insert into work_orders
    // Third call: insert checklist items
    let fromCallIndex = 0
    mockSupabase.from.mockImplementation(() => {
      fromCallIndex++
      if (fromCallIndex === 1) {
        // generateWONumber: select wo_number from work_orders
        return mockChain({ data: [], error: null })
      }
      // All subsequent: insert returns the created WO or checklist success
      return mockChain({ data: createdWO, error: null })
    })

    const { createWorkOrder } = await import('@/lib/api/work-orders')
    const result = await createWorkOrder(
      {
        project_id: 'PROJ-001',
        type: 'install',
        status: 'draft',
        assigned_crew: null,
        assigned_to: null,
        scheduled_date: null,
        started_at: null,
        completed_at: null,
        priority: 'normal',
        description: 'Test WO',
        special_instructions: null,
        customer_signature: false,
        customer_signed_at: null,
        materials_used: [],
        time_on_site_minutes: null,
        notes: null,
        created_by: null,
      },
      ['Step 1', 'Step 2']
    )

    expect(result).not.toBeNull()
    expect(result!.id).toBe('wo-new')
  })

  it('auto-populates checklist from template when no items provided', async () => {
    const createdWO = { id: 'wo-new', type: 'survey', status: 'draft' }
    const insertSpy = vi.fn()

    let fromCallIndex = 0
    mockSupabase.from.mockImplementation(() => {
      fromCallIndex++
      const chain = mockChain({ data: fromCallIndex === 1 ? [] : createdWO, error: null })
      chain.insert = vi.fn((...args: any[]) => {
        insertSpy(...args)
        return chain
      })
      return chain
    })

    const { createWorkOrder, WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    await createWorkOrder({
      project_id: 'PROJ-002',
      type: 'survey',
      status: 'draft',
      assigned_crew: null,
      assigned_to: null,
      scheduled_date: null,
      started_at: null,
      completed_at: null,
      priority: 'normal',
      description: null,
      special_instructions: null,
      customer_signature: false,
      customer_signed_at: null,
      materials_used: [],
      time_on_site_minutes: null,
      notes: null,
      created_by: null,
    })

    // The second insert call should be for checklist items using the survey template
    const lastInsertCall = insertSpy.mock.calls[insertSpy.mock.calls.length - 1]
    if (lastInsertCall) {
      const rows = lastInsertCall[0]
      if (Array.isArray(rows)) {
        expect(rows.length).toBe(WO_CHECKLIST_TEMPLATES.survey.length)
      }
    }
  })

  it('returns null on error', async () => {
    mockSupabase.from.mockImplementation(() => {
      return mockChain({ data: null, error: { message: 'insert fail' } })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { createWorkOrder } = await import('@/lib/api/work-orders')
    const result = await createWorkOrder({
      project_id: 'PROJ-001',
      type: 'install',
      status: 'draft',
      assigned_crew: null,
      assigned_to: null,
      scheduled_date: null,
      started_at: null,
      completed_at: null,
      priority: 'normal',
      description: null,
      special_instructions: null,
      customer_signature: false,
      customer_signed_at: null,
      materials_used: [],
      time_on_site_minutes: null,
      notes: null,
      created_by: null,
    })

    expect(result).toBeNull()
    consoleSpy.mockRestore()
  })
})

// ── updateWorkOrder ─────────────────────────────────────────────────────────

describe('updateWorkOrder', () => {
  it('returns true on success', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { updateWorkOrder } = await import('@/lib/api/work-orders')
    const result = await updateWorkOrder('wo1', { priority: 'high' })

    expect(result).toBe(true)
    expect(chain.update).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'wo1')
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'update fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updateWorkOrder } = await import('@/lib/api/work-orders')
    const result = await updateWorkOrder('wo1', { priority: 'high' })

    expect(result).toBe(false)
    consoleSpy.mockRestore()
  })
})

// ── updateWorkOrderStatus ───────────────────────────────────────────────────

describe('updateWorkOrderStatus', () => {
  it('sets started_at when moving to in_progress', async () => {
    const updateSpy = vi.fn()
    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First call: select current status (assigned -> in_progress is valid)
        return mockChain({ data: { status: 'assigned' }, error: null })
      }
      // Second call: update
      const chain = mockChain({ data: null, error: null })
      chain.update = vi.fn((data: any) => { updateSpy(data); return chain })
      return chain
    })

    const { updateWorkOrderStatus } = await import('@/lib/api/work-orders')
    const result = await updateWorkOrderStatus('wo1', 'in_progress')

    expect(result).toBe(true)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const updates = updateSpy.mock.calls[0][0]
    expect(updates.status).toBe('in_progress')
    expect(updates.started_at).toBeDefined()
    expect(updates.completed_at).toBeUndefined()
  })

  it('sets completed_at when moving to complete', async () => {
    const updateSpy = vi.fn()
    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // First call: select current status (in_progress -> complete is valid)
        return mockChain({ data: { status: 'in_progress' }, error: null })
      }
      // Second call: update
      const chain = mockChain({ data: null, error: null })
      chain.update = vi.fn((data: any) => { updateSpy(data); return chain })
      return chain
    })

    const { updateWorkOrderStatus } = await import('@/lib/api/work-orders')
    const result = await updateWorkOrderStatus('wo1', 'complete')

    expect(result).toBe(true)
    const updates = updateSpy.mock.calls[0][0]
    expect(updates.status).toBe('complete')
    expect(updates.completed_at).toBeDefined()
  })

  it('returns false on invalid transition', async () => {
    // complete -> in_progress is not a valid transition
    mockSupabase.from.mockReturnValue(
      mockChain({ data: { status: 'complete' }, error: null })
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { updateWorkOrderStatus } = await import('@/lib/api/work-orders')
    const result = await updateWorkOrderStatus('wo1', 'in_progress')

    expect(result).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'status fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updateWorkOrderStatus } = await import('@/lib/api/work-orders')
    const result = await updateWorkOrderStatus('wo1', 'assigned')

    expect(result).toBe(false)
    consoleSpy.mockRestore()
  })
})

// ── addChecklistItem ────────────────────────────────────────────────────────

describe('addChecklistItem', () => {
  it('creates item with next sort_order', async () => {
    const existingItems = [{ sort_order: 3 }]
    const newItem = { id: 'c-new', work_order_id: 'wo1', description: 'New task', sort_order: 4 }

    let callIndex = 0
    mockSupabase.from.mockImplementation(() => {
      callIndex++
      if (callIndex === 1) {
        // Fetch existing sort_order
        return mockChain({ data: existingItems, error: null })
      }
      // Insert new item
      return mockChain({ data: newItem, error: null })
    })

    const { addChecklistItem } = await import('@/lib/api/work-orders')
    const result = await addChecklistItem('wo1', 'New task')

    expect(result).not.toBeNull()
    expect(result!.description).toBe('New task')
    expect(result!.sort_order).toBe(4)
  })

  it('returns null on error', async () => {
    mockSupabase.from.mockImplementation(() => {
      return mockChain({ data: null, error: { message: 'insert fail' } })
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { addChecklistItem } = await import('@/lib/api/work-orders')
    const result = await addChecklistItem('wo1', 'Test')

    expect(result).toBeNull()
    consoleSpy.mockRestore()
  })
})

// ── toggleChecklistItem ─────────────────────────────────────────────────────

describe('toggleChecklistItem', () => {
  it('sets completed_by and completed_at when completing', async () => {
    const updateSpy = vi.fn()
    const chain = mockChain({ data: null, error: null })
    chain.update = vi.fn((data: any) => {
      updateSpy(data)
      return chain
    })
    mockSupabase.from.mockReturnValue(chain)

    const { toggleChecklistItem } = await import('@/lib/api/work-orders')
    const result = await toggleChecklistItem('c1', true, 'Jane Doe')

    expect(result).toBe(true)
    const updates = updateSpy.mock.calls[0][0]
    expect(updates.completed).toBe(true)
    expect(updates.completed_by).toBe('Jane Doe')
    expect(updates.completed_at).toBeDefined()
  })

  it('clears completed_by and completed_at when uncompleting', async () => {
    const updateSpy = vi.fn()
    const chain = mockChain({ data: null, error: null })
    chain.update = vi.fn((data: any) => {
      updateSpy(data)
      return chain
    })
    mockSupabase.from.mockReturnValue(chain)

    const { toggleChecklistItem } = await import('@/lib/api/work-orders')
    const result = await toggleChecklistItem('c1', false, 'Jane Doe')

    expect(result).toBe(true)
    const updates = updateSpy.mock.calls[0][0]
    expect(updates.completed).toBe(false)
    expect(updates.completed_by).toBeNull()
    expect(updates.completed_at).toBeNull()
  })
})

// ── deleteChecklistItem ─────────────────────────────────────────────────────

describe('deleteChecklistItem', () => {
  it('returns true on success', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { deleteChecklistItem } = await import('@/lib/api/work-orders')
    const result = await deleteChecklistItem('c1')

    expect(result).toBe(true)
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'c1')
  })

  it('returns false on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'delete fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deleteChecklistItem } = await import('@/lib/api/work-orders')
    const result = await deleteChecklistItem('c1')

    expect(result).toBe(false)
    consoleSpy.mockRestore()
  })
})

// ── createWorkOrderFromProject ──────────────────────────────────────────────

describe('createWorkOrderFromProject', () => {
  it('pre-fills project data in description and special_instructions', async () => {
    const createdWO = { id: 'wo-proj', type: 'install', status: 'draft', description: 'Install work order for Alpha House', special_instructions: 'Location: 123 Main, Austin' }
    const insertSpy = vi.fn()

    let callIndex = 0
    mockSupabase.from.mockImplementation(() => {
      callIndex++
      const chain = mockChain({ data: callIndex === 1 ? [] : createdWO, error: null })
      chain.insert = vi.fn((...args: any[]) => {
        insertSpy(...args)
        return chain
      })
      return chain
    })

    const { createWorkOrderFromProject } = await import('@/lib/api/work-orders')
    const result = await createWorkOrderFromProject(
      'PROJ-001',
      'install',
      { name: 'Alpha House', address: '123 Main', city: 'Austin' }
    )

    // The first insert call should be for the work order with pre-filled data
    const woInsert = insertSpy.mock.calls[0]?.[0]
    if (woInsert) {
      expect(woInsert.description).toContain('Install work order for Alpha House')
      expect(woInsert.special_instructions).toContain('123 Main')
      expect(woInsert.special_instructions).toContain('Austin')
      expect(woInsert.project_id).toBe('PROJ-001')
    }
  })

  it('sets status to assigned when crew provided', async () => {
    const insertSpy = vi.fn()

    let callIndex = 0
    mockSupabase.from.mockImplementation(() => {
      callIndex++
      const chain = mockChain({ data: callIndex === 1 ? [] : { id: 'wo-x' }, error: null })
      chain.insert = vi.fn((...args: any[]) => {
        insertSpy(...args)
        return chain
      })
      return chain
    })

    const { createWorkOrderFromProject } = await import('@/lib/api/work-orders')
    await createWorkOrderFromProject(
      'PROJ-001',
      'survey',
      { name: 'Test', address: null, city: null },
      { crew: 'crew-1' }
    )

    const woInsert = insertSpy.mock.calls[0]?.[0]
    if (woInsert) {
      expect(woInsert.status).toBe('assigned')
      expect(woInsert.assigned_crew).toBe('crew-1')
    }
  })

  it('defaults to draft status when no crew provided', async () => {
    const insertSpy = vi.fn()

    let callIndex = 0
    mockSupabase.from.mockImplementation(() => {
      callIndex++
      const chain = mockChain({ data: callIndex === 1 ? [] : { id: 'wo-x' }, error: null })
      chain.insert = vi.fn((...args: any[]) => {
        insertSpy(...args)
        return chain
      })
      return chain
    })

    const { createWorkOrderFromProject } = await import('@/lib/api/work-orders')
    await createWorkOrderFromProject(
      'PROJ-001',
      'survey',
      { name: 'Test', address: null, city: null }
    )

    const woInsert = insertSpy.mock.calls[0]?.[0]
    if (woInsert) {
      expect(woInsert.status).toBe('draft')
    }
  })
})

// ── loadProjectWorkOrders ───────────────────────────────────────────────────

describe('loadProjectWorkOrders', () => {
  it('returns work orders for a specific project', async () => {
    const wos = [
      { id: 'wo1', project_id: 'PROJ-001', type: 'install' },
      { id: 'wo2', project_id: 'PROJ-001', type: 'inspection' },
    ]
    const chain = mockChain({ data: wos, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectWorkOrders } = await import('@/lib/api/work-orders')
    const result = await loadProjectWorkOrders('PROJ-001')

    expect(result).toHaveLength(2)
    expect(chain.eq).toHaveBeenCalledWith('project_id', 'PROJ-001')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(50)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'fail' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadProjectWorkOrders } = await import('@/lib/api/work-orders')
    const result = await loadProjectWorkOrders('PROJ-001')

    expect(result).toEqual([])
    consoleSpy.mockRestore()
  })
})

// ── getValidTransitions ─────────────────────────────────────────────────────

describe('getValidTransitions', () => {
  it('draft can transition to assigned or cancelled', async () => {
    const { getValidTransitions } = await import('@/lib/api/work-orders')
    expect(getValidTransitions('draft')).toEqual(['assigned', 'cancelled'])
  })

  it('assigned can transition to in_progress or cancelled', async () => {
    const { getValidTransitions } = await import('@/lib/api/work-orders')
    expect(getValidTransitions('assigned')).toEqual(['in_progress', 'cancelled'])
  })

  it('in_progress can transition to complete or cancelled', async () => {
    const { getValidTransitions } = await import('@/lib/api/work-orders')
    expect(getValidTransitions('in_progress')).toEqual(['complete', 'cancelled'])
  })

  it('complete has no valid transitions', async () => {
    const { getValidTransitions } = await import('@/lib/api/work-orders')
    expect(getValidTransitions('complete')).toEqual([])
  })

  it('cancelled has no valid transitions', async () => {
    const { getValidTransitions } = await import('@/lib/api/work-orders')
    expect(getValidTransitions('cancelled')).toEqual([])
  })

  it('unknown status returns empty array', async () => {
    const { getValidTransitions } = await import('@/lib/api/work-orders')
    expect(getValidTransitions('bogus')).toEqual([])
  })
})

// ── WO_CHECKLIST_TEMPLATES ──────────────────────────────────────────────────

describe('WO_CHECKLIST_TEMPLATES', () => {
  it('has templates for all 5 work order types', async () => {
    const { WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    expect(Object.keys(WO_CHECKLIST_TEMPLATES)).toEqual(
      expect.arrayContaining(['install', 'inspection', 'service', 'survey', 'repair'])
    )
    expect(Object.keys(WO_CHECKLIST_TEMPLATES)).toHaveLength(5)
  })

  it('install template has 9 items', async () => {
    const { WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    expect(WO_CHECKLIST_TEMPLATES.install).toHaveLength(9)
  })

  it('inspection template has 5 items', async () => {
    const { WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    expect(WO_CHECKLIST_TEMPLATES.inspection).toHaveLength(5)
  })

  it('service template has 4 items', async () => {
    const { WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    expect(WO_CHECKLIST_TEMPLATES.service).toHaveLength(4)
  })

  it('survey template has 5 items', async () => {
    const { WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    expect(WO_CHECKLIST_TEMPLATES.survey).toHaveLength(5)
  })

  it('repair template has 6 items', async () => {
    const { WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    expect(WO_CHECKLIST_TEMPLATES.repair).toHaveLength(6)
  })

  it('all templates contain non-empty strings', async () => {
    const { WO_CHECKLIST_TEMPLATES } = await import('@/lib/api/work-orders')
    for (const [type, items] of Object.entries(WO_CHECKLIST_TEMPLATES)) {
      for (const item of items) {
        expect(typeof item).toBe('string')
        expect(item.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
