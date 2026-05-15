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
  type CommGateway,
  type Connection,
  type Disconnect,
  type Equipment,
  type EquipmentGraph,
  type GroundingElectrode,
  type HomeRouter,
  type ProductionCT,
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
  // Phase H8 polish — per-Tyson "BRANCH CIRCUIT N: M MODULES" labels per
  // string. Falls back to even-split when PlansetData doesn't carry an
  // explicit per-string module count.
  const branchCounts: number[] = (() => {
    const flat = data.stringsPerInverter?.flat() ?? []
    const explicit = flat.map((n) => Number(n)).filter((n) => n > 0)
    if (explicit.length === stringCount) return explicit
    // Even split with remainder on the last branch.
    const base = Math.floor(data.panelCount / stringCount)
    const arr = Array.from({ length: stringCount }, () => base)
    arr[stringCount - 1] += data.panelCount - base * stringCount
    return arr
  })()
  return {
    id: 'pv',
    kind: 'PVArray',
    width: 280,
    height: 140,
    ports: quadPorts('pv'),
    labelSlots: defaultLabelSlots(280, 140),
    labels: [
      { text: 'ROOF ARRAY WIRING', priority: 10, bold: true },
      { text: `(N) MODULE: (${data.panelCount}) ${data.panelModel} · ${data.panelWattage}W`, priority: 9 },
      { text: `${branchCounts.map((n) => `${n}-SERIES`).join(' · ')} · ${data.panelCount} × ${data.panelWattage} = ${data.systemDcKw} kW DC`, priority: 8 },
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
    labels: [
      { text: '(N) JUNCTION BOX', priority: 9, bold: true },
      { text: '20A/2P · 600V · NEMA 3R · UL', priority: 7 },
    ],
    props: { role: 'dc', nemaRating: '3R', voltageRating: '600V' },
  }
}

function hybridInvertersFromData(data: PlansetData): HybridInverter[] {
  const count = Math.max(1, data.inverterCount)
  // Per-inverter module count — even-split fallback when stringsPerInverter
  // doesn't carry an explicit count for this hybrid.
  const flat = data.stringsPerInverter?.flat() ?? []
  const explicit = flat.map((n) => Number(n)).filter((n) => n > 0)
  const totalModules = data.panelCount
  const baseModules = Math.floor(totalModules / count)
  return Array.from({ length: count }).map((_, i): HybridInverter => {
    const modulesThisInverter =
      explicit.length === count
        ? explicit[i]
        : i === count - 1
          ? totalModules - baseModules * (count - 1)
          : baseModules
    return {
      id: `hybrid-${i + 1}`,
      kind: 'HybridInverter',
      width: 110,
      height: 100,
      ports: quadPorts(`hybrid-${i + 1}`),
      labelSlots: defaultLabelSlots(110, 100),
      labels: [
        { text: `(N) HYBRID #${i + 1} · ${data.inverterAcPower} kW AC`, priority: 9, bold: true },
        { text: `BRANCH CIRCUIT ${i + 1} · ${modulesThisInverter} MODULES`, priority: 7 },
        { text: '102 VDC NOMINAL · UL 1741-SB', priority: 5 },
      ],
      props: {
        model: data.inverterModel,
        acKw: data.inverterAcPower,
        backupAcA: 100,
        listingStandard: 'UL 1741-SB',
      },
    }
  })
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
        { text: `MICRO GRID #${i + 1} · ${modulesThisStack * data.batteryCapacity} kWh`, priority: 9, bold: true },
        { text: `${modulesThisStack}× ${data.batteryModel}`, priority: 7 },
        { text: 'FLOOR · BOLLARDS · HEAT DET.', priority: 6 },
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
      // Tyson-spec NEC phrasing, compressed to fit the label-slot budget.
      // Non-fusible is encoded in the EATON DG223URB model on the next line.
      { text: '(N) PV DISCONNECT', priority: 9, bold: true },
      { text: '(EATON) DG223URB · 100A/2P · 240V 3R', priority: 7 },
      { text: 'VISIBLE, LOCKABLE · "AC DISCONNECT"', priority: 6 },
      { text: 'EXTERIOR WALL', priority: 5 },
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
      { text: '(N) GEN DISC — FUSIBLE 60A', priority: 9, bold: true },
      { text: 'DG222NRB · (45A FUSES)', priority: 7 },
      { text: 'E-STOP ISOLATES LOAD', priority: 5 },
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
    label: `(N) PV BREAKER #${i + 1}`,
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
      { text: `(N) MSP UPGRADE · ${busbar}A · EXTERIOR`, priority: 9, bold: true },
      { text: 'BUSBAR 120% NEC 705.12(B)', priority: 7 },
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
      { text: '(N) MAIN BREAKER TO HOUSE', priority: 9, bold: true },
      { text: `240V · ${serviceA}A/2P · TOP FED`, priority: 8 },
      { text: 'BI-DIRECTIONAL · NEMA 3R', priority: 6 },
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
      { text: `(N) CUSTOMER GENERATION`, priority: 9, bold: true },
      { text: `(E) BI-DIR METER · ${data.voltage || '120/240V'} · 200A`, priority: 8 },
      { text: 'TO UTILITY GRID →', priority: 6 },
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
    labels: [
      { text: '(N) PROTECTED LOAD PANEL · 125A', priority: 9, bold: true },
      { text: 'BRP20B125R · MLO · NEMA 3R', priority: 7 },
    ],
    props: {
      model: 'Eaton BRP20B125R',
      mainLugAmperage: 125,
      circuitCount: 20,
      nemaRating: '3R',
    },
  }
}

