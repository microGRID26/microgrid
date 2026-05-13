// lib/sld-v2/from-planset-data.ts
//
// Phase 4 — PlansetData → EquipmentGraph adapter.
//
// Lets the v2 generator render real DB projects. Takes the existing
// PlansetData shape from lib/planset-types.ts and emits an EquipmentGraph
// suitable for layoutEquipmentGraph() + SldRenderer.
//
// Topology dispatch:
//   · Duracell hybrid inverter model → HybridInverter graph (Tyson shape)
//   · systemTopology = 'string-mppt'  → TODO Phase 7 (currently stubs an empty graph)
//   · systemTopology = 'micro-inverter' → TODO Phase 7
//
// Per smooth-mixing-milner.md, the v1 generator stays operational; this
// adapter is the bridge from existing project data into the v2 path.

import {
  defaultLabelSlots,
  quadPorts,
  type BackupPanel,
  type BatteryStack,
  type Connection,
  type Disconnect,
  type Equipment,
  type EquipmentGraph,
  type HybridInverter,
  type JunctionBox,
  type Meter,
  type MSP,
  type PVArray,
  type RapidShutdown,
  type SheetMeta,
} from './equipment'
import type { PlansetData } from '../planset-types'

// ──────────────────────────────────────────────────────────────────────────
// Topology detection
// ──────────────────────────────────────────────────────────────────────────

export function isDuracellHybrid(data: PlansetData): boolean {
  return /duracell.*(hybrid|pc\s*max)/i.test(data.inverterModel)
}

// ──────────────────────────────────────────────────────────────────────────
// Equipment builders
// ──────────────────────────────────────────────────────────────────────────

function pvArrayFromData(data: PlansetData): PVArray {
  const stringCount = Math.max(1, data.stringsPerInverter.flat().length || 2)
  const modulesPerString = Math.max(1, Math.round(data.panelCount / stringCount))
  return {
    id: 'pv',
    kind: 'PVArray',
    width: 280,
    height: 140,
    ports: quadPorts('pv'),
    labelSlots: defaultLabelSlots(280, 140),
    labels: [
      { text: `(${data.panelCount}) ${data.panelModel} · ${data.panelWattage}W`, priority: 9 },
      { text: `${stringCount} strings × ${modulesPerString} modules · ${data.systemDcKw} kW DC STC`, priority: 8 },
      { text: `Roof: module-level ${data.rapidShutdownModel} per NEC 690.12(B)(2)`, priority: 7 },
    ],
    props: {
      moduleModel: data.panelModel,
      moduleWatts: data.panelWattage,
      moduleCount: data.panelCount,
      stringCount,
      modulesPerString,
    },
  }
}

function rsdFromData(data: PlansetData): RapidShutdown | null {
  // INTEGRATED rapid shutdown (e.g. some micros) means no discrete initiator box.
  if (/integrated/i.test(data.rapidShutdownModel)) return null
  return {
    id: 'rsd',
    kind: 'RapidShutdown',
    width: 60,
    height: 24,
    ports: quadPorts('rsd'),
    labelSlots: defaultLabelSlots(60, 24),
    labels: [
      { text: 'Rapid-Shutdown Initiator', priority: 8 },
      { text: 'NEC 690.12(A) · RED MAINT. SWITCH', priority: 7 },
    ],
    props: {
      model: data.rapidShutdownModel,
      role: 'initiator',
      necCitation: 'NEC 690.12(A)',
    },
  }
}

function dcJunctionBox(): JunctionBox {
  return {
    id: 'dc-jb',
    kind: 'JunctionBox',
    width: 60,
    height: 40,
    ports: quadPorts('dc-jb'),
    labelSlots: defaultLabelSlots(60, 40),
    labels: [],
    props: { role: 'dc', nemaRating: '3R', voltageRating: '600V' },
  }
}

function hybridInvertersFromData(data: PlansetData): HybridInverter[] {
  const count = Math.max(1, data.inverterCount)
  return Array.from({ length: count }).map((_, i): HybridInverter => ({
    id: `hybrid-${i + 1}`,
    kind: 'HybridInverter',
    width: 110,
    height: 100,
    ports: quadPorts(`hybrid-${i + 1}`),
    labelSlots: defaultLabelSlots(110, 100),
    labels: [
      { text: `(N) HYBRID #${i + 1}`, priority: 9, bold: true },
      { text: data.inverterModel, priority: 7 },
    ],
    props: {
      model: data.inverterModel,
      acKw: data.inverterAcPower,
      backupAcA: 100,
      listingStandard: 'UL 1741-SB',
    },
  }))
}

