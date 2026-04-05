import { describe, it, expect } from 'vitest'
import { calculateSldLayout } from '@/lib/sld-layout'
import type { SldConfig } from '@/lib/sld-layout'
import { DURACELL_DEFAULTS } from '@/lib/planset-types'

// ── TEST FIXTURES ──────────────────────────────────────────────────────────

const D = DURACELL_DEFAULTS

function makeConfig(overrides: Partial<SldConfig> = {}): SldConfig {
  return {
    projectName: 'Test Homeowner',
    address: '123 Solar Ave, Houston TX 77060',
    panelModel: D.panelModel,
    panelWattage: D.panelWattage,
    panelCount: 30,
    inverterModel: D.inverterModel,
    inverterCount: D.inverterCount,
    inverterAcKw: D.inverterAcPower,
    maxPvPower: D.maxPvPower,
    mpptsPerInverter: D.mpptsPerInverter,
    stringsPerMppt: D.stringsPerMppt,
    maxCurrentPerMppt: D.maxCurrentPerMppt,
    batteryModel: D.batteryModel,
    batteryCount: D.batteryCount,
    batteryCapacity: D.batteryCapacity,
    batteriesPerStack: D.batteriesPerStack,
    rackingModel: D.rackingModel,
    strings: [
      { id: 1, modules: 10, roofFace: 1, vocCold: 405.4, vmp: 313, imp: 13.1 },
      { id: 2, modules: 10, roofFace: 1, vocCold: 405.4, vmp: 313, imp: 13.1 },
      { id: 3, modules: 10, roofFace: 2, vocCold: 405.4, vmp: 313, imp: 13.1 },
    ],
    stringsPerInverter: [[0, 1], [2]],
    meter: 'M123456',
    esid: 'ESID789',
    utility: 'CenterPoint',
    systemDcKw: 12.3,
    systemAcKw: 30,
    totalStorageKwh: 80,
    contractor: 'MicroGRID Energy',
    contractorAddress: '15200 E Hardy Rd',
    contractorPhone: '(888) 485-5551',
    contractorLicense: '32259',
    contractorEmail: 'engineering@microgridenergy.com',
    ...overrides,
  }
}

// ── calculateSldLayout ─────────────────────────────────────────────────────

describe('calculateSldLayout', () => {
  it('returns valid dimensions', () => {
    const layout = calculateSldLayout(makeConfig())
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('minimum width is 1600', () => {
    const layout = calculateSldLayout(makeConfig())
    expect(layout.width).toBeGreaterThanOrEqual(1600)
  })

  it('generates elements array', () => {
    const layout = calculateSldLayout(makeConfig())
    expect(layout.elements.length).toBeGreaterThan(0)
  })

  it('includes border rectangles', () => {
    const layout = calculateSldLayout(makeConfig())
    const rects = layout.elements.filter(e => e.type === 'rect')
    expect(rects.length).toBeGreaterThanOrEqual(2) // outer + inner border
  })

  it('includes text elements for STC box', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    const stcText = texts.find(t => t.text.includes('STC'))
    expect(stcText).toBeDefined()
  })

  it('includes text for module count and power', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    const moduleText = texts.find(t => t.text.includes('30') && t.text.includes('410W'))
    expect(moduleText).toBeDefined()
  })

  it('width increases with more inverters', () => {
    const layout2 = calculateSldLayout(makeConfig({ inverterCount: 2 }))
    const layout3 = calculateSldLayout(makeConfig({
      inverterCount: 3,
      stringsPerInverter: [[0], [1], [2]],
    }))
    expect(layout3.width).toBeGreaterThanOrEqual(layout2.width)
  })

  it('height increases with more strings per inverter', () => {
    const config3 = makeConfig({
      strings: [
        { id: 1, modules: 10, roofFace: 1, vocCold: 405.4, vmp: 313, imp: 13.1 },
        { id: 2, modules: 10, roofFace: 1, vocCold: 405.4, vmp: 313, imp: 13.1 },
        { id: 3, modules: 10, roofFace: 2, vocCold: 405.4, vmp: 313, imp: 13.1 },
      ],
      stringsPerInverter: [[0, 1], [2]],
    })
    const config6 = makeConfig({
      strings: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1, modules: 5, roofFace: 1, vocCold: 202.7, vmp: 156.5, imp: 13.1,
      })),
      stringsPerInverter: [[0, 1, 2], [3, 4, 5]],
    })
    const layout3 = calculateSldLayout(config3)
    const layout6 = calculateSldLayout(config6)
    expect(layout6.height).toBeGreaterThanOrEqual(layout3.height)
  })

  it('includes meter and ESID text', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    expect(texts.some(t => t.text.includes('M123456'))).toBe(true)
    expect(texts.some(t => t.text.includes('ESID789'))).toBe(true)
  })

  it('includes battery information', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    expect(texts.some(t => t.text.includes('DURACELL') || t.text.includes('5KWH'))).toBe(true)
  })

  it('all element coordinates are positive', () => {
    const layout = calculateSldLayout(makeConfig())
    for (const el of layout.elements) {
      if ('x' in el) expect(el.x).toBeGreaterThanOrEqual(0)
      if ('y' in el) expect(el.y).toBeGreaterThanOrEqual(0)
      if ('x1' in el) expect(el.x1).toBeGreaterThanOrEqual(0)
      if ('y1' in el) expect(el.y1).toBeGreaterThanOrEqual(0)
    }
  })

  it('all elements fit within sheet dimensions', () => {
    const layout = calculateSldLayout(makeConfig())
    for (const el of layout.elements) {
      if ('x' in el && 'w' in el) {
        expect(el.x + el.w).toBeLessThanOrEqual(layout.width + 5) // small tolerance
      }
    }
  })
})