// Phase H8 polish — (N) PV LOAD CENTER per Tyson PV-5 convention. Sits
// between the PV disconnect and the MSP. Electrically passive in our v2
// model (the MSP still owns the backfeed breakers), but visually marks
// the load-center node AHJs look for. Reuses BackupPanel kind/box.
function pvLoadCenter(): BackupPanel {
  return {
    id: 'pv-load-center',
    kind: 'BackupPanel',
    width: 100,
    height: 60,
    ports: quadPorts('pv-load-center'),
    labelSlots: defaultLabelSlots(100, 60),
    labels: [
      { text: '(N) PV LOAD CENTER · 125A', priority: 9, bold: true },
      { text: 'BRP12L125R · NEMA 3R · MLO', priority: 7 },
    ],
    props: {
      model: 'Eaton BRP12L125R',
      mainLugAmperage: 125,
      circuitCount: 12,
      nemaRating: '3R',
    },
  }
}

// Phase H8 Category H — comm subsystem factories.
function commGateway(): CommGateway {
  return {
    id: 'comm-gw',
    kind: 'CommGateway',
    width: 90,
    height: 40,
    ports: quadPorts('comm-gw'),
    labelSlots: defaultLabelSlots(90, 40),
    labels: [
      { text: '(N) DPCRGM — CELL', priority: 9, bold: true },
      { text: 'COMM GATEWAY · DURACELL', priority: 7 },
    ],
    props: {
      model: 'DPCRGM-Cell',
      bridge: 'ethernet+cellular',
    },
  }
}

function homeRouter(): HomeRouter {
  return {
    id: 'home-router',
    kind: 'HomeRouter',
    width: 70,
    height: 30,
    ports: quadPorts('home-router'),
    labelSlots: defaultLabelSlots(70, 30),
    labels: [
      { text: '(E) HOMEOWNER ROUTER', priority: 8 },
    ],
    props: {
      label: 'ROUTER',
    },
  }
}

// Phase H8 polish — Production CT factory. Clamps on the service-entrance
// wire between MSP and the service disconnect. Tyson PV-5 labels this
// "PRIMARY CONSUMPTION AND PRODUCTION".
function productionCtFromData(_data: PlansetData): ProductionCT {
  return {
    id: 'prod-ct',
    kind: 'ProductionCT',
    width: 40,
    height: 20,
    ports: quadPorts('prod-ct'),
    labelSlots: defaultLabelSlots(40, 20),
    labels: [
      { text: 'PRIMARY CONSUMPTION + PRODUCTION', priority: 9, bold: true },
      { text: 'FROM MAIN BREAKER · CT P/N 1001808', priority: 7 },
    ],
    props: {
      model: 'CT EXT P/N 1001808',
      targetLabel: 'Service Entrance · 200A',
      cableSpec: '#18 SHIELDED',
    },
  }
}

