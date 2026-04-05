import { describe, it, expect } from 'vitest'
import {
  autoDistributeStrings,
  calcDcVoltageDrop,
  calcAcVoltageDrop,
  calcAmpacityCorrection,
  calcStringFuseSize,
  calcOcpdSize,
  buildConductorSchedule,
  buildBom,
  WIRE_RESISTANCE,
  NEC,
  AMPACITY_TABLE,
} from '@/lib/planset-calcs'
import { buildPlansetData, DURACELL_DEFAULTS } from '@/lib/planset-types'
import type { Project } from '@/types/database'

// ── TEST FIXTURES ──────────────────────────────────────────────────────────

/** Minimal project fixture matching Duracell defaults */
function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'test-001',
    name: 'Test Homeowner',
    address: '123 Solar Ave',
    city: 'Houston',
    state: 'TX',
    zip: '77060',
    utility: 'CenterPoint',
    meter_number: 'M123456',
    esid: 'ESID789',
    ahj: 'City of Houston',
    voltage: '120/240V',
    msp_bus_rating: '200',
    main_breaker: '200A',
    module: 'AMP 410W',
    module_qty: 30,
    inverter: 'Duracell 15kW',
    inverter_qty: 2,
    battery_qty: 16,
    ...overrides,
  } as Project
}

const D = DURACELL_DEFAULTS

// ── autoDistributeStrings ──────────────────────────────────────────────────

