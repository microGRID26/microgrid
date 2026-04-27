/**
 * Planset calculation functions — extracted from page.tsx for testability.
 *
 * NEC-compliant electrical calculations for solar engineering documents:
 * - String distribution across inverter MPPTs
 * - DC/AC voltage drop per NEC 310
 * - Ampacity correction (conduit fill, temperature)
 * - OCPD/fuse sizing (125% rule, round-up to 5A increments)
 * - Conductor schedule values
 */

import type { PlansetString, PlansetData } from './planset-types'

// ── WIRE RESISTANCE TABLE ──────────────────────────────────────────────────
// Resistance in ohms per 1000 feet, copper conductors at 75°C

export const WIRE_RESISTANCE: Record<string, number> = {
  '#14': 3.14, '#12': 1.98, '#10': 1.24, '#8': 0.778, '#6': 0.491,
  '#4': 0.308, '#3': 0.245, '#2': 0.194, '#1': 0.154, '1/0': 0.122,
}

// ── NEC CONSTANTS ──────────────────────────────────────────────────────────

export const NEC = {
  /** Default ambient temperature (°C) */
  ambientTemp: 37,
  /** THWN-2 copper temperature correction factor at 37°C */
  tempCorrectionFactor: 0.91,
  /** NEC 310.15 conduit fill factor */
  conduitFillFactor: 0.70,
  /** AC system voltage */
  acVoltage: 240,
  /** Battery stack voltage (Duracell LFP) */
  batteryStackVoltage: 51.2,
  /** Battery stack power (W) */
  batteryStackPower: 23000,
} as const

// ── AMPACITY TABLE ─────────────────────────────────────────────────────────
// [label, baseAmpacity, conduitFill, ambientTemp, 75°C max]

export type AmpacityRow = [string, number, number, number, number]

export const AMPACITY_TABLE: AmpacityRow[] = [
  ['#10 AWG CU (DC STRING)', 40, 0.70, 37, 30],
  ['#4 AWG CU (BATTERY)', 95, 0.70, 37, 85],
  ['#1 AWG CU (INVERTER AC)', 145, 0.70, 37, 130],
  ['#6 AWG CU (EGC)', 75, 1.0, 37, 65],
]

// ── AUTO STRING DISTRIBUTION ───────────────────────────────────────────────

/**
 * Distribute solar panels across inverter MPPT inputs as evenly as possible.
 *
 * Algorithm:
 *  1. Calculate max modules per string based on Voc limit
 *  2. Determine number of strings needed (capped by total inputs)
 *  3. Distribute panels evenly with remainder going to first N strings
 */
export function autoDistributeStrings(
  panelCount: number,
  vocCorrected: number,
  panelVmp: number,
  panelImp: number,
  inverterCount: number,
  mpptsPerInverter: number,
  stringsPerMppt: number,
  maxVoc: number,
): PlansetString[] {
  const totalInputs = inverterCount * mpptsPerInverter * stringsPerMppt
  const maxPerString = Math.floor(maxVoc / vocCorrected)
  const neededStrings = Math.min(Math.ceil(panelCount / (maxPerString || 1)), totalInputs)
  if (neededStrings <= 0) return []
  const baseSize = Math.floor(panelCount / neededStrings)
  const extra = panelCount % neededStrings

  const strings: PlansetString[] = []
  for (let i = 0; i < neededStrings; i++) {
    const modules = baseSize + (i < extra ? 1 : 0)
    strings.push({
      id: i + 1,
      mppt: Math.floor(i / stringsPerMppt) + 1,
      modules,
      roofFace: 1,
      vocCold: parseFloat((modules * vocCorrected).toFixed(1)),
      vmpNominal: parseFloat((modules * panelVmp).toFixed(1)),
      current: panelImp,
    })
  }
  return strings
}

// ── VOLTAGE DROP ───────────────────────────────────────────────────────────

export interface VoltageDropResult {
  /** Voltage drop in volts */
  vDrop: number
  /** Voltage drop as percentage */
  vDropPct: number
  /** PASS if under threshold, FAIL if over */
  status: 'PASS' | 'FAIL'
}

/**
 * Calculate DC string voltage drop per NEC.
 * Formula: V_drop = 2 × Length(ft) × Current(A) × Resistance(Ω/1000ft) / 1000
 * Threshold: < 2%
 */
export function calcDcVoltageDrop(
  current: number,
  vmpNominal: number,
  runFt: number,
  wireSize: string,
): VoltageDropResult {
  const resistance = WIRE_RESISTANCE[wireSize] ?? 0
  const vDrop = (2 * runFt * current * resistance) / 1000
  const vDropPct = vmpNominal > 0 ? (vDrop / vmpNominal) * 100 : 0
  return {
    vDrop: parseFloat(vDrop.toFixed(4)),
    vDropPct: parseFloat(vDropPct.toFixed(4)),
    status: vDropPct < 2 ? 'PASS' : 'FAIL',
  }
}

