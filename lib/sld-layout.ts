// lib/sld-layout.ts
// SVG Single-Line Diagram Layout Engine

import { renderSldFromSpec, type SldSpec } from './sld-from-spec'
import sonnenSpec from './sld-layouts/sonnen-microinverter.json'
import rushSpec from './sld-layouts/rush-spatial.json'
import legacySpec from './sld-layouts/legacy-string-mppt.json'

export interface SldConfig {
  // Project data
  projectName: string
  address: string
  panelModel: string
  panelWattage: number
  panelCount: number
  inverterModel: string
  inverterCount: number
  inverterAcKw: number
  maxPvPower: number
  mpptsPerInverter: number
  stringsPerMppt: number
  maxCurrentPerMppt: number
  batteryModel: string
  batteryCount: number
  batteryCapacity: number
  batteriesPerStack: number
  rackingModel: string
  // String configs
  strings: { id: number; modules: number; roofFace: number; vocCold: number; vmp: number; imp: number }[]
  // String split per inverter
  stringsPerInverter: number[][] // e.g. [[0,1,2], [3,4,5]] — indices into strings array
  // Site info
  meter: string
  esid: string
  utility: string
  systemDcKw: number
  systemAcKw: number
  totalStorageKwh: number
  // Existing system
  existingPanels?: string
  existingInverters?: string
  existingDcKw?: number
  // Contractor
  contractor: string
  contractorAddress: string
  contractorPhone: string
  contractorLicense: string
  contractorEmail: string
  // Wire specs (optional — defaults used if not provided)
  dcStringWire?: string       // default: '#10 AWG CU PV WIRE'
  dcConduit?: string          // default: '3/4" EMT TYPE CONDUIT'
  dcHomerunWire?: string      // default: '(2) #10 AWG CU THWN-2'
  dcEgc?: string              // default: '(1) #6 AWG BARE CU EGC'
  dcHomerunConduit?: string   // default: '3/4" EMT TYPE CONDUIT'
  acInverterWire?: string     // default: '#6 AWG CU THWN-2'
  acToPanelWire?: string      // default: '(2) #4 AWG CU THWN-2'
  acConduit?: string          // default: '1-1/4" EMT TYPE CONDUIT'
  // Service-entrance conduit (utility pole → service disconnect → meter).
  // Carries 3× 250 kcmil; defaults to 2" EMT (1-1/4" can't fit per Ch 9 Table 4).
  serviceEntranceConduit?: string
  batteryWire?: string        // default: '(2) #4/0 AWG'
  batteryConduit?: string     // default: '2" EMT'
  pcsCurrentSetting?: number  // default: 200
  acRunLengthFt?: number      // trenching distance from inverter to MSP/utility (default: 50)
  backfeedBreakerA?: number   // per-inverter backfeed breaker amps, NEC 705.12 (default: 100)
  // Topology discriminators (Task 2.4) — required; PlansetData provides all three
  systemTopology: 'string-mppt' | 'micro-inverter'
  rapidShutdownModel: string                         // e.g. 'RSD-D-20'
  hasCantexBar: boolean
  // Optional inverter mix — used by the micro-inverter topology branch when
  // multiple models coexist on one install (Tyson PROJ-26922 = 8× D700-M2 + 1× D350-M1).
  inverterMix?: Array<{ model: string; count: number; acKw: number; acW?: number }>
  // Revenue Grade Meter (PC-PRO-RGM) — gates the RGM rect between service
  // disconnect and utility meter. OUT for Duracell projects (William Carter
  // feedback 2026-04-26); legacy DWG-era plansets had it.
  hasRgm: boolean
  // NEC 705.12(B)(2)(b)(2) "120% rule" compliance — when false, the SLD notes
  // surface a designer warning so AHJ rejection is caught before submittal.
  loadSideBackfeedCompliant?: boolean
  totalBackfeedA?: number
  maxAllowableBackfeedA?: number
  mainBreakerA?: number
  // v5 — Tyson PV-5 SLD additions (used only by calculateSldLayoutMicroInverter)
  mspBusbarA?: number     // default 225 — MSP busbar amp rating
  batteryKwAc?: number    // default 4.8 — Sonnen continuous AC output
  branches?: Array<{
    id: number
    modules: number
    breakerAmps: number
    inverterModel: string
    inverterCount: number
    mixSecondary?: { model: string; count: number }
  }>
}

// Text width estimation: ~0.58 * fontSize * charCount for Arial (padded to prevent overflow)
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58
}

// Calculate box size to fit lines of text with padding
function sizeBox(lines: string[], fontSize: number, padding: { x: number; y: number }): { w: number; h: number } {
  const maxLineWidth = Math.max(...lines.map(l => estimateTextWidth(l, fontSize)))
  const textHeight = lines.length * (fontSize + 2) // line height = fontSize + 2px
  return {
    w: maxLineWidth + padding.x * 2,
    h: textHeight + padding.y * 2,
  }
}

export interface SldLayout {
  width: number
  height: number
  elements: SldElement[]
}

export type SldElement =
  | { type: 'rect'; x: number; y: number; w: number; h: number; stroke?: string; strokeWidth?: number; dash?: boolean; fill?: string }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number; dash?: boolean }
  | { type: 'circle'; cx: number; cy: number; r: number; stroke?: string; strokeWidth?: number; fill?: string }
  | { type: 'text'; x: number; y: number; text: string; fontSize: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; fill?: string; italic?: boolean }
  | { type: 'breaker'; x: number; y: number; label: string; amps?: string }
  | { type: 'disconnect'; x: number; y: number; label: string }
  | { type: 'ground'; x: number; y: number }
  | { type: 'callout'; cx: number; cy: number; number: number; r?: number }
  // v6 hybrid renderer — see ~/.claude/plans/cozy-herding-quilt.md
  // Embeds a registered SVG asset (Sonnen battery, Eaton disconnect, MSP, etc.)
  // at the given position. Asset renders at native viewBox; w/h scale it to fit.
  // props inject project-specific overrides into the asset (e.g. amp ratings,
  // model numbers) via id-targeted text substitution inside the asset SVG.
  | { type: 'svg-asset'; x: number; y: number; w: number; h: number; assetId: string; props?: Record<string, string | number> }

export function calculateSldLayout(config: SldConfig): SldLayout {
  // v8 layout (Claude Design) — JSON-spec'd Tyson-quality SLD per topology.
  // Routes to one of three specs in lib/sld-layouts/. Each spec is canvas
  // 1500×950 with sectioned regions, color-coded conductors, and title block.
  if (config.systemTopology === 'micro-inverter') {
    return renderSldFromSpec(sonnenSpec as SldSpec, config)
  }
  if (config.inverterCount <= 2) {
    return renderSldFromSpec(rushSpec as SldSpec, config)
  }
  return renderSldFromSpec(legacySpec as SldSpec, config)
}

