import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useServerFilter } from '@/lib/hooks/useServerFilter'

const sampleData = [
  { id: 'PROJ-001', name: 'Alpha', stage: 'permit', pm_id: 'u1', pm: 'Alice', city: 'Austin' },
  { id: 'PROJ-002', name: 'Beta', stage: 'install', pm_id: 'u2', pm: 'Bob', city: 'Dallas' },
  { id: 'PROJ-003', name: 'Gamma', stage: 'permit', pm_id: 'u1', pm: 'Alice', city: 'Austin' },
  { id: 'PROJ-004', name: 'Delta', stage: 'design', pm_id: 'u3', pm: 'Carol', city: null },
]

describe('useServerFilter', () => {
  it('initial state has empty filters and empty search', () => {
    const { result } = renderHook(() => useServerFilter(sampleData))

    expect(result.current.filterValues).toEqual({})
    expect(result.current.search).toBe('')
  })

  it('setFilter updates filter value', () => {
    const { result } = renderHook(() => useServerFilter(sampleData))

    act(() => {
      result.current.setFilter('stage', 'permit')
    })

    expect(result.current.filterValues).toEqual({ stage: 'permit' })
  })

  it('setSearch updates search text', () => {
    const { result } = renderHook(() => useServerFilter(sampleData))

    act(() => {
      result.current.setSearch('Alpha')
    })

    expect(result.current.search).toBe('Alpha')
  })

  it('extracts dropdown options from a single field', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        extractDropdowns: { stage: 'stage' },
      })
    )

    const stages = result.current.dropdowns.stage
    expect(stages).toHaveLength(3) // design, install, permit (sorted)
    expect(stages.map(d => d.value)).toEqual(['design', 'install', 'permit'])
    // For single fields, value === label
    expect(stages[0].label).toBe('design')
  })

  it('extracts dropdown options from paired fields (pm_id|pm)', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        extractDropdowns: { pm: 'pm_id|pm' },
      })
    )

    const pms = result.current.dropdowns.pm
    expect(pms).toHaveLength(3) // Alice, Bob, Carol (sorted by label)
    expect(pms.map(d => d.label)).toEqual(['Alice', 'Bob', 'Carol'])
    expect(pms.map(d => d.value)).toEqual(['u1', 'u2', 'u3'])
  })

  it('buildQueryFilters produces correct filter object from active filters', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        extractDropdowns: { stage: 'stage', pm: 'pm_id|pm' },
      })
    )

    act(() => {
      result.current.setFilter('stage', 'permit')
      result.current.setFilter('pm', 'u1')
    })

    const filters = result.current.buildQueryFilters()
    expect(filters).toEqual({
      stage: { eq: 'permit' },
      pm_id: { eq: 'u1' },
    })
  })

  it('buildQueryFilters skips "all" filter values', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        extractDropdowns: { stage: 'stage' },
      })
    )

    act(() => {
      result.current.setFilter('stage', 'all')
    })

    const filters = result.current.buildQueryFilters()
    expect(filters).toEqual({})
  })

  it('buildSearchOr produces correct OR expression with escapeIlike', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        searchFields: ['name', 'id', 'city'],
      })
    )

    act(() => {
      result.current.setSearch('test')
    })

    const orExpr = result.current.buildSearchOr()
    expect(orExpr).toBe('name.ilike.%test%,id.ilike.%test%,city.ilike.%test%')
  })

  it('buildSearchOr escapes special ILIKE characters', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        searchFields: ['name'],
      })
    )

    act(() => {
      result.current.setSearch('100%')
    })

    const orExpr = result.current.buildSearchOr()
    expect(orExpr).toBe('name.ilike.%100\\%%')
  })

  it('buildSearchOr returns undefined for empty search', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        searchFields: ['name'],
      })
    )

    expect(result.current.buildSearchOr()).toBeUndefined()
  })

  it('staticFilters are merged into buildQueryFilters output', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        staticFilters: {
          disposition: { not_in: ['Cancelled', 'In Service'] },
        },
        extractDropdowns: { stage: 'stage' },
      })
    )

    act(() => {
      result.current.setFilter('stage', 'permit')
    })

    const filters = result.current.buildQueryFilters()
    expect(filters).toEqual({
      disposition: { not_in: ['Cancelled', 'In Service'] },
      stage: { eq: 'permit' },
    })
  })

  it('resetFilters clears all filter values and search', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        searchFields: ['name'],
        extractDropdowns: { stage: 'stage' },
      })
    )

    act(() => {
      result.current.setFilter('stage', 'permit')
      result.current.setSearch('Alpha')
    })

    expect(result.current.filterValues).toEqual({ stage: 'permit' })
    expect(result.current.search).toBe('Alpha')

    act(() => {
      result.current.resetFilters()
    })

    expect(result.current.filterValues).toEqual({})
    expect(result.current.search).toBe('')
  })

  it('ignores null values when extracting dropdown options', () => {
    const { result } = renderHook(() =>
      useServerFilter(sampleData, {
        extractDropdowns: { city: 'city' },
      })
    )

    const cities = result.current.dropdowns.city
    // Only non-null cities: Austin, Dallas
    expect(cities).toHaveLength(2)
    expect(cities.map(d => d.value)).toEqual(['Austin', 'Dallas'])
  })
})