/**
 * Calculate AC voltage drop (inverter to panel).
 * Threshold: < 3%
 */
export function calcAcVoltageDrop(
  inverterAcPowerKw: number,
  runFt: number,
  wireSize: string,
  acVoltage: number = NEC.acVoltage,
): VoltageDropResult {
  const current = inverterAcPowerKw * 1000 / acVoltage
  const resistance = WIRE_RESISTANCE[wireSize] ?? 0
  const vDrop = (2 * runFt * current * resistance) / 1000
  const vDropPct = acVoltage > 0 ? (vDrop / acVoltage) * 100 : 0
  return {
    vDrop: parseFloat(vDrop.toFixed(4)),
    vDropPct: parseFloat(vDropPct.toFixed(4)),
    status: vDropPct < 3 ? 'PASS' : 'FAIL',
  }
}

// ── AMPACITY CORRECTION ────────────────────────────────────────────────────

export interface AmpacityCorrectionResult {
  label: string
  baseAmpacity: number
  correctedAmpacity: number
  max75C: number
  usableAmpacity: number
}

/**
 * Calculate corrected ampacity per NEC 310.12.
 * Corrected = Base × Conduit Fill × Temperature CF
 * Usable = min(Corrected, 75°C column maximum)
 */
export function calcAmpacityCorrection(
  row: AmpacityRow,
  tempCF: number = NEC.tempCorrectionFactor,
): AmpacityCorrectionResult {
  const corrected = parseFloat((row[1] * row[2] * tempCF).toFixed(1))
  const usable = Math.min(corrected, row[4])
  return {
    label: row[0],
    baseAmpacity: row[1],
    correctedAmpacity: corrected,
    max75C: row[4],
    usableAmpacity: usable,
  }
}

// ── OCPD / FUSE SIZING ────────────────────────────────────────────────────

/**
 * Calculate string fuse size per NEC.
 * Uses 1.56× Isc, rounded up to nearest 5A.
 */
export function calcStringFuseSize(panelIsc: number): { fuseCalc: number; fuseSize: number } {
  const fuseCalc = panelIsc * 1.56
  const fuseSize = Math.ceil(fuseCalc / 5) * 5
  return { fuseCalc: parseFloat(fuseCalc.toFixed(2)), fuseSize }
}

/**
 * Calculate OCPD size from FLA per 125% rule.
 * FLA × 1.25, rounded up to nearest 5A.
 */
export function calcOcpdSize(fla: number): { fla125: number; ocpd: number } {
  const fla125 = fla * 1.25
  const ocpd = Math.ceil(fla125 / 5) * 5
  return { fla125: parseFloat(fla125.toFixed(2)), ocpd }
}

// ── CONDUCTOR SCHEDULE ─────────────────────────────────────────────────────

export interface ConductorScheduleEntry {
  tag: string
  circuit: string
  fla: number
  fla125: number
  ocpd: number
  baseAmpacity: number
  correctedAmpacity: number
  max75C: number
  usableAmpacity: number
}

/**
 * Generate the full conductor schedule for PV-8 sheet.
 */
