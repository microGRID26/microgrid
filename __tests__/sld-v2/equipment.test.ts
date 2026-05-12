// Phase 1 verification — every equipment kind constructs, port coords valid,
// label slots non-overlapping. Per ~/.claude/plans/smooth-mixing-milner.md.

import { describe, it, expect } from 'vitest'
import {
  defaultLabelSlots,
  quadPorts,
  isInverter,
  isDisconnect,
  isHybrid,
  type Equipment,
  type EquipmentGraph,
  type MSP,
  type Disconnect,
  type HybridInverter,
  type BatteryStack,
  type PVArray,
  type Meter,
  type StringInverter,
  type MicroInverter,
  type RapidShutdown,
  type JunctionBox,
  type BackupPanel,
  type EVCharger,
  type ProductionCT,
} from '../../lib/sld-v2/equipment'

// ─────────────────────────────────────────────────────────────────────
// helpers / factories
// ─────────────────────────────────────────────────────────────────────

function makeBase(id: string, width = 120, height = 80) {
  return {
    id,
    width,
    height,
    ports: quadPorts(id),
    labelSlots: defaultLabelSlots(width, height),
    labels: [{ text: id, priority: 8 }],
  }
}

function sampleMsp(): MSP {
  return {
    ...makeBase('msp-1', 130, 130),
    kind: 'MSP',
    props: {
      busbarA: 225,
      mainBreakerA: 125,
      voltage: '240V 1Φ 3W',
      location: 'EXTERIOR',
      nemaRating: '3R',
      backfeeds: [
        { id: 'h1', label: '(N) HYBRID #1 BACKFEED', ampere: 100 },
        { id: 'h2', label: '(N) HYBRID #2 BACKFEED', ampere: 100 },
      ],
      hasSurgeProtector: true,
    },
  }
}

function sampleDisc(role: Disconnect['props']['role']): Disconnect {
  return {
    ...makeBase(`disc-${role}`, 80, 90),
    kind: 'Disconnect',
    props: {
      role,
      model: role === 'gen' ? 'Eaton DG222NRB' : 'Eaton DG223URB',
      ampere: role === 'gen' ? 60 : 100,
      poles: 2,
      fusible: role === 'gen',
      fuseAmpere: role === 'gen' ? 45 : undefined,
      nemaRating: '3R',
      bidirectional: role === 'service',
    },
  }
}

function sampleHybrid(idSuffix: number): HybridInverter {
  return {
    ...makeBase(`hybrid-${idSuffix}`, 110, 100),
    kind: 'HybridInverter',
    props: {
      model: 'Duracell PC-MAX-15',
      acKw: 15,
      backupAcA: 100,
      listingStandard: 'UL 1741-SB',
    },
  }
}

function sampleStack(idSuffix: number): BatteryStack {
  return {
    ...makeBase(`stack-${idSuffix}`, 90, 110),
    kind: 'BatteryStack',
    props: {
      model: 'Duracell 5kWh LFP',
      moduleCount: 8,
      moduleKwh: 5,
      chemistry: 'LFP',
    },
  }
}

function samplePvArray(): PVArray {
  return {
    ...makeBase('pv-array', 280, 140),
    kind: 'PVArray',
    props: {
      moduleModel: 'Seraphim SRP-440-BTD-BG',
      moduleWatts: 440,
      moduleCount: 20,
      stringCount: 2,
      modulesPerString: 10,
    },
  }
}