describe('autoDistributeStrings', () => {
  // Standard Duracell config: 30 panels, 2 inverters, 3 MPPT × 2 strings = 12 inputs
  // vocCorrected for Duracell: 37.4 × (1 + 0.0028 × 30) = 37.4 × 1.084 = 40.54
  const vocCorrected = 40.54

  it('distributes 30 panels across Duracell inverters correctly', () => {
    const strings = autoDistributeStrings(30, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    // maxPerString = floor(500 / 40.54) = 12
    // neededStrings = ceil(30 / 12) = 3, but capped at min(3, 12) = 3
    expect(strings.length).toBe(3)
    // 30 / 3 = 10 each, no remainder
    expect(strings.every(s => s.modules === 10)).toBe(true)
    // Total modules
    expect(strings.reduce((sum, s) => sum + s.modules, 0)).toBe(30)
  })

  it('handles uneven distribution (remainder panels)', () => {
    const strings = autoDistributeStrings(32, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    // 32 / 3 strings = 10 base + 2 extra → first 2 get 11, last gets 10
    expect(strings.length).toBe(3)
    expect(strings[0].modules).toBe(11)
    expect(strings[1].modules).toBe(11)
    expect(strings[2].modules).toBe(10)
    expect(strings.reduce((sum, s) => sum + s.modules, 0)).toBe(32)
  })

  it('respects max Voc limit', () => {
    const strings = autoDistributeStrings(30, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    // Each string Voc should stay under 500V
    for (const s of strings) {
      expect(s.vocCold).toBeLessThanOrEqual(500)
    }
  })

  it('caps strings at total available inputs', () => {
    // 1 inverter × 1 MPPT × 1 string = 1 input total, but needs many strings
    const strings = autoDistributeStrings(30, vocCorrected, D.panelVmp, D.panelImp, 1, 1, 1, 500)
    expect(strings.length).toBe(1) // Capped at total inputs
    expect(strings[0].modules).toBe(30)
  })

  it('returns empty array for zero panels', () => {
    const strings = autoDistributeStrings(0, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    expect(strings).toEqual([])
  })

  it('returns empty array for zero inverters', () => {
    const strings = autoDistributeStrings(30, vocCorrected, D.panelVmp, D.panelImp, 0, 3, 2, 500)
    expect(strings).toEqual([])
  })

  it('assigns correct MPPT numbers', () => {
    // 2 strings per MPPT → strings 1-2 on MPPT 1, 3-4 on MPPT 2, etc.
    const strings = autoDistributeStrings(60, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    for (const s of strings) {
      const expectedMppt = Math.floor((s.id - 1) / 2) + 1
      expect(s.mppt).toBe(expectedMppt)
    }
  })

  it('calculates vocCold correctly per string', () => {
    const strings = autoDistributeStrings(30, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    for (const s of strings) {
      const expected = parseFloat((s.modules * vocCorrected).toFixed(1))
      expect(s.vocCold).toBe(expected)
    }
  })

  it('calculates vmpNominal correctly per string', () => {
    const strings = autoDistributeStrings(30, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    for (const s of strings) {
      const expected = parseFloat((s.modules * D.panelVmp).toFixed(1))
      expect(s.vmpNominal).toBe(expected)
    }
  })

  it('sets current to panelImp for all strings', () => {
    const strings = autoDistributeStrings(30, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    expect(strings.every(s => s.current === D.panelImp)).toBe(true)
  })

  it('handles large system (100 panels)', () => {
    const strings = autoDistributeStrings(100, vocCorrected, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    // 100 panels, maxPerString=12 → need ceil(100/12)=9 strings, 12 inputs available
    expect(strings.length).toBe(9)
    expect(strings.reduce((sum, s) => sum + s.modules, 0)).toBe(100)
  })

  it('handles small system (5 panels)', () => {
    const strings = autoDistributeStrings(5, vocCorrected, D.panelVmp, D.panelImp, 1, 3, 2, 500)
    // 5 panels, maxPerString=12, need 1 string
    expect(strings.length).toBe(1)
    expect(strings[0].modules).toBe(5)
  })
})

// ── buildPlansetData ───────────────────────────────────────────────────────

describe('buildPlansetData', () => {
  it('calculates system DC kW correctly', () => {
    const data = buildPlansetData(makeProject({ module_qty: 30 }))
    // 30 × 410W / 1000 = 12.3 kW
    expect(data.systemDcKw).toBe(12.3)
  })

  it('calculates system AC kW correctly', () => {
    const data = buildPlansetData(makeProject())
    // 2 inverters × 15 kW = 30 kW
    expect(data.systemAcKw).toBe(30)
  })

  it('calculates total storage kWh', () => {
    const data = buildPlansetData(makeProject())
    // 16 batteries × 5 kWh = 80 kWh
    expect(data.totalStorageKwh).toBe(80)
  })

  it('calculates Voc temperature correction', () => {
    const data = buildPlansetData(makeProject())
    // absCoeff = |(-0.28)| / 100 = 0.0028
    // vocCorrected = 37.4 × (1 + 0.0028 × (25 - (-5)))
    // = 37.4 × (1 + 0.0028 × 30) = 37.4 × 1.084 = 40.5416
    expect(data.vocCorrected).toBeCloseTo(40.54, 1)
  })

  it('sets PCS current to bus rating', () => {
    const data = buildPlansetData(makeProject({ msp_bus_rating: '200' }))
    expect(data.pcsCurrentSetting).toBe(200)
  })

  it('defaults bus rating to 200 when not set', () => {
    const data = buildPlansetData(makeProject({ msp_bus_rating: null }))
    expect(data.pcsCurrentSetting).toBe(200)
  })

  it('calculates racking attachment count', () => {
    const data = buildPlansetData(makeProject({ module_qty: 30 }))
    // ceil(30 × 2.2) = ceil(66) = 66
    expect(data.racking.attachmentCount).toBe(66)
  })

  it('calculates racking rail count', () => {
    const data = buildPlansetData(makeProject({ module_qty: 30 }))
    // ceil(30 × 0.7) = ceil(21) = 21
    expect(data.racking.railCount).toBe(21)
  })

  it('calculates rail splice count from rail count', () => {
    const data = buildPlansetData(makeProject({ module_qty: 30 }))
    // ceil(21 × 0.5) = 11
    expect(data.racking.railSpliceCount).toBe(11)
  })

  it('calculates mid clamp count', () => {
    const data = buildPlansetData(makeProject({ module_qty: 30 }))
    // ceil(30 × 1.5) = 45
    expect(data.racking.midClampCount).toBe(45)
  })

  it('calculates end clamp count', () => {
    const data = buildPlansetData(makeProject({ module_qty: 30 }))
    // ceil(30 × 1.0) = 30
    expect(data.racking.endClampCount).toBe(30)
  })

  it('calculates rail length in inches', () => {
    const data = buildPlansetData(makeProject({ module_qty: 30 }))
    // round(30 × 42.5) = 1275
    expect(data.racking.railLengthIn).toBe(1275)
  })

  it('distributes strings across inverters', () => {
    const strings = autoDistributeStrings(30, 40.54, D.panelVmp, D.panelImp, 2, 3, 2, 500)
    const data = buildPlansetData(makeProject({ module_qty: 30 }), { strings })
    // 3 strings, 2 inverters → ceil(3/2)=2 per inv → inv1: [0,1], inv2: [2]
    expect(data.stringsPerInverter).toHaveLength(2)
    expect(data.stringsPerInverter[0]).toEqual([0, 1])
    expect(data.stringsPerInverter[1]).toEqual([2])
  })

  it('derives roof faces from strings', () => {
    const strings = [
      { id: 1, mppt: 1, modules: 10, roofFace: 1, vocCold: 405.4, vmpNominal: 313, current: 13.1 },
      { id: 2, mppt: 1, modules: 10, roofFace: 1, vocCold: 405.4, vmpNominal: 313, current: 13.1 },
      { id: 3, mppt: 2, modules: 10, roofFace: 2, vocCold: 405.4, vmpNominal: 313, current: 13.1 },
    ]
    const data = buildPlansetData(makeProject(), { strings })
    expect(data.roofFaces).toHaveLength(2)
    expect(data.roofFaces.find(f => f.id === 1)?.modules).toBe(20)
    expect(data.roofFaces.find(f => f.id === 2)?.modules).toBe(10)
  })

  it('applies overrides over defaults', () => {
    const data = buildPlansetData(makeProject(), {
      panelWattage: 500,
      inverterCount: 3,
      batteryCount: 20,
    })
    expect(data.panelWattage).toBe(500)
    expect(data.inverterCount).toBe(3)
    expect(data.batteryCount).toBe(20)
    expect(data.systemAcKw).toBe(45) // 3 × 15
    expect(data.totalStorageKwh).toBe(100) // 20 × 5
  })

  it('handles zero module quantity', () => {
    const data = buildPlansetData(makeProject({ module_qty: 0 }))
    expect(data.systemDcKw).toBe(0)
    expect(data.panelCount).toBe(0)
    expect(data.racking.attachmentCount).toBe(0)
  })
})

// ── DC Voltage Drop ────────────────────────────────────────────────────────

describe('calcDcVoltageDrop', () => {
  it('calculates standard Duracell string voltage drop', () => {
    // Isc=14A, Vmp=313V (10-module string), 100ft run, #10 wire
    const result = calcDcVoltageDrop(14.0, 313, 100, '#10')
    // V_drop = 2 × 100 × 14.0 × 1.24 / 1000 = 3.472V
    // V_drop% = 3.472 / 313 × 100 = 1.109%
    expect(result.vDrop).toBeCloseTo(3.472, 2)
    expect(result.vDropPct).toBeCloseTo(1.109, 1)
    expect(result.status).toBe('PASS')
  })

  it('fails when voltage drop exceeds 2%', () => {
    // Long run with high current → should fail
    const result = calcDcVoltageDrop(14.0, 100, 200, '#10')
    // V_drop = 2 × 200 × 14 × 1.24 / 1000 = 6.944V
    // V_drop% = 6.944 / 100 = 6.94%
    expect(result.status).toBe('FAIL')
    expect(result.vDropPct).toBeGreaterThan(2)
  })

  it('handles different wire sizes', () => {
    const result10 = calcDcVoltageDrop(14.0, 313, 100, '#10')
    const result8 = calcDcVoltageDrop(14.0, 313, 100, '#8')
    // Thicker wire = less resistance = less drop
    expect(result8.vDrop).toBeLessThan(result10.vDrop)
  })

  it('handles zero Vmp gracefully', () => {
    const result = calcDcVoltageDrop(14.0, 0, 100, '#10')
    expect(result.vDropPct).toBe(0)
    expect(result.status).toBe('PASS')
  })
})

// ── AC Voltage Drop ────────────────────────────────────────────────────────

describe('calcAcVoltageDrop', () => {
  it('calculates standard inverter AC drop', () => {
    // 15kW inverter, 50ft run, #4 wire at 240V
    const result = calcAcVoltageDrop(15, 50, '#4')
    // Current = 15000 / 240 = 62.5A
    // V_drop = 2 × 50 × 62.5 × 0.308 / 1000 = 1.925V
    // V_drop% = 1.925 / 240 = 0.802%
    expect(result.vDrop).toBeCloseTo(1.925, 2)
    expect(result.vDropPct).toBeCloseTo(0.802, 1)
    expect(result.status).toBe('PASS')
  })

  it('fails when AC drop exceeds 3%', () => {
    // Very long run
    const result = calcAcVoltageDrop(15, 500, '#10')
    expect(result.status).toBe('FAIL')
    expect(result.vDropPct).toBeGreaterThan(3)
  })
})

// ── Ampacity Correction ────────────────────────────────────────────────────

describe('calcAmpacityCorrection', () => {
  it('corrects #10 AWG DC string ampacity', () => {
    const result = calcAmpacityCorrection(AMPACITY_TABLE[0])
    // 40 × 0.70 × 0.91 = 25.48 → rounded to 25.5
    expect(result.correctedAmpacity).toBeCloseTo(25.5, 0)
    // 75°C max is 30, corrected is 25.5 → usable = 25.5
    expect(result.usableAmpacity).toBe(result.correctedAmpacity)
  })

  it('corrects #4 AWG battery ampacity', () => {
    const result = calcAmpacityCorrection(AMPACITY_TABLE[1])
    // 95 × 0.70 × 0.91 = 60.515 → 60.5
    expect(result.correctedAmpacity).toBeCloseTo(60.5, 0)
    // 75°C max is 85, corrected is ~60.5 → usable = 60.5
    expect(result.usableAmpacity).toBe(result.correctedAmpacity)
  })

  it('corrects #1 AWG inverter AC ampacity', () => {
    const result = calcAmpacityCorrection(AMPACITY_TABLE[2])
    // 145 × 0.70 × 0.91 = 92.365 → 92.4
    expect(result.correctedAmpacity).toBeCloseTo(92.4, 0)
    // 75°C max is 130, corrected is ~92.4 → usable = 92.4
    expect(result.usableAmpacity).toBe(result.correctedAmpacity)
  })

  it('corrects #6 AWG EGC ampacity', () => {
    const result = calcAmpacityCorrection(AMPACITY_TABLE[3])
    // 75 × 1.0 × 0.91 = 68.25 → 68.3
    expect(result.correctedAmpacity).toBeCloseTo(68.3, 0)
    // 75°C max is 65 → usable = 65 (capped)
    expect(result.usableAmpacity).toBe(65)
  })

  it('usable is min of corrected and 75C max', () => {
    for (const row of AMPACITY_TABLE) {
      const result = calcAmpacityCorrection(row)
      expect(result.usableAmpacity).toBe(Math.min(result.correctedAmpacity, result.max75C))
    }
  })
})

// ── Fuse / OCPD Sizing ────────────────────────────────────────────────────

describe('calcStringFuseSize', () => {
  it('calculates fuse for Duracell panel (Isc=14A)', () => {
    const { fuseCalc, fuseSize } = calcStringFuseSize(14.0)
    // 14.0 × 1.56 = 21.84 → round up to 25A
    expect(fuseCalc).toBeCloseTo(21.84, 1)
    expect(fuseSize).toBe(25)
  })

  it('rounds up to nearest 5A', () => {
    // Isc=10 → 10 × 1.56 = 15.6 → 20A
    expect(calcStringFuseSize(10).fuseSize).toBe(20)
    // Isc=8 → 8 × 1.56 = 12.48 → 15A
    expect(calcStringFuseSize(8).fuseSize).toBe(15)
    // Isc=20 → 20 × 1.56 = 31.2 → 35A
    expect(calcStringFuseSize(20).fuseSize).toBe(35)
  })
})

describe('calcOcpdSize', () => {
  it('calculates OCPD for string FLA (125% rule)', () => {
    const { fla125, ocpd } = calcOcpdSize(13.1) // panelImp
    // 13.1 × 1.25 = 16.375 → 20A
    expect(fla125).toBeCloseTo(16.38, 1)
    expect(ocpd).toBe(20)
  })

  it('rounds up correctly', () => {
    // FLA=20 → 25 → OCPD=25
    expect(calcOcpdSize(20).ocpd).toBe(25)
    // FLA=40 → 50 → OCPD=50
    expect(calcOcpdSize(40).ocpd).toBe(50)
    // FLA=62.5 → 78.125 → OCPD=80
    expect(calcOcpdSize(62.5).ocpd).toBe(80)
  })
})

// ── Conductor Schedule ─────────────────────────────────────────────────────

describe('buildConductorSchedule', () => {
  const strings = autoDistributeStrings(30, 40.54, D.panelVmp, D.panelImp, 2, 3, 2, 500)
  const data = buildPlansetData(makeProject({ module_qty: 30 }), { strings })

  it('includes one entry per string', () => {
    const schedule = buildConductorSchedule(data)
    const stringEntries = schedule.filter(e => e.tag.startsWith('S'))
    expect(stringEntries.length).toBe(strings.length)
  })

  it('includes battery entry when batteries present', () => {
    const schedule = buildConductorSchedule(data)
    expect(schedule.some(e => e.tag === 'BATT')).toBe(true)
  })

  it('excludes battery entry when no batteries', () => {
    const noBattData = buildPlansetData(makeProject({ module_qty: 30 }), { strings, batteryCount: 0 })
    const schedule = buildConductorSchedule(noBattData)
    expect(schedule.some(e => e.tag === 'BATT')).toBe(false)
  })

  it('includes inverter entry', () => {
    const schedule = buildConductorSchedule(data)
    expect(schedule.some(e => e.tag === 'INV')).toBe(true)
  })

  it('string usable ampacity exceeds string FLA×1.25', () => {
    const schedule = buildConductorSchedule(data)
    const stringEntries = schedule.filter(e => e.tag.startsWith('S'))
    for (const entry of stringEntries) {
      expect(entry.usableAmpacity).toBeGreaterThanOrEqual(entry.fla125)
    }
  })

  it('inverter usable ampacity exceeds inverter FLA×1.25', () => {
    const schedule = buildConductorSchedule(data)
    const invEntry = schedule.find(e => e.tag === 'INV')!
    expect(invEntry.usableAmpacity).toBeGreaterThanOrEqual(invEntry.fla125)
  })

  it('string FLA matches panel Imp', () => {
    const schedule = buildConductorSchedule(data)
    const stringEntry = schedule.find(e => e.tag === 'S1')!
    expect(stringEntry.fla).toBe(D.panelImp)
  })

  it('inverter FLA calculated from AC power', () => {
    const schedule = buildConductorSchedule(data)
    const invEntry = schedule.find(e => e.tag === 'INV')!
    // 15kW / 240V × 1000 = 62.5A
    expect(invEntry.fla).toBeCloseTo(62.5, 1)
  })
})

// ── BOM Generation ─────────────────────────────────────────────────────────

describe('buildBom', () => {
  const data = buildPlansetData(makeProject({ module_qty: 30 }))

  it('includes all 14 BOM line items', () => {
    const bom = buildBom(data)
    expect(bom.length).toBe(14)
  })

  it('panel quantity matches project', () => {
    const bom = buildBom(data)
    const panels = bom.find(r => r.item === 'SOLAR PV MODULE')!
    expect(panels.qty).toBe(30)
  })

  it('RSD quantity matches panel count', () => {
    const bom = buildBom(data)
    const rsd = bom.find(r => r.item === 'RAPID SHUTDOWN DEVICE')!
    expect(rsd.qty).toBe(30)
  })

  it('inverter quantity matches config', () => {
    const bom = buildBom(data)
    const inv = bom.find(r => r.item === 'INVERTER')!
    expect(inv.qty).toBe(2)
  })

  it('battery quantity matches config', () => {
    const bom = buildBom(data)
    const batt = bom.find(r => r.item === 'BATTERY')!
    expect(batt.qty).toBe(16)
  })

  it('attachment count matches racking calculation', () => {
    const bom = buildBom(data)
    const att = bom.find(r => r.item === 'ATTACHMENT')!
    expect(att.qty).toBe(data.racking.attachmentCount)
  })

  it('rail count matches racking calculation', () => {
    const bom = buildBom(data)
    const rail = bom.find(r => r.item === 'RAIL')!
    expect(rail.qty).toBe(data.racking.railCount)
  })
})

// ── Wire Resistance Table ──────────────────────────────────────────────────

describe('WIRE_RESISTANCE', () => {
  it('has entries for all standard sizes', () => {
    const sizes = ['#14', '#12', '#10', '#8', '#6', '#4', '#3', '#2', '#1', '1/0']
    for (const size of sizes) {
      expect(WIRE_RESISTANCE[size]).toBeDefined()
      expect(WIRE_RESISTANCE[size]).toBeGreaterThan(0)
    }
  })

  it('resistance decreases with larger wire', () => {
    expect(WIRE_RESISTANCE['#14']).toBeGreaterThan(WIRE_RESISTANCE['#12'])
    expect(WIRE_RESISTANCE['#12']).toBeGreaterThan(WIRE_RESISTANCE['#10'])
    expect(WIRE_RESISTANCE['#10']).toBeGreaterThan(WIRE_RESISTANCE['#8'])
    expect(WIRE_RESISTANCE['#4']).toBeGreaterThan(WIRE_RESISTANCE['#1'])
    expect(WIRE_RESISTANCE['#1']).toBeGreaterThan(WIRE_RESISTANCE['1/0'])
  })
})

// ── NEC Constants Sanity ───────────────────────────────────────────────────

describe('NEC constants', () => {
  it('ambient temp is 37°C', () => {
    expect(NEC.ambientTemp).toBe(37)
  })

  it('temp correction factor is 0.91', () => {
    expect(NEC.tempCorrectionFactor).toBe(0.91)
  })

  it('conduit fill factor is 0.70', () => {
    expect(NEC.conduitFillFactor).toBe(0.70)
  })

  it('AC voltage is 240V', () => {
    expect(NEC.acVoltage).toBe(240)
  })
})
