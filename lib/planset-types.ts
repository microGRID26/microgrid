// ── Planset Data Layer ─────────────────────────────────────────────────────
// Unified data model for the planset generator.
// Merges project DB data + equipment specs + redesign results into a single
// shape consumed by all sheet components.

import type { Project } from '@/types/database'

// ── Contractor ─────────────────────────────────────────────────────────────

export const MICROGRID_CONTRACTOR = {
  name: 'MicroGRID Energy',
  address: '600 Northpark Central Dr, Suite 140',
  city: 'Houston, TX 77073',
  phone: '(888) 485-5551',
  email: 'engineering@microgridenergy.com',
  license: '32259',
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
  acWireToPanel: '#6 AWG CU THWN-2',
  acConduit: '1-1/4" EMT',
  dcRunLengthFt: 100,
  acRunLengthFt: 50,
  batteryMaxCurrentA: 62.5, // Duracell Max Hybrid inverter battery port max continuous current
  batteryWire: '#4/0 AWG CU THWN-2',
  batteryConduit: '2" EMT',

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
  dcRunLengthFt: number
  acRunLengthFt: number
  batteryMaxCurrentA: number
  batteryWire: string
  batteryConduit: string

  // Building info
  roofType: string
  rafterSize: string
  stories: number
  buildingType: string
  occupancy: string
  windSpeed: number
  riskCategory: string
  exposure: string

  // Contractor
  contractor: typeof MICROGRID_CONTRACTOR

  // Computed
  vocCorrected: number
  pcsCurrentSetting: number

  // Site plan image (uploaded or extracted from original planset)
  sitePlanImageUrl: string | null

  // Sheet metadata
  sheetTotal: number
  drawnDate: string
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
  dcRunLengthFt?: number
  acRunLengthFt?: number
  batteryMaxCurrentA?: number
  batteryWire?: string
  batteryConduit?: string

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
}

/**
 * Merge project DB data + equipment defaults + redesign overrides into PlansetData.
 */
export function buildPlansetData(project: Project, overrides: PlansetOverrides = {}): PlansetData {
  const d = DURACELL_DEFAULTS

  const panelWattage = overrides.panelWattage ?? d.panelWattage
  // module_qty / battery_qty / inverter_qty come from a text DB column and may be stored as floats ("64.0", "1.0", "8.0") from Excel imports
  const toIntCount = (v: unknown): number => {
    if (v == null || v === '') return 0
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? Math.round(n) : 0
  }
  const panelCount = overrides.panelCount ?? toIntCount(project.module_qty)
  // New system inverter count: use override or default (NOT project.inverter_qty which is the OLD microinverter count)
  const inverterCount = overrides.inverterCount ?? d.inverterCount
  const inverterAcPower = overrides.inverterAcPower ?? d.inverterAcPower
  // New system battery count: use override or default (NOT project.battery_qty which is the OLD system)
  const batteryCount = overrides.batteryCount ?? d.batteryCount
  const batteryCapacity = overrides.batteryCapacity ?? d.batteryCapacity
  const panelVoc = overrides.panelVoc ?? d.panelVoc
  const mspBusRating = String(project.msp_bus_rating ?? '200').replace(/\s*A$/i, '').trim()

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

  // Distribute strings across inverters
  const strings = overrides.strings ?? []
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
  const roofFaces: PlansetRoofFace[] = overrides.roofFaces ?? (() => {
    const faceMap = new Map<number, number>()
    for (const s of strings) {
      faceMap.set(s.roofFace, (faceMap.get(s.roofFace) ?? 0) + s.modules)
    }
    return Array.from(faceMap.entries()).map(([id, modules]) => ({
      id, tilt: 0, azimuth: 0, modules,
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
    city: project.city ?? '',
    state: 'TX',
    zip: project.zip ?? '',
    utility: project.utility ?? '',
    meter: project.meter_number ?? '',
    esid: ((): string => {
      const raw: unknown = project.esid
      if (raw == null) return ''
      if (typeof raw === 'number') return raw.toLocaleString('fullwide', { useGrouping: false })
      const s = String(raw)
      // Detect Excel-corrupted scientific notation (e.g. "1.0089E+21") — original digits are unrecoverable
      if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) return 'ESID UNAVAILABLE'
      return s
    })(),
    ahj: project.ahj ?? '',
    voltage: project.voltage ?? '120/240V',
    mspBusRating: mspBusRating,
    mainBreaker: project.main_breaker ?? `${mspBusRating}A`,

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
    backfeedBreakerA: Math.ceil((inverterAcPower * 1000 / 240) * 1.25 / 5) * 5,
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
    batteryWire: overrides.batteryWire ?? d.batteryWire,
    batteryConduit: overrides.batteryConduit ?? d.batteryConduit,

    roofType: overrides.roofType ?? d.roofType,
    rafterSize: overrides.rafterSize ?? d.rafterSize,
    stories: overrides.stories ?? d.stories,
    buildingType: overrides.buildingType ?? d.buildingType,
    occupancy: overrides.occupancy ?? d.occupancy,
    windSpeed: overrides.windSpeed ?? d.windSpeed,
    riskCategory: overrides.riskCategory ?? d.riskCategory,
    exposure: overrides.exposure ?? d.exposure,

    sitePlanImageUrl: overrides.sitePlanImageUrl ?? null,

    contractor: MICROGRID_CONTRACTOR,
    vocCorrected: parseFloat(vocCorrected.toFixed(2)),
    pcsCurrentSetting,
    sheetTotal: 9,  // base count — page.tsx overrides when enhanced mode adds sheets
    drawnDate,
  }
}