// ── Spatial left-to-right layout for 1-2 inverter systems (RUSH style) ──
function calculateSldLayoutSpatial(config: SldConfig): SldLayout {
  const elements: SldElement[] = []
  const W = 1350 // content width (sidebar handled by SheetPV5)
  const H = 820
  const PAD = 8

  // ── Top info boxes ──
  // STC box
  const stcLines = [
    `MODULES: ${config.panelCount} x ${config.panelWattage} = ${config.systemDcKw.toFixed(3)} kW DC`,
    `${config.inverterModel}: ${config.inverterCount} x ${config.inverterAcKw} = ${config.systemAcKw.toFixed(3)} kW AC`,
    `TOTAL kW AC = ${config.systemAcKw} kW AC`,
  ]
  elements.push({ type: 'rect', x: 20, y: 10, w: 300, h: 48 })
  elements.push({ type: 'text', x: 28, y: 22, text: 'STC', fontSize: 7, bold: true })
  stcLines.forEach((line, i) => {
    elements.push({ type: 'text', x: 28, y: 32 + i * 8, text: line, fontSize: 5 })
  })

  // Meter/ESID box
  elements.push({ type: 'rect', x: 330, y: 10, w: 220, h: 30 })
  elements.push({ type: 'text', x: 338, y: 22, text: `METER NUMBER: ${config.meter}`, fontSize: 5 })
  elements.push({ type: 'text', x: 338, y: 32, text: `ESID NUMBER: ${config.esid}`, fontSize: 5 })

  // Battery scope box
  elements.push({ type: 'rect', x: W - 300, y: 10, w: 300, h: 55 })
  elements.push({ type: 'text', x: W - 292, y: 22, text: 'BATTERY SCOPE', fontSize: 6, bold: true })
  const battScopeLines = [
    `(${config.batteryCount}) ${config.batteryModel.toUpperCase()}`,
    `${config.batteryCapacity}KWH, 51.2VDC NOMINAL, IP67, NEMA 3R`,
    `SERVICE DISCONNECT RATING    200A`,
    `SERVICE DISCONNECT FUSE RATING    200A`,
  ]
  battScopeLines.forEach((line, i) => {
    elements.push({ type: 'text', x: W - 292, y: 32 + i * 8, text: line, fontSize: 4.5 })
  })

  // Installation notes (below STC)
  elements.push({ type: 'rect', x: 20, y: 62, w: 300, h: 42 })
  elements.push({ type: 'text', x: 28, y: 72, text: 'INSTALLATION NOTES:', fontSize: 5.5, bold: true })
  const installNotes = [
    'REQUIRES RING TERMINALS FOR BATTERY WIRING',
    'REQUIRES TRENCHING',
    'REQUIRES RIGID RACK FOR INVERTER AND BATTERY MOUNTING',
  ]
  installNotes.forEach((line, i) => {
    elements.push({ type: 'text', x: 28, y: 82 + i * 7, text: `- ${line}`, fontSize: 4, fill: '#444' })
  })

  // SCOPE block (top-right, matching RUSH)
  const scopeX = W - 300, scopeY = 68
  elements.push({ type: 'rect', x: scopeX, y: scopeY, w: 300, h: 45 })
  elements.push({ type: 'text', x: scopeX + 8, y: scopeY + 10, text: 'SCOPE', fontSize: 5, bold: true })
  const scopeLines = [
    `(${config.inverterCount}) ${config.inverterModel.toUpperCase()}`,
    `(${config.batteryCount}) ${config.batteryModel.toUpperCase()}`,
    `SERVICE DISCONNECT RATING    200A`,
  ]
  scopeLines.forEach((line, i) => {
    elements.push({ type: 'text', x: scopeX + 8, y: scopeY + 20 + i * 8, text: line, fontSize: 4, fill: '#444' })
  })

  // ── Drawing border ──
  elements.push({ type: 'rect', x: 3, y: 3, w: W - 6, h: H - 6, strokeWidth: 2 })

  // ── Layout zones ──
  const topY = 115 // below info boxes
  const midY = topY + 140 // middle band (DPC + MSP)
  const centerY = midY + 30 // center of equipment band

  // ══════════════════════════════════════════════════════════════
  // LEFT ZONE: PV Arrays + Junction Box (x: 30-250)
  // ══════════════════════════════════════════════════════════════

  // Compact string representation (RUSH style: branch circuits)
  const allStrings = config.strings
  const stringBlockX = 30
  const stringStartY = topY + 10

  for (let inv = 0; inv < config.inverterCount; inv++) {
    const stringsForInv = config.stringsPerInverter[inv]?.map(i => allStrings[i]) ?? []
    const branchY = stringStartY + inv * 120
    const branchLabel = `BRANCH CIRCUIT ${inv + 1}`

    elements.push({ type: 'text', x: stringBlockX, y: branchY, text: branchLabel, fontSize: 5, bold: true })

    // String count annotation — uniform vs mixed sizes
    const moduleCounts = stringsForInv.map(s => s.modules)
    const totalModules = moduleCounts.reduce((a, b) => a + b, 0)
    const uniform = moduleCounts.length > 0 && moduleCounts.every(m => m === moduleCounts[0])
    const stringDesc = uniform
      ? `${stringsForInv.length} STRINGS x ${moduleCounts[0]} MODULES (${totalModules} TOTAL)`
      : `${stringsForInv.length} STRINGS, ${totalModules} MODULES (${moduleCounts.join('+')})`
    elements.push({ type: 'text', x: stringBlockX, y: branchY + 9, text: stringDesc, fontSize: 4.5, fill: '#444' })

    // Compact module drawing (small rectangles) — base on largest string in this branch
    const maxModules = moduleCounts.length > 0 ? Math.max(...moduleCounts) : 0
    const numDraw = Math.min(maxModules, 10)
    for (let m = 0; m < numDraw; m++) {
      elements.push({ type: 'rect', x: stringBlockX + m * 8, y: branchY + 14, w: 7, h: 12, strokeWidth: 0.5 })
    }
    if (maxModules > 10) {
      elements.push({ type: 'text', x: stringBlockX + numDraw * 8 + 4, y: branchY + 22, text: `...${maxModules}`, fontSize: 4, fill: '#666' })
    }

    // String voltage/current
    const s0 = stringsForInv[0]
    if (s0) {
      elements.push({ type: 'text', x: stringBlockX + 120, y: branchY + 18, text: `Voc: ${s0.vocCold.toFixed(1)}V`, fontSize: 4.5, fill: '#444' })
      elements.push({ type: 'text', x: stringBlockX + 120, y: branchY + 26, text: `Imp: ${s0.imp}A`, fontSize: 4.5, fill: '#444' })
    }

    // RSD label — per-string, per William feedback (one callout per string)
    stringsForInv.forEach((s, si) => {
      const rsdY = branchY + 34 + si * 10
      elements.push({ type: 'text', x: stringBlockX, y: rsdY, text: `(N) ${config.rapidShutdownModel ?? 'RSD-D-20'} ROOFTOP MODULE LEVEL RAPID SHUTDOWN DEVICE — STRING ${s.id}`, fontSize: 3.5, fill: '#666' })
    })

    // Wire to right →
    elements.push({ type: 'line', x1: stringBlockX + 180, y1: branchY + 20, x2: 230, y2: branchY + 20, strokeWidth: 1 })
  }

  // Roof array wiring label
  elements.push({ type: 'text', x: stringBlockX, y: stringStartY + config.inverterCount * 120, text: 'ROOF ARRAY WIRING', fontSize: 5, bold: true })
  elements.push({ type: 'text', x: stringBlockX + 8, y: stringStartY + config.inverterCount * 120 + 9, text: `${config.dcStringWire ?? '#10 AWG CU PV WIRE'}, PV TRUNK`, fontSize: 4, fill: '#444' })

  // Junction Box
  const jbX = 230, jbY = topY + 60
  // JB landscape — Phase 7 svg-asset. w=60 keeps existing wire at jbX+60 correct.
  elements.push({ type: 'svg-asset', x: jbX, y: jbY, w: 60, h: 24, assetId: 'jb-nema3-600v-ls' })
  elements.push({ type: 'callout', cx: jbX + 30, cy: jbY - 12, number: 1 })

  // Wire from JB → DC Disc (full wire spec stack)
  elements.push({ type: 'line', x1: jbX + 60, y1: jbY + 12, x2: 320, y2: jbY + 12, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: jbX + 65, y: jbY + 2, text: config.dcHomerunWire ?? '(2) #10 AWG CU THWN-2', fontSize: 3.5, fill: '#444', italic: true })
  elements.push({ type: 'text', x: jbX + 65, y: jbY - 5, text: config.dcEgc ?? '(1) #6 AWG BARE CU EGC', fontSize: 3.5, fill: '#444', italic: true })
  elements.push({ type: 'text', x: jbX + 65, y: jbY + 24, text: config.dcHomerunConduit ?? '3/4" EMT TYPE CONDUIT', fontSize: 3.5, fill: '#444', italic: true })

  // ══════════════════════════════════════════════════════════════
  // CENTER-LEFT: PV Load Center + DC Disconnect (x: 310-430)
  // ══════════════════════════════════════════════════════════════

  // PV Load Center (RUSH: BRP12L125R)
  const pvlcX = 310, pvlcY = jbY - 20
  const pvlcW = 80, pvlcH = 54  // 3:2 ratio matching 120×80 native viewBox
  elements.push({ type: 'svg-asset', x: pvlcX, y: pvlcY, w: pvlcW, h: pvlcH, assetId: 'eaton-brp12l125r' })
  elements.push({ type: 'text', x: pvlcX + pvlcW / 2, y: pvlcY - 6, text: '(N) PV LOAD CENTER', fontSize: 4.5, anchor: 'middle', bold: true })

  // Wire from PV LC down to DC Disconnect
  elements.push({ type: 'line', x1: pvlcX + pvlcW / 2, y1: pvlcY + pvlcH, x2: pvlcX + pvlcW / 2, y2: pvlcY + pvlcH + 20, strokeWidth: 1.5 })

  // DC Disconnect (below PV LC)
  const dcDiscX = pvlcX + 40
  const dcDiscY = pvlcY + 80
  elements.push({ type: 'disconnect', x: dcDiscX, y: dcDiscY, label: '(N) PV DISCONNECT' })
  elements.push({ type: 'callout', cx: dcDiscX + 100, cy: dcDiscY, number: 2 })
  elements.push({ type: 'text', x: dcDiscX, y: dcDiscY + 16, text: 'NON-FUSIBLE', fontSize: 3.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: dcDiscX, y: dcDiscY + 23, text: '200A, 2P, 240V (N)', fontSize: 3.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: dcDiscX, y: dcDiscY + 32, text: 'VISIBLE, LOCKABLE,', fontSize: 3, anchor: 'middle', fill: '#999' })
  elements.push({ type: 'text', x: dcDiscX, y: dcDiscY + 39, text: 'LABELED DISCONNECT', fontSize: 3, anchor: 'middle', fill: '#999' })
  elements.push({ type: 'callout', cx: dcDiscX - 22, cy: dcDiscY, number: 3 })

  // Wire from DC disc → right to DPC
  elements.push({ type: 'line', x1: dcDiscX + 15, y1: dcDiscY, x2: 420, y2: dcDiscY, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: dcDiscX + 25, y: dcDiscY - 8, text: '(3) #3 AWG CU THWN-2', fontSize: 3.5, fill: '#444', italic: true })
  elements.push({ type: 'text', x: dcDiscX + 25, y: dcDiscY + 50, text: '1" EMT TYPE CONDUIT', fontSize: 3.5, fill: '#444', italic: true })

  // ══════════════════════════════════════════════════════════════
  // CENTER: Duracell Power Center blocks (x: 420-750)
  // ══════════════════════════════════════════════════════════════
  for (let inv = 0; inv < config.inverterCount; inv++) {
    const dpcY = topY + 20 + inv * 200
    const dpcX = 420

    // DPC container — larger to fit individual battery units
    const dpcW = 310, dpcH = Math.max(170, 22 + config.batteriesPerStack * 20 + 60)
    elements.push({ type: 'rect', x: dpcX, y: dpcY, w: dpcW, h: dpcH, strokeWidth: 1.5, dash: true })
    elements.push({ type: 'text', x: dpcX + dpcW / 2, y: dpcY + 12, text: 'DURACELL POWER CENTER', fontSize: 6, anchor: 'middle', bold: true })
    // Physical mounting label
    elements.push({ type: 'text', x: dpcX + dpcW / 2, y: dpcY + dpcH - 5, text: 'INSTALLED ON (N) RIGID RACK (EXTERIOR MOUNTED)', fontSize: 3.5, anchor: 'middle', fill: '#999' })

    // Battery stack (left inside DPC) — draw individual battery units like RUSH
    const battX = dpcX + 10, battY = dpcY + 22
    const battUnitH = 18, battUnitW = 70
    const battCount = config.batteriesPerStack
    // Draw individual battery rectangles stacked
    for (let b = 0; b < battCount; b++) {
      const by = battY + b * (battUnitH + 2)
      elements.push({ type: 'rect', x: battX, y: by, w: battUnitW, h: battUnitH, strokeWidth: 0.8 })
      elements.push({ type: 'text', x: battX + battUnitW / 2, y: by + 11, text: 'DURACELL', fontSize: 4, anchor: 'middle', fill: '#444' })
    }
    // Battery stack label
    const battStackBottom = battY + battCount * (battUnitH + 2)
    elements.push({ type: 'text', x: battX + battUnitW / 2, y: battStackBottom + 8, text: `(N)(${battCount}) ${config.batteryModel.toUpperCase()}`, fontSize: 3.5, anchor: 'middle', bold: true })
    elements.push({ type: 'text', x: battX + battUnitW / 2, y: battStackBottom + 16, text: `(${config.batteryCapacity}KWH)`, fontSize: 3.5, anchor: 'middle', fill: '#666' })
    elements.push({ type: 'callout', cx: battX - 12, cy: battY + (battCount * (battUnitH + 2)) / 2, number: 5 })
    // Harness / distribution bar
    elements.push({ type: 'line', x1: battX + battUnitW, y1: battY + 5, x2: battX + battUnitW, y2: battStackBottom - 5, strokeWidth: 2 })
    elements.push({ type: 'text', x: battX + battUnitW + 4, y: battY + (battStackBottom - battY) / 2, text: '(N) HARNESS', fontSize: 3, fill: '#666' })
    elements.push({ type: 'text', x: battX + battUnitW + 4, y: battY + (battStackBottom - battY) / 2 + 7, text: 'DISTRIBUTION BAR', fontSize: 3, fill: '#666' })

    // Cantex high-current distribution bar on battery DC bus (Task 2.4)
    if (config.hasCantexBar !== false) {
      const cantexX = battX
      const cantexY = battStackBottom + 26  // moved below battery model labels (+8, +16)
      elements.push({ type: 'rect', x: cantexX, y: cantexY, w: 80, h: 18 })
      elements.push({ type: 'text', x: cantexX + 40, y: cantexY + 12, text: '(N) CANTEX HIGH-CURRENT BAR', fontSize: 3.5, anchor: 'middle', bold: true })
    }

    // Battery combiner (center inside DPC) — Phase 7 svg-asset. anchor-left=(0,20)=harness wire.
    const combX = battX + battUnitW + 25, combY = battY + 15
    elements.push({ type: 'svg-asset', x: combX, y: combY, w: 65, h: 40, assetId: 'battery-combiner' })
    // Wire from battery harness to combiner
    const battMidY = battY + (battCount * (battUnitH + 2)) / 2
    elements.push({ type: 'line', x1: battX + battUnitW + 2, y1: battMidY, x2: combX, y2: combY + 20, strokeWidth: 1 })
    elements.push({ type: 'text', x: battX + battUnitW + 8, y: battMidY - 8, text: config.batteryWire ?? '#4/0 AWG', fontSize: 3.5, fill: '#444' })

    // Inverter (right inside DPC)
    const invX = dpcX + 195, invY = dpcY + 20
    const invW = 105, invH = 130
    elements.push({ type: 'rect', x: invX, y: invY, w: invW, h: invH, strokeWidth: 2 })
    const invModules = (config.stringsPerInverter[inv] ?? []).reduce((s, idx) => s + (config.strings[idx]?.modules ?? 0), 0)
    const invDcKw = (invModules * config.panelWattage / 1000).toFixed(2)
    const invLines = [
      `(N) ${config.inverterModel.toUpperCase().slice(0, 25)}`,
      `HYBRID ${config.inverterAcKw}KW`,
      `INVERTER ${inv + 1}`,
      `${config.inverterAcKw}KW AC, 100A, 240V`,
      `NEMA 3R`,
      `${invModules} MOD = ${invDcKw} kW DC`,
      `${config.mpptsPerInverter} MPPT`,
    ]
    invLines.forEach((line, i) => {
      elements.push({
        type: 'text', x: invX + invW / 2, y: invY + 14 + i * 14,
        text: line, fontSize: i < 3 ? 5.5 : 4.5, anchor: 'middle',
        bold: i === 0, fill: i >= 4 ? '#666' : undefined,
      })
    })
    elements.push({ type: 'callout', cx: invX + invW + 12, cy: invY + invH / 2, number: 3 })

    // Wire from combiner to inverter
    elements.push({ type: 'line', x1: combX + 65, y1: combY + 20, x2: invX, y2: invY + invH / 2, strokeWidth: 1.5 })

    // Wire from DC disc into DPC (top)
    elements.push({ type: 'line', x1: dpcX, y1: invY + invH / 2, x2: invX, y2: invY + invH / 2, strokeWidth: 1.5 })

    // AC output from inverter → right
    const acOutY = dpcY + dpcH / 2
    elements.push({ type: 'line', x1: dpcX + dpcW, y1: acOutY, x2: dpcX + dpcW + 30, y2: acOutY, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: dpcX + dpcW + 5, y: acOutY - 8, text: config.acInverterWire ?? '#6 AWG CU THWN-2', fontSize: 4, fill: '#444', italic: true })
    elements.push({ type: 'text', x: dpcX + dpcW + 5, y: acOutY + 12, text: '(1) #8 AWG CU EGC', fontSize: 4, fill: '#444', italic: true })

    // AC Disconnect
    const acDiscX = dpcX + dpcW + 35
    elements.push({ type: 'disconnect', x: acDiscX, y: acOutY, label: '(N) AC DISC' })
    elements.push({ type: 'callout', cx: acDiscX, cy: acOutY - 18, number: 4 })
    elements.push({ type: 'text', x: acDiscX, y: acOutY + 18, text: '200A/2P, 240V', fontSize: 4, anchor: 'middle', fill: '#666' })

    // Wire from AC disc → MSP
    elements.push({ type: 'line', x1: acDiscX + 15, y1: acOutY, x2: 830, y2: acOutY, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: acDiscX + 25, y: acOutY - 8, text: config.acToPanelWire ?? '(2) #4 AWG CU THWN-2', fontSize: 4, fill: '#444', italic: true })
    elements.push({ type: 'text', x: acDiscX + 25, y: acOutY + 12, text: `${config.acConduit ?? '1-1/4" EMT'} TYPE CONDUIT`, fontSize: 4, fill: '#444', italic: true })

    // Monitoring gateway (below DPC)
    const gwX = dpcX + 20, gwY = dpcY + dpcH + 8
    elements.push({ type: 'rect', x: gwX, y: gwY, w: 85, h: 25, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: gwX + 42, y: gwY + 10, text: '(N) DURACELL DTL', fontSize: 4.5, anchor: 'middle', bold: true })
    elements.push({ type: 'text', x: gwX + 42, y: gwY + 19, text: 'MONITORING GW', fontSize: 3.5, anchor: 'middle', fill: '#666' })
    elements.push({ type: 'line', x1: dpcX + dpcW / 2, y1: dpcY + dpcH, x2: gwX + 42, y2: gwY, strokeWidth: 0.5, dash: true })
    elements.push({ type: 'text', x: dpcX + dpcW / 2 + 10, y: dpcY + dpcH + 5, text: 'CAN TO CANBUS', fontSize: 3, fill: '#999' })

    // Link extension cable between DPC blocks
    if (inv < config.inverterCount - 1) {
      elements.push({ type: 'line', x1: dpcX + dpcW / 2, y1: dpcY + dpcH, x2: dpcX + dpcW / 2, y2: dpcY + dpcH + 40, strokeWidth: 0.5, dash: true })
      elements.push({ type: 'text', x: dpcX + dpcW / 2 + 8, y: dpcY + dpcH + 25, text: 'LINK EXT CABLE', fontSize: 3, fill: '#999' })
    }
  }

  // ══════════════════════════════════════════════════════════════
  // RIGHT: Main Service Panel + Utility Chain (x: 830-1340)
  // ══════════════════════════════════════════════════════════════
  const mspX = 830, mspY = topY + 30
  const mspW = 130, mspH = 140

  // MSP — Phase 5 svg-asset. anchor-left=(0,70), anchor-right=(130,70) → utilY = mspY + 70.
  elements.push({ type: 'svg-asset', x: mspX, y: mspY, w: mspW, h: mspH, assetId: 'msp-225a' })
  elements.push({ type: 'callout', cx: mspX + mspW / 2, cy: mspY - 12, number: 6 })

  // Main breaker below MSP
  elements.push({ type: 'line', x1: mspX + 20, y1: mspY + mspH, x2: mspX + 20, y2: mspY + mspH + 30, strokeWidth: 1.5 })
  elements.push({ type: 'breaker', x: mspX + 20, y: mspY + mspH + 25, label: '(E) MAIN', amps: '200A' })
  elements.push({ type: 'text', x: mspX + 20, y: mspY + mspH + 55, text: 'TO LOADS', fontSize: 5, anchor: 'middle' })

  // Ground system
  elements.push({ type: 'line', x1: mspX + 70, y1: mspY + mspH, x2: mspX + 70, y2: mspY + mspH + 45, strokeWidth: 1 })
  elements.push({ type: 'ground', x: mspX + 70, y: mspY + mspH + 45 })
  elements.push({ type: 'text', x: mspX + 85, y: mspY + mspH + 35, text: 'EXISTING GROUNDING', fontSize: 4.5 })
  elements.push({ type: 'text', x: mspX + 85, y: mspY + mspH + 43, text: 'ELECTRODE SYSTEM', fontSize: 4.5 })
  elements.push({ type: 'text', x: mspX + 85, y: mspY + mspH + 51, text: 'NEC 250.50, 250.52(A)', fontSize: 4, fill: '#666' })

  // Sub panel (above MSP, dashed)
  elements.push({ type: 'rect', x: mspX, y: mspY - 50, w: mspW, h: 40, dash: true, strokeWidth: 1 })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY - 35, text: '(E) SUB PANEL', fontSize: 5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY - 25, text: '200A (INTERIOR)', fontSize: 4, anchor: 'middle', fill: '#999' })
  elements.push({ type: 'line', x1: mspX + mspW / 2, y1: mspY - 10, x2: mspX + mspW / 2, y2: mspY, strokeWidth: 1, dash: true })

  // Surge protector — Phase 6 svg-asset.
  elements.push({ type: 'svg-asset', x: mspX + mspW + 10, y: mspY - 50, w: 80, h: 28, assetId: 'surge-protector-spd' })

  // IMO RSD — Phase 6 svg-asset.
  elements.push({ type: 'svg-asset', x: mspX + mspW + 10, y: mspY - 15, w: 80, h: 28, assetId: 'imo-rsd' })

  // ── Utility chain (right of MSP) ──
  const utilY = mspY + mspH / 2
  elements.push({ type: 'line', x1: mspX + mspW, y1: utilY, x2: mspX + mspW + 25, y2: utilY, strokeWidth: 1.5 })
  // Wire spec MSP → Service Disconnect
  elements.push({ type: 'text', x: mspX + mspW + 3, y: utilY - 8, text: '(3) 250 kcmil CU THWN-2', fontSize: 3, fill: '#444', italic: true })

  // Service Disconnect — Phase 6 svg-asset. anchor-left=(0,18)=utilY, anchor-right=(90,18).
  const sdX = mspX + mspW + 25
  elements.push({ type: 'svg-asset', x: sdX, y: utilY - 18, w: 90, h: 36, assetId: 'service-disc-200a' })
  elements.push({ type: 'callout', cx: sdX + 45, cy: utilY - 28, number: 7 })

  // Expansion fittings
  elements.push({ type: 'text', x: sdX + 45, y: utilY + 28, text: '(N) EXPANSION FITTINGS', fontSize: 3.5, anchor: 'middle', fill: '#333', bold: true })
  elements.push({ type: 'text', x: sdX + 45, y: utilY + 35, text: `BOTH ENDS OF ${config.serviceEntranceConduit ?? '2" EMT'}`, fontSize: 3, anchor: 'middle', fill: '#666' })

  // Wire from Service Disc → (RGM →) Utility Meter
  // RGM gated by config.hasRgm. Meter position (umCx) kept fixed.
  const rgmX = sdX + 110
  const umCx = rgmX + 100
  if (config.hasRgm) {
    elements.push({ type: 'line', x1: sdX + 90, y1: utilY, x2: rgmX, y2: utilY, strokeWidth: 1.5 })
    elements.push({ type: 'rect', x: rgmX, y: utilY - 12, w: 55, h: 24, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: rgmX + 27, y: utilY - 1, text: '(N) RGM', fontSize: 4, anchor: 'middle' })
    elements.push({ type: 'text', x: rgmX + 27, y: utilY + 8, text: 'PC-PRO-RGM', fontSize: 3, anchor: 'middle', fill: '#666' })
    elements.push({ type: 'callout', cx: rgmX + 27, cy: utilY - 22, number: 8 })
    elements.push({ type: 'line', x1: rgmX + 55, y1: utilY, x2: umCx - 18, y2: utilY, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: rgmX + 58, y: utilY + 12, text: `${config.serviceEntranceConduit ?? '2" EMT'} TYPE CONDUIT`, fontSize: 3.5, fill: '#444', italic: true })
  } else {
    elements.push({ type: 'line', x1: sdX + 90, y1: utilY, x2: umCx - 18, y2: utilY, strokeWidth: 1.5 })
    const labelX = (sdX + 90 + umCx - 18) / 2 - 35
    elements.push({ type: 'text', x: labelX, y: utilY + 12, text: `${config.serviceEntranceConduit ?? '2" EMT'} TYPE CONDUIT`, fontSize: 3.5, fill: '#444', italic: true })
  }
  // Utility meter — Phase 6 svg-asset. anchor-left=(2,20)=wire in, anchor-right=(38,20)=wire out.
  elements.push({ type: 'svg-asset', x: umCx - 20, y: utilY - 20, w: 40, h: 40, assetId: 'utility-meter-200a' })
  elements.push({ type: 'text', x: umCx, y: utilY - 24, text: 'UTILITY METER', fontSize: 5, anchor: 'middle', fill: '#666', bold: true })
  elements.push({ type: 'text', x: umCx, y: utilY - 32, text: '(E) BI-DIRECTIONAL', fontSize: 4.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'callout', cx: umCx, cy: utilY - 42, number: 9 })

  // Wire to grid
  elements.push({ type: 'line', x1: umCx + 18, y1: utilY, x2: umCx + 40, y2: utilY, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: umCx + 45, y: utilY - 4, text: 'TO UTILITY', fontSize: 5, fill: '#666' })
  elements.push({ type: 'text', x: umCx + 45, y: utilY + 4, text: 'GRID', fontSize: 5, fill: '#666' })
  elements.push({ type: 'text', x: umCx + 45, y: utilY + 14, text: config.utility.toUpperCase(), fontSize: 4, fill: '#999' })

  // 10' MAX notation
  elements.push({ type: 'line', x1: sdX, y1: utilY - 45, x2: umCx + 40, y2: utilY - 45, strokeWidth: 0.5 })
  elements.push({ type: 'text', x: (sdX + umCx + 40) / 2, y: utilY - 48, text: "10' MAX", fontSize: 5, anchor: 'middle', bold: true })

  // Consumption CT
  const ctX = mspX + mspW / 2
  elements.push({ type: 'circle', cx: ctX, cy: mspY + 80, r: 7, strokeWidth: 1 })
  elements.push({ type: 'text', x: ctX, y: mspY + 82, text: 'CT', fontSize: 4, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: ctX + 15, y: mspY + 80, text: 'CONSUMPTION CT.', fontSize: 3.5, fill: '#444' })

  // Trenching detail (below utility chain) — 250 kcmil service entrance from
  // config.serviceEntranceConduit (default 2" EMT).
  const trenchY = utilY + 50
  elements.push({ type: 'text', x: sdX, y: trenchY, text: `${config.serviceEntranceConduit ?? '2" EMT'} TYPE CONDUIT`, fontSize: 4, fill: '#444', italic: true })
  elements.push({ type: 'text', x: sdX, y: trenchY + 8, text: `ROUGHLY ${config.acRunLengthFt ?? 50} FEET (DIRT/ROCK)`, fontSize: 4, fill: '#444', italic: true })
  elements.push({ type: 'text', x: sdX, y: trenchY + 16, text: 'TRENCHING FROM UTILITY POLE', fontSize: 4, fill: '#444', italic: true })
  elements.push({ type: 'text', x: sdX, y: trenchY + 24, text: 'TO HOME WALL', fontSize: 4, fill: '#444', italic: true })

  // ── Notes section (bottom) ──
  const notesY = H - 110
  elements.push({ type: 'rect', x: 20, y: notesY, w: W - 40, h: 95, strokeWidth: 0.5 })
  elements.push({ type: 'text', x: 30, y: notesY + 12, text: 'NOTES:', fontSize: 6, bold: true })
  const noteLines = [
    '1. ALL ELECTRICAL MATERIALS SHALL BE NEW AND LISTED BY RECOGNIZED TESTING LABORATORY.',
    '2. OUTDOOR EQUIPMENT SHALL BE AT LEAST NEMA 3R RATED. ALL METALLIC EQUIPMENT GROUNDED PER NEC 250.',
    `3. PV SYSTEM: ${config.systemDcKw.toFixed(2)} kW DC / ${config.systemAcKw} kW AC. BATTERY: ${config.totalStorageKwh} kWh.`,
    '4. IF POWER IS USED THROUGH ATTIC, WIRE SHALL BE KEPT AT LEAST 12" AWAY FROM HOT SURFACE.',
    '5. IF CONDUIT IS USED ON EXTERIOR, RUNS SHALL BE MIN. 7/8" ABOVE ROOF.',
    '6. ALL WORK PER 2020 NEC WITH EMPHASIS ON ARTICLES 690, 705, 706.',
    `7. PCS CONTROLLED CURRENT SETTING: ${config.pcsCurrentSetting ?? 200}A. STRING CALCULATIONS REQUIRE PE REVIEW.`,
    ...(config.loadSideBackfeedCompliant === false
      ? [
          `⚠ DESIGNER WARNING: 120% rule fails — total backfeed ${config.totalBackfeedA ?? 0}A + ${config.mainBreakerA ?? 200}A main exceeds 120% × bus (max allowable backfeed = ${config.maxAllowableBackfeedA ?? 0}A). Use line-side tap, sub-panel feeder, PCS-limited output, or upsize bus.`,
        ]
      : []),
  ]
  noteLines.forEach((line, i) => {
    elements.push({ type: 'text', x: 30, y: notesY + 22 + i * 9, text: line, fontSize: 5 })
  })

  // Title: ELECTRICAL SINGLE LINE DIAGRAM
  elements.push({ type: 'text', x: W / 2, y: H - 8, text: 'ELECTRICAL SINGLE LINE DIAGRAM', fontSize: 8, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: W / 2 + 180, y: H - 8, text: 'SCALE: NTS', fontSize: 5, fill: '#666' })

  return { width: W, height: H, elements }
}