function batteryStacksFromData(data: PlansetData): BatteryStack[] {
  // batteryCount = total individual battery modules; batteriesPerStack groups them.
  if (data.batteryCount <= 0) return []
  const stackCount = Math.max(1, Math.ceil(data.batteryCount / data.batteriesPerStack))
  return Array.from({ length: stackCount }).map((_, i): BatteryStack => {
    const modulesThisStack =
      i === stackCount - 1
        ? data.batteryCount - data.batteriesPerStack * (stackCount - 1)
        : data.batteriesPerStack
    return {
      id: `stack-${i + 1}`,
      kind: 'BatteryStack',
      width: 90,
      height: 110,
      ports: quadPorts(`stack-${i + 1}`),
      labelSlots: defaultLabelSlots(90, 110),
      labels: [
        { text: `(N) BATTERY STACK #${i + 1}`, priority: 8, bold: true },
        { text: `${modulesThisStack}× ${data.batteryModel}`, priority: 6 },
        { text: `${modulesThisStack * data.batteryCapacity} kWh`, priority: 6 },
      ],
      props: {
        model: data.batteryModel,
        moduleCount: modulesThisStack,
        moduleKwh: data.batteryCapacity,
        chemistry: /lfp/i.test(data.batteryModel) ? 'LFP' : /sonnen/i.test(data.batteryModel) ? 'NMC' : 'other',
      },
    }
  })
}

function pvDisconnect(): Disconnect {
  return {
    id: 'disc-pv',
    kind: 'Disconnect',
    width: 80,
    height: 90,
    ports: quadPorts('disc-pv'),
    labelSlots: defaultLabelSlots(80, 90),
    labels: [
      { text: '(N) PV / DC DISCONNECT', priority: 9, bold: true },
      { text: 'Eaton DG223URB · 100A · 2P', priority: 7 },
      { text: 'VISIBLE, LOCKABLE — AC DISC', priority: 6 },
    ],
    props: {
      role: 'pv',
      model: 'Eaton DG223URB',
      ampere: 100,
      poles: 2,
      fusible: false,
      nemaRating: '3R',
    },
  }
}

function genDisconnect(): Disconnect {
  return {
    id: 'disc-gen',
    kind: 'Disconnect',
    width: 80,
    height: 90,
    ports: quadPorts('disc-gen'),
    labelSlots: defaultLabelSlots(80, 90),
    labels: [
      { text: '(N) CUSTOMER GEN DISC', priority: 9, bold: true },
      { text: 'Eaton DG222NRB · 45A fusible · 2P', priority: 7 },
      { text: "LABELED 'GEN DISCONNECT'", priority: 6 },
    ],
    props: {
      role: 'gen',
      model: 'Eaton DG222NRB',
      ampere: 60,
      poles: 2,
      fusible: true,
      fuseAmpere: 45,
      nemaRating: '3R',
    },
  }
}

function mspFromData(data: PlansetData): MSP {
  const busbar = parseInt(data.mspBusRating, 10) || 225
  const mainBreaker = parseInt(data.mainBreaker.replace(/A$/i, ''), 10) || 125
  const backfeeds = Array.from({ length: data.inverterCount }).map((_, i) => ({
    id: `h${i + 1}`,
    label: `(N) HYBRID #${i + 1} BACKFEED`,
    ampere: data.backfeedBreakerA,
  }))
  return {
    id: 'msp',
    kind: 'MSP',
    width: 130,
    height: 140,
    ports: quadPorts('msp'),
    labelSlots: defaultLabelSlots(130, 140),
    labels: [
      { text: `${busbar}A · ${data.voltage} · EXTERIOR · NEMA 3R`, priority: 8 },
      { text: `BUSBAR ${busbar}A · 120% RULE PER NEC 705.12(B)`, priority: 7 },
    ],
    props: {
      busbarA: busbar,
      mainBreakerA: mainBreaker,
      voltage: data.voltage,
      location: 'EXTERIOR',
      nemaRating: '3R',
      backfeeds,
      hasSurgeProtector: true,
    },
  }
}

