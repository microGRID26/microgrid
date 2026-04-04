// ── Planset Data Layer ─────────────────────────────────────────────────────
// Unified data model for the planset generator.
// Merges project DB data + equipment specs + redesign results into a single
// shape consumed by all sheet components.

import type { Project } from '@/types/database'

// ── Contractor ─────────────────────────────────────────────────────────────

export const MICROGRID_CONTRACTOR = {
  name: 'MicroGRID Energy',
  address: '15200 E Hardy Rd',
  city: 'Houston, TX 77060',
  phone: '(888) 485-5551',
  email: 'engineering@microgridenergy.com',
  license: '32259',
}

// ── Duracell Equipment Defaults ────────────────────────────────────────────
// All current redesigns use the same target equipment.

export const DURACELL_DEFAULTS = {
  // Panel
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
  batteryWire: '#4/0 AWG CU THWN-2',
  batteryConduit: '2" EMT',
  batteryEgc: '#6 AWG CU',
  feederWire: '#2 AWG CU THWN-2',
  feederConduit: '1" EMT',

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
  tilt: number       // degrees
  azimuth: number    // degrees
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
  const panelCount = overrides.panelCount ?? project.module_qty ?? 0
  const inverterCount = overrides.inverterCount ?? project.inverter_qty ?? d.inverterCount
  const inverterAcPower = overrides.inverterAcPower ?? d.inverterAcPower
  const batteryCount = overrides.batteryCount ?? project.battery_qty ?? d.batteryCount
  const batteryCapacity = overrides.batteryCapacity ?? d.batteryCapacity
  const panelVoc = overrides.panelVoc ?? d.panelVoc
  const mspBusRating = project.msp_bus_rating ?? '200'

  const systemDcKw = (panelCount * panelWattage) / 1000
  const systemAcKw = inverterCount * inverterAcPower
  const totalStorageKwh = batteryCount * batteryCapacity

  // Voc temperature correction
  const absCoeff = Math.abs(d.vocTempCoeff / 100)
  const vocCorrected = panelVoc * (1 + absCoeff * (25 - d.designTempLow))

  // PCS current setting: 120% of bus rating, or per MSP
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
    esid: project.esid ?? '',
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
    maxPvPower: overrides.maxPvPower ?? d.maxPvPower,
    mpptsPerInverter: overrides.mpptsPerInverter ?? d.mpptsPerInverter,
    stringsPerMppt: overrides.stringsPerMppt ?? d.stringsPerMppt,
    maxCurrentPerMppt: overrides.maxCurrentPerMppt ?? d.maxCurrentPerMppt,

    batteryModel: overrides.batteryModel ?? d.batteryModel,
    batteryCount,
    batteryCapacity,
    batteriesPerStack: overrides.batteriesPerStack ?? d.batteriesPerStack,

    rackingModel: overrides.rackingModel ?? d.rackingModel,
    racking,
    roofFaces,

    strings,
    stringsPerInverter,

    existingPanelModel: overrides.existingPanelModel ?? project.module ?? null,
    existingPanelCount: overrides.existingPanelCount ?? project.module_qty ?? null,
    existingPanelWattage: overrides.existingPanelWattage ?? null,
    existingInverterModel: overrides.existingInverterModel ?? project.inverter ?? null,
    existingInverterCount: overrides.existingInverterCount ?? project.inverter_qty ?? null,

    dcStringWire: overrides.dcStringWire ?? d.dcStringWire,
    dcConduit: overrides.dcConduit ?? d.dcConduit,
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

    contractor: MICROGRID_CONTRACTOR,
    vocCorrected: parseFloat(vocCorrected.toFixed(2)),
    pcsCurrentSetting,
    sheetTotal: 8,
    drawnDate,
  }
}