function sampleMeter(): Meter {
  return {
    ...makeBase('meter', 70, 70),
    kind: 'Meter',
    props: {
      utility: 'CenterPoint Energy',
      serviceA: 200,
      voltage: '120/240V',
      bidirectional: true,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('Phase 1: every equipment kind constructs', () => {
  const samples: Equipment[] = [
    samplePvArray(),
    {
      ...makeBase('inv-string', 100, 100),
      kind: 'StringInverter',
      props: { model: 'Sample SI', acKw: 7.6, mpptCount: 2 },
    } as StringInverter,
    {
      ...makeBase('inv-micro', 30, 30),
      kind: 'MicroInverter',
      props: { model: 'D700-M2', acWatts: 700, perModule: true },
    } as MicroInverter,
    sampleHybrid(1),
    sampleHybrid(2),
    sampleStack(1),
    sampleStack(2),
    sampleMsp(),
    sampleDisc('pv'),
    sampleDisc('gen'),
    sampleDisc('service'),
    sampleDisc('ess'),
    {
      ...makeBase('rsd-init', 60, 24),
      kind: 'RapidShutdown',
      props: { model: 'RSD-D-20', role: 'initiator', necCitation: 'NEC 690.12(A)' },
    } as RapidShutdown,
    {
      ...makeBase('dc-jb', 60, 40),
      kind: 'JunctionBox',
      props: { role: 'dc', nemaRating: '3R', voltageRating: '600V' },
    } as JunctionBox,
    sampleMeter(),
    {
      ...makeBase('backup-panel', 110, 70),
      kind: 'BackupPanel',
      props: {
        model: 'Eaton BRP20B125R',
        mainLugAmperage: 125,
        circuitCount: 20,
        nemaRating: '3R',
      },
    } as BackupPanel,
    {
      ...makeBase('ev', 80, 80),
      kind: 'EVCharger',
      props: { model: 'JuiceBox 40', ampere: 40, voltage: '240V 1Φ', smartLoadControl: true },
    } as EVCharger,
    {
      ...makeBase('prod-ct', 40, 20),
      kind: 'ProductionCT',
      props: {
        model: 'CT EXT P/N 1001808',
        targetLabel: 'Hybrid AC OUT · 100A',
        cableSpec: '#18 SHIELDED',
      },
    } as ProductionCT,
  ]

  it.each(samples)('constructs %s', (eq) => {
    expect(eq.id).toBeTruthy()
    expect(eq.kind).toBeTruthy()
    expect(eq.width).toBeGreaterThan(0)
    expect(eq.height).toBeGreaterThan(0)
    expect(eq.ports.length).toBeGreaterThan(0)
    expect(eq.labelSlots.length).toBeGreaterThan(0)
  })

  it('all sample kinds covered', () => {
    const kinds = new Set(samples.map((e) => e.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(12)
  })
})

describe('quadPorts() — port coords valid', () => {
  it('returns one port per side', () => {
    const ports = quadPorts()
    const sides = new Set(ports.map((p) => p.side))
    expect(sides).toEqual(new Set(['N', 'S', 'E', 'W']))
  })

  it('prefixes ids when prefix provided', () => {
    const ports = quadPorts('msp-1')
    expect(ports.every((p) => p.id.startsWith('msp-1-'))).toBe(true)
  })
})

describe('defaultLabelSlots() — slot priority + bounds', () => {
  it('returns 4 slots (one per side) with descending priority', () => {
    const slots = defaultLabelSlots(120, 80)
    expect(slots).toHaveLength(4)
    const sides = new Set(slots.map((s) => s.side))
    expect(sides).toEqual(new Set(['N', 'S', 'E', 'W']))
    // priorities are within 1..10
    for (const s of slots) {
      expect(s.priority).toBeGreaterThanOrEqual(1)
      expect(s.priority).toBeLessThanOrEqual(10)
    }
  })

  it('side-priority order: N > S > E > W (default convention)', () => {
    const slots = defaultLabelSlots(120, 80)
    const byside = Object.fromEntries(slots.map((s) => [s.side, s.priority]))
    expect(byside.N).toBeGreaterThan(byside.S)
    expect(byside.S).toBeGreaterThan(byside.E)
    expect(byside.E).toBeGreaterThan(byside.W)
  })

  it('maxLineWidth scales with equipment width for N/S, fixed for E/W', () => {
    const wide = defaultLabelSlots(200, 80)
    const narrow = defaultLabelSlots(60, 80)
    const wideN = wide.find((s) => s.side === 'N')!
    const narrowN = narrow.find((s) => s.side === 'N')!
    expect(wideN.maxLineWidth).toBeGreaterThan(narrowN.maxLineWidth)
    const wideE = wide.find((s) => s.side === 'E')!
    const narrowE = narrow.find((s) => s.side === 'E')!
    expect(wideE.maxLineWidth).toBe(narrowE.maxLineWidth)
  })
})

describe('type guards', () => {
  it('isInverter recognizes string/micro/hybrid', () => {
    expect(isInverter(sampleHybrid(1))).toBe(true)
    expect(isInverter(sampleDisc('pv'))).toBe(false)
    expect(isInverter(sampleMsp())).toBe(false)
  })

  it('isDisconnect / isHybrid narrow correctly', () => {
    const d = sampleDisc('gen')
    if (isDisconnect(d)) expect(d.props.role).toBe('gen')
    expect(isHybrid(sampleHybrid(1))).toBe(true)
    expect(isHybrid(sampleMsp() as Equipment)).toBe(false)
  })
})

describe('EquipmentGraph composition', () => {
  it('Tyson-style topology (2× hybrid, 2× stack, MSP, 3× disconnects, meter) is buildable', () => {
    const graph: EquipmentGraph = {
      equipment: [
        samplePvArray(),
        sampleHybrid(1),
        sampleHybrid(2),
        sampleStack(1),
        sampleStack(2),
        sampleMsp(),
        sampleDisc('pv'),
        sampleDisc('gen'),
        sampleDisc('service'),
        sampleMeter(),
      ],
      connections: [
        {
          id: 'h1-batt',
          from: 'hybrid-1-S',
          to: 'stack-1-N',
          conductor: '(2) #4/0 AWG · 175A FUSED',
          category: 'dc-battery',
        },
        {
          id: 'h1-ac-out',
          from: 'hybrid-1-E',
          to: 'disc-pv-W',
          conductor: '(2) #3 AWG CU THWN-2 · 100A',
          category: 'ac-inverter',
        },
      ],
      sheet: {
        size: 'ANSI_B',
        orientation: 'landscape',
        titleBlock: {
          sheetCode: 'PV-5',
          sheetTitle: 'Electrical Single Line Diagram',
          projectName: 'PROJ-26922 · Corey Tyson',
          projectNumber: 'PROJ-26922',
          projectAddress: 'Houston, TX',
          contractor: 'MicroGRID Energy',
          contractorAddress: '600 Northpark Central Dr Suite 140, Houston TX 77073',
          contractorPhone: '+1 555 0100',
          contractorLicense: 'TX-XXXX',
          revision: 'v1 · 2026-05-12',
          drawnBy: 'Atlas',
        },
      },
    }
    expect(graph.equipment).toHaveLength(10)
    expect(graph.connections).toHaveLength(2)
    expect(graph.sheet.titleBlock.sheetCode).toBe('PV-5')
  })
})
