// ── Planset Data Layer ─────────────────────────────────────────────────────
// Unified data model for the planset generator.
// Merges project DB data + equipment specs + redesign results into a single
// shape consumed by all sheet components.

import type { Project } from '@/types/database'

// ── NEC Ampacity Tables (Table 310.16, THWN-2 copper) ──────────────────────
// Single source-of-truth so PV-6 ampacity table + PV-8 conductor schedule render
// matching values for the same wire. Fixes the #4-vs-#4/0 (battery) and
// #6-vs-#1-vs-#3 (inverter→MSP) cross-sheet contradictions in the William
// Carter audit.

export const NEC_AMPACITY_75C: Record<string, { c90: number; c75: number }> = {
  '#14 AWG': { c90: 25, c75: 20 },
  '#12 AWG': { c90: 30, c75: 25 },
  '#10 AWG': { c90: 40, c75: 35 },
  '#8 AWG':  { c90: 55, c75: 50 },
  '#6 AWG':  { c90: 75, c75: 65 },
  '#4 AWG':  { c90: 95, c75: 85 },
  '#3 AWG':  { c90: 110, c75: 100 },
  '#2 AWG':  { c90: 130, c75: 115 },
  '#1 AWG':  { c90: 145, c75: 130 },
  '1/0 AWG': { c90: 170, c75: 150 },
  '2/0 AWG': { c90: 195, c75: 175 },
  '3/0 AWG': { c90: 225, c75: 200 },
  '4/0 AWG': { c90: 260, c75: 230 },
  '250 kcmil': { c90: 290, c75: 255 },
  '300 kcmil': { c90: 320, c75: 285 },
  '350 kcmil': { c90: 350, c75: 310 },
}

/**
 * Parse a wire spec like '#4/0 AWG CU THWN-2', '(2) #4/0 AWG', '1/0 AWG', or
 * '250 kcmil CU' and look up NEC 310.16 ampacity. Returns {c90, c75} for the
 * 90°C derate-from / 75°C terminal-cap columns. Returns {0, 0} when the size
 * cannot be parsed (callers fall back to a sane default rather than render 0).
 *
 * Lookup keys in `NEC_AMPACITY_75C` use `#` for #14–#1 (small AWG) and bare
 * `N/0` for paralleled AWG (1/0–4/0) — this helper normalizes either input
 * form to the matching key.
 */
