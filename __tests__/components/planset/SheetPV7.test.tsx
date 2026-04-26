import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SheetPV7 } from '@/components/planset/SheetPV7'
import type { PlansetData } from '@/lib/planset-types'
import { MICROGRID_CONTRACTOR } from '@/lib/planset-types'

const baseData: Partial<PlansetData> = {
  projectId: 'TEST-001',
  owner: 'Test Owner',
  address: '123 Main St',
  city: 'Houston',
  state: 'TX',
  zip: '77073',
  systemDcKw: 5.28,
  systemAcKw: 15,
  totalStorageKwh: 80,
  panelCount: 12,
  panelModel: 'JA Solar AMP 380',
  inverterCount: 2,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  batteryCount: 16,
  batteryModel: 'Duracell 5kWh LFP',
  contractor: MICROGRID_CONTRACTOR,
  // Minimal required fields to satisfy PlansetData
  strings: [],
  panelIsc: 10,
  panelImp: 9,
  panelVmp: 40,
  inverterAcPower: 15,
}

describe('SheetPV7 — warning labels page', () => {
  it('renders the live MicroGRID phone number (832) 280-7764', () => {
    const { container } = render(<SheetPV7 data={baseData as PlansetData} />)
    expect(container.textContent).toContain('(832) 280-7764')
  })

  it('renders NEC 705 multi-power-source caution language', () => {
    const { container } = render(<SheetPV7 data={baseData as PlansetData} />)
    expect(container.textContent?.toLowerCase()).toMatch(/multiple sources of power|warning|caution/)
  })

  it('does NOT render the dead 888 phone number', () => {
    const { container } = render(<SheetPV7 data={baseData as PlansetData} />)
    expect(container.textContent).not.toContain('888')
  })

  it('renders system summary tokens (DC kW, storage kWh, inverter model)', () => {
    const { container } = render(<SheetPV7 data={baseData as PlansetData} />)
    const text = container.textContent ?? ''
    // DC capacity
    expect(text).toMatch(/5\.28|5\.3/)
    // Storage capacity
    expect(text).toContain('80')
    // Inverter model name (or partial)
    expect(text).toMatch(/Duracell|Max Hybrid/i)
  })
})
