import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// We need to reset modules before each test so the module-level cache is fresh
beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

// Helper: build a chainable Supabase mock that resolves to given data
function buildChain(resolveData: { data: unknown[]; error: null; count?: number }) {
  const chain: Record<string, any> = {}
  const methods = ['select', 'eq', 'neq', 'in', 'ilike', 'or', 'order', 'range', 'limit', 'not', 'is', 'gt', 'lt', 'gte', 'lte']
  for (const m of methods) {
    chain[m] = vi.fn(() => chain)
  }
  // Make it thenable so await works
  chain.then = vi.fn((resolve: any) => Promise.resolve(resolveData).then(resolve))
  return chain
}

function mockSupabaseWith(chain: Record<string, any>) {
  return {
    from: vi.fn(() => chain),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  }
}

describe('useSupabaseQuery', () => {
  it('returns data from Supabase query', async () => {
    const rows = [{ id: 'PROJ-001', name: 'Test Project', stage: 'permit' }]
    const chain = buildChain({ data: rows, error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')
    const { result } = renderHook(() => useSupabaseQuery('projects'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual(rows)
    expect(result.current.error).toBeNull()
  })

  it('loading state transitions from true to false', async () => {
    const chain = buildChain({ data: [], error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')
    const { result } = renderHook(() => useSupabaseQuery('projects'))

    // Initially loading
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
  })

  it('sets error state on query failure', async () => {
    const chain: Record<string, any> = {}
    const methods = ['select', 'eq', 'neq', 'in', 'ilike', 'or', 'order', 'range', 'limit', 'not', 'is']
    for (const m of methods) {
      chain[m] = vi.fn(() => chain)
    }
    chain.then = vi.fn((resolve: any) =>
      Promise.resolve({ data: null, error: { message: 'Table not found' } }).then(resolve)
    )
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')
    const { result } = renderHook(() => useSupabaseQuery('projects'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Table not found')
    expect(result.current.data).toEqual([])
  })

  it('returns cached data on second call with same params', async () => {
    const rows = [{ id: 'PROJ-001', name: 'Cached' }]
    const chain = buildChain({ data: rows, error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    // First render
    const { result, unmount } = renderHook(() => useSupabaseQuery('projects'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(rows)

    const callCount = supabase.from.mock.calls.length

    unmount()

    // Second render — should use cache
    const { result: result2 } = renderHook(() => useSupabaseQuery('projects'))
    await waitFor(() => expect(result2.current.loading).toBe(false))
    expect(result2.current.data).toEqual(rows)

    // from() should not have been called again (cache hit)
    expect(supabase.from.mock.calls.length).toBe(callCount)
  })

  it('cache miss on different params triggers new fetch', async () => {
    const rows = [{ id: 'PROJ-001', name: 'Test' }]
    const chain = buildChain({ data: rows, error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    // First query with no filters
    const { result, unmount } = renderHook(() => useSupabaseQuery('projects'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    unmount()

    const callCountAfterFirst = supabase.from.mock.calls.length

    // Second query with different filters — should miss cache
    const { result: result2 } = renderHook(() =>
      useSupabaseQuery('projects', { filters: { stage: 'permit' } })
    )
    await waitFor(() => expect(result2.current.loading).toBe(false))

    expect(supabase.from.mock.calls.length).toBeGreaterThan(callCountAfterFirst)
  })

  it('refresh bypasses cache', async () => {
    const rows = [{ id: 'PROJ-001' }]
    const chain = buildChain({ data: rows, error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    const { result } = renderHook(() => useSupabaseQuery('projects'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const callCountBefore = supabase.from.mock.calls.length

    await act(async () => {
      result.current.refresh()
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(supabase.from.mock.calls.length).toBeGreaterThan(callCountBefore)
  })

  it('applies eq filter for shorthand values', async () => {
    const chain = buildChain({ data: [], error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    renderHook(() =>
      useSupabaseQuery('projects', { filters: { stage: 'permit' } })
    )

    await waitFor(() => {
      expect(chain.eq).toHaveBeenCalledWith('stage', 'permit')
    })
  })

  it('applies neq filter', async () => {
    const chain = buildChain({ data: [], error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    renderHook(() =>
      useSupabaseQuery('projects', { filters: { disposition: { neq: 'Cancelled' } } })
    )

    await waitFor(() => {
      expect(chain.neq).toHaveBeenCalledWith('disposition', 'Cancelled')
    })
  })

  it('applies not_in filter', async () => {
    const chain = buildChain({ data: [], error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    renderHook(() =>
      useSupabaseQuery('projects', {
        filters: { disposition: { not_in: ['Cancelled', 'In Service'] } },
      })
    )

    await waitFor(() => {
      expect(chain.not).toHaveBeenCalledWith(
        'disposition',
        'in',
        '("Cancelled","In Service")'
      )
    })
  })

  it('applies ilike filter', async () => {
    const chain = buildChain({ data: [], error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    renderHook(() =>
      useSupabaseQuery('projects', { filters: { name: { ilike: '%test%' } } })
    )

    await waitFor(() => {
      expect(chain.ilike).toHaveBeenCalledWith('name', '%test%')
    })
  })

  it('pagination: uses range and returns pagination state', async () => {
    const rows = [{ id: 'PROJ-001' }, { id: 'PROJ-002' }]
    const chain = buildChain({ data: rows, error: null, count: 250 })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    const { result } = renderHook(() =>
      useSupabaseQuery('projects', { page: 1, pageSize: 100 })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.currentPage).toBe(1)
    expect(result.current.totalCount).toBe(250)
    expect(result.current.hasMore).toBe(true)
    expect(chain.range).toHaveBeenCalledWith(0, 99)
  })

  it('pagination: nextPage and prevPage work', async () => {
    const chain = buildChain({ data: [], error: null, count: 250 })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    const { result } = renderHook(() =>
      useSupabaseQuery('projects', { page: 1, pageSize: 100 })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.nextPage() })
    expect(result.current.currentPage).toBe(2)

    act(() => { result.current.prevPage() })
    expect(result.current.currentPage).toBe(1)

    // prevPage should not go below 1
    act(() => { result.current.prevPage() })
    expect(result.current.currentPage).toBe(1)
  })

  it('pagination: hasMore is false on last page', async () => {
    const chain = buildChain({ data: [], error: null, count: 50 })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    const { result } = renderHook(() =>
      useSupabaseQuery('projects', { page: 1, pageSize: 100 })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.hasMore).toBe(false)
  })

  it('clearQueryCache invalidates all entries', async () => {
    const rows = [{ id: 'PROJ-001' }]
    const chain = buildChain({ data: rows, error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery, clearQueryCache } = await import('@/lib/hooks/useSupabaseQuery')

    // First render populates cache
    const { result, unmount } = renderHook(() => useSupabaseQuery('projects'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    unmount()

    const callCountBefore = supabase.from.mock.calls.length

    // Clear cache
    clearQueryCache()

    // New render should fetch again since cache was cleared
    const { result: result2 } = renderHook(() => useSupabaseQuery('projects'))
    await waitFor(() => expect(result2.current.loading).toBe(false))

    expect(supabase.from.mock.calls.length).toBeGreaterThan(callCountBefore)
  })

  it('stale-while-revalidate: stale cache returns data immediately without loading', async () => {
    const rows = [{ id: 'PROJ-001' }]
    const chain = buildChain({ data: rows, error: null })
    const supabase = mockSupabaseWith(chain)

    vi.doMock('@/lib/supabase/client', () => ({ createClient: () => supabase }))

    const { useSupabaseQuery } = await import('@/lib/hooks/useSupabaseQuery')

    // First render populates cache
    const { result, unmount } = renderHook(() => useSupabaseQuery('projects'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(rows)
    unmount()

    // Manually expire the cache entry by backdating its timestamp
    // Access the module-level cache indirectly: the key is deterministic
    // We verify stale behavior by checking that data is returned without loading=true
    // even when the cache should be stale. We fake staleness by manipulating Date.now.
    const originalDateNow = Date.now
    Date.now = () => originalDateNow() + 31_000 // 31s in the future = stale

    const { result: result2 } = renderHook(() => useSupabaseQuery('projects'))

    // Stale-while-revalidate: should return cached data immediately (loading=false)
    // because stale cache sets data before triggering background refetch
    await waitFor(() => expect(result2.current.loading).toBe(false))
    expect(result2.current.data).toEqual(rows)
    expect(result2.current.error).toBeNull()

    Date.now = originalDateNow
  })
})