export function buildConductorSchedule(data: PlansetData): ConductorScheduleEntry[] {
  const tf = NEC.tempCorrectionFactor
  const cf = NEC.conduitFillFactor
  const entries: ConductorScheduleEntry[] = []

  // String conductors. PV-source-circuit OCPD per NEC 690.9(B): 156% × Isc
  // (= 125% conductor sizing × 125% continuous-duty allowance). Was using
  // calcOcpdSize(panelImp) which is the 125% load-OCPD rule — wrong for PV
  // string fuses. The 156% helper is right above this function.
  const stringFla = data.panelImp
  const stringFla125 = parseFloat((stringFla * 1.25).toFixed(2))
  const { fuseSize: stringOcpd } = calcStringFuseSize(data.panelIsc)
  const string10Amp = 40
  const stringCorrected = parseFloat((string10Amp * cf * tf).toFixed(1))
  const string75C = 35  // NEC 310.16 #10 AWG @ 75°C
  const stringUsable = Math.min(stringCorrected, string75C)

  for (const s of data.strings) {
    entries.push({
      tag: `S${s.id}`,
      circuit: `STRING ${s.id} (${s.modules} MOD)`,
      fla: stringFla,
      fla125: stringFla125,
      ocpd: stringOcpd,
      baseAmpacity: string10Amp,
      correctedAmpacity: stringCorrected,
      max75C: string75C,
      usableAmpacity: stringUsable,
    })
  }

  // Battery conductor
  if (data.batteryCount > 0) {
    const battFla = 63.16
    const battFla125 = parseFloat((battFla * 1.25).toFixed(1))
    const batt4Amp = 95
    const battCorrected = parseFloat((batt4Amp * cf * tf).toFixed(1))
    const batt75C = 85
    entries.push({
      tag: 'BATT',
      circuit: `BATTERY (${data.batteryCount}x ${data.batteryModel})`,
      fla: battFla,
      fla125: battFla125,
      ocpd: 80,
      baseAmpacity: batt4Amp,
      correctedAmpacity: battCorrected,
      max75C: batt75C,
      usableAmpacity: Math.min(battCorrected, batt75C),
    })
  }

  // Inverter conductor
  const invFla = parseFloat((data.inverterAcPower * 1000 / NEC.acVoltage).toFixed(1))
  const invFla125 = parseFloat((invFla * 1.25).toFixed(1))
  const inv1Amp = 145
  const invCorrected = parseFloat((inv1Amp * cf * tf).toFixed(1))
  const inv75C = 130
  // Inverter→MSP OCPD = backfeed breaker amps. Was hardcoded 100A — drifts
  // from PV-4/PV-6/PV-7.1/SheetPV8 which all derive from data.backfeedBreakerA.
  entries.push({
    tag: 'INV',
    circuit: `INVERTER (${data.inverterCount}x ${data.inverterModel.split(' ').slice(0, 3).join(' ')})`,
    fla: invFla,
    fla125: invFla125,
    ocpd: data.backfeedBreakerA,
    baseAmpacity: inv1Amp,
    correctedAmpacity: invCorrected,
    max75C: inv75C,
    usableAmpacity: Math.min(invCorrected, inv75C),
  })

  // GEN — service-entrance row (utility pole → service disconnect → meter).
  // Sized to data.mainBreaker per NEC 230.42; 250 kcmil CU THWN-2 @ 75°C.
  // mainBreaker comes in as e.g. '200A' or '200'; clamp to a positive integer
  // and fall back to 200 only when the value is missing/garbage (not when 0).
  const mainParsed = parseInt(data.mainBreaker)
  const genFla = (Number.isFinite(mainParsed) && mainParsed > 0) ? mainParsed : 200
  const genFla125 = parseFloat((genFla * 1.25).toFixed(1))
  const gen250kcmilAmp = 290 // 250 kcmil CU THWN-2 @ 90°C
  const gen75C = 255         // 250 kcmil CU THWN-2 @ 75°C
  // Service entrance not subject to 4+CCC fill derate (NEC 310.15(C)(1)),
  // so corrected = 75°C max here.
  entries.push({
    tag: 'GEN',
    circuit: 'SERVICE DISCONNECT → UTILITY METER',
    fla: genFla,
    fla125: genFla125,
    ocpd: genFla,
    baseAmpacity: gen250kcmilAmp,
    correctedAmpacity: gen75C,
    max75C: gen75C,
    usableAmpacity: gen75C,
  })

  return entries
}

// ── BOM GENERATION ─────────────────────────────────────────────────────────

export interface BomRow {
  item: string
  qty: number
  model: string
}

/**
 * Generate Bill of Materials from PlansetData.
 */
export function buildBom(data: PlansetData): BomRow[] {
  // AC disconnect amps tracks data.mainBreaker so a 100A / 150A service
  // doesn't get a 200A disconnect specced. Same parse-guard as PV-8 GEN row.
  const mainParsed = parseInt(data.mainBreaker)
  const acDiscA = (Number.isFinite(mainParsed) && mainParsed > 0) ? mainParsed : 200
  return [
    { item: 'SOLAR PV MODULE', qty: data.panelCount, model: data.panelModel },
    { item: 'RAPID SHUTDOWN DEVICE', qty: data.panelCount, model: 'APSMART RSD-D-20' },
    { item: 'EMERGENCY POWER OFF', qty: 1, model: 'DURACELL EMERGENCY STOP BUTTON' },
    { item: 'INVERTER', qty: data.inverterCount, model: data.inverterModel },
    { item: 'BATTERY', qty: data.batteryCount, model: data.batteryModel },
    { item: 'JUNCTION BOX', qty: 2, model: 'JUNCTION BOXES' },
    { item: 'AC DISCONNECT', qty: 1, model: `${acDiscA}A/2P NON-FUSIBLE DISCONNECT 240V N3R` },
    { item: 'ATTACHMENT', qty: data.racking.attachmentCount, model: data.racking.attachmentModel },
    { item: 'RAIL CLICKER', qty: data.racking.attachmentCount, model: 'IronRidge XR100 Rail Clicker' },
    { item: 'RAIL', qty: data.racking.railCount, model: data.racking.railModel },
    { item: 'RAIL SPLICE', qty: data.racking.railSpliceCount, model: 'CF RAIL SPLICE SS 2012013' },
    { item: 'MID CLAMPS', qty: data.racking.midClampCount, model: 'MID CLAMP ASSEMBLY' },
    { item: 'END CLAMPS', qty: data.racking.endClampCount, model: 'END CLAMP ASSEMBLY' },
    { item: 'GROUNDING LUG', qty: data.racking.groundingLugCount, model: 'GROUNDING LUGS' },
  ]
}
