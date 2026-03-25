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

// ── loadProjectById ─────────────────────────────────────────────────────────

describe('loadProjectById', () => {
  it('returns a project on success', async () => {
    const project = { id: 'PROJ-001', name: 'Test Project' }
    const chain = mockChain({ data: project, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectById } = await import('@/lib/api/projects')
    const result = await loadProjectById('PROJ-001')

    expect(mockSupabase.from).toHaveBeenCalledWith('projects')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('id', 'PROJ-001')
    expect(chain.single).toHaveBeenCalled()
    expect(result).toEqual(project)
  })

  it('returns null when project not found', async () => {
    const chain = mockChain({ data: null, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectById } = await import('@/lib/api/projects')
    const result = await loadProjectById('PROJ-999')

    expect(result).toBeNull()
  })

  it('returns null and logs error on failure', async () => {
    const error = { message: 'connection failed' }
    const chain = mockChain({ data: null, error })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadProjectById } = await import('@/lib/api/projects')
    const result = await loadProjectById('PROJ-001')

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith('project load by id failed:', error)
    consoleSpy.mockRestore()
  })
})

// ── loadProjectsByIds ───────────────────────────────────────────────────────

describe('loadProjectsByIds', () => {
  it('returns empty array for empty input', async () => {
    const { loadProjectsByIds } = await import('@/lib/api/projects')
    const result = await loadProjectsByIds([])

    expect(result).toEqual([])
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('returns projects for a small batch', async () => {
    const projects = [
      { id: 'PROJ-001', name: 'Alpha' },
      { id: 'PROJ-002', name: 'Beta' },
    ]
    const chain = mockChain({ data: projects, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadProjectsByIds } = await import('@/lib/api/projects')
    const result = await loadProjectsByIds(['PROJ-001', 'PROJ-002'])

    expect(mockSupabase.from).toHaveBeenCalledWith('projects')
    expect(chain.select).toHaveBeenCalledWith('id, name')
    expect(chain.in).toHaveBeenCalledWith('id', ['PROJ-001', 'PROJ-002'])
    expect(result).toEqual(projects)
  })

  it('batches large arrays in chunks of 100', async () => {
    // Create 250 IDs to force 3 batches
    const ids = Array.from({ length: 250 }, (_, i) => `PROJ-${String(i).padStart(3, '0')}`)
    const batch1 = ids.slice(0, 100).map(id => ({ id, name: id }))
    const batch2 = ids.slice(100, 200).map(id => ({ id, name: id }))
    const batch3 = ids.slice(200, 250).map(id => ({ id, name: id }))

    let callCount = 0
    mockSupabase.from.mockImplementation(() => {
      callCount++
      if (callCount === 1) return mockChain({ data: batch1, error: null })
      if (callCount === 2) return mockChain({ data: batch2, error: null })
      return mockChain({ data: batch3, error: null })
    })

    const { loadProjectsByIds } = await import('@/lib/api/projects')
    const result = await loadProjectsByIds(ids)

    expect(mockSupabase.from).toHaveBeenCalledTimes(3)
    expect(result).toHaveLength(250)
  })

  it('handles errors in a batch gracefully', async () => {
    const chain = mockChain({ data: null, error: { message: 'batch error' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadProjectsByIds } = await import('@/lib/api/projects')
    const result = await loadProjectsByIds(['PROJ-001'])

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith('projects batch load failed:', { message: 'batch error' })
    consoleSpy.mockRestore()
  })
})

// ── searchProjects ──────────────────────────────────────────────────────────

describe('searchProjects', () => {
  it('applies escapeIlike and uses .or() for name+id search', async () => {
    const projects = [{ id: 'PROJ-001', name: 'Solar Alpha' }]
    const chain = mockChain({ data: projects, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { searchProjects } = await import('@/lib/api/projects')
    const result = await searchProjects('Solar')

    expect(mockSupabase.from).toHaveBeenCalledWith('projects')
    expect(chain.or).toHaveBeenCalledWith('name.ilike.%Solar%,id.ilike.%Solar%')
    expect(chain.limit).toHaveBeenCalledWith(10)
    expect(result).toEqual(projects)
  })

  it('escapes special ILIKE characters in search query', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { searchProjects } = await import('@/lib/api/projects')
    await searchProjects('100%_done')

    // escapeIlike converts % to \% and _ to \_
    expect(chain.or).toHaveBeenCalledWith('name.ilike.%100\\%\\_done%,id.ilike.%100\\%\\_done%')
  })

  it('respects custom limit', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { searchProjects } = await import('@/lib/api/projects')
    await searchProjects('test', 25)

    expect(chain.limit).toHaveBeenCalledWith(25)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'search failed' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { searchProjects } = await import('@/lib/api/projects')
    const result = await searchProjects('test')

    expect(result).toEqual([])
    consoleSpy.mockRestore()
  })
})

// ── loadScheduleByDateRange ─────────────────────────────────────────────────

describe('loadScheduleByDateRange', () => {
  it('filters by date range and includes project join', async () => {
    const scheduleData = [
      { id: '1', date: '2026-03-20', project: { name: 'Alpha', city: 'Houston' } },
    ]
    const chain = mockChain({ data: scheduleData, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadScheduleByDateRange } = await import('@/lib/api/schedules')
    const result = await loadScheduleByDateRange('2026-03-01', '2026-03-31')

    expect(mockSupabase.from).toHaveBeenCalledWith('schedule')
    expect(chain.select).toHaveBeenCalledWith('*, project:projects(name, city)')
    expect(chain.gte).toHaveBeenCalledWith('date', '2026-03-01')
    expect(chain.lte).toHaveBeenCalledWith('date', '2026-03-31')
    expect(result.data).toEqual(scheduleData)
    expect(result.error).toBeNull()
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'schedule error' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadScheduleByDateRange } = await import('@/lib/api/schedules')
    const result = await loadScheduleByDateRange('2026-03-01', '2026-03-31')

    expect(result.data).toEqual([])
    expect(result.error).toEqual({ message: 'schedule error' })
    consoleSpy.mockRestore()
  })
})

// ── loadChangeOrders ────────────────────────────────────────────────────────

describe('loadChangeOrders', () => {
  it('orders by created_at desc and includes project join', async () => {
    const orders = [
      { id: '1', title: 'Panel swap', project: { name: 'Alpha', city: 'Houston', pm: 'Jane', pm_id: 'u1' } },
    ]
    const chain = mockChain({ data: orders, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadChangeOrders } = await import('@/lib/api/change-orders')
    const result = await loadChangeOrders()

    expect(mockSupabase.from).toHaveBeenCalledWith('change_orders')
    expect(chain.select).toHaveBeenCalledWith('*, project:projects(name, city, pm, pm_id)')
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalledWith(2000)
    expect(result.data).toEqual(orders)
    expect(result.error).toBeNull()
  })

  it('respects custom limit', async () => {
    const chain = mockChain({ data: [], error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadChangeOrders } = await import('@/lib/api/change-orders')
    await loadChangeOrders(500)

    expect(chain.limit).toHaveBeenCalledWith(500)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'change order error' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadChangeOrders } = await import('@/lib/api/change-orders')
    const result = await loadChangeOrders()

    expect(result.data).toEqual([])
    expect(result.error).toEqual({ message: 'change order error' })
    consoleSpy.mockRestore()
  })
})

// ── loadCrewsByIds ──────────────────────────────────────────────────────────

describe('loadCrewsByIds', () => {
  it('returns empty array for empty input', async () => {
    const { loadCrewsByIds } = await import('@/lib/api/crews')
    const result = await loadCrewsByIds([])

    expect(result).toEqual([])
    expect(mockSupabase.from).not.toHaveBeenCalled()
  })

  it('filters crews by IDs', async () => {
    const crews = [
      { id: 'c1', name: 'Crew Alpha' },
      { id: 'c2', name: 'Crew Beta' },
    ]
    const chain = mockChain({ data: crews, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadCrewsByIds } = await import('@/lib/api/crews')
    const result = await loadCrewsByIds(['c1', 'c2'])

    expect(mockSupabase.from).toHaveBeenCalledWith('crews')
    expect(chain.select).toHaveBeenCalledWith('id, name')
    expect(chain.in).toHaveBeenCalledWith('id', ['c1', 'c2'])
    expect(result).toEqual(crews)
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'crews error' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadCrewsByIds } = await import('@/lib/api/crews')
    const result = await loadCrewsByIds(['c1'])

    expect(result).toEqual([])
    consoleSpy.mockRestore()
  })
})

// ── loadActiveCrews ─────────────────────────────────────────────────────────

describe('loadActiveCrews', () => {
  it('filters on active=TRUE and orders by name', async () => {
    const crews = [
      { id: 'c1', name: 'Alpha Crew', active: 'TRUE' },
      { id: 'c2', name: 'Beta Crew', active: 'TRUE' },
    ]
    const chain = mockChain({ data: crews, error: null })
    mockSupabase.from.mockReturnValue(chain)

    const { loadActiveCrews } = await import('@/lib/api/crews')
    const result = await loadActiveCrews()

    expect(mockSupabase.from).toHaveBeenCalledWith('crews')
    expect(chain.select).toHaveBeenCalledWith('*')
    expect(chain.eq).toHaveBeenCalledWith('active', 'TRUE')
    expect(chain.order).toHaveBeenCalledWith('name')
    expect(result.data).toEqual(crews)
    expect(result.error).toBeNull()
  })

  it('returns empty array on error', async () => {
    const chain = mockChain({ data: null, error: { message: 'crews error' } })
    mockSupabase.from.mockReturnValue(chain)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { loadActiveCrews } = await import('@/lib/api/crews')
    const result = await loadActiveCrews()

    expect(result.data).toEqual([])
    expect(result.error).toEqual({ message: 'crews error' })
    consoleSpy.mockRestore()
  })
})
