// lib/sld-v2/equipment.ts
//
// Equipment model for the SLD v2 layout-engine refactor.
// See ~/.claude/plans/smooth-mixing-milner.md (Phase 1).
//
// Why discriminated unions: each equipment KIND has different props (a battery
// has kWh, an inverter has AC kW, a disconnect has amps/poles). The layout
// engine only cares about ports + label slots — those live on every kind in
// uniform shape. The renderer dispatches per-kind to paint the right SVG.

// ──────────────────────────────────────────────────────────────────────────
// Port + label-slot primitives
// ──────────────────────────────────────────────────────────────────────────

/**
 * A port is an anchor point on an equipment block where a conductor (wire)
 * can attach. Coordinates are RELATIVE to the equipment's bounding box origin.
 * The layout engine (elkjs) converts these to world coords post-layout.
 *
 * `side` is required because elkjs FIXED_SIDE port constraints need to know
 * which face the port lives on (N/S/E/W) for orthogonal edge routing.
 */
export type PortSide = 'N' | 'S' | 'E' | 'W'
export interface Port {
  id: string             // unique within the equipment instance (e.g. 'in', 'out', 'backup')
  side: PortSide
  /** Relative offset on the side. 0..1 — 0 = top/left, 1 = bottom/right. Default 0.5 (centered). */
  ratio?: number
  /** Optional human-readable role (e.g. 'AC OUT', 'BATT', 'BACKUP'). Used in callouts. */
  role?: string
}

/**
 * A label slot is a rectangular zone outside the equipment block where text
 * can be placed. The slot picker (Phase 3) assigns each label string to a slot
 * by priority, falling back to a numbered leader-line callout if no slot fits.
 */
export interface LabelSlot {
  /** Anchor side relative to the equipment. */
  side: PortSide
  /** Higher priority slots are preferred. 1 (lowest) .. 10 (highest). */
  priority: number
  /** Max lines this slot can hold (rendered top-down). */
  maxLines: number
  /** Max line width in px (used to wrap or skip overlong strings). */
  maxLineWidth: number
  /** Vertical or horizontal spacing within the slot (line height in px). */
  lineHeight?: number
}

/** A single text content line tagged with priority (lowest priority drops first if slot count constrained). */
export interface LabelLine {
  text: string
  priority: number    // 1 (drops first) .. 10 (must keep)
  fontSize?: number   // default 7
  bold?: boolean
}

// ──────────────────────────────────────────────────────────────────────────
// Common base for every equipment kind
// ──────────────────────────────────────────────────────────────────────────

export interface EquipmentBase {
  /** Stable unique id within the equipment graph. Used by connections + nodeOverrides. */
  id: string
  /** Bounding box hint — the renderer sizes its SVG to this. elkjs places it. */
  width: number
  height: number
  /** Port manifest exposed to the layout engine. */
  ports: Port[]
  /** Label slots the picker can fill with property-derived strings. */
  labelSlots: LabelSlot[]
  /** Label content lines. Picker assigns these to slots by priority. */
  labels: LabelLine[]
  /** Optional manual override — bypasses elkjs placement for this node only. */
  overrideXY?: { x: number; y: number }
}

// ──────────────────────────────────────────────────────────────────────────
// Equipment kinds — discriminated union
// ──────────────────────────────────────────────────────────────────────────

export interface PVArray extends EquipmentBase {
  kind: 'PVArray'
  props: {
    moduleModel: string         // e.g. 'Seraphim SRP-440-BTD-BG'
    moduleWatts: number         // 440
    moduleCount: number         // 20
    stringCount: number         // 2
    modulesPerString: number    // 10
    /** Optional per-string detail for multi-string layouts. */
    strings?: Array<{ id: number; modules: number }>
  }
}

export interface StringInverter extends EquipmentBase {
  kind: 'StringInverter'
  props: {
    model: string
    acKw: number
    mpptCount: number
  }
}

export interface MicroInverter extends EquipmentBase {
  kind: 'MicroInverter'
  props: {
    model: string
    acWatts: number             // per-unit (e.g. 700 W)
    perModule: boolean          // true: 1 per module; false: pair / quad
  }
}

export interface HybridInverter extends EquipmentBase {
  kind: 'HybridInverter'
  props: {
    model: string               // e.g. 'Duracell PC-MAX-15'
    acKw: number                // continuous AC output
    backupAcA?: number          // backup output amps
    listingStandard: string     // e.g. 'UL 1741-SB'
    branchCircuit?: number      // Tyson PV-5 convention — N for "BRANCH CIRCUIT N"
    moduleCount?: number        // count of modules on this circuit
  }
}

