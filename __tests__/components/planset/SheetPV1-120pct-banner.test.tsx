import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SheetPV1 } from '@/components/planset/SheetPV1'
import { buildPlansetData } from '@/lib/planset-types'
import type { Project } from '@/types/database'
import type { PlansetString } from '@/lib/planset-types'

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'test', name: 'Test', address: '', city: '', zip: '', utility: '',
  module_qty: 45, battery_qty: null, inverter_qty: null,
  ...overrides,
}) as unknown as Project

const patriciaStrings: PlansetString[] = [1, 2, 3, 4, 5].map((id) => ({
  id, mppt: ((id - 1) % 3) + 1, modules: 9, roofFace: 1,
  vocCold: 404.9, vmpNominal: 313.2, current: 12.65,
}))

describe('SheetPV1 — 120% rule failure banner', () => {
  it("renders the red banner when loadSideBackfeedCompliant is false", () => {
    // Patricia config: 200A bus + 200A main → 40A headroom; 2× 80A backfeed = 160A.
    // 160 > 40 → fail.
    const data = buildPlansetData(makeProject(), {
      panelCount: 45, inverterCount: 2, strings: patriciaStrings,
    })
    expect(data.loadSideBackfeedCompliant).toBe(false)

    const { container } = render(<SheetPV1 data={data} enhanced />)
    const banner = container.querySelector('[data-banner-120pct-fail]')
    expect(banner).toBeTruthy()
    expect(banner?.textContent).toContain('120% RULE FAIL')
    expect(banner?.textContent).toContain(`${data.totalBackfeedA}A backfeed`)
    expect(banner?.textContent).toContain(`${data.maxAllowableBackfeedA}A max allowable`)
  })

  it("does NOT render the banner when the 120% rule passes", () => {
    // 200A main breaker, but smaller inverter (PCS-clamped) keeps backfeed low.
    // Single inverter @ 5kW → ~25A backfeed, well within 40A headroom.
    const data = buildPlansetData(makeProject(), {
      panelCount: 12, inverterCount: 1, inverterAcPower: 5,
      strings: patriciaStrings.slice(0, 1),
    })
    expect(data.loadSideBackfeedCompliant).toBe(true)

    const { container } = render(<SheetPV1 data={data} enhanced />)
    expect(container.querySelector('[data-banner-120pct-fail]')).toBeNull()
  })
})