function serviceDisc(serviceA: number): Disconnect {
  return {
    id: 'disc-service',
    kind: 'Disconnect',
    width: 80,
    height: 90,
    ports: quadPorts('disc-service'),
    labelSlots: defaultLabelSlots(80, 90),
    labels: [
      { text: '(N) SERVICE DISC', priority: 9, bold: true },
      { text: `${serviceA}A · 2P · NEMA 3R · BI-DIRECTIONAL`, priority: 7 },
    ],
    props: {
      role: 'service',
      model: 'Service Disc',
      ampere: serviceA,
      poles: 2,
      fusible: false,
      nemaRating: '3R',
      bidirectional: true,
    },
  }
}

function meterFromData(data: PlansetData): Meter {
  return {
    id: 'meter',
    kind: 'Meter',
    width: 70,
    height: 70,
    ports: quadPorts('meter'),
    labelSlots: defaultLabelSlots(70, 70),
    labels: [
      { text: `(E) UTILITY METER`, priority: 9, bold: true },
      { text: `Meter: ${data.meter || '__________'}`, priority: 6 },
      { text: `ESID: ${data.esid || '__________'}`, priority: 6 },
    ],
    props: {
      utility: data.utility,
      serviceA: 200,
      voltage: data.voltage,
      bidirectional: true,
      isRevenueGrade: data.hasRgm,
    },
  }
}