export function ampacityFor(wireSpec: string): { c90: number; c75: number } {
  // `#` is optional so '1/0 AWG' (no #) and '#1 AWG' both match
  const awg = wireSpec.match(/(#?\d+(?:\/0)?)\s*AWG/i)
  if (awg) {
    const raw = awg[1].toUpperCase()
    // Table keys: '#14 AWG'…'#1 AWG' use '#'; '1/0 AWG'…'4/0 AWG' don't
    const key = raw.includes('/0') ? `${raw.replace('#', '')} AWG` : `${raw.startsWith('#') ? raw : '#' + raw} AWG`
    return NEC_AMPACITY_75C[key] ?? { c90: 0, c75: 0 }
  }
  const kcmil = wireSpec.match(/(\d+)\s*kcmil/i)
  if (kcmil) {
    return NEC_AMPACITY_75C[`${kcmil[1]} kcmil`] ?? { c90: 0, c75: 0 }
  }
  return { c90: 0, c75: 0 }
}

// ── Contractor ─────────────────────────────────────────────────────────────

export const MICROGRID_CONTRACTOR = {
  name: 'MicroGRID Energy',
  address: '600 Northpark Central Dr, Suite 140',
  city: 'Houston, TX 77073',
  phone: '(832) 280-7764',
  email: 'engineering@microgridenergy.com',
  license: '41312',
}

// ── Panel Presets ─────────────────────────────────────────────────────────

export interface PanelPreset {
  panelModel: string
  panelWattage: number
  panelVoc: number
  panelVmp: number
  panelIsc: number
  panelImp: number
  panelLengthMm: number
  panelWidthMm: number
  vocTempCoeff: number
  designTempLow: number
}

export const PANEL_PRESETS: Record<string, PanelPreset> = {
  'seraphim-440': {
    panelModel: 'Seraphim SRP-440-BTD-BG',
    panelWattage: 440,
    panelVoc: 41.5,
    panelVmp: 34.8,
    panelIsc: 13.5,
    panelImp: 12.65,
    panelLengthMm: 1722,
    panelWidthMm: 1134,
    vocTempCoeff: -0.28,
    designTempLow: -5,
  },
  'amp-410': {
    panelModel: 'AMP 410W Domestic',
    panelWattage: 410,
    panelVoc: 37.4,
    panelVmp: 31.3,
    panelIsc: 14.0,
    panelImp: 13.1,
    panelLengthMm: 1722,
    panelWidthMm: 1134,
    vocTempCoeff: -0.28,
    designTempLow: -5,
  },
}

/** Labels for the preset dropdown */
export const PANEL_PRESET_LABELS: Record<string, string> = {
  'seraphim-440': 'Seraphim SRP-440-BTD-BG (440W)',
  'amp-410': 'AMP 410W Domestic',
}

// ── Duracell Equipment Defaults ────────────────────────────────────────────
// Default panel is Seraphim 440 for EDGE redesigns.

export const DURACELL_DEFAULTS = {
  // Panel — Seraphim SRP-440-BTD-BG (standard for EDGE redesigns)
  ...PANEL_PRESETS['seraphim-440'],

  // Inverter
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterCount: 2,
  inverterAcPower: 15, // kW per unit
  maxPvPower: 19500,
  maxVoc: 500,
  mpptMin: 125,
  mpptMax: 425,
  mpptsPerInverter: 3,
  stringsPerMppt: 2,
  maxCurrentPerMppt: 26,

  // Battery
  batteryModel: 'Duracell 5kWh LFP',
  batteryCount: 16,
  batteryCapacity: 5,
  batteriesPerStack: 8,

  // Racking
  rackingModel: 'IronRidge XR100',

  // Wire specs (NEC compliant for Duracell layout)
  dcStringWire: '#10 AWG CU PV WIRE',
  dcConduit: '3/4" EMT',
  acWireInverter: '#10 AWG CU THWN-2',
  // #1 AWG sized for 78.1A continuous (62.5A × 1.25) per inverter — #6 AWG fails 75°C/0.91 derate.
  acWireToPanel: '#1 AWG CU THWN-2',
  acConduit: '1-1/4" EMT',
  // Service-entrance conduit (utility pole → service disconnect → meter). Carries
  // the 250 kcmil bonded copper feeder; 1-1/4" EMT can't fit 3× 250 kcmil per
  // NEC Ch 9 Table 4, so this is a separate field from acConduit (which sizes
  // the inverter→panel run).
  serviceEntranceConduit: '2" EMT',
  dcRunLengthFt: 100,
  acRunLengthFt: 50,
  batteryMaxCurrentA: 62.5, // Duracell Max Hybrid inverter battery port max continuous current
  batteryWire: '#4/0 AWG CU THWN-2',
  batteryConduit: '2" EMT',
  // Tag 2 — DC homerun (JBOX → PV Load Center), consolidates all string conductors
  dcHomerunWire: '#10 AWG CU THWN-2',
  dcHomerunEgc: '#8 AWG CU EGC',
  dcHomerunConduit: '1" EMT',
  // Tag 3 — DC home-run from non-fused PV disconnect to inverter DC input
  dcDisconnectWire: '#3 AWG CU THWN-2',
  dcDisconnectConduit: '1" EMT',
  // Tag 6 — Battery combiner output to inverter battery port
  batteryCombinerOutputWire: '#3 AWG CU THWN-2',
  batteryCombinerOutputConduit: '1-1/4" EMT',

  // Topology defaults — string-mppt for all new Duracell projects
  systemTopology: 'string-mppt' as const,
  rapidShutdownModel: 'RSD-D-20',
  hasCantexBar: true,
  // RGM (Revenue Grade Meter / PC-PRO-RGM) is OUT for Duracell projects per
  // William Carter feedback (2026-04-26). Legacy DWG-era plansets included it;
  // new MG-rendered Duracell installs do not. Per-project override available.
  hasRgm: false,

  // Building defaults (can be overridden per project)
  roofType: 'COMP SHINGLE',
  rafterSize: '2x6 @ 24" O.C.',
  stories: 1,
  buildingType: 'Type V-B',
  occupancy: 'R',
  windSpeed: 150,
  riskCategory: 'II',
  exposure: 'B',
}

// ── String Configuration ───────────────────────────────────────────────────

export interface PlansetString {
  id: number
  mppt: number
  modules: number
  roofFace: number
  vocCold: number
  vmpNominal: number
  current: number
}

// ── Roof Face ──────────────────────────────────────────────────────────────

export interface PlansetRoofFace {
  id: number
  tilt: number       // degrees (0 + azimuth 0 = unknown — derived faces use this sentinel)
  azimuth: number    // degrees (0 + tilt 0 = unknown — derived faces use this sentinel)
  modules: number    // panels on this face
  // NEW (Phase 3) — polygon coords in roof-plan unit space (normalized 0–1, top-left origin)
  polygon: Array<[number, number]>
  // NEW (Phase 3) — fire-setback applicability + walking-path classification
  setbacks: {
    ridge: boolean
    eave: boolean
    rake: boolean
    pathClear: 'walkable' | 'partial' | 'blocked'
  }
}

// ── Revisions / callouts / inverter mix (Phase 1 — Tyson rebuild scope) ───

/** Revision history entry — surfaced in title block + revision-table sheets. */
export interface PlansetRevision {
  rev: number
  date: string
  note: string
}

/** Equipment callout overlay on the site plan. Coords in normalized 0–1 space. */
export interface PlansetEquipmentCallout {
  id: number
  label: string
  x: number
  y: number
  leaderTo?: [number, number]
}

/** Inverter mix entry — supports legacy installs with multiple inverter models. */
export interface PlansetInverterMixEntry {
  model: string
  count: number
  acKw: number
}

// ── Racking Detail ─────────────────────────────────────────────────────────

export interface PlansetRackingDetail {
  attachmentModel: string
  attachmentCount: number
  railModel: string
  railLengthIn: number   // total rail length in inches
  railCount: number      // number of rail pieces
  railSpliceCount: number
  midClampCount: number
  endClampCount: number
  groundingLugCount: number
}

// ── Planset Data (fully resolved, what sheets consume) ─────────────────────

export interface PlansetData {
  // Project identity
  projectId: string
  owner: string
  address: string
  city: string
  state: string
  zip: string

  // Utility / metering
  utility: string
  meter: string
  esid: string
  ahj: string

  // Electrical
  voltage: string
  mspBusRating: string
  mainBreaker: string

  // Panel specs
  panelModel: string
  panelWattage: number
  panelCount: number
  panelVoc: number
  panelVmp: number
  panelIsc: number
  panelImp: number

  // System totals
  systemDcKw: number
  systemAcKw: number
  totalStorageKwh: number

  // Inverter specs
  inverterModel: string
  inverterCount: number
  inverterAcPower: number
  backfeedBreakerA: number  // per-inverter NEC 705.12 backfeed breaker, rounded up to nearest 5A
  maxPvPower: number
  mpptsPerInverter: number
  stringsPerMppt: number
  maxCurrentPerMppt: number

  // Battery specs
  batteryModel: string
  batteryCount: number
  batteryCapacity: number
  batteriesPerStack: number

  // Racking
  rackingModel: string
  racking: PlansetRackingDetail

  // Roof faces
  roofFaces: PlansetRoofFace[]

  // Strings
  strings: PlansetString[]
  stringsPerInverter: number[][] // indices into strings array per inverter

  // Existing system (pre-redesign)
  existingPanelModel: string | null
  existingPanelCount: number | null
  existingPanelWattage: number | null
  existingInverterModel: string | null
  existingInverterCount: number | null

  // Wire specs
  dcStringWire: string
  dcConduit: string
  acWireInverter: string
  acWireToPanel: string
  acConduit: string
  // 250 kcmil service entrance, utility pole → service disconnect → meter.
  // Separate from acConduit (inverter→panel) because Ch 9 Table 4 forbids
  // 250 kcmil ×3 in 1-1/4" EMT.
  serviceEntranceConduit: string
  dcRunLengthFt: number
  acRunLengthFt: number
  batteryMaxCurrentA: number
  batteryWire: string
  batteryConduit: string
  // Wire specs for the 3 inter-component DC runs that PV-6 wire chart + PV-8
  // conductor schedule reference. Keeping each run a separate field so the
  // OverridesPanel (designer UI) can tweak any one without affecting the others.
  dcHomerunWire: string         // Tag 2: JBOX → PV Load Center (consolidated string conductors)
  dcHomerunEgc: string          // Tag 2 EGC
  dcHomerunConduit: string      // Tag 2 conduit
  dcDisconnectWire: string      // Tag 3: PV Disconnect → Inverter DC input
  dcDisconnectConduit: string   // Tag 3 conduit
  batteryCombinerOutputWire: string    // Tag 6: Battery Combiner → Inverter battery port
  batteryCombinerOutputConduit: string // Tag 6 conduit

  // Building info
  roofType: string
  rafterSize: string
  stories: number
  buildingType: string
  occupancy: string
  windSpeed: number
  riskCategory: string
  exposure: string

  // Topology — gates micro-inverter-era components in the SLD
  systemTopology: 'string-mppt' | 'micro-inverter'
  rapidShutdownModel: string
  hasCantexBar: boolean
  // Revenue Grade Meter (PC-PRO-RGM) — OUT for Duracell, IN for legacy/AHJ-required
  hasRgm: boolean

  // Contractor
  contractor: typeof MICROGRID_CONTRACTOR

  // Computed
  vocCorrected: number
  pcsCurrentSetting: number

  // NEC 705.12(B)(2)(b)(2) "120% rule" compliance for load-side backfeed.
  // Sum of all backfeed breakers + main breaker must not exceed 120% × bus.
  // When false, designer must use line-side tap, sub-panel feeder, PCS-limited
  // output (NEC 705.13), or upsize the bus before submitting to AHJ.
  totalBackfeedA: number
  maxAllowableBackfeedA: number
  loadSideBackfeedCompliant: boolean

  // NEC 690.7 — max system voltage. The longest string's Voc-cold (Voc per
  // module × modules in the string × cold-temp correction) must not exceed
  // the inverter's maximum input voltage. When false, the inverter is at
  // risk of damage on the first cold morning + the planset is a 690.7
  // violation. Computed across all data.strings.
  inverterMaxVoc: number          // copy of inverter spec for the rendered banner / readiness eval
  maxStringVocCold: number        // longest string's Voc-cold; 0 when no strings configured
  maxSystemVoltageCompliant: boolean

  // P0-1 (R1 audit 2026-04-28) — Duracell Power Center Max Hybrid 15kW battery
  // conductor sizing is currently driven by `batteryMaxCurrentA` which is the
  // AC-EQUIVALENT of inverter output (kW / 240V), not the DC bus current. NEC
  // 706.30 + 690.8 require sizing to 125% of MAX continuous DC current pulled
  // from the battery stack. The rendered #4/0 may be undersized by ~5×, which
  // is a fire risk + AHJ rejection + PE license exposure if shipped wrong.
  // FAIL-CLOSED on Duracell projects until PE confirms the actual battery-port
  // DC max from the manufacturer spec sheet. Designer can override per project
  // when wire size has been independently verified.
  batteryDcSizingVerified: boolean

  // Site plan image (uploaded or extracted from original planset)
  sitePlanImageUrl: string | null

  // Sheet metadata
  sheetTotal: number
  drawnDate: string

  // ── Phase 1 — title-block / SLD topology / site-plan callouts (optional) ──
  // All defaulted in buildPlansetData() so existing fixtures don't break.
  drawnBy?: string
  revisions?: PlansetRevision[]
  sheetSize?: string
  equipmentCallouts?: PlansetEquipmentCallout[]
  inverterMix?: PlansetInverterMixEntry[]

  // ── Phase 2 (Claude Design 2026-05-11) — site/cover imagery + property survey ──
  // All optional, consumed by SheetPV3 (site plan) and SheetPV1 (cover page).
  // Sheets render placeholder boxes when these are null/undefined.
  propertyLines?: Array<{ side: 'N' | 'E' | 'S' | 'W'; dim: string }>
  aerialImageUrl?: string | null
  housePhotoUrl?: string | null
  vicinityImageUrl?: string | null
}

// ── Build function ─────────────────────────────────────────────────────────

export interface PlansetOverrides {
  // String configs (from redesign tool)
  strings?: PlansetString[]

  // Equipment specs (defaults to DURACELL_DEFAULTS)
  panelModel?: string
  panelWattage?: number
  panelCount?: number
  panelVoc?: number
  panelVmp?: number
  panelIsc?: number
  panelImp?: number
  inverterModel?: string
  inverterCount?: number
  inverterAcPower?: number
  maxPvPower?: number
  mpptsPerInverter?: number
  stringsPerMppt?: number
  maxCurrentPerMppt?: number
  batteryModel?: string
  batteryCount?: number
  batteryCapacity?: number
  batteriesPerStack?: number
  rackingModel?: string

  // Wire specs
  dcStringWire?: string
  dcConduit?: string
  acWireInverter?: string
  acWireToPanel?: string
  acConduit?: string
  serviceEntranceConduit?: string
  dcRunLengthFt?: number
  acRunLengthFt?: number
  batteryMaxCurrentA?: number
  batteryWire?: string
  batteryConduit?: string
  dcHomerunWire?: string
  dcHomerunEgc?: string
  dcHomerunConduit?: string
  dcDisconnectWire?: string
  dcDisconnectConduit?: string
  batteryCombinerOutputWire?: string
  batteryCombinerOutputConduit?: string

  // Building info
  roofType?: string
  rafterSize?: string
  stories?: number
  buildingType?: string
  occupancy?: string
  windSpeed?: number
  riskCategory?: string
  exposure?: string

  // Roof faces (optional — auto-derived from strings if not provided)
  roofFaces?: PlansetRoofFace[]

  // Racking overrides
  attachmentModel?: string
  railModel?: string

  // Temperature coefficients
  vocTempCoeff?: number
  designTempLow?: number

  // Site plan image URL
  sitePlanImageUrl?: string

  // Existing system
  existingPanelModel?: string
  existingPanelCount?: number
  existingPanelWattage?: number
  existingInverterModel?: string
  existingInverterCount?: number

  // Topology overrides (rare — only set when modeling a Hambrick-style legacy)
  systemTopology?: 'string-mppt' | 'micro-inverter'
  rapidShutdownModel?: string
  hasCantexBar?: boolean
  hasRgm?: boolean

  // P0-1 (R1 audit 2026-04-28) — per-project override of the Duracell battery
  // DC fail-closed gate. Defaults: Duracell inverters → false (block until PE
  // confirms manufacturer battery-port DC max); non-Duracell inverters → true
  // (no known sizing issue). Set true on a per-project basis only after wire
  // size has been independently verified against the manufacturer spec sheet.
  batteryDcSizingVerified?: boolean

  // ── Phase 1 — Tyson-rebuild override map ─────────────────────────────────
  // Two project DB row overrides + four title-block / sheet-metadata overrides
  // + the inverter-mix override for legacy installs.
  mspBusRating?: string
  meter?: string
  drawnBy?: string
  revisions?: PlansetRevision[]
  sheetSize?: string
  equipmentCallouts?: PlansetEquipmentCallout[]
  inverterMix?: PlansetInverterMixEntry[]
}

// ── TEMP (Phase 1 v2 validation) — Tyson PROJ-26922 as-built overrides ────
// Remove this block + the conditional merge below before any commit.
// Used to exercise calculateSldLayoutMicroInverter() end-to-end for screenshot
// validation since polygon/overrides DB persistence (greg_action #446) hasn't
// shipped yet.
const __TYSON_OVERRIDES_TEMP: PlansetOverrides = {
  mspBusRating: '225',
  meter: '66 317 844',
  systemTopology: 'micro-inverter',
  panelModel: 'Hyperion HY-DH108P8 405W',
  panelWattage: 405,
  panelCount: 17,
  panelVoc: 37.32,
  panelVmp: 31.21,
  panelIsc: 13.65,
  panelImp: 12.98,
  inverterModel: 'Duracell D700-M2',
  inverterCount: 9,
  inverterAcPower: 0.7,
  inverterMix: [
    { model: 'Duracell D700-M2', count: 8, acKw: 0.7 },
    { model: 'Duracell D350-M1', count: 1, acKw: 0.35 },
  ],
  batteryModel: 'Sonnen SonnenCORE+ SCORE-P20',
  batteryCount: 1,
  batteryCapacity: 20,
  batteriesPerStack: 1,
  rapidShutdownModel: 'INTEGRATED',
  hasCantexBar: false,
  hasRgm: true,
  drawnBy: 'MicroGRID',
  revisions: [
    { rev: 0, date: '02/14/2025', note: 'Initial issue' },
    { rev: 1, date: '02/24/2025', note: 'MSP upgrade per AHJ comment + Sonnen disconnect relocation' },
  ],
  equipmentCallouts: [
    { id: 1, label: '(N) AC J-BOX', x: 0.55, y: 0.42 },
    { id: 2, label: '(N) AC LOAD CENTER', x: 0.62, y: 0.50 },
    { id: 3, label: '(N) AC BATT DISC', x: 0.62, y: 0.62 },
    { id: 4, label: '(N) SONNEN ESS', x: 0.71, y: 0.62 },
    { id: 5, label: '(E) MSP 225A', x: 0.78, y: 0.50 },
    { id: 6, label: '(E) DPCRGM', x: 0.86, y: 0.50 },
    { id: 7, label: '(E) UTILITY METER', x: 0.92, y: 0.50 },
    { id: 8, label: "(N) GEN DISC < 10' MTR", x: 0.92, y: 0.62 },
  ],
}

/**
 * Merge project DB data + equipment defaults + redesign overrides into PlansetData.
 */
export function buildPlansetData(project: Project, overrides: PlansetOverrides = {}): PlansetData {
  // TEMP — see __TYSON_OVERRIDES_TEMP above. Remove before commit.
  if (project.id === 'PROJ-26922') {
    overrides = { ...__TYSON_OVERRIDES_TEMP, ...overrides }
  }
  const d = DURACELL_DEFAULTS

  const panelWattage = overrides.panelWattage ?? d.panelWattage
  // module_qty / battery_qty / inverter_qty come from a text DB column and may be stored as floats ("64.0", "1.0", "8.0") from Excel imports
  const toIntCount = (v: unknown): number => {
    if (v == null || v === '') return 0
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || n < 0) return 0
    return Math.round(n)
  }
  const panelCount = overrides.panelCount ?? toIntCount(project.module_qty)
  // New system inverter count: use override or default (NOT project.inverter_qty which is the OLD microinverter count)
  const inverterCount = overrides.inverterCount ?? d.inverterCount
  const inverterAcPower = overrides.inverterAcPower ?? d.inverterAcPower
  // New system battery count: use override or default (NOT project.battery_qty which is the OLD system)
  const batteryCount = overrides.batteryCount ?? d.batteryCount
  const batteryCapacity = overrides.batteryCapacity ?? d.batteryCapacity
  const panelVoc = overrides.panelVoc ?? d.panelVoc
  const mspBusRating = overrides.mspBusRating ?? String(project.msp_bus_rating ?? '200').replace(/\s*A$/i, '').trim()
  const mainBreakerNum = String(project.main_breaker ?? mspBusRating).replace(/\s*A$/i, '').trim()

  // NEC 240.6(A) standard OCPD sizes — breakers above 30A skip values like 45/55/65/75/85/95
  const NEC_STD_BREAKERS = [15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400]
  const clampToNecBreaker = (amps: number): number => {
    if (!Number.isFinite(amps) || amps <= 0) return 15
    for (const sz of NEC_STD_BREAKERS) { if (sz >= amps) return sz }
    return NEC_STD_BREAKERS[NEC_STD_BREAKERS.length - 1]
  }

  const systemDcKw = (panelCount * panelWattage) / 1000
  const systemAcKw = inverterCount * inverterAcPower
  const totalStorageKwh = batteryCount * batteryCapacity

  // Voc temperature correction
  const vocTempCoeff = overrides.vocTempCoeff ?? d.vocTempCoeff
  const designTempLow = overrides.designTempLow ?? d.designTempLow
  const absCoeff = Math.abs(vocTempCoeff / 100)
  const vocCorrected = panelVoc * (1 + absCoeff * (25 - designTempLow))

  // PCS controlled current setting: matches MSP bus rating (NEC 705.12 120% rule is for backfeed breaker sizing, not PCS)
  const busRatingNum = parseInt(mspBusRating) || 200
  const pcsCurrentSetting = busRatingNum

  // NEC 705.12(B)(2)(b)(2) — 120% rule compliance check
  const mainBreakerNumInt = parseInt(mainBreakerNum) || busRatingNum
  const perInverterBackfeedA = clampToNecBreaker((inverterAcPower * 1000 / 240) * 1.25)
  const totalBackfeedA = perInverterBackfeedA * inverterCount
  const maxAllowableBackfeedA = Math.max(0, busRatingNum * 1.2 - mainBreakerNumInt)
  const loadSideBackfeedCompliant = totalBackfeedA <= maxAllowableBackfeedA

  // P0-1 — Duracell battery-DC fail-closed gate. The current `batteryMaxCurrentA`
  // default is the AC-equivalent (15kW / 240V = 62.5A); the actual DC bus
  // current at 51.2V supporting 15kW is ~293A continuous. Until PE confirms the
  // actual battery-port DC max from the manufacturer spec sheet, fail-closed
  // on any inverter whose model name matches Duracell. Designer can override
  // per project via the per-project overrides flag (PlansetOverrides field).
  const inverterModel = overrides.inverterModel ?? d.inverterModel
  const isDuracellInverter = /duracell/i.test(inverterModel)
  const batteryDcSizingVerified = overrides.batteryDcSizingVerified
    ?? !isDuracellInverter  // non-Duracell inverters default to verified (no known issue)

  // Distribute strings across inverters
  const strings = overrides.strings ?? []

  // NEC 690.7 — max system voltage check (placed after `strings` is defined).
  // Each string carries `vocCold` already computed when the string was built
  // (see auto-distribute-strings + redesign tool); take the maximum across
  // strings and compare to the inverter's max input voltage. With no strings
  // configured (fresh project, no redesign yet) we have nothing to enforce —
  // pre-string projects can't even render PV-7 with a real number, so default
  // to compliant=false UNLESS the project also has zero panels (truly empty).
  // This makes the export gate fail-closed on partially-configured projects.
  const inverterMaxVoc = d.maxVoc
  const maxStringVocCold = strings.length > 0
    ? Math.max(...strings.map((s) => s.vocCold))
    : 0
  const maxSystemVoltageCompliant = strings.length === 0
    ? panelCount === 0  // empty-project edge case: no panels means no string to check
    : maxStringVocCold <= inverterMaxVoc
  const stringsPerInverter: number[][] = []
  if (strings.length > 0 && inverterCount > 0) {
    const perInv = Math.ceil(strings.length / inverterCount)
    for (let i = 0; i < inverterCount; i++) {
      const start = i * perInv
      const end = Math.min(start + perInv, strings.length)
      stringsPerInverter.push(Array.from({ length: end - start }, (_, j) => start + j))
    }
  }

  // Derive roof faces from strings (group by roofFace, sum modules)
  // pathClear is clamped to known values — a stale planset blob carrying an
  // old/typo'd value (e.g. 'open') would otherwise silently render as garbage
  // in the legend without TypeScript catching it (overrides cross a serialize
  // boundary).
  const PATH_CLEAR_VALUES = ['walkable', 'partial', 'blocked'] as const
  type PathClear = typeof PATH_CLEAR_VALUES[number]
  const clampPathClear = (v: unknown): PathClear =>
    PATH_CLEAR_VALUES.includes(v as PathClear) ? (v as PathClear) : 'walkable'

  const roofFaces: PlansetRoofFace[] = overrides.roofFaces
    ? overrides.roofFaces.map((face) => ({
        ...face,
        setbacks: { ...face.setbacks, pathClear: clampPathClear(face.setbacks?.pathClear) },
      }))
    : (() => {
        const faceMap = new Map<number, number>()
        for (const s of strings) {
          faceMap.set(s.roofFace, (faceMap.get(s.roofFace) ?? 0) + s.modules)
        }
        return Array.from(faceMap.entries()).map(([id, modules]) => ({
          id, tilt: 0, azimuth: 0, modules,
          polygon: [],
          setbacks: { ridge: false, eave: false, rake: false, pathClear: 'walkable' as const },
        }))
      })()

  // Compute racking details from panel count
  const attachmentCount = Math.ceil(panelCount * 2.2)
  const railCount = Math.ceil(panelCount * 0.7)
  const racking: PlansetRackingDetail = {
    attachmentModel: overrides.attachmentModel ?? 'IronRidge XR100 Roof Attachment',
    attachmentCount,
    railModel: overrides.railModel ?? 'CF LTE US RAIL AL MLL 165.4" 2012034',
    railLengthIn: Math.round(panelCount * 42.5), // ~42.5" rail per panel
    railCount,
    railSpliceCount: Math.ceil(railCount * 0.5),
    midClampCount: Math.ceil(panelCount * 1.5),
    endClampCount: Math.ceil(panelCount * 1.0),
    groundingLugCount: 5,
  }

  const today = new Date()
  const drawnDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`

  return {
    projectId: project.id,
    owner: project.name,
    address: project.address ?? '',
    // CRM city values sometimes include trailing state and/or zip ("Cypress, TX 77433", "Cypress TX", "CYPRESS, TEXAS")
    // Strip them so downstream `${city}, ${state} ${zip}` templates don't render duplicates.
    city: (project.city ?? '')
      .replace(/[,\s]+(TX|TEXAS)\s*\d{5}(-\d{4})?\s*$/i, '')
      .replace(/[,\s]+(TX|TEXAS)\s*$/i, '')
      .replace(/[,\s]+$/, '')
      .trim(),
    state: 'TX',
    zip: project.zip ?? '',
    utility: project.utility ?? '',
    meter: overrides.meter ?? project.meter_number ?? '',
    esid: ((): string => {
      const raw: unknown = project.esid
      if (raw == null) return ''
      if (typeof raw === 'number') return raw.toLocaleString('fullwide', { useGrouping: false })
      const s = String(raw).trim()
      // Detect Excel-corrupted scientific notation (e.g. "1.0089E+21") — original digits are unrecoverable
      if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) return 'ESID UNAVAILABLE'
      return s
    })(),
    ahj: project.ahj ?? '',
    voltage: project.voltage ?? '120/240V',
    mspBusRating: mspBusRating,
    mainBreaker: `${mainBreakerNum}A`,

    panelModel: overrides.panelModel ?? d.panelModel,
    panelWattage,
    panelCount,
    panelVoc,
    panelVmp: overrides.panelVmp ?? d.panelVmp,
    panelIsc: overrides.panelIsc ?? d.panelIsc,
    panelImp: overrides.panelImp ?? d.panelImp,

    systemDcKw: parseFloat(systemDcKw.toFixed(3)),
    systemAcKw,
    totalStorageKwh,

    inverterModel: overrides.inverterModel ?? d.inverterModel,
    inverterCount,
    inverterAcPower,
    backfeedBreakerA: clampToNecBreaker((inverterAcPower * 1000 / 240) * 1.25),
    maxPvPower: overrides.maxPvPower ?? d.maxPvPower,
    mpptsPerInverter: overrides.mpptsPerInverter ?? d.mpptsPerInverter,
    stringsPerMppt: overrides.stringsPerMppt ?? d.stringsPerMppt,
    maxCurrentPerMppt: overrides.maxCurrentPerMppt ?? d.maxCurrentPerMppt,

    batteryModel: overrides.batteryModel ?? d.batteryModel,
    batteryCount,
    batteryCapacity,
    // Batteries per stack: override → default, but cap at actual battery count per inverter
    batteriesPerStack: overrides.batteriesPerStack ?? Math.min(d.batteriesPerStack, Math.ceil(batteryCount / inverterCount)),

    rackingModel: overrides.rackingModel ?? d.rackingModel,
    racking,
    roofFaces,

    strings,
    stringsPerInverter,

    existingPanelModel: overrides.existingPanelModel ?? project.module ?? null,
    existingPanelCount: overrides.existingPanelCount ?? (project.module_qty != null ? toIntCount(project.module_qty) : null),
    existingPanelWattage: overrides.existingPanelWattage ?? null,
    existingInverterModel: overrides.existingInverterModel ?? project.inverter ?? null,
    existingInverterCount: overrides.existingInverterCount ?? (project.inverter_qty != null ? toIntCount(project.inverter_qty) : null),

    dcStringWire: overrides.dcStringWire ?? d.dcStringWire,
    dcConduit: overrides.dcConduit ?? d.dcConduit,
    dcRunLengthFt: overrides.dcRunLengthFt ?? d.dcRunLengthFt,
    acRunLengthFt: overrides.acRunLengthFt ?? d.acRunLengthFt,
    batteryMaxCurrentA: overrides.batteryMaxCurrentA ?? d.batteryMaxCurrentA,
    acWireInverter: overrides.acWireInverter ?? d.acWireInverter,
    acWireToPanel: overrides.acWireToPanel ?? d.acWireToPanel,
    acConduit: overrides.acConduit ?? d.acConduit,
    serviceEntranceConduit: overrides.serviceEntranceConduit ?? d.serviceEntranceConduit,
    batteryWire: overrides.batteryWire ?? d.batteryWire,
    batteryConduit: overrides.batteryConduit ?? d.batteryConduit,
    dcHomerunWire: overrides.dcHomerunWire ?? d.dcHomerunWire,
    dcHomerunEgc: overrides.dcHomerunEgc ?? d.dcHomerunEgc,
    dcHomerunConduit: overrides.dcHomerunConduit ?? d.dcHomerunConduit,
    dcDisconnectWire: overrides.dcDisconnectWire ?? d.dcDisconnectWire,
    dcDisconnectConduit: overrides.dcDisconnectConduit ?? d.dcDisconnectConduit,
    batteryCombinerOutputWire: overrides.batteryCombinerOutputWire ?? d.batteryCombinerOutputWire,
    batteryCombinerOutputConduit: overrides.batteryCombinerOutputConduit ?? d.batteryCombinerOutputConduit,

    roofType: overrides.roofType ?? d.roofType,
    rafterSize: overrides.rafterSize ?? d.rafterSize,
    stories: overrides.stories ?? d.stories,
    buildingType: overrides.buildingType ?? d.buildingType,
    occupancy: overrides.occupancy ?? d.occupancy,
    windSpeed: overrides.windSpeed ?? d.windSpeed,
    riskCategory: overrides.riskCategory ?? d.riskCategory,
    exposure: overrides.exposure ?? d.exposure,

    sitePlanImageUrl: overrides.sitePlanImageUrl ?? null,

    systemTopology: overrides.systemTopology ?? d.systemTopology,
    rapidShutdownModel: overrides.rapidShutdownModel ?? d.rapidShutdownModel,
    hasCantexBar: overrides.hasCantexBar ?? d.hasCantexBar,
    hasRgm: overrides.hasRgm ?? d.hasRgm,

    contractor: MICROGRID_CONTRACTOR,
    vocCorrected: parseFloat(vocCorrected.toFixed(2)),
    pcsCurrentSetting,
    totalBackfeedA,
    maxAllowableBackfeedA,
    loadSideBackfeedCompliant,
    inverterMaxVoc,
    maxStringVocCold: parseFloat(maxStringVocCold.toFixed(2)),
    maxSystemVoltageCompliant,
    batteryDcSizingVerified,
    sheetTotal: 10,  // base count — page.tsx overrides when enhanced mode adds sheets
    drawnDate,

    // ── Phase 1 — title-block / SLD topology / site-plan callouts ─────────
    drawnBy: overrides.drawnBy ?? 'MicroGRID',
    sheetSize: overrides.sheetSize ?? 'ANSI B (11"×17")',
    revisions: overrides.revisions ?? [{ rev: 0, date: drawnDate, note: 'Initial issue' }],
    equipmentCallouts: overrides.equipmentCallouts ?? [],
    inverterMix: overrides.inverterMix,  // explicit undefined preserved — no default
  }
}

// ── Phase 1 helpers ────────────────────────────────────────────────────────

/**
 * For sheets that need a single representative inverter model when a mix is
 * present (e.g. PV-1 cover summary, BOM grouping). Returns the entry with the
 * highest total AC (count × acKw) — the dominant inverter for the install.
 */
export function dominantInverter(
  mix: PlansetInverterMixEntry[] | undefined,
): PlansetInverterMixEntry | null {
  if (!mix || mix.length === 0) return null
  return mix.reduce((winner, m) =>
    m.count * m.acKw > winner.count * winner.acKw ? m : winner,
  )
}

/**
 * When inverterMix is populated, validate consistency with the singular
 * inverterModel/inverterCount fields. Throws (development) or warns (production)
 * on mismatch — caller decides which based on env.
 */
export function validateInverterMix(
  data: { inverterModel: string; inverterCount: number; inverterMix?: PlansetInverterMixEntry[] },
): void {
  const mix = data.inverterMix
  if (!mix || mix.length === 0) return
  const totalCount = mix.reduce((acc, m) => acc + m.count, 0)
  if (totalCount !== data.inverterCount) {
    const msg = `[planset-types] inverterMix count sum (${totalCount}) does not match data.inverterCount (${data.inverterCount}).`
    if (process.env.NODE_ENV === 'development') throw new Error(msg)
    else console.warn(msg)
  }
  if (mix.length === 1 && mix[0].model !== data.inverterModel) {
    const msg = `[planset-types] single-entry inverterMix model "${mix[0].model}" does not match data.inverterModel "${data.inverterModel}".`
    if (process.env.NODE_ENV === 'development') throw new Error(msg)
    else console.warn(msg)
  }
}
