import { describe, it, expect } from 'vitest'
import { evaluateExportReadiness, type CutSheetStatus } from '@/lib/planset-export-readiness'
import { buildPlansetData, DURACELL_DEFAULTS } from '@/lib/planset-types'
import { CUT_SHEETS } from '@/components/planset/SheetCutSheets'
import type { Project } from '@/types/database'
import type { PlansetData } from '@/lib/planset-types'

// Use the same minimal-project pattern other planset tests use. The cast is
// intentional — we only need a few fields for buildPlansetData to succeed.
const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'test-1',
  name: 'Test Owner',
  address: '123 Test St',
  city: 'Houston',
  zip: '77073',
  utility: 'CenterPoint',
  module_qty: 36,
  battery_qty: null,
  inverter_qty: null,
  msp_bus_rating: '200',
  main_breaker: '200',
  ...overrides,
}) as unknown as Project

const allCutSheetsOk = (): Map<string, CutSheetStatus> =>
  new Map(CUT_SHEETS.map((cs) => [cs.sheetId, 'ok' as CutSheetStatus]))

// Build a planset that's compliant on every rule the gate checks, so each
// test below can isolate one failure mode at a time. Uses a 225A bus + 100A
// main so the 200A bus + 200A main + 2× 15kW Duracell 120%-rule failure
// (160A backfeed vs 40A allowable) doesn't trip the baseline.
function buildCompliantData(): PlansetData {
  const data = buildPlansetData(makeProject({ msp_bus_rating: '225', main_breaker: '100' }), {
    // 4 modules per string × 9 strings = 36 panels — keeps Voc-cold under 500V
    strings: Array.from({ length: 9 }, (_, i) => ({
      id: i,
      mppt: (i % 3) + 1,
      modules: 4,
      roofFace: 1,
      vocCold: 4 * 41.5 * 1.084, // 4 × Seraphim Voc × cold correction ≈ 180V
      vmpNominal: 4 * 34.8,
      current: 13.5,
    })),
    // Override Duracell battery-DC verification flag so the gate isn't
    // tripped by P0-1 in the compliant baseline.
    batteryDcSizingVerified: true,
  })
  return data
}

describe('evaluateExportReadiness — happy path', () => {
  it('returns canExport=true when every rule passes', () => {
    const data = buildCompliantData()
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    expect(result.canExport).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.allOverridable).toBe(false)
  })
})

describe('evaluateExportReadiness — NEC 705.12 (120% backfeed)', () => {
  it('blocks export when loadSideBackfeedCompliant=false', () => {
    // 100A bus + 100A main + 2× 15kW inverter = 160A backfeed; max allowable
    // = 100×1.2 - 100 = 20A → fail.
    const data = buildPlansetData(
      makeProject({ msp_bus_rating: '100', main_breaker: '100' }),
      { batteryDcSizingVerified: true, strings: [] }
    )
    expect(data.loadSideBackfeedCompliant).toBe(false)
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    expect(result.canExport).toBe(false)
    expect(result.failures.find((f) => f.rule === 'NEC_705_12_BACKFEED')).toBeTruthy()
  })

  it('NEC 705.12 failure is overridable (designer can attach AHJ-approved alternate)', () => {
    const data = buildPlansetData(
      makeProject({ msp_bus_rating: '100', main_breaker: '100' }),
      { batteryDcSizingVerified: true, strings: [] }
    )
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    const f = result.failures.find((f) => f.rule === 'NEC_705_12_BACKFEED')
    expect(f?.overridable).toBe(true)
  })
})

