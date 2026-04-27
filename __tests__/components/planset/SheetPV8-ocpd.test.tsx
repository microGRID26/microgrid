import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SheetPV8 } from '@/components/planset/SheetPV8'
import { buildPlansetData } from '@/lib/planset-types'
import type { Project } from '@/types/database'
import type { PlansetString } from '@/lib/planset-types'

const makeProject = (): Project => ({
  id: 'test',
  name: 'Test',
  address: '',
  city: '',
  zip: '',
  utility: '',
  module_qty: 45,
  battery_qty: null,
  inverter_qty: null,
}) as unknown as Project

// Patricia Smith string config: 5× 9 modules, 3 on INV1 + 2 on INV2.
const patriciaStrings: PlansetString[] = [1, 2, 3, 4, 5].map((id) => ({
  id, mppt: ((id - 1) % 3) + 1, modules: 9, roofFace: 1,
  vocCold: 404.9, vmpNominal: 313.2, current: 12.65,
}))

// Conductor schedule column order (matches SheetPV8 condColHeaders):
//   0 TAG · 1 CIRCUIT ORIGIN · 2 FLA · 3 FLA×1.25 · 4 OCPD · 5 #WIRES · 6 WIRE
//   7 #GND · 8 GND SIZE · 9 WIRE TYPE · 10 CONDUIT · 11 AMPACITY · ...
const COL_OCPD = 4
const COL_CONDUIT = 10

const findRowByCircuit = (container: HTMLElement, substr: string): HTMLTableRowElement | undefined =>
  Array.from(container.querySelectorAll('tbody tr')).find((tr) => {
    const cell1 = tr.children[1]?.textContent ?? ''
    return cell1.includes(substr)
  }) as HTMLTableRowElement | undefined

const cell = (row: HTMLTableRowElement, idx: number): string => row.children[idx]?.textContent?.trim() ?? ''

describe('SheetPV8 OCPD columns — cross-sheet consistency', () => {
  // Each test asserts against the OCPD cell specifically, not a substring of
  // the full row text (which can contain false-positive matches like "25" in
  // the corrected-ampacity column "25.5").

  it('string OCPD = 25A per NEC 690.9(B): Isc × 1.56 (was 20A from Imp × 1.25)', () => {
    const data = buildPlansetData(makeProject(), { panelCount: 45, inverterCount: 2, strings: patriciaStrings })
    const { container } = render(<SheetPV8 data={data} />)
    const stringRow = findRowByCircuit(container, 'STRING 1 (')
    expect(stringRow).toBeDefined()
    // Isc 13.5 × 1.56 = 21.06 → ceil to 25A. Bug rendered 20A.
    expect(cell(stringRow!, COL_OCPD)).toBe('25')
  })

  it('inverter→MSP OCPD tracks data.backfeedBreakerA (different inverter sizes give different OCPDs)', () => {
    // Default Duracell 2× 15kW → 80A backfeed each (PCS-clamped).
    const dataDefault = buildPlansetData(makeProject(), {
      panelCount: 45, inverterCount: 2, strings: patriciaStrings,
    })
    const { container: c1 } = render(<SheetPV8 data={dataDefault} />)
    const invRow1 = findRowByCircuit(c1, 'INVERTER → MSP')!
    expect(cell(invRow1, COL_OCPD)).toBe(String(dataDefault.backfeedBreakerA))

    // Different inverter size — backfeed should change. If OCPD were hardcoded
    // 100, this assertion would fail (or both would falsely match).
    const dataSmaller = buildPlansetData(makeProject(), {
      panelCount: 12, inverterCount: 1, inverterAcPower: 5,
      strings: patriciaStrings.slice(0, 1),
    })
    const { container: c2 } = render(<SheetPV8 data={dataSmaller} />)
    const invRow2 = findRowByCircuit(c2, 'INVERTER → MSP')!
    expect(cell(invRow2, COL_OCPD)).toBe(String(dataSmaller.backfeedBreakerA))
    expect(dataSmaller.backfeedBreakerA).not.toBe(dataDefault.backfeedBreakerA)
  })

  it('service-entrance row conduit uses data.serviceEntranceConduit', () => {
    const data = buildPlansetData(makeProject(), {
      panelCount: 45, inverterCount: 2, strings: patriciaStrings, serviceEntranceConduit: '3" EMT',
    })
    const { container } = render(<SheetPV8 data={data} />)
    const genRow = findRowByCircuit(container, 'SERVICE DISCONNECT')!
    expect(cell(genRow, COL_CONDUIT)).toBe('3" EMT')
  })

  it('service-entrance OCPD tracks data.mainBreaker, not hardcoded 200', () => {
    const proj = makeProject()
    proj.main_breaker = '150A' as unknown as Project['main_breaker']
    const data = buildPlansetData(proj, { panelCount: 45, inverterCount: 2, strings: patriciaStrings })
    const { container } = render(<SheetPV8 data={data} />)
    const genRow = findRowByCircuit(container, 'SERVICE DISCONNECT')!
    expect(cell(genRow, COL_OCPD)).toBe('150')
  })

  it('service-entrance OCPD falls back to 200 on garbage / 0 / negative mainBreaker', () => {
    // Defensive parse: parseInt('0A') = 0, but 0 isn't a valid service size,
    // so the guard treats it as garbage and falls back to 200A residential
    // default. Same shape as the planset-calcs canonical helper.
    for (const bad of ['unknown', '', '0', '-50']) {
      const proj = makeProject()
      proj.main_breaker = bad as unknown as Project['main_breaker']
      const data = buildPlansetData(proj, { panelCount: 45, inverterCount: 2, strings: patriciaStrings })
      const { container } = render(<SheetPV8 data={data} />)
      const genRow = findRowByCircuit(container, 'SERVICE DISCONNECT')!
      expect(cell(genRow, COL_OCPD)).toBe('200')
    }
  })
})