export interface BatteryStack extends EquipmentBase {
  kind: 'BatteryStack'
  props: {
    model: string               // e.g. 'Duracell 5kWh LFP'
    moduleCount: number         // e.g. 8 (per stack)
    moduleKwh: number           // e.g. 5
    chemistry: 'LFP' | 'NMC' | 'other'
    stackIndex?: number         // e.g. 1 for MICRO GRID #1
    siteNote?: string           // e.g. 'FLOOR · BOLLARDS · HEAT DET.'
  }
}

export interface MSP extends EquipmentBase {
  kind: 'MSP'
  props: {
    /** Busbar continuous amperage (e.g. 225). */
    busbarA: number
    /** Main breaker amperage (e.g. 125). */
    mainBreakerA: number
    /** Voltage class (e.g. '240V 1Φ 3W'). */
    voltage: string
    /** Service classification — 'EXTERIOR' / 'INTERIOR'. */
    location: 'EXTERIOR' | 'INTERIOR'
    /** NEMA rating (e.g. '3R'). */
    nemaRating: string
    /** Backfeed breaker descriptors for hybrid inverters. */
    backfeeds: Array<{ id: string; label: string; ampere: number }>
    /** Whether to include a surge protector slot. */
    hasSurgeProtector?: boolean
  }
}

export interface Disconnect extends EquipmentBase {
  kind: 'Disconnect'
  props: {
    /** Specific subkind for label semantics. */
    role: 'pv' | 'gen' | 'service' | 'ess'
    model: string               // e.g. 'Eaton DG223URB'
    ampere: number              // e.g. 100
    poles: 2 | 3
    fusible: boolean
    fuseAmpere?: number         // when fusible
    nemaRating: string          // e.g. '3R'
    /** True for service disc with bidirectional flow (PV + utility). */
    bidirectional?: boolean
  }
}

export interface RapidShutdown extends EquipmentBase {
  kind: 'RapidShutdown'
  props: {
    model: string               // e.g. 'RSD-D-20'
    /** Whether this is the initiator (red maintenance switch) vs module-level RSD. */
    role: 'initiator' | 'module-level'
    necCitation: string         // e.g. 'NEC 690.12(A)' / '690.12(B)(2)'
  }
}

export interface JunctionBox extends EquipmentBase {
  kind: 'JunctionBox'
  props: {
    /** What's joined (DC string, AC, etc.). */
    role: 'dc' | 'ac' | 'comms'
    nemaRating: string
    voltageRating: string       // e.g. '600V'
  }
}

export interface Meter extends EquipmentBase {
  kind: 'Meter'
  props: {
    /** Utility provider. */
    utility: string             // e.g. 'CenterPoint Energy'
    /** Service classification. */
    serviceA: number            // 200
    voltage: string             // '120/240V'
    bidirectional: boolean      // PV + utility flow
    /** Optional revenue-grade meter flag. */
    isRevenueGrade?: boolean
  }
}

export interface BackupPanel extends EquipmentBase {
  kind: 'BackupPanel'
  props: {
    model: string               // e.g. 'Eaton BRP20B125R'
    mainLugAmperage: number     // MLO rating (e.g. 125)
    circuitCount: number        // e.g. 20
    nemaRating: string
  }
}

export interface EVCharger extends EquipmentBase {
  kind: 'EVCharger'
  props: {
    model: string
    ampere: number              // e.g. 40
    voltage: string             // '240V 1Φ'
    smartLoadControl?: boolean  // J-1772 Level 2 with EV-EMS
  }
}

export interface ProductionCT extends EquipmentBase {
  kind: 'ProductionCT'
  props: {
    model: string               // e.g. 'CT EXT P/N 1001808'
    /** Where the CT physically clamps. */
    targetLabel: string         // e.g. 'Hybrid AC OUT · 100A'
    cableSpec: string           // e.g. '#18 SHIELDED'
  }
}

// Phase H8 Category H — comm subsystem (DPCRGM gateway + homeowner router).
// Gateway aggregates inverter + battery comm and bridges to the homeowner's
// router via ethernet. Router is dashed-bordered (existing equipment).
export interface CommGateway extends EquipmentBase {
  kind: 'CommGateway'
  props: {
    model: string               // e.g. 'DPCRGM-Cell'
    bridge: 'ethernet' | 'cellular' | 'ethernet+cellular'
  }
}

export interface HomeRouter extends EquipmentBase {
  kind: 'HomeRouter'
  props: {
    label: string               // e.g. 'HOMEOWNER ROUTER'
  }
}

// Phase H8 Category E — Grounding electrode + GEC. Anchor for the GEC
// conductor from the service / MSP. Triangle-with-vertical-strokes symbol
// (universal earth-ground glyph) painted in the box component.
export interface GroundingElectrode extends EquipmentBase {
  kind: 'GroundingElectrode'
  props: {
    electrodeType: 'rod' | 'plate' | 'concrete-encased' | 'water-pipe'
    /** Display label (e.g. 'GROUNDING ELECTRODE · 5/8"x8' CU ROD'). */
    label: string
  }
}

