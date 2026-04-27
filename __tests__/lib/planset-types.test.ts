import { describe, it, expect } from 'vitest'
import { MICROGRID_CONTRACTOR, buildPlansetData, DURACELL_DEFAULTS, ampacityFor, NEC_AMPACITY_75C } from '@/lib/planset-types'
import type { Project } from '@/types/database'

describe('MICROGRID_CONTRACTOR phone', () => {
  it('uses the live 832 number, not the dead 888 number', () => {
    expect(MICROGRID_CONTRACTOR.phone).toBe('(832) 280-7764')
  })
  it('is in proper formatted (XXX) XXX-XXXX shape', () => {
    expect(MICROGRID_CONTRACTOR.phone).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/)
  })
})

const makeProject = (): Project => ({
  id: 'test',
  name: 'Test',
  address: '',
  city: '',
  zip: '',
  utility: '',
  module_qty: 12,
  battery_qty: null,
  inverter_qty: null,
}) as unknown as Project

describe('PlansetData topology discriminator', () => {
  it('defaults to string-mppt for new Duracell projects', () => {
    const data = buildPlansetData(makeProject())
    expect(data.systemTopology).toBe('string-mppt')
  })
  it('respects override to micro-inverter (Hambrick-style legacy projects)', () => {
    const data = buildPlansetData(makeProject(), { systemTopology: 'micro-inverter' })
    expect(data.systemTopology).toBe('micro-inverter')
  })
  it('rapidShutdownModel defaults to RSD-D-20', () => {
    const data = buildPlansetData(makeProject())
    expect(data.rapidShutdownModel).toBe('RSD-D-20')
  })
  it('rapidShutdownModel override is respected', () => {
    const data = buildPlansetData(makeProject(), { rapidShutdownModel: 'IMO RSD-D-50' })
    expect(data.rapidShutdownModel).toBe('IMO RSD-D-50')
  })
  it('hasCantexBar defaults to true', () => {
    const data = buildPlansetData(makeProject())
    expect(data.hasCantexBar).toBe(true)
  })
  it('hasCantexBar override to false is respected', () => {
    const data = buildPlansetData(makeProject(), { hasCantexBar: false })
    expect(data.hasCantexBar).toBe(false)
  })
})

describe('PlansetRoofFace polygon + setbacks', () => {
  it('roof faces default to empty polygon and all setbacks false (walkable) when not provided', () => {
    const data = buildPlansetData(makeProject(), {
      strings: [{ id: 1, mppt: 1, modules: 12, roofFace: 1, vocCold: 0, vmpNominal: 0, current: 0 }],
    })
    expect(data.roofFaces.length).toBe(1)
    const f = data.roofFaces[0]
    expect(f.polygon).toEqual([])
    expect(f.setbacks).toEqual({ ridge: false, eave: false, rake: false, pathClear: 'walkable' })
  })

  it('roof face polygon + setbacks override is preserved end-to-end', () => {
    const polygon: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const data = buildPlansetData(makeProject(), {
      roofFaces: [{
        id: 1, tilt: 25, azimuth: 180, modules: 12,
        polygon,
        setbacks: { ridge: true, eave: false, rake: false, pathClear: 'partial' },
      }],
    })
    expect(data.roofFaces[0].polygon).toEqual(polygon)
    expect(data.roofFaces[0].setbacks.ridge).toBe(true)
    expect(data.roofFaces[0].setbacks.pathClear).toBe('partial')
  })

  it('pathClear accepts walkable | partial | blocked', () => {
    for (const p of ['walkable', 'partial', 'blocked'] as const) {
      const data = buildPlansetData(makeProject(), {
        roofFaces: [{
          id: 1, tilt: 0, azimuth: 0, modules: 0,
          polygon: [], setbacks: { ridge: false, eave: false, rake: false, pathClear: p },
        }],
      })
      expect(data.roofFaces[0].setbacks.pathClear).toBe(p)
    }
  })
})

