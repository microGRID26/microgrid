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
    contractorAddress: '600 Northpark Central Dr, Suite 140',
    contractorPhone: '(832) 280-7764',
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

  it('minimum width is appropriate for inverter count', () => {
    const layout = calculateSldLayout(makeConfig())
    // Spatial layout (1-2 inv) uses ~1350, multi-row (3+) uses 1600+
    expect(layout.width).toBeGreaterThanOrEqual(1200)
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
    // Spatial layout uses "30 x 440" in STC box, multi-row uses "30 x 440W"
    const moduleText = texts.find(t => t.text.includes('30') && t.text.includes('440'))
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

  // ── Phase 3 SLD Enhancement tests ──

  it('includes numbered callout circles (1-9)', () => {
    const layout = calculateSldLayout(makeConfig())
    const callouts = layout.elements.filter(e => e.type === 'callout')
    // With 2 inverters: each gets callouts 1-6, plus shared 7,8,9
    // Inverter 1: ①②③④⑤⑥, Inverter 2: ①②③④⑤⑥, Shared: ⑦⑧⑨
    expect(callouts.length).toBeGreaterThanOrEqual(9)
    const numbers = callouts.map(c => c.number)
    // All TAG numbers 1-9 present
    for (let n = 1; n <= 9; n++) {
      expect(numbers).toContain(n)
    }
  })

  it('callout elements have positive radius', () => {
    const layout = calculateSldLayout(makeConfig())
    const callouts = layout.elements.filter(e => e.type === 'callout')
    for (const c of callouts) {
      expect(c.r ?? 10).toBeGreaterThan(0)
    }
  })

  it('includes installation notes box', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    expect(texts.some(t => t.text.includes('INSTALLATION NOTES'))).toBe(true)
    expect(texts.some(t => t.text.includes('RING TERMINALS'))).toBe(true)
    expect(texts.some(t => t.text.includes('RIGID RACK'))).toBe(true)
  })

  it('includes battery scope with disconnect ratings', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    expect(texts.some(t => t.text.includes('SERVICE DISCONNECT RATING'))).toBe(true)
    expect(texts.some(t => t.text.includes('SERVICE DISCONNECT FUSE RATING'))).toBe(true)
  })

  it('includes consumption CT element', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    expect(texts.some(t => t.text.includes('CONSUMPTION CT'))).toBe(true)
    // CT circle exists
    const circles = layout.elements.filter(e => e.type === 'circle')
    expect(circles.length).toBeGreaterThanOrEqual(2) // utility meter + CT
  })

  it('wire labels include EGC on AC segments', () => {
    const layout = calculateSldLayout(makeConfig())
    const texts = layout.elements.filter(e => e.type === 'text')
    const egcLabels = texts.filter(t => t.text.includes('EGC'))
    // At least 1 EGC label per inverter
    expect(egcLabels.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the configured AC conduit type from data, not a hardcoded literal', () => {
    const config = makeConfig()
    config.acConduit = '1-1/2" EMT'
    const layout = calculateSldLayout(config)
    const texts = layout.elements.filter(e => e.type === 'text')
    // Confirm the configured value flows through
    expect(texts.some(t => t.text.includes('1-1/2" EMT'))).toBe(true)
    // Confirm no hardcoded PVC remains
    expect(texts.some(t => t.text.includes('PVC'))).toBe(false)
  })
})