describe('evaluateExportReadiness — NEC 690.7 (max system voltage)', () => {
  it('blocks export when longest string Voc-cold exceeds inverter maxVoc', () => {
    // 14 × Seraphim 41.5V × 1.084 cold correction ≈ 630V > 500V Duracell limit
    const data = buildPlansetData(makeProject({ module_qty: 14 }), {
      batteryDcSizingVerified: true,
      strings: [{
        id: 1, mppt: 1, modules: 14, roofFace: 1,
        vocCold: 14 * 41.5 * 1.084, vmpNominal: 14 * 34.8, current: 13.5,
      }],
    })
    expect(data.maxSystemVoltageCompliant).toBe(false)
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    expect(result.canExport).toBe(false)
    const f = result.failures.find((f) => f.rule === 'NEC_690_7_MAX_VOLTAGE')
    expect(f).toBeTruthy()
    expect(f?.overridable).toBe(true)
  })

  it('passes when longest string Voc-cold is within limit', () => {
    const data = buildPlansetData(makeProject(), {
      batteryDcSizingVerified: true,
      strings: [{
        id: 1, mppt: 1, modules: 10, roofFace: 1,
        vocCold: 10 * 41.5 * 1.084, vmpNominal: 10 * 34.8, current: 13.5,
      }],
    })
    expect(data.maxSystemVoltageCompliant).toBe(true)
  })

  it('treats partially-configured projects as noncompliant (fail-closed)', () => {
    // panelCount > 0 but no strings configured yet — the planset shouldn't
    // be exportable until the designer wires the strings up.
    const data = buildPlansetData(makeProject({ module_qty: 12 }), {
      batteryDcSizingVerified: true,
      strings: [],
    })
    expect(data.maxSystemVoltageCompliant).toBe(false)
  })

  it('treats truly empty projects (no panels) as compliant', () => {
    const data = buildPlansetData(makeProject({ module_qty: 0 }), {
      batteryDcSizingVerified: true,
      strings: [],
    })
    expect(data.maxSystemVoltageCompliant).toBe(true)
  })
})

describe('evaluateExportReadiness — cut-sheet availability', () => {
  it('blocks export when any cut-sheet is missing', () => {
    const data = buildCompliantData()
    const status = allCutSheetsOk()
    status.set(CUT_SHEETS[0].sheetId, 'missing')
    const result = evaluateExportReadiness({ data, cutSheetStatus: status })
    expect(result.canExport).toBe(false)
    expect(result.failures.find((f) => f.rule === 'CUT_SHEET_MISSING')).toBeTruthy()
  })

  it('cut-sheet missing is NOT overridable (designer must fix the asset)', () => {
    const data = buildCompliantData()
    const status = allCutSheetsOk()
    status.set(CUT_SHEETS[0].sheetId, 'missing')
    const result = evaluateExportReadiness({ data, cutSheetStatus: status })
    const f = result.failures.find((f) => f.rule === 'CUT_SHEET_MISSING')
    expect(f?.overridable).toBe(false)
    expect(result.allOverridable).toBe(false)
  })

  it('blocks export when cut-sheet status is still pending', () => {
    const data = buildCompliantData()
    const status = new Map<string, CutSheetStatus>([[CUT_SHEETS[0].sheetId, 'pending']])
    const result = evaluateExportReadiness({ data, cutSheetStatus: status })
    expect(result.canExport).toBe(false)
  })
})

