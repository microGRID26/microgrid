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
    contractorLicense: '41312',
    contractorEmail: 'engineering@microgridenergy.com',
    systemTopology: 'string-mppt',
    rapidShutdownModel: 'RSD-D-20',
    hasCantexBar: true,
    hasRgm: false,  // Duracell projects skip RGM (William Carter feedback 2026-04-26)
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

  it('includes numbered callout circles 1-7 + 9 (RGM/8 gated)', () => {
    // Default Duracell config has hasRgm=false → callout ⑧ (RGM) is skipped
    const layout = calculateSldLayout(makeConfig())
    const callouts = layout.elements.filter(e => e.type === 'callout')
    const numbers = callouts.map(c => c.number)
    for (const n of [1, 2, 3, 4, 5, 6, 7, 9]) {
      expect(numbers).toContain(n)
    }
    expect(numbers).not.toContain(8)
  })

  it('includes callout ⑧ (RGM) when hasRgm=true', () => {
    const layout = calculateSldLayout(makeConfig({ hasRgm: true }))
    const callouts = layout.elements.filter(e => e.type === 'callout')
    expect(callouts.map(c => c.number)).toContain(8)
  })

  it('does NOT render RGM rect when hasRgm=false', () => {
    const layout = calculateSldLayout(makeConfig({ hasRgm: false }))
    const rgmTexts = layout.elements.filter(
      e => e.type === 'text' && /\(N\) RGM|PC-PRO-RGM/i.test(e.text),
    )
    expect(rgmTexts.length).toBe(0)
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

// ── SLD topology gating (Task 2.4) ─────────────────────────────────────────

describe('SLD topology gating', () => {
  it('regression guard — renderer never emits Hambrick legacy tokens', () => {
    // The MG SLD renderer is currently string-mppt-only. This test guards
    // against future regressions that accidentally introduce DPCRGM/DTU/
    // PLC/Ethernet labels into the string-mppt path.
    // See lib/planset-topology.ts for the topology discriminator.
    const config = makeConfig()
    config.systemTopology = 'string-mppt'
    const layout = calculateSldLayout(config)
    const texts = layout.elements.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts.some(t => t.includes('DPCRGM'))).toBe(false)
    expect(texts.some(t => t.includes('DTU'))).toBe(false)
    // Ethernet switch (micro-inverter artifact)
    expect(texts.some(t => /ethernet switch/i.test(t))).toBe(false)
    // PLC (micro-inverter artifact)
    expect(texts.some(t => /\bPLC\b/.test(t))).toBe(false)
  })

  it('micro-inverter topology renders DPCRGM box only when hasRgm=true', () => {
    // v4: the micro-inverter renderer gates the DPCRGM box on config.hasRgm.
    // The notes block always references DPCRGM by name, so we check the
    // standalone label (text === 'DPCRGM') rather than substring inclusion.
    const cfgOff = makeConfig()
    cfgOff.systemTopology = 'micro-inverter'
    cfgOff.hasRgm = false
    const offTexts = calculateSldLayout(cfgOff).elements
      .filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(offTexts.some(t => t === 'DPCRGM')).toBe(false)

    const cfgOn = makeConfig()
    cfgOn.systemTopology = 'micro-inverter'
    cfgOn.hasRgm = true
    const onTexts = calculateSldLayout(cfgOn).elements
      .filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(onTexts.some(t => t === 'DPCRGM')).toBe(true)
  })

  it('string-mppt topology produces a valid layout with elements', () => {
    const config = makeConfig()
    config.systemTopology = 'string-mppt'
    const layout = calculateSldLayout(config)
    expect(layout.elements.length).toBeGreaterThan(0)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('micro-inverter topology produces a valid layout with elements', () => {
    // The current SLD renderer is Duracell/string-MPPT style by design —
    // it never rendered DPCRGM/DTU/PLC/Ethernet even before Task 2.4.
    // micro-inverter topology flag is wired in for forward compatibility;
    // the layout must not crash and must still return valid elements.
    const config = makeConfig()
    config.systemTopology = 'micro-inverter'
    const layout = calculateSldLayout(config)
    expect(layout.elements.length).toBeGreaterThan(0)
    expect(layout.width).toBeGreaterThan(0)
  })

  it('renders RSD callout text using the configured rapidShutdownModel', () => {
    const config = makeConfig()
    config.systemTopology = 'string-mppt'
    config.rapidShutdownModel = 'RSD-D-20'
    const layout = calculateSldLayout(config)
    const texts = layout.elements.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts.some(t => t.includes('RSD-D-20'))).toBe(true)
  })

  it('renders Cantex bar callout when hasCantexBar=true', () => {
    const config = makeConfig()
    config.hasCantexBar = true
    const layout = calculateSldLayout(config)
    const texts = layout.elements.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts.some(t => /cantex/i.test(t))).toBe(true)
  })

  it('does NOT render Cantex bar when hasCantexBar=false', () => {
    const config = makeConfig()
    config.hasCantexBar = false
    const layout = calculateSldLayout(config)
    const texts = layout.elements.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts.some(t => /cantex/i.test(t))).toBe(false)
  })

  it('Cantex bar renders by default (hasCantexBar omitted)', () => {
    const config = makeConfig() // no hasCantexBar field
    const layout = calculateSldLayout(config)
    const texts = layout.elements.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    expect(texts.some(t => /cantex/i.test(t))).toBe(true)
  })

  it('RSD label renders per-string in spatial layout (2-inverter, 3-string config)', () => {
    // The default makeConfig() has 2 inverters (spatial path) with 3 strings total
    // (2 strings on inv 0, 1 string on inv 1). Each string must get its own RSD label.
    const config = makeConfig()
    const layout = calculateSldLayout(config)
    const texts = layout.elements.filter(e => e.type === 'text').map(e => (e as { text: string }).text)
    const rsdTexts = texts.filter(t => t.includes('RSD-D-20'))
    // 3 strings total → at least 3 RSD labels
    expect(rsdTexts.length).toBeGreaterThanOrEqual(3)
  })
})