/** Union of every equipment kind. The discriminator is `kind`. */
export type Equipment =
  | PVArray
  | StringInverter
  | MicroInverter
  | HybridInverter
  | BatteryStack
  | MSP
  | Disconnect
  | RapidShutdown
  | JunctionBox
  | Meter
  | BackupPanel
  | EVCharger
  | ProductionCT
  | CommGateway
  | HomeRouter
  | GroundingElectrode

// ──────────────────────────────────────────────────────────────────────────
// Graph: equipment + connections + sheet metadata
// ──────────────────────────────────────────────────────────────────────────

/**
 * A connection (conductor) between two equipment ports.
 * The layout engine routes the wire orthogonally; the renderer paints the
 * polyline plus the conductor spec label along it.
 */
export interface Connection {
  id: string
  /** `equipmentId.portId` */
  from: string
  to: string
  /** Conductor spec — e.g. '(2) #6 AWG CU THWN-2 + (1) #8 EGC · ¾" EMT'. */
  conductor: string
  /** Optional NEC ampacity context for callouts. */
  ampacityNote?: string
  /** Which wire class — affects line style + color. */
  category: 'dc-string' | 'dc-battery' | 'ac-inverter' | 'ac-service' | 'comm' | 'ground' | 'gec'
}

export interface SheetMeta {
  /** Sheet size — drives PDF page size. */
  size: 'ANSI_B' | 'ANSI_C' | 'ARCH_C'  // start with ANSI B (11×17)
  orientation: 'landscape' | 'portrait'
  /** Title block fields — populated from PlansetData. */
  titleBlock: {
    sheetCode: string             // e.g. 'PV-5'
    sheetTitle: string            // e.g. 'Electrical Single Line Diagram'
    projectName: string
    projectNumber: string
    projectAddress: string
    contractor: string
    contractorAddress: string
    contractorPhone: string
    contractorLicense: string
    revision: string              // e.g. 'v1' / '2026-05-12'
    drawnBy: string
    checkedBy?: string
  }
  /** Optional design-time scale hint (1"=20', etc.). */
  scaleNote?: string
}

/**
 * The full equipment graph for one SLD sheet.
 * This is what the new spec format ships, and what `from-planset-data.ts`
 * (Phase 4) produces from PlansetData.
 */
export interface EquipmentGraph {
  equipment: Equipment[]
  connections: Connection[]
  sheet: SheetMeta
  /** Optional manual placement overrides for the 5% ELK gets wrong.
   *  Keyed by equipment id; value is absolute (x, y). */
  nodeOverrides?: Record<string, { x: number; y: number }>
  /** Notes / code citations rendered in the bottom-left notes block. */
  notes?: Array<{
    text: string
    severity: 'info' | 'warn'
    necCitations?: string[]
  }>
}

// ──────────────────────────────────────────────────────────────────────────
// Builders + helpers (used by adapters in Phase 4 and tests)
// ──────────────────────────────────────────────────────────────────────────

/** Default label-slot quad: one on each side, priority N=8, E=6, S=7, W=5. */
export function defaultLabelSlots(width: number, height: number): LabelSlot[] {
  return [
    { side: 'N', priority: 8, maxLines: 2, maxLineWidth: width + 80, lineHeight: 10 },
    { side: 'S', priority: 7, maxLines: 4, maxLineWidth: width + 80, lineHeight: 10 },
    { side: 'E', priority: 6, maxLines: 6, maxLineWidth: 180, lineHeight: 10 },
    { side: 'W', priority: 5, maxLines: 6, maxLineWidth: 180, lineHeight: 10 },
  ]
}

/** Standard 4-port quad for box-shaped equipment (centered ports).
 *
 * Port ID format: `${prefix}.${side}` (e.g. `msp.N`, `pv.E`). The dot
 * separator matches the convention used by `Connection.from`/`Connection.to`
 * so the elkjs adapter can pass port ids through untouched. */
export function quadPorts(prefix = ''): Port[] {
  const p = (suffix: string) => (prefix ? `${prefix}.${suffix}` : suffix)
  return [
    { id: p('N'), side: 'N' },
    { id: p('S'), side: 'S' },
    { id: p('E'), side: 'E' },
    { id: p('W'), side: 'W' },
  ]
}

/** Type guards for downstream dispatch. */
export function isInverter(e: Equipment): e is StringInverter | MicroInverter | HybridInverter {
  return e.kind === 'StringInverter' || e.kind === 'MicroInverter' || e.kind === 'HybridInverter'
}

export function isDisconnect(e: Equipment): e is Disconnect {
  return e.kind === 'Disconnect'
}

export function isHybrid(e: Equipment): e is HybridInverter {
  return e.kind === 'HybridInverter'
}