describe('ampacityFor() — NEC 310.16 wire size lookup', () => {
  it('parses #-prefixed AWG: #10 / #6 / #1', () => {
    expect(ampacityFor('#10 AWG CU PV WIRE')).toEqual({ c90: 40, c75: 35 })
    expect(ampacityFor('#6 AWG BARE CU EGC')).toEqual({ c90: 75, c75: 65 })
    expect(ampacityFor('#1 AWG CU THWN-2')).toEqual({ c90: 145, c75: 130 })
  })
  it('parses paralleled AWG with # prefix: #4/0', () => {
    expect(ampacityFor('#4/0 AWG CU THWN-2')).toEqual({ c90: 260, c75: 230 })
  })
  it('parses paralleled AWG WITHOUT # prefix: 1/0, 2/0, 4/0 (R1 regression case)', () => {
    expect(ampacityFor('1/0 AWG CU THWN-2')).toEqual({ c90: 170, c75: 150 })
    expect(ampacityFor('2/0 AWG CU')).toEqual({ c90: 195, c75: 175 })
    expect(ampacityFor('4/0 AWG')).toEqual({ c90: 260, c75: 230 })
  })
  it('parses AWG without # prefix: 10 AWG, 6 AWG', () => {
    expect(ampacityFor('10 AWG CU')).toEqual({ c90: 40, c75: 35 })
    expect(ampacityFor('6 AWG')).toEqual({ c90: 75, c75: 65 })
  })
  it('parses kcmil sizes: 250, 300, 350', () => {
    expect(ampacityFor('250 kcmil CU THWN-2')).toEqual({ c90: 290, c75: 255 })
    expect(ampacityFor('300 kcmil')).toEqual({ c90: 320, c75: 285 })
    expect(ampacityFor('350 kcmil CU')).toEqual({ c90: 350, c75: 310 })
  })
  it('parses count-prefixed strings: (2) #4/0 AWG', () => {
    expect(ampacityFor('(2) #4/0 AWG CU')).toEqual({ c90: 260, c75: 230 })
    expect(ampacityFor('(3) #1 AWG CU THWN-2')).toEqual({ c90: 145, c75: 130 })
  })
  it('returns {0,0} for unparseable strings (caller falls back)', () => {
    expect(ampacityFor('garbage')).toEqual({ c90: 0, c75: 0 })
    expect(ampacityFor('')).toEqual({ c90: 0, c75: 0 })
    expect(ampacityFor('#0 AWG')).toEqual({ c90: 0, c75: 0 }) // not in table; #1 is smallest paralleled boundary
  })
  it('case-insensitive AWG / kcmil', () => {
    expect(ampacityFor('#10 awg cu pv wire')).toEqual({ c90: 40, c75: 35 })
    expect(ampacityFor('250 KCMIL CU THWN-2')).toEqual({ c90: 290, c75: 255 })
  })
  it('NEC_AMPACITY_75C table contains all expected sizes', () => {
    // Sanity check the table itself
    expect(NEC_AMPACITY_75C['#10 AWG'].c75).toBe(35)
    expect(NEC_AMPACITY_75C['#1 AWG'].c75).toBe(130)
    expect(NEC_AMPACITY_75C['4/0 AWG'].c75).toBe(230)
    expect(NEC_AMPACITY_75C['250 kcmil'].c75).toBe(255)
  })
})

describe('120% rule compliance (NEC 705.12(B)(2)(b)(2))', () => {
  // Default Duracell config — 200A bus + 200A main + 30 kW AC system
  it('Patricia Smith case (200A bus, 200A main, 30 kW AC) FAILS 120% rule', () => {
    const data = buildPlansetData(makeProject(), {
      panelCount: 45, inverterCount: 2,
    })
    // 30 kW = 125A operating, ×1.25 = 156.25A → clamps to 80A per inverter, 160A total
    expect(data.totalBackfeedA).toBe(160)
    // Max allowable = 1.2 × 200 - 200 = 40A
    expect(data.maxAllowableBackfeedA).toBe(40)
    // 160 > 40 → fails
    expect(data.loadSideBackfeedCompliant).toBe(false)
  })

  it('PASSES on 200A bus with smaller (single 5kW) system', () => {
    const proj = makeProject()
    proj.msp_bus_rating = '200' as unknown as Project['msp_bus_rating']
    proj.main_breaker = '200' as unknown as Project['main_breaker']
    const data = buildPlansetData(proj, {
      panelCount: 12, inverterCount: 1, inverterAcPower: 5,
    })
    // 5 kW = 20.83A operating, ×1.25 = 26A → clamps to 30A (NEC 240.6 standard)
    expect(data.totalBackfeedA).toBe(30)
    expect(data.maxAllowableBackfeedA).toBe(40)
    expect(data.loadSideBackfeedCompliant).toBe(true)
  })

  it('PASSES on 320A meter base with 200A main + 30 kW AC system (Greg has these in TX)', () => {
    const proj = makeProject()
    proj.msp_bus_rating = '320' as unknown as Project['msp_bus_rating']
    proj.main_breaker = '200' as unknown as Project['main_breaker']
    const data = buildPlansetData(proj, {
      panelCount: 45, inverterCount: 2,
    })
    expect(data.totalBackfeedA).toBe(160)
    // Max allowable = 1.2 × 320 - 200 = 184A
    expect(data.maxAllowableBackfeedA).toBe(184)
    // 160 ≤ 184 → passes
    expect(data.loadSideBackfeedCompliant).toBe(true)
  })

  it('FAILS even on 400A bus when main is 400A (no headroom for backfeed)', () => {
    const proj = makeProject()
    proj.msp_bus_rating = '400' as unknown as Project['msp_bus_rating']
    proj.main_breaker = '400' as unknown as Project['main_breaker']
    const data = buildPlansetData(proj, {
      panelCount: 45, inverterCount: 2,
    })
    // Max allowable = 1.2 × 400 - 400 = 80A. 160A backfeed > 80 → fails.
    expect(data.maxAllowableBackfeedA).toBe(80)
    expect(data.loadSideBackfeedCompliant).toBe(false)
  })

  it('maxAllowableBackfeedA never goes negative (clamps to 0 when main > bus)', () => {
    // Edge: misconfigured project where main breaker exceeds bus rating
    const proj = makeProject()
    proj.msp_bus_rating = '100' as unknown as Project['msp_bus_rating']
    proj.main_breaker = '200' as unknown as Project['main_breaker']
    const data = buildPlansetData(proj)
    expect(data.maxAllowableBackfeedA).toBe(0)
  })
})