describe('evaluateExportReadiness — Duracell battery-DC unverified (P0-1)', () => {
  it('Max Hybrid 15kW (PE-verified 2026-05-07 via Duracell Setup Guide) passes by default', () => {
    // #349 resolved: Duracell Setup Guide states 200A continuous battery DC
    // discharge. batteryMaxCurrentA + batteryWire updated; default sizing
    // verified for the Max Hybrid 15 kW SKU.
    const data = buildPlansetData(makeProject(), { strings: [] })
    expect(data.batteryDcSizingVerified).toBe(true)
    expect(data.batteryMaxCurrentA).toBe(200)
    expect(data.batteryWire).toBe('250 kcmil CU THWN-2')
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    expect(result.failures.find((f) => f.rule === 'BATTERY_DC_UNVERIFIED')).toBeUndefined()
  })

  it('blocks export by default on a non-15kW Duracell SKU (fail-closed for future SKUs)', () => {
    // The fail-closed mechanism still gates any other Duracell inverter that
    // hasn't gone through its own PE-verification (e.g. Max Hybrid 6/8/10 kW).
    const data = buildPlansetData(makeProject(), {
      inverterModel: 'Duracell Power Center Max Hybrid 8kW',
      strings: [],
    })
    expect(data.batteryDcSizingVerified).toBe(false)
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    expect(result.failures.find((f) => f.rule === 'BATTERY_DC_UNVERIFIED')).toBeTruthy()
  })

  it('passes when designer has overridden batteryDcSizingVerified per project', () => {
    const data = buildCompliantData() // already overrides batteryDcSizingVerified=true
    expect(data.batteryDcSizingVerified).toBe(true)
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    expect(result.failures.find((f) => f.rule === 'BATTERY_DC_UNVERIFIED')).toBeUndefined()
  })

  it('passes by default on non-Duracell inverter (no known sizing issue)', () => {
    const data = buildPlansetData(makeProject(), {
      inverterModel: 'Enphase IQ8',
      strings: [],
    })
    expect(data.batteryDcSizingVerified).toBe(true)
  })

  it('battery-DC failure is overridable for an un-verified Duracell SKU', () => {
    const data = buildPlansetData(makeProject(), {
      inverterModel: 'Duracell Power Center Max Hybrid 8kW',
      strings: [],
    })
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    const f = result.failures.find((f) => f.rule === 'BATTERY_DC_UNVERIFIED')
    expect(f?.overridable).toBe(true)
  })
})

describe('evaluateExportReadiness — allOverridable aggregate', () => {
  it('allOverridable=true only when every failure is overridable', () => {
    // 120% + battery-DC both overridable
    const data = buildPlansetData(
      makeProject({ msp_bus_rating: '100', main_breaker: '100' }),
      { strings: [] } // battery-DC will also fail; both overridable
    )
    const result = evaluateExportReadiness({ data, cutSheetStatus: allCutSheetsOk() })
    expect(result.canExport).toBe(false)
    expect(result.failures.length).toBeGreaterThanOrEqual(2)
    expect(result.allOverridable).toBe(true)
  })

  it('allOverridable=false when at least one failure is non-overridable', () => {
    const data = buildPlansetData(
      makeProject({ msp_bus_rating: '100', main_breaker: '100' }),
      { strings: [] }
    )
    const status = allCutSheetsOk()
    status.set(CUT_SHEETS[0].sheetId, 'missing') // non-overridable
    const result = evaluateExportReadiness({ data, cutSheetStatus: status })
    expect(result.allOverridable).toBe(false)
  })
})

describe('buildPlansetData — new compliance fields', () => {
  it('exposes inverterMaxVoc from Duracell defaults', () => {
    const data = buildPlansetData(makeProject(), { strings: [] })
    expect(data.inverterMaxVoc).toBe(DURACELL_DEFAULTS.maxVoc)
  })

  it('maxStringVocCold is the max across configured strings', () => {
    const data = buildPlansetData(makeProject(), {
      batteryDcSizingVerified: true,
      strings: [
        { id: 1, mppt: 1, modules: 8,  roofFace: 1, vocCold: 100, vmpNominal: 280, current: 13.5 },
        { id: 2, mppt: 2, modules: 10, roofFace: 1, vocCold: 250, vmpNominal: 350, current: 13.5 },
        { id: 3, mppt: 3, modules: 6,  roofFace: 1, vocCold:  80, vmpNominal: 210, current: 13.5 },
      ],
    })
    expect(data.maxStringVocCold).toBe(250)
  })

  it('maxStringVocCold is 0 when no strings are configured', () => {
    const data = buildPlansetData(makeProject(), { strings: [] })
    expect(data.maxStringVocCold).toBe(0)
  })
})