// ── Micro-inverter topology branch (Phase 1 — Tyson rebuild scope) ─────────
// Renders an AC-trunk SLD shape for legacy installs (Hyperion/APTOS modules
// with per-panel microinverters, Sonnen battery on AC side, optional DPCRGM).
// Triggered when config.systemTopology === 'micro-inverter'.
function calculateSldLayoutMicroInverter(config: SldConfig): SldLayout {
  // ── Defensive guard (v5) ─────────────────────────────────────────────────
  if (!config.inverterMix || config.inverterMix.length === 0) {
    throw new Error(
      'calculateSldLayoutMicroInverter requires config.inverterMix (micro-inverter topology). ' +
      'Got empty/undefined. Check sld-layout.ts dispatch — string-MPPT data should not reach this branch.'
    )
  }
  if (!config.batteryModel) {
    throw new Error(
      'calculateSldLayoutMicroInverter requires config.batteryModel (Tyson topology assumes ESS). ' +
      'Got empty/undefined. If a no-battery micro-inverter topology is needed, add a separate branch.'
    )
  }

  const elements: SldElement[] = []

  // ── Constants ────────────────────────────────────────────────────────────
  const W = 1400
  const H = 1050
  const STROKE = '#111'
  const SUBSTROKE = '#444'
  const ANNOT = '#222'
  const MUTED = '#666'

  const textBlock = (x: number, y: number, lines: string[], opts: {
    fontSize?: number, fill?: string, bold?: boolean, anchor?: 'start' | 'middle' | 'end',
    lineHeight?: number,
  } = {}) => {
    const fs = opts.fontSize ?? 7
    const lh = opts.lineHeight ?? fs + 1.5
    lines.forEach((line, i) => {
      elements.push({
        type: 'text', x, y: y + i * lh, text: line,
        fontSize: fs, fill: opts.fill ?? ANNOT,
        bold: opts.bold ?? false, anchor: opts.anchor ?? 'start',
      })
    })
  }

  const pill = (cx: number, cy: number, w: number, h: number, label: string, fontSize = 6) => {
    elements.push({ type: 'rect', x: cx - w / 2, y: cy - h / 2, w, h, stroke: STROKE, strokeWidth: 0.7 })
    elements.push({
      type: 'text', x: cx, y: cy + fontSize * 0.35, text: label,
      fontSize, bold: true, anchor: 'middle',
    })
  }

  const fuse = (cx: number, cy: number, label: string) => {
    elements.push({ type: 'circle', cx, cy, r: 5, strokeWidth: 0.8 })
    elements.push({ type: 'line', x1: cx, y1: cy - 5, x2: cx, y2: cy + 5, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: cx + 9, y: cy + 2, text: label, fontSize: 5.5, fill: MUTED })
  }

  // ── SECTION 1 — TOP HEADER STRIP (STC + Meter# + Scope panels) ──
  const stcX = 720, stcY = 70, stcW = 200, stcH = 110
  elements.push({ type: 'rect', x: stcX, y: stcY, w: stcW, h: stcH, stroke: STROKE, strokeWidth: 1 })
  elements.push({ type: 'text', x: stcX + stcW / 2, y: stcY + 14, text: 'STC', fontSize: 8, bold: true, anchor: 'middle' })
  elements.push({ type: 'line', x1: stcX, y1: stcY + 22, x2: stcX + stcW, y2: stcY + 22, strokeWidth: 0.5 })
  textBlock(stcX + 8, stcY + 32, [
    `MODULES: ${config.panelCount} x ${config.panelWattage} = ${(config.systemDcKw ?? 0).toFixed(3)} kW DC`,
    ...config.inverterMix.map(g =>
      `${g.model} INVERTER(S): ${g.count} x ${g.acW ?? Math.round((g.acKw ?? 0) * 1000 / g.count)} = ${((g.acKw ?? 0)).toFixed(3)} kW AC`
    ),
    `TOTAL kW AC = ${(config.systemAcKw ?? 0).toFixed(3)} kW AC`,
  ], { fontSize: 6, lineHeight: 9 })

  const meterBoxX = stcX, meterBoxY = stcY - 60, meterBoxW = stcW, meterBoxH = 50
  elements.push({ type: 'rect', x: meterBoxX, y: meterBoxY, w: meterBoxW, h: meterBoxH, stroke: STROKE, strokeWidth: 1 })
  textBlock(meterBoxX + 8, meterBoxY + 14, [
    `METER NUMBER: ${config.meter ?? '—'}`,
    `ESID NUMBER: ${config.esid ?? '—'}`,
  ], { fontSize: 6.5, lineHeight: 14, bold: true })

  const scopeX = 940, scopeY = 10, scopeW = 460, scopeH = 95
  elements.push({ type: 'rect', x: scopeX, y: scopeY, w: scopeW, h: scopeH, stroke: STROKE, strokeWidth: 1 })
  elements.push({ type: 'text', x: scopeX + scopeW / 2, y: scopeY + 14, text: 'SCOPE', fontSize: 9, bold: true, anchor: 'middle' })
  elements.push({ type: 'line', x1: scopeX, y1: scopeY + 22, x2: scopeX + scopeW, y2: scopeY + 22, strokeWidth: 0.5 })
  textBlock(scopeX + 10, scopeY + 32, [
    `${(config.systemDcKw ?? 0).toFixed(3)} KW DC / ${(config.systemAcKw ?? 0).toFixed(3)} KW AC`,
    `(${config.panelCount}) ${config.panelModel} ${config.panelWattage}W MODULES`,
    ...config.inverterMix.map(g => `(${g.count}) ${g.model} MICROINVERTERS`),
    'ELECTRICAL INFORMATION',
    `NEW UPGRADED: 1Φ, 3W, 120/240V`,
    `MAIN SERVICE PANEL UPGRADE BUSBAR RATING: ${config.mspBusbarA ?? 225}A`,
    `MAIN SERVICE BREAKER RATING: ${config.mainBreakerA ?? 125}A`,
  ], { fontSize: 6, lineHeight: 8.5 })

  const battScopeX = 940, battScopeY = 110, battScopeW = 460, battScopeH = 70
  elements.push({ type: 'rect', x: battScopeX, y: battScopeY, w: battScopeW, h: battScopeH, stroke: STROKE, strokeWidth: 1 })
  elements.push({ type: 'text', x: battScopeX + battScopeW / 2, y: battScopeY + 14, text: 'BATTERY SCOPE', fontSize: 9, bold: true, anchor: 'middle' })
  elements.push({ type: 'line', x1: battScopeX, y1: battScopeY + 22, x2: battScopeX + battScopeW, y2: battScopeY + 22, strokeWidth: 0.5 })
  textBlock(battScopeX + 10, battScopeY + 32, [
    `${(config.batteryCapacity ?? 20).toFixed(3)} KWh / ${(config.batteryKwAc ?? 4.8).toFixed(3)} KW AC`,
    `(${config.batteryCount ?? 1}) ${config.batteryModel} (${(config.batteryCapacity ?? 20).toFixed(3)} kWh)`,
    `ELECTRICAL INFORMATION: NEW UPGRADED 1Φ, 3W, 120/240V`,
  ], { fontSize: 6, lineHeight: 9 })

  // ── SECTION 2 — ROOF ARRAY DETAIL (left column) ──
  const roofX = 20, roofY = 220, roofW = 250, roofH = 280
  elements.push({ type: 'rect', x: roofX, y: roofY, w: roofW, h: roofH, stroke: STROKE, strokeWidth: 0.8 })
  elements.push({ type: 'text', x: roofX + roofW / 2, y: roofY + 14, text: 'ROOF ARRAY WIRING', fontSize: 8, bold: true, anchor: 'middle' })
  elements.push({ type: 'line', x1: roofX, y1: roofY + 22, x2: roofX + roofW, y2: roofY + 22, strokeWidth: 0.5 })

  textBlock(roofX + 10, roofY + 34, [
    `(N) MODULE: (${config.panelCount}) ${config.panelModel}`,
    `${config.panelWattage}W`,
    'MICRO INVERTERS - MOUNTED UNDER',
    'EACH PANEL (NEC 690.13)',
    'INTEGRATED GROUNDING WIRE',
  ], { fontSize: 5.5, lineHeight: 7.5 })

  const branches = config.branches ?? [
    { id: 1, modules: 9, breakerAmps: 20, inverterModel: 'D700-M2', inverterCount: 4, mixSecondary: { model: 'D350-M1', count: 1 } },
    { id: 2, modules: 8, breakerAmps: 15, inverterModel: 'D700-M2', inverterCount: 4 },
  ]

  let branchY = roofY + 90
  branches.forEach((br) => {
    elements.push({
      type: 'text', x: roofX + 10, y: branchY, bold: true,
      text: `BRANCH CIRCUIT ${br.id}: ${br.modules} MODULES`,
      fontSize: 6,
    })
    const modW = 18, modH = 14, modGap = 2
    const cols = Math.min(br.modules, 9)
    for (let c = 0; c < cols; c++) {
      const mx = roofX + 14 + c * (modW + modGap)
      const my = branchY + 6
      elements.push({ type: 'rect', x: mx, y: my, w: modW, h: modH, stroke: STROKE, strokeWidth: 0.6 })
      elements.push({ type: 'line', x1: mx + modW - 5, y1: my + modH - 3, x2: mx + modW - 1, y2: my + modH - 3, strokeWidth: 0.4 })
      elements.push({ type: 'line', x1: mx + modW - 3, y1: my + modH - 5, x2: mx + modW - 3, y2: my + modH - 1, strokeWidth: 0.4 })
    }
    pill(roofX + roofW - 30, branchY + 13, 36, 14, `${br.breakerAmps}A/2P`, 5.5)
    const inv1 = `(${br.inverterCount}) DURACELL: ${br.inverterModel} (240V)`
    const inv2 = br.mixSecondary ? `(${br.mixSecondary.count}) DURACELL: ${br.mixSecondary.model} (240V)` : null
    textBlock(roofX + 14, branchY + 26, [inv1, ...(inv2 ? [inv2] : [])], { fontSize: 5, lineHeight: 7 })
    branchY += 70
  })

  textBlock(roofX + 10, roofY + roofH - 26, [
    '(4) #10 AWG TRUNK CABLE',
    '(1) #6 BARE CU EGC',
  ], { fontSize: 5.5, lineHeight: 7.5, bold: true })

  elements.push({ type: 'callout', cx: roofX + roofW + 14, cy: roofY + roofH / 2, number: 1 })
  elements.push({ type: 'line', x1: roofX + roofW, y1: roofY + roofH / 2, x2: 320, y2: roofY + roofH / 2, strokeWidth: 1.4 })

  // ── SECTION 3 — MAIN EQUIPMENT ROW ──
  const mainY = 360
  let cursorX = 320

  const jbX = cursorX, jbY = mainY - 28, jbW = 70, jbH = 56
  // JB — Phase 6 svg-asset. anchor-left=(0,28)=mainY wire.
  elements.push({ type: 'svg-asset', x: jbX, y: jbY, w: jbW, h: jbH, assetId: 'jb-nema3-600v' })
  cursorX = jbX + jbW

  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 70, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 12, cy: mainY - 18, number: 2 })
  textBlock(cursorX + 22, mainY - 28, [
    '(4) #10 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  cursorX += 70

  const lcW = 108, lcH = 72  // 3:2 ratio matching 120×80 native viewBox
  const lcX = cursorX, lcY = mainY - lcH / 2  // center left anchor on mainY wire
  elements.push({ type: 'svg-asset', x: lcX, y: lcY, w: lcW, h: lcH, assetId: 'eaton-brp12l125r' })
  textBlock(lcX + lcW / 2, lcY - 7, ['(N) PV LOAD CENTER'], { fontSize: 6, bold: true, anchor: 'middle' })
  cursorX = lcX + lcW

  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 80, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 14, cy: mainY - 18, number: 3 })
  textBlock(cursorX + 24, mainY - 28, [
    '(2) #8 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  cursorX += 80

  const pvdW = 80, pvdH = 104  // 10:13 native Eaton viewBox ratio
  const pvdX = cursorX, pvdY = mainY - pvdH / 2  // left anchor centered on mainY
  elements.push({ type: 'svg-asset', x: pvdX, y: pvdY, w: pvdW, h: pvdH, assetId: 'eaton-dg222urb' })
  textBlock(pvdX + pvdW / 2, pvdY - 7, ['(N) PV DISCONNECT'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(pvdX + pvdW / 2, pvdY + pvdH + 4, [
    'VISIBLE, LOCKABLE,',
    'LABELED "AC DISC"',
    'EXTERIOR WALL',
  ], { fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED })
  cursorX = pvdX + pvdW

  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 70, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 25, cy: mainY - 18, number: 4 })
  textBlock(cursorX + 35, mainY - 28, [
    '(2) #8 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  cursorX += 70

  const plpW = 120, plpH = 130  // matches 120×130 native viewBox exactly
  const plpX = cursorX, plpY = mainY - plpH / 2  // center left anchor on mainY wire
  elements.push({ type: 'svg-asset', x: plpX, y: plpY, w: plpW, h: plpH, assetId: 'eaton-brp20b125r' })
  cursorX = plpX + plpW

  // ── BATTERY (vertical drop from PLP) ──
  const battX = plpX + 30
  const battY = mainY + 130
  const battW = 232  // preserves Sonnen asset aspect 360:280 ≈ 1.286 (round-1 fix)
  const battH = 180

  elements.push({ type: 'line', x1: plpX + plpW / 2, y1: plpY + plpH, x2: plpX + plpW / 2, y2: battY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: plpX + plpW / 2 + 14, cy: plpY + plpH + 30, number: 5 })
  textBlock(plpX + plpW / 2 + 24, plpY + plpH + 22, [
    '(3) #8 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })

  elements.push({ type: 'svg-asset', x: battX, y: battY, w: battW, h: battH, assetId: 'sonnen-score-p20' })
  // Map asset-native (360×280) coords to the rendered slot. Used by external
  // wires connecting INTO the asset's anchor positions.
  const slotX = (nx: number) => battX + (nx / 360) * battW
  const slotY = (ny: number) => battY + (ny / 280) * battH
  const estopRightX = slotX(346)   // anchor-estop-out — right edge of E-STOP block
  const estopCenterY = slotY(55)
  // Annotation shifted below the conductor #6 callout band to avoid overlap (round-1 fix)
  textBlock(battX + battW + 8, battY + 70, [
    '(N) (1) SONNEN INC. -',
    'SONNENCORE+ SCORE-P20',
    '(240 VAC) (20.000 KWH)',
    'BATTERY WILL BE',
    'MOUNTED INSIDE',
    'THE GARAGE',
  ], { fontSize: 5, lineHeight: 6.5, fill: ANNOT })

  // ── ESS DISCONNECT (right of battery) ──
  const essdW = 70, essdH = 91  // 10:13 native Eaton viewBox ratio
  const essdX = battX + battW + 100
  const essdY = estopCenterY - essdH / 2  // left anchor centered on E-STOP output wire
  elements.push({ type: 'line', x1: estopRightX, y1: estopCenterY, x2: essdX, y2: essdY + essdH / 2, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: estopRightX + 20, cy: estopCenterY - 9, number: 6 })
  textBlock(estopRightX + 30, estopCenterY - 19, [
    '(2) #14 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  elements.push({ type: 'svg-asset', x: essdX, y: essdY, w: essdW, h: essdH, assetId: 'eaton-dg221urb' })
  textBlock(essdX + essdW / 2, essdY - 7, ['(N) ESS DISCONNECT'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(essdX + essdW / 2, essdY + essdH + 4, [
    'VISIBLE, LOCKABLE,',
    'LABELED "AC DISC"',
  ], { fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED })

  // Dashed control wire routes BELOW battery to avoid crossing the Sonnen rectangle.
  elements.push({ type: 'line', x1: essdX + essdW / 2, y1: essdY + essdH, x2: essdX + essdW / 2, y2: battY + battH + 15, strokeWidth: 1.4, dash: true })
  elements.push({ type: 'line', x1: essdX + essdW / 2, y1: battY + battH + 15, x2: battX + 100, y2: battY + battH + 15, strokeWidth: 1.4, dash: true })
  elements.push({ type: 'line', x1: battX + 100, y1: battY + battH + 15, x2: battX + 100, y2: battY + 36, strokeWidth: 1.4, dash: true })
  elements.push({ type: 'callout', cx: essdX - 14, cy: essdY + essdH - 16, number: 7 })

  // ── CUSTOMER GENERATION DISCONNECT (back at main row) ──
  cursorX = plpX + plpW
  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 90, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 14, cy: mainY - 18, number: 8 })
  textBlock(cursorX + 24, mainY - 28, [
    '(3) #8 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  cursorX += 90

  const cgdW = 80, cgdH = 104
  const cgdX = cursorX, cgdY = mainY - cgdH / 2
  elements.push({ type: 'svg-asset', x: cgdX, y: cgdY, w: cgdW, h: cgdH, assetId: 'eaton-dg222nrb' })
  textBlock(cgdX + cgdW / 2, cgdY - 7, ['(N) CUSTOMER GEN DISCONNECT'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(cgdX + cgdW / 2, cgdY + cgdH + 4, [
    'VISIBLE, LOCKABLE,',
    'LABELED "AC DISC"',
    "WITHIN 10' OF METER",
  ], { fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED })
  cursorX = cgdX + cgdW

  // ── MSP ──
  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 90, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 14, cy: mainY - 18, number: 9 })
  textBlock(cursorX + 24, mainY - 28, [
    '(3) #8 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  elements.push({ type: 'line', x1: cursorX, y1: mainY + 14, x2: cursorX + 90, y2: mainY + 14, strokeWidth: 0.5 })
  elements.push({ type: 'line', x1: cursorX, y1: mainY + 11, x2: cursorX, y2: mainY + 17, strokeWidth: 0.5 })
  elements.push({ type: 'line', x1: cursorX + 90, y1: mainY + 11, x2: cursorX + 90, y2: mainY + 17, strokeWidth: 0.5 })
  elements.push({ type: 'text', x: cursorX + 45, y: mainY + 22, text: "10' MAX", fontSize: 5, bold: true, anchor: 'middle' })
  cursorX += 90

  const mspX = cursorX, mspY = mainY - 60, mspW = 130, mspH = 140
  // MSP — Phase 5 svg-asset. anchor-left=(0,70)=mainY wire, anchor-right=(130,70)=utility meter.
  elements.push({ type: 'svg-asset', x: mspX, y: mspY, w: mspW, h: mspH, assetId: 'msp-225a' })
  textBlock(mspX + mspW / 2, mspY + mspH + 4, [
    '(N) MAIN BREAKER TO HOUSE',
    '240v, 125A/2P TOP FED',
    '(N) 45A PV BREAKER AT',
    'OPPOSITE END OF BUS',
    'FROM MAIN BREAKER',
  ], { fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED })
  cursorX = mspX + mspW

  // ── UTILITY METER ──
  const umCx = cursorX + 30, umCy = mainY
  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: umCx - 18, y2: mainY, strokeWidth: 1.4 })
  // Utility meter — Phase 6 svg-asset. anchor-left=(2,20)=wire in, anchor-right=(38,20)=wire out.
  elements.push({ type: 'svg-asset', x: umCx - 20, y: umCy - 20, w: 40, h: 40, assetId: 'utility-meter-200a' })
  textBlock(umCx, umCy + 30, [
    '(E) BI-DIRECTIONAL',
    'UTILITY METER',
    '1-PHASE, 3-WIRE',
    '120v/240v, 200A RATED',
    '(EXTERIOR)',
    `UTILITY: ${config.utility ?? 'CenterPoint Energy'}`,
    `METER NO: ${config.meter ?? '—'}`,
  ], { fontSize: 4.5, lineHeight: 5.5, anchor: 'middle', fill: MUTED })
  elements.push({ type: 'line', x1: umCx + 18, y1: umCy, x2: umCx + 70, y2: umCy, strokeWidth: 1.4 })
  elements.push({ type: 'line', x1: umCx + 64, y1: umCy - 4, x2: umCx + 70, y2: umCy, strokeWidth: 1 })
  elements.push({ type: 'line', x1: umCx + 64, y1: umCy + 4, x2: umCx + 70, y2: umCy, strokeWidth: 1 })
  elements.push({ type: 'text', x: umCx + 80, y: umCy + 2, text: 'TO UTILITY GRID', fontSize: 5, bold: true })

  // ── SECTION 4 — GEC GROUNDING ──
  const gecX = mspX + mspW / 2, gecY = mspY + mspH + 50
  elements.push({ type: 'line', x1: gecX, y1: mspY + mspH, x2: gecX, y2: gecY, strokeWidth: 1 })
  elements.push({ type: 'ground', x: gecX, y: gecY })
  textBlock(gecX + 12, gecY - 4, [
    'GEC',
    'GROUNDING ELECTRODE SYSTEM',
    'EXISTING GROUNDING ELECTRODE',
    'SYSTEM TO EARTH REF.',
    'NEC 250.52, 250.53(A)',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })

  // ── SECTION 5 — COMM SUBGRAPH ──
  const commY = 760
  elements.push({ type: 'text', x: 320, y: commY, text: 'COMMUNICATION WIRES', fontSize: 6, bold: true, fill: MUTED })

  const sonnenCtX = battX + battW / 2
  const sonnenCtY = battY + battH + 16
  elements.push({ type: 'circle', cx: sonnenCtX, cy: sonnenCtY, r: 8, strokeWidth: 0.6 })
  elements.push({ type: 'text', x: sonnenCtX, y: sonnenCtY + 3, text: 'CT', fontSize: 5, bold: true, anchor: 'middle' })
  textBlock(sonnenCtX + 14, sonnenCtY - 2, ['SONNEN', 'PRODUCTION CT'], {
    fontSize: 4.5, lineHeight: 5.5, fill: MUTED,
  })
  elements.push({
    type: 'line', x1: sonnenCtX, y1: sonnenCtY - 8, x2: sonnenCtX, y2: battY + battH,
    strokeWidth: 0.8, dash: true,
  })

  const dpcCtX = mspX + mspW / 2
  const dpcCtY = sonnenCtY
  elements.push({ type: 'circle', cx: dpcCtX, cy: dpcCtY, r: 8, strokeWidth: 0.6 })
  elements.push({ type: 'text', x: dpcCtX, y: dpcCtY + 3, text: 'CT', fontSize: 5, bold: true, anchor: 'middle' })
  textBlock(dpcCtX + 14, dpcCtY - 2, ['DPC RGM CTs'], { fontSize: 4.5, fill: MUTED })

  const dpcX = 620, dpcY = commY + 30, dpcW = 110, dpcH = 50
  // DPCRGM-Cell — Phase 7 svg-asset. anchor-left=(0,25), anchor-right=(110,25).
  elements.push({ type: 'svg-asset', x: dpcX, y: dpcY, w: dpcW, h: dpcH, assetId: 'dpcrgm-cell' })

  elements.push({ type: 'line', x1: sonnenCtX + 8, y1: sonnenCtY, x2: dpcX, y2: dpcY + 25, strokeWidth: 0.7, dash: true })
  elements.push({ type: 'line', x1: dpcCtX - 8, y1: dpcCtY, x2: dpcX + dpcW, y2: dpcY + 25, strokeWidth: 0.7, dash: true })

  const ethX = dpcX + dpcW + 60, ethY = dpcY, ethW = 90, ethH = 30
  elements.push({ type: 'rect', x: ethX, y: ethY, w: ethW, h: ethH, stroke: STROKE, strokeWidth: 0.8 })
  elements.push({ type: 'text', x: ethX + ethW / 2, y: ethY + 18, text: 'ETHERNET SWITCH', fontSize: 5.5, bold: true, anchor: 'middle' })
  elements.push({ type: 'line', x1: dpcX + dpcW, y1: dpcY + 25, x2: ethX, y2: ethY + 15, strokeWidth: 0.8, dash: true })
  elements.push({ type: 'circle', cx: (dpcX + dpcW + ethX) / 2, cy: (dpcY + 25 + ethY + 15) / 2, r: 4, strokeWidth: 0.4 })
  elements.push({ type: 'text', x: (dpcX + dpcW + ethX) / 2, y: (dpcY + 25 + ethY + 15) / 2 + 1.5, text: '5', fontSize: 4, anchor: 'middle' })
  textBlock((dpcX + dpcW + ethX) / 2, dpcY - 4, ['24 AWG CAT', '5/6 SHIELDED'], {
    fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED,
  })

  const routerX = ethX + ethW + 40, routerY = ethY, routerW = 90, routerH = 30
  elements.push({ type: 'rect', x: routerX, y: routerY, w: routerW, h: routerH, stroke: STROKE, strokeWidth: 0.8 })
  elements.push({ type: 'text', x: routerX + routerW / 2, y: routerY + 13, text: 'HOMEOWNER', fontSize: 5, bold: true, anchor: 'middle' })
  elements.push({ type: 'text', x: routerX + routerW / 2, y: routerY + 22, text: 'ROUTER', fontSize: 5, bold: true, anchor: 'middle' })
  elements.push({ type: 'line', x1: ethX + ethW, y1: ethY + 15, x2: routerX, y2: routerY + 15, strokeWidth: 0.8, dash: true })

  textBlock(routerX + routerW + 14, ethY, [
    'CT EXTENSION',
    'PART #1001808',
    'WITH #18',
    'SHIELDED CABLE',
  ], { fontSize: 4.5, lineHeight: 6, fill: MUTED })

  // ── SECTION 6 — INSTALLER NOTES ──
  const notesY = 900
  const notesW = 1380
  elements.push({ type: 'rect', x: 10, y: notesY, w: notesW, h: 140, stroke: STROKE, strokeWidth: 0.8 })
  elements.push({ type: 'text', x: 18, y: notesY + 14, text: 'INSTALLER NOTES:', fontSize: 7, bold: true })
  const installerNotes = [
    '• REQUIRES TO RELOCATE (E) ESSENTIAL LOADS FROM (E) MAIN SERVICE PANEL TO (N) PROTECTED LOADS PANEL',
    '• REQUIRES TO TEST FOR EDISON CIRCUIT BEFORE TURNING ON THE SYSTEM',
    "• ONLY 10-12 SINGLE POLE LOADS WILL BE BACKED UP AS PER HOMEOWNER'S SELECTION",
    '• REQUIRES SONNENCORE+ BATTERIES TO BE FLOOR MOUNTED',
    '• HEAT DETECTORS REQUIRED ON INTERIOR FOR ALL BATTERIES',
    '• REQUIRES BOLLARDS 3 FEET FROM THE BATTERY',
    '• REQUIRES CT WIRE EXTENSION KIT PART #1001808',
    '• REQUIRES TO EXTEND CT WIRES WITH #18 AWG SHIELDED CABLE',
    '• REQUIRES MAIN PANEL UPGRADE',
    '• REQUIRES SMOKE DETECTORS',
  ]
  const colWidth = notesW / 2 - 20
  installerNotes.forEach((note, i) => {
    const col = i < 5 ? 0 : 1
    const row = i % 5
    elements.push({
      type: 'text',
      x: 18 + col * colWidth,
      y: notesY + 28 + row * 12,
      text: note, fontSize: 5.5, fill: ANNOT,
    })
  })

  textBlock(18, notesY + 96, [
    'IF ROMEX IS USED THROUGH ATTIC - RUNS SHALL BE KEPT SEPARATE AND NOT BUNDLED',
    'IF CONDUIT IS USED ON EXTERIOR - RUNS SHALL BE MIN. 7/8" ABOVE ROOF',
    `(1) STRING OF (${branches[0]?.modules ?? 9}) MODULES CONNECTED IN SERIES & (1) STRING OF (${branches[1]?.modules ?? 8}) MODULES CONNECTED IN SERIES`,
  ], { fontSize: 5, lineHeight: 7, fill: ANNOT, bold: true })

  return {
    width: W,
    height: H,
    elements,
  }
}