// Phase H8 Category E — grounding electrode factory.
function groundingElectrode(): GroundingElectrode {
  return {
    id: 'gnd-electrode',
    kind: 'GroundingElectrode',
    width: 50,
    height: 50,
    ports: quadPorts('gnd-electrode'),
    labelSlots: defaultLabelSlots(50, 50),
    labels: [
      { text: '(E) GROUNDING ELECTRODE', priority: 8 },
      { text: '5/8" × 8\' CU ROD · NEC 250.52', priority: 7 },
    ],
    props: {
      electrodeType: 'rod',
      label: 'GROUNDING ELECTRODE · 5/8"x8\' CU ROD',
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

  // Phase H8 Category B — Tyson PV-5 convention is 3 stacked lines per
  // conductor: (qty) #AWG TYPE-2 / (qty) #AWG EGC / conduit-size. PlansetData
  // carries dcHomerun* as a full triplet; for the other runs PlansetData only
  // stores wire + conduit, so EGC sizes below are NEC 250.122 defaults sized
  // to the upstream OCPD for that category (PE-default; override at PlansetData
  // level when a project's calc differs).
  const dcStringEgc = '(1) #10 AWG EGC'      // PV string circuit OCPD ≤ 20A → #10
  const acBranchEgc = '(1) #10 AWG EGC'      // hybrid AC branch OCPD ≤ 60A → #10
  const acServiceEgc = '(1) #4 AWG EGC'      // 200A service → #4

  // PV → RSD → DC JB (or direct PV → DC JB if integrated RSD)
  const pvStringConductor = `${data.dcStringWire}\nTRUNK CABLE · ${dcStringEgc}\n${data.dcConduit}`
  if (rsd) {
    connections.push({
      id: 'pv-rsd',
      from: 'pv.E',
      to: 'rsd.W',
      conductor: pvStringConductor,
      category: 'dc-string',
    })
    connections.push({
      id: 'rsd-dc-jb',
      from: 'rsd.E',
      to: 'dc-jb.W',
      conductor: pvStringConductor,
      category: 'dc-string',
    })
  } else {
    connections.push({
      id: 'pv-dc-jb',
      from: 'pv.E',
      to: 'dc-jb.W',
      conductor: pvStringConductor,
      category: 'dc-string',
    })
  }

  // DC JB → each hybrid (PV-DC) ; each hybrid → its battery stack
  inverters.forEach((inv, i) => {
    connections.push({
      id: `dc-jb-${inv.id}`,
      from: 'dc-jb.E',
      to: `${inv.id}.W`,
      conductor: `${data.dcHomerunWire}\n${data.dcHomerunEgc}\n${data.dcHomerunConduit}`,
      category: 'dc-string',
    })
    // Match each inverter with its battery stack (1:1 when counts equal)
    const stack = batteries[i]
    if (stack) {
      connections.push({
        id: `${inv.id}-batt`,
        from: `${inv.id}.S`,
        to: `${stack.id}.N`,
        conductor: `${data.batteryWire}\n${acBranchEgc}\n${data.batteryConduit}`,
        category: 'dc-battery',
      })
    }
    // Hybrid AC OUT → PV Disconnect
    connections.push({
      id: `${inv.id}-ac`,
      from: `${inv.id}.E`,
      to: 'disc-pv.W',
      conductor: `${data.acWireToPanel}\n${acBranchEgc}\n${data.acConduit}`,
      category: 'ac-inverter',
    })
  })

  // Hybrid #1 → Backup Loads Panel (backup AC out, only first inverter)
  if (inverters.length > 0) {
    connections.push({
      id: 'h1-backup',
      from: `${inverters[0].id}.N`,
      to: 'blp.E',
      conductor: `(3) #6 AWG CU THWN-2\n${acBranchEgc}`,
      category: 'ac-inverter',
    })
  }

  // PV Disc → PV Load Center → MSP, Gen Disc → MSP, MSP → Service → Meter
  connections.push({
    id: 'pv-disc-loadctr',
    from: 'disc-pv.E',
    to: 'pv-load-center.W',
    conductor: `${data.acWireToPanel}\n${acBranchEgc}\n${data.acConduit}`,
    category: 'ac-inverter',
  })
  connections.push({
    id: 'pv-loadctr-msp',
    from: 'pv-load-center.E',
    to: 'msp.W',
    conductor: `${data.acWireToPanel}\n${acBranchEgc}\n${data.acConduit}`,
    category: 'ac-inverter',
  })
  connections.push({
    id: 'gen-disc-msp',
    from: 'disc-gen.E',
    to: 'msp.W',
    conductor: '(2) #6 AWG CU THWN-2 · 45A\n(1) #10 AWG EGC',
    category: 'ac-inverter',
  })
  // Phase H8 polish — Production CT inline on the service entrance.
  // MSP → CT → service disconnect. Carries the service-entrance conductor
  // spec on the MSP→CT edge; the CT→disc-service edge is the short clamp run.
  connections.push({
    id: 'msp-prod-ct',
    from: 'msp.E',
    to: 'prod-ct.W',
    conductor: data.serviceEntranceConduit
      ? `(2) #4/0 AWG CU THWN-2 · 200A\n${acServiceEgc}\n${data.serviceEntranceConduit}`
      : `(2) #4/0 AWG CU THWN-2 · 200A\n${acServiceEgc}`,
    category: 'ac-service',
  })
  connections.push({
    id: 'prod-ct-service',
    from: 'prod-ct.E',
    to: 'disc-service.W',
    conductor: `(2) #4/0 AWG CU THWN-2 · 200A\n${acServiceEgc} TO UTILITY GRID`,
    category: 'ac-service',
  })
  connections.push({
    id: 'service-meter',
    from: 'disc-service.E',
    to: 'meter.W',
    conductor: `(2) #4/0 AWG CU THWN-2 · 200A\n${acServiceEgc}`,
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
  // Phase H8 Category H — comm subsystem (gateway + homeowner router).
  const commGw = commGateway()
  const router = homeRouter()
  // Phase H8 Category E — grounding electrode.
  const gnd = groundingElectrode()
  // Phase H8 polish — Production CT on the service entrance.
  const prodCt = productionCtFromData(data)
  // Phase H8 polish — (N) PV LOAD CENTER between PV disconnect and MSP.
  const pvLoad = pvLoadCenter()

  const equipment: Equipment[] = [
    pv,
    ...(rsd ? [rsd] : []),
    dcJb,
    ...inverters,
    ...batteries,
    pvDisc,
    pvLoad,
    genDisc,
    msp,
    prodCt,
    sDisc,
    meter,
    ...(blp ? [blp] : []),
    commGw,
    router,
    gnd,
  ]

  const connections = buildConnections(data, { inverters, batteries, rsd })
  // Comm subsystem connections — added after wire/AC build so categorical
  // ordering stays readable.
  inverters.forEach((inv) => {
    connections.push({
      id: `${inv.id}-comm`,
      from: `${inv.id}.N`,
      to: 'comm-gw.S',
      conductor: 'CAT-6 ETHERNET',
      category: 'comm',
    })
  })
  batteries.forEach((stack) => {
    connections.push({
      id: `${stack.id}-comm`,
      from: `${stack.id}.E`,
      to: 'comm-gw.W',
      conductor: 'CAN-BUS · #18 SHIELDED',
      category: 'comm',
    })
  })
  connections.push({
    id: 'comm-router',
    from: 'comm-gw.E',
    to: 'home-router.W',
    conductor: 'CAT-6 ETHERNET',
    category: 'comm',
  })
  // Phase H8 Category E — GEC from MSP to grounding electrode.
  connections.push({
    id: 'msp-gec',
    from: 'msp.S',
    to: 'gnd-electrode.N',
    conductor: `#6 AWG CU GEC\nNEC 250.166`,
    category: 'gec',
  })
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