function backupPanel(): BackupPanel {
  return {
    id: 'blp',
    kind: 'BackupPanel',
    width: 110,
    height: 70,
    ports: quadPorts('blp'),
    labelSlots: defaultLabelSlots(110, 70),
    labels: [],
    props: {
      model: 'Eaton BRP20B125R',
      mainLugAmperage: 125,
      circuitCount: 20,
      nemaRating: '3R',
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Connection builder
// ──────────────────────────────────────────────────────────────────────────

function buildConnections(
  data: PlansetData,
  options: {
    inverters: HybridInverter[]
    batteries: BatteryStack[]
    rsd: RapidShutdown | null
  },
): Connection[] {
  const { inverters, batteries, rsd } = options
  const connections: Connection[] = []

  // PV → RSD → DC JB (or direct PV → DC JB if integrated RSD)
  if (rsd) {
    connections.push({
      id: 'pv-rsd',
      from: 'pv.E',
      to: 'rsd.W',
      conductor: data.dcStringWire,
      category: 'dc-string',
    })
    connections.push({
      id: 'rsd-dc-jb',
      from: 'rsd.E',
      to: 'dc-jb.W',
      conductor: data.dcStringWire,
      category: 'dc-string',
    })
  } else {
    connections.push({
      id: 'pv-dc-jb',
      from: 'pv.E',
      to: 'dc-jb.W',
      conductor: data.dcStringWire,
      category: 'dc-string',
    })
  }

  // DC JB → each hybrid (PV-DC) ; each hybrid → its battery stack
  inverters.forEach((inv, i) => {
    connections.push({
      id: `dc-jb-${inv.id}`,
      from: 'dc-jb.E',
      to: `${inv.id}.W`,
      conductor: data.dcHomerunWire,
      category: 'dc-string',
    })
    // Match each inverter with its battery stack (1:1 when counts equal)
    const stack = batteries[i]
    if (stack) {
      connections.push({
        id: `${inv.id}-batt`,
        from: `${inv.id}.S`,
        to: `${stack.id}.N`,
        conductor: data.batteryWire,
        category: 'dc-battery',
      })
    }
    // Hybrid AC OUT → PV Disconnect
    connections.push({
      id: `${inv.id}-ac`,
      from: `${inv.id}.E`,
      to: 'disc-pv.W',
      conductor: data.acWireToPanel,
      category: 'ac-inverter',
    })
  })

  // Hybrid #1 → Backup Loads Panel (backup AC out, only first inverter)
  if (inverters.length > 0) {
    connections.push({
      id: 'h1-backup',
      from: `${inverters[0].id}.N`,
      to: 'blp.E',
      conductor: '#6 AWG',
      category: 'ac-inverter',
    })
  }

  // PV Disc → MSP, Gen Disc → MSP, MSP → Service → Meter
  connections.push({
    id: 'pv-disc-msp',
    from: 'disc-pv.E',
    to: 'msp.W',
    conductor: data.acWireToPanel,
    category: 'ac-inverter',
  })
  connections.push({
    id: 'gen-disc-msp',
    from: 'disc-gen.E',
    to: 'msp.W',
    conductor: '(2) #6 AWG · 45A',
    category: 'ac-inverter',
  })
  connections.push({
    id: 'msp-service',
    from: 'msp.E',
    to: 'disc-service.W',
    conductor: data.serviceEntranceConduit
      ? `(2) #4/0 · 200A · ${data.serviceEntranceConduit}`
      : '(2) #4/0 · 200A',
    category: 'ac-service',
  })
  connections.push({
    id: 'service-meter',
    from: 'disc-service.E',
    to: 'meter.W',
    conductor: '(2) #4/0 · 200A',
    category: 'ac-service',
  })

  return connections
}

// ──────────────────────────────────────────────────────────────────────────
// Sheet meta builder
// ──────────────────────────────────────────────────────────────────────────

function sheetMetaFromData(data: PlansetData): SheetMeta {
  const c = data.contractor
  return {
    size: 'ANSI_B',
    orientation: 'landscape',
    titleBlock: {
      sheetCode: 'PV-5',
      sheetTitle: 'Electrical Single Line Diagram',
      projectName: data.owner ? `${data.projectId} · ${data.owner}` : data.projectId,
      projectNumber: data.projectId,
      projectAddress: [data.address, data.city, data.state, data.zip].filter(Boolean).join(', '),
      contractor: c.name,
      contractorAddress: `${c.address}, ${c.city}`,
      contractorPhone: c.phone,
      contractorLicense: c.license,
      revision: `v2 · ${data.drawnDate}`,
      drawnBy: data.drawnBy ?? 'MicroGRID',
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

export interface FromPlansetOptions {
  /** Override the service-entrance amperage on the service disconnect. */
  serviceA?: number
  /** Force include backup loads panel even when topology wouldn't usually. */
  includeBackupPanel?: boolean
}

/**
 * Convert a fully-resolved PlansetData into an EquipmentGraph for v2 rendering.
 *
 * Currently handles:
 *   · Duracell hybrid topology (1+ inverters + matching battery stacks)
 *
 * Future (Phase 7):
 *   · String-MPPT topology — emits StringInverter + standalone battery if any
 *   · Micro-inverter topology — emits MicroInverter array
 */
export function equipmentGraphFromPlansetData(
  data: PlansetData,
  options: FromPlansetOptions = {},
): EquipmentGraph {
  if (!isDuracellHybrid(data)) {
    // Phase 7 will fill these in. For now, emit a minimal placeholder graph
    // with title block + empty equipment so SldRenderer doesn't crash.
    return {
      equipment: [],
      connections: [],
      sheet: sheetMetaFromData(data),
      notes: [
        {
          text: `sld-v2 adapter: topology "${data.systemTopology}" with model "${data.inverterModel}" not yet supported. Phase 7 work.`,
          severity: 'warn',
        },
      ],
    }
  }

  // Duracell hybrid path
  const pv = pvArrayFromData(data)
  const rsd = rsdFromData(data)
  const dcJb = dcJunctionBox()
  const inverters = hybridInvertersFromData(data)
  const batteries = batteryStacksFromData(data)
  const pvDisc = pvDisconnect()
  const genDisc = genDisconnect()
  const msp = mspFromData(data)
  const serviceA = options.serviceA ?? 200
  const sDisc = serviceDisc(serviceA)
  const meter = meterFromData(data)
  const blp = options.includeBackupPanel !== false ? backupPanel() : null

  const equipment: Equipment[] = [
    pv,
    ...(rsd ? [rsd] : []),
    dcJb,
    ...inverters,
    ...batteries,
    pvDisc,
    genDisc,
    msp,
    sDisc,
    meter,
    ...(blp ? [blp] : []),
  ]

  const connections = buildConnections(data, { inverters, batteries, rsd })
  // Drop the h1-backup connection if backup panel isn't included.
  const filteredConnections = blp
    ? connections
    : connections.filter((c) => c.id !== 'h1-backup')

  return {
    equipment,
    connections: filteredConnections,
    sheet: sheetMetaFromData(data),
    notes: [
      ...(data.loadSideBackfeedCompliant
        ? []
        : [
            {
              text: 'WARNING: NEC 705.12(B)(2)(b)(2) "120% rule" non-compliant — total backfeed exceeds allowed.',
              severity: 'warn' as const,
              necCitations: ['NEC 705.12(B)(2)(b)(2)'],
            },
          ]),
      ...(data.maxSystemVoltageCompliant
        ? []
        : [
            {
              text: `WARNING: NEC 690.7 max system voltage — longest string Voc-cold ${data.maxStringVocCold}V exceeds inverter max ${data.inverterMaxVoc}V.`,
              severity: 'warn' as const,
              necCitations: ['NEC 690.7'],
            },
          ]),
    ],
  }
}
