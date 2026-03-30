import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { getAllowedDispositions, useBulkSelect } from '@/components/BulkActionBar'
import type { Project } from '@/types/database'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'PROJ-001',
    name: 'Test Project',
    city: null,
    zip: null,
    address: null,
    phone: null,
    email: null,
    sale_date: null,
    stage: 'evaluation' as any,
    stage_date: null,
    pm: null,
    pm_id: null,
    disposition: null,
    contract: null,
    systemkw: null,
    financier: null,
    ahj: null,
    utility: null,
    advisor: null,
    consultant: null,
    blocker: null,
    financing_type: null,
    down_payment: null,
    tpo_escalator: null,
    financier_adv_pmt: null,
    module: null,
    module_qty: null,
    inverter: null,
    inverter_qty: null,
    battery: null,
    battery_qty: null,
    optimizer: null,
    optimizer_qty: null,
    meter_location: null,
    panel_location: null,
    voltage: null,
    msp_bus_rating: null,
    mpu: null,
    shutdown: null,
    performance_meter: null,
    interconnection_breaker: null,
    main_breaker: null,
    hoa: null,
    esid: null,
    permit_number: null,
    utility_app_number: null,
    permit_fee: null,
    reinspection_fee: null,
    city_permit_date: null,
    utility_permit_date: null,
    ntp_date: null,
    survey_scheduled_date: null,
    survey_date: null,
    install_scheduled_date: null,
    install_complete_date: null,
    city_inspection_date: null,
    utility_inspection_date: null,
    pto_date: null,
    in_service_date: null,
    site_surveyor: null,
    consultant_email: null,
    dealer: null,
    follow_up_date: null,
    energy_community: false,
    org_id: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── getAllowedDispositions() ──────────────────────────────────────────────────

describe('getAllowedDispositions()', () => {
  it('null disposition returns [Sale, Loyalty]', () => {
    const allowed = getAllowedDispositions(null)
    expect(allowed).toEqual(['Sale', 'Loyalty'])
  })

  it('Sale disposition returns [Sale, Loyalty]', () => {
    const allowed = getAllowedDispositions('Sale')
    expect(allowed).toEqual(['Sale', 'Loyalty'])
  })

  it('Loyalty disposition returns [Sale, Loyalty, Cancelled]', () => {
    const allowed = getAllowedDispositions('Loyalty')
    expect(allowed).toEqual(['Sale', 'Loyalty', 'Cancelled'])
  })

  it('In Service disposition returns [Sale, In Service]', () => {
    const allowed = getAllowedDispositions('In Service')
    expect(allowed).toEqual(['Sale', 'In Service'])
  })

  it('Cancelled disposition returns [Loyalty, Cancelled]', () => {
    const allowed = getAllowedDispositions('Cancelled')
    expect(allowed).toEqual(['Loyalty', 'Cancelled'])
  })

  it('cannot go directly from Sale to Cancelled', () => {
    const allowed = getAllowedDispositions('Sale')
    expect(allowed).not.toContain('Cancelled')
  })

  it('cannot go directly from null to Cancelled', () => {
    const allowed = getAllowedDispositions(null)
    expect(allowed).not.toContain('Cancelled')
  })

  it('Cancelled cannot go directly to Sale', () => {
    const allowed = getAllowedDispositions('Cancelled')
    expect(allowed).not.toContain('Sale')
  })

  it('In Service cannot go to Loyalty or Cancelled', () => {
    const allowed = getAllowedDispositions('In Service')
    expect(allowed).not.toContain('Loyalty')
    expect(allowed).not.toContain('Cancelled')
  })

  it('unknown disposition defaults to [Sale, Loyalty]', () => {
    const allowed = getAllowedDispositions('SomethingWeird')
    expect(allowed).toEqual(['Sale', 'Loyalty'])
  })
})

// ── useBulkSelect hook ───────────────────────────────────────────────────────

describe('useBulkSelect()', () => {
  const projects = [
    makeProject({ id: 'P1' }),
    makeProject({ id: 'P2' }),
    makeProject({ id: 'P3' }),
  ]

  it('starts with empty selection and selectMode off', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    expect(result.current.selectMode).toBe(false)
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.selectedProjects).toHaveLength(0)
  })

  it('toggleSelect adds an ID', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.toggleSelect('P1'))
    expect(result.current.selectedIds.has('P1')).toBe(true)
    expect(result.current.selectedIds.size).toBe(1)
    expect(result.current.selectedProjects).toHaveLength(1)
    expect(result.current.selectedProjects[0].id).toBe('P1')
  })

  it('toggleSelect removes an already-selected ID', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.toggleSelect('P1'))
    act(() => result.current.toggleSelect('P1'))
    expect(result.current.selectedIds.has('P1')).toBe(false)
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('toggleSelect adds multiple IDs independently', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.toggleSelect('P1'))
    act(() => result.current.toggleSelect('P2'))
    expect(result.current.selectedIds.size).toBe(2)
    expect(result.current.selectedIds.has('P1')).toBe(true)
    expect(result.current.selectedIds.has('P2')).toBe(true)
  })

  it('selectAll selects all provided IDs', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.selectAll(['P1', 'P2', 'P3']))
    expect(result.current.selectedIds.size).toBe(3)
    expect(result.current.selectedProjects).toHaveLength(3)
  })

  it('selectAll merges with existing selection', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.toggleSelect('P1'))
    act(() => result.current.selectAll(['P2', 'P3']))
    expect(result.current.selectedIds.size).toBe(3)
  })

  it('deselectAll clears selection', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.selectAll(['P1', 'P2', 'P3']))
    act(() => result.current.deselectAll())
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.selectedProjects).toHaveLength(0)
  })

  it('exitSelectMode clears selection and disables select mode', () => {
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.setSelectMode(true))
    act(() => result.current.selectAll(['P1', 'P2']))
    expect(result.current.selectMode).toBe(true)
    expect(result.current.selectedIds.size).toBe(2)

    act(() => result.current.exitSelectMode())
    expect(result.current.selectMode).toBe(false)
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('selectedProjects reflects current allProjects list', () => {
    // If an ID is selected but not in allProjects, it should not appear in selectedProjects
    const { result } = renderHook(() => useBulkSelect(projects))
    act(() => result.current.toggleSelect('P1'))
    act(() => result.current.toggleSelect('NONEXISTENT'))
    expect(result.current.selectedIds.size).toBe(2)
    // selectedProjects only includes matching projects
    expect(result.current.selectedProjects).toHaveLength(1)
    expect(result.current.selectedProjects[0].id).toBe('P1')
  })
})
