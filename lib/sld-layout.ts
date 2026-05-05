// lib/sld-layout.ts
// SVG Single-Line Diagram Layout Engine

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
  // Topology branch — micro-inverter installs (legacy Hyperion/APTOS) render
  // an AC-trunk shape, not the DC-string shape. Branch first so inverter-count
  // routing below only applies to string-MPPT projects.
  if (config.systemTopology === 'micro-inverter') {
    return calculateSldLayoutMicroInverter(config)
  }

  // Use spatial left-to-right layout for 1-2 inverter systems (common residential)
  if (config.inverterCount <= 2) {
    return calculateSldLayoutSpatial(config)
  }
  // Fall back to multi-row top-to-bottom for 3+ inverters
  const elements: SldElement[] = []
  const PAD = 8 // standard padding
  const SECTION_GAP = 25 // gap between major sections
  const COL_GAP = 80 // gap between inverter columns

  // ── PHASE 1: Calculate sizes of all components ──

  // STC box
  const stcLines = [
    'STC',
    `MODULES: ${config.panelCount} x ${config.panelWattage}W = ${config.systemDcKw.toFixed(2)} kW DC`,
    `INVERTER(S): ${config.inverterCount} x ${config.inverterAcKw}kW = ${config.systemAcKw.toFixed(1)} kW AC`,
  ]
  const stcSize = sizeBox(stcLines, 6, { x: PAD, y: PAD })

  // Meter box
  const meterLines = [
    `METER NUMBER: ${config.meter}`,
    `ESID NUMBER: ${config.esid}`,
  ]
  const meterSize = sizeBox(meterLines, 6, { x: PAD, y: PAD })

  // Battery scope box
  const battLines = [
    `(N)(${config.batteryCount}) ${config.batteryModel.toUpperCase()}`,
    `${config.batteryCapacity}KWH, 51.2VDC NOMINAL, IP67, NEMA 3R`,
    `TOTAL STORAGE: ${config.totalStorageKwh} kWh | STACKS: ${config.inverterCount} x ${config.batteriesPerStack}`,
  ]
  const battScopeSize = sizeBox(battLines, 5.5, { x: PAD, y: PAD })

  // Inverter box
  const invSize = sizeBox([
    `(N) ${config.inverterModel.toUpperCase()}`,
    `INVERTER X`,
    `${config.inverterAcKw}KW AC, ${(config.maxPvPower / 1000).toFixed(1)}KW DC, 100A, 240V, NEMA 3R`,
    `XX MODULES = XX.XX kW DC`,
    `${config.mpptsPerInverter} MPPT, ${config.stringsPerMppt} STRINGS/MPPT, MAX ${config.maxCurrentPerMppt}A/MPPT`,
    `CEC EFF: 96.5% | PEAK: 97.5%`,
  ], 5.5, { x: PAD + 4, y: PAD })
  invSize.w = Math.max(invSize.w, 210) // minimum width
  invSize.h = Math.max(invSize.h, 80) // minimum height

  // Battery stack box
  const battStackLines = [
    `(N)(${config.batteriesPerStack})`,
    config.batteryModel.toUpperCase(),
    `${config.batteryCapacity}KWH, 51.2VDC`,
    `IP67, NEMA 3R`,
    `STACK OF ${config.batteriesPerStack}`,
    `${config.batteriesPerStack * config.batteryCapacity} kWh TOTAL`,
  ]
  const battStackSize = sizeBox(battStackLines, 5, { x: PAD, y: PAD })
  battStackSize.w = Math.max(battStackSize.w, 90)

  // Monitoring gateway box
  const gwSize = sizeBox(['(N) DCCGRGL', 'DURACELL MONITORING GW'], 4.5, { x: PAD, y: PAD })
  gwSize.w = Math.max(gwSize.w, 110)

  // Wireless bridge box
  const wbSize = sizeBox(['(N) WIRELESS BRIDGE'], 4, { x: PAD, y: PAD })
  wbSize.w = Math.max(wbSize.w, 75)

  // ── PHASE 2: Calculate positions (multi-row layout) ──
  // Cap inverter columns per row to keep the sheet at a readable aspect ratio.
  // Systems with >MAX_COLS_PER_ROW inverters wrap into multiple rows, each
  // containing its own strings → JB → DC disc → inverter → battery → AC disc.
  // All rows feed into a shared bus bar at the bottom.

  const MAX_COLS_PER_ROW = 4
  const numRows = Math.ceil(config.inverterCount / MAX_COLS_PER_ROW)
  const colsInRow = (r: number) =>
    r < numRows - 1 ? MAX_COLS_PER_ROW : config.inverterCount - MAX_COLS_PER_ROW * (numRows - 1)

  // Width based on widest possible row (capped at MAX_COLS_PER_ROW)
  const invColWidth = battStackSize.w + 60 + invSize.w + 30 + gwSize.w
  const maxColsInAnyRow = Math.min(config.inverterCount, MAX_COLS_PER_ROW)
  const totalInvWidth = invColWidth * maxColsInAnyRow + (maxColsInAnyRow - 1) * COL_GAP
  // Utility chain: wire(30) + servDisc(100) + wire(25) + RGM(70) + wire(25) + meter(44dia) + wire(50) + gridText(80) + margin(30)
  const utilChainWidth = 30 + 100 + 25 + 70 + 25 + 44 + 50 + 80 + 30 // = 454
  const sheetWidth = Math.max(totalInvWidth + 100 + utilChainWidth + 50, 1600)

  // Per-row vertical sections
  const stringRowH = 40 // height per string row
  const maxStringsPerInv = Math.max(...config.stringsPerInverter.map(s => s.length))
  const stringsSectionH = maxStringsPerInv * stringRowH + 30
  const jbH = 25
  const ROW_GAP = 40

  // Single row equipment height: strings + gap + JB + gap + DC disc(25) + inverter + gap + AC disc zone(60)
  const rowEquipmentH = stringsSectionH + 10 + jbH + 40 + 25 + invSize.h + SECTION_GAP + 60

  // Header area top margin (STC, meter, battery scope boxes live here)
  const headerTopMargin = 80

  // Per-row Y offset helpers
  const rowTopY = (r: number) => headerTopMargin + r * (rowEquipmentH + ROW_GAP)
  const stringsTopYForRow = (r: number) => rowTopY(r)
  const jbYForRow = (r: number) => stringsTopYForRow(r) + stringsSectionH + 10
  const dcDiscYForRow = (r: number) => jbYForRow(r) + jbH + 40
  const invTopYForRow = (r: number) => dcDiscYForRow(r) + 25
  const acDiscYForRow = (r: number) => invTopYForRow(r) + invSize.h + SECTION_GAP

  // Bus bar below all rows
  const busY = rowTopY(numRows - 1) + rowEquipmentH + 30

  // Below bus (breakers, ground, existing system, generator)
  const belowBusH = 100

  // Notes section
  const notesY = busY + belowBusH + 20
  const notesH = 100

  // Title block
  const titleBlockH = 120

  const sheetHeight = notesY + notesH + titleBlockH + 30

  // Per-row column centering
  const rowColumnsStartX = (r: number) => {
    const cols = colsInRow(r)
    const rowWidth = cols * invColWidth + (cols - 1) * COL_GAP
    return (sheetWidth - rowWidth) / 2
  }

  // ── PHASE 3: Generate elements ──

  // Drawing border
  elements.push({ type: 'rect', x: 5, y: 5, w: sheetWidth - 10, h: sheetHeight - 10, strokeWidth: 2 })
  elements.push({ type: 'rect', x: 9, y: 9, w: sheetWidth - 18, h: sheetHeight - 18, strokeWidth: 0.5 })

  // STC box (top left)
  elements.push({ type: 'rect', x: 20, y: 16, w: stcSize.w, h: stcSize.h })
  stcLines.forEach((line, i) => {
    elements.push({ type: 'text', x: 28, y: 28 + i * 10, text: line, fontSize: i === 0 ? 7 : 6, bold: i === 0 })
  })

  // Meter box (top center)
  const meterX = 20 + stcSize.w + 20
  elements.push({ type: 'rect', x: meterX, y: 16, w: meterSize.w, h: meterSize.h })
  meterLines.forEach((line, i) => {
    elements.push({ type: 'text', x: meterX + 8, y: 28 + i * 10, text: line, fontSize: 6 })
  })

  // Battery scope box (top right) — enhanced to match RUSH detail
  const battScopeEnhancedLines = [
    `(N)(${config.batteryCount}) ${config.batteryModel.toUpperCase()}`,
    `${config.batteryCapacity}KWH, 51.2VDC NOMINAL, IP67, NEMA 3R`,
    `TOTAL STORAGE: ${config.totalStorageKwh} kWh | STACKS: ${config.inverterCount} x ${config.batteriesPerStack}`,
    `ELECTRICAL INFORMATION`,
    `  N-3P, 240V, 2220A`,
    `SERVICE DISCONNECT RATING    200A`,
    `SERVICE DISCONNECT FUSE RATING    200A`,
  ]
  const battScopeEnhancedSize = sizeBox(battScopeEnhancedLines, 5.5, { x: PAD, y: PAD })
  battScopeEnhancedSize.w = Math.max(battScopeEnhancedSize.w, 260)
  const battScopeX = sheetWidth - battScopeEnhancedSize.w - 20
  elements.push({ type: 'rect', x: battScopeX, y: 16, w: battScopeEnhancedSize.w, h: battScopeEnhancedSize.h + 16 })
  elements.push({ type: 'text', x: battScopeX + 8, y: 28, text: 'BATTERY SCOPE', fontSize: 6, bold: true })
  battScopeEnhancedLines.forEach((line, i) => {
    const isBold = line === 'ELECTRICAL INFORMATION'
    elements.push({ type: 'text', x: battScopeX + 8, y: 40 + i * 9, text: line, fontSize: 5.5, bold: isBold })
  })

  // SCOPE block (below battery scope)
  const scopeY = 16 + battScopeEnhancedSize.h + 22
  elements.push({ type: 'rect', x: battScopeX, y: scopeY, w: battScopeEnhancedSize.w, h: 40 })
  elements.push({ type: 'text', x: battScopeX + 8, y: scopeY + 12, text: 'SCOPE', fontSize: 5.5, bold: true })
  elements.push({ type: 'text', x: battScopeX + 8, y: scopeY + 22, text: `(${config.inverterCount}) ${config.inverterModel.toUpperCase()}`, fontSize: 4.5, fill: '#444' })
  elements.push({ type: 'text', x: battScopeX + 8, y: scopeY + 32, text: `(${config.batteryCount}) ${config.batteryModel.toUpperCase()}`, fontSize: 4.5, fill: '#444' })

  // Installation notes box (below STC + meter boxes)
  const installNotesY = 16 + stcSize.h + 12
  const installNotes = [
    'REQUIRES RING TERMINALS FOR BATTERY WIRING',
    'REQUIRES TRENCHING',
    `ADDITIONAL VF TRENCH LENGTH IS GM BOTH ENDS OF THE TRENCH FOR VERTICAL WIRING`,
    'NEEDS TO FIX THE PVC AND EXPOSED WIRING FROM MAIN SERVICE PANEL ON UTILITY POLE',
    'TO MAKE SPACE FOR NEW SURGE PROTECTOR',
    'REQUIRES RIGID RACK FOR MAX HYBRID INVERTER AND BATTERY MOUNTING',
  ]
  const installNotesSize = sizeBox(installNotes, 5, { x: PAD, y: PAD })
  installNotesSize.w = Math.max(installNotesSize.w, stcSize.w)
  elements.push({ type: 'rect', x: 20, y: installNotesY, w: installNotesSize.w, h: installNotesSize.h + 8 })
  elements.push({ type: 'text', x: 28, y: installNotesY + 10, text: 'INSTALLATION NOTES:', fontSize: 5.5, bold: true })
  installNotes.forEach((line, i) => {
    elements.push({ type: 'text', x: 28, y: installNotesY + 21 + i * 8, text: `- ${line}`, fontSize: 4.5, fill: '#444' })
  })

  // ── Per-inverter columns (multi-row aware) ──
  for (let inv = 0; inv < config.inverterCount; inv++) {
    const row = Math.floor(inv / MAX_COLS_PER_ROW)
    const col = inv % MAX_COLS_PER_ROW
    const stringIndices = config.stringsPerInverter[inv]
    const invCenterX = rowColumnsStartX(row) + col * (invColWidth + COL_GAP) + invColWidth / 2

    // Row-local Y coordinates (shadow outer names so existing element code works unchanged)
    const stringsTopY = stringsTopYForRow(row)
    const jbY = jbYForRow(row)
    const dcDiscY = dcDiscYForRow(row)
    const invTopY = invTopYForRow(row)
    const acDiscY = acDiscYForRow(row)

    // ── String arrays ──
    const stringsForInv = stringIndices.map(i => config.strings[i])
    const stringsBaseX = invCenterX - 100 // left-align strings

    stringsForInv.forEach((s, si) => {
      const sy = stringsTopY + si * stringRowH
      const moduleW = 8, moduleH = 14
      const numDraw = Math.min(s.modules, 12)

      // String label
      elements.push({ type: 'text', x: stringsBaseX, y: sy - 4, text: `STRING ${s.id}: (${s.modules}) ${config.panelModel.toUpperCase()}`, fontSize: 6, bold: true })
      elements.push({ type: 'text', x: stringsBaseX + 230, y: sy - 4, text: `ROOF #${s.roofFace}`, fontSize: 5.5, fill: '#666' })

      // Panel rectangles
      for (let mi = 0; mi < numDraw; mi++) {
        elements.push({ type: 'rect', x: stringsBaseX + mi * (moduleW + 1), y: sy, w: moduleW, h: moduleH, strokeWidth: 0.7 })
      }

      // Series connection line
      elements.push({ type: 'line', x1: stringsBaseX, y1: sy + moduleH / 2, x2: stringsBaseX + numDraw * (moduleW + 1) - 1, y2: sy + moduleH / 2, strokeWidth: 0.3, dash: true })

      // Voltage/current labels
      const labelX = stringsBaseX + numDraw * (moduleW + 1) + 15
      elements.push({ type: 'line', x1: stringsBaseX + numDraw * (moduleW + 1), y1: sy + moduleH / 2, x2: labelX - 5, y2: sy + moduleH / 2, strokeWidth: 1 })
      elements.push({ type: 'text', x: labelX, y: sy + moduleH / 2 - 2, text: `${s.vocCold.toFixed(1)}V`, fontSize: 5, fill: '#444' })
      elements.push({ type: 'text', x: labelX, y: sy + moduleH / 2 + 6, text: `${s.imp}A`, fontSize: 5, fill: '#444' })

      // RSD label — per-string, matches spatial layout's per-string semantics
      elements.push({ type: 'text', x: stringsBaseX, y: sy + moduleH + 10, text: `(N) ${config.rapidShutdownModel ?? 'RSD-D-20'} ROOFTOP MODULE LEVEL RAPID SHUTDOWN DEVICE — STRING ${s.id}`, fontSize: 4.5, fill: '#444' })
    })

    // Roof array wiring label (RUSH style: bold header + detail lines)
    const afterStringsY = stringsTopY + stringsForInv.length * stringRowH + 5
    elements.push({ type: 'text', x: stringsBaseX, y: afterStringsY, text: 'ROOF ARRAY WIRING', fontSize: 5.5, bold: true })
    elements.push({ type: 'text', x: stringsBaseX + 10, y: afterStringsY + 9, text: `${config.dcStringWire ?? '#10 AWG CU PV WIRE'}, PV TRUNK CABLE`, fontSize: 4.5, fill: '#444' })
    elements.push({ type: 'text', x: stringsBaseX + 10, y: afterStringsY + 17, text: `INSTALLED IN ${config.dcConduit ?? '3/4" EMT'} TYPE CONDUIT`, fontSize: 4.5, fill: '#444' })

    // Junction box — centered under string arrays
    const jbW = 65, jbBoxH = 24
    elements.push({ type: 'rect', x: invCenterX - jbW / 2, y: jbY, w: jbW, h: jbBoxH })
    elements.push({ type: 'text', x: invCenterX, y: jbY + 10, text: '(N) JUNCTION BOX', fontSize: 5.5, anchor: 'middle' })
    elements.push({ type: 'text', x: invCenterX, y: jbY + 19, text: '600V, NEMA 3', fontSize: 5, anchor: 'middle', fill: '#666' })
    // Callout ① — Junction Box
    elements.push({ type: 'callout', cx: invCenterX + jbW / 2 + 14, cy: jbY + jbBoxH / 2, number: 1 })

    // Wire from JB to DC disconnect
    elements.push({ type: 'line', x1: invCenterX, y1: jbY + jbH + 5, x2: invCenterX, y2: dcDiscY - 15, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: invCenterX + 8, y: dcDiscY - 30, text: config.dcHomerunWire ?? '(2) #10 AWG CU THWN-2', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: dcDiscY - 22, text: config.dcEgc ?? '(1) #6 AWG BARE CU EGC', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: dcDiscY - 14, text: config.dcHomerunConduit ?? '3/4" EMT TYPE CONDUIT', fontSize: 5, fill: '#444', italic: true })

    // DC Disconnect
    elements.push({ type: 'disconnect', x: invCenterX, y: dcDiscY, label: '(N) DC DISCONNECT' })
    // Callout ② — DC Disconnect (offset past label text)
    elements.push({ type: 'callout', cx: invCenterX + 100, cy: dcDiscY, number: 2 })

    // Wire to inverter
    elements.push({ type: 'line', x1: invCenterX, y1: dcDiscY + 10, x2: invCenterX, y2: invTopY, strokeWidth: 1.5 })

    // Inverter box
    const invX = invCenterX - invSize.w / 2
    elements.push({ type: 'rect', x: invX, y: invTopY, w: invSize.w, h: invSize.h, strokeWidth: 2 })
    // Callout ③ — Inverter
    elements.push({ type: 'callout', cx: invX + invSize.w + 14, cy: invTopY + invSize.h / 2, number: 3 })

    const invModules = stringsForInv.reduce((s, str) => s + str.modules, 0)
    const invDcKw = (invModules * config.panelWattage / 1000).toFixed(2)
    const actualInvLines = [
      `(N) ${config.inverterModel.toUpperCase().slice(0, 35)}`,
      `HYBRID ${config.inverterAcKw}KW INVERTER ${inv + 1}`,
      `${config.inverterAcKw}KW AC, ${(config.maxPvPower / 1000).toFixed(1)}KW DC, 100A, 240V, NEMA 3R`,
      `${invModules} MODULES = ${invDcKw} kW DC`,
      `${config.mpptsPerInverter} MPPT, ${config.stringsPerMppt} STRINGS/MPPT, MAX ${config.maxCurrentPerMppt}A/MPPT`,
      'CEC EFF: 96.5% | PEAK: 97.5%',
    ]
    actualInvLines.forEach((line, i) => {
      elements.push({
        type: 'text', x: invCenterX, y: invTopY + 13 + i * 11,
        text: line, fontSize: i < 2 ? 6 : 5.5, anchor: 'middle',
        bold: i === 0, fill: i >= 3 ? '#666' : undefined,
      })
    })

    // Battery stack (left of inverter)
    const battX = invX - 60 - battStackSize.w
    const battY = invTopY + (invSize.h - battStackSize.h) / 2
    elements.push({ type: 'line', x1: invX, y1: invTopY + invSize.h / 2, x2: battX + battStackSize.w, y2: invTopY + invSize.h / 2, strokeWidth: 1.5 })
    // Wire labels centered between battery box and inverter
    const battWireMidX = battX + battStackSize.w + (invX - battX - battStackSize.w) / 2
    elements.push({ type: 'text', x: battWireMidX, y: invTopY + invSize.h / 2 - 8, text: config.batteryWire ?? '(2) #4/0 AWG', fontSize: 4.5, anchor: 'middle', fill: '#444', italic: true })
    elements.push({ type: 'text', x: battWireMidX, y: invTopY + invSize.h / 2 + 12, text: config.batteryConduit ?? '2" EMT', fontSize: 4.5, anchor: 'middle', fill: '#444', italic: true })
    elements.push({ type: 'rect', x: battX, y: battY, w: battStackSize.w, h: battStackSize.h, strokeWidth: 1.5 })
    // Callout ⑤ — Battery Stack
    elements.push({ type: 'callout', cx: battX - 14, cy: battY + battStackSize.h / 2, number: 5 })
    battStackLines.forEach((line, i) => {
      elements.push({
        type: 'text', x: battX + battStackSize.w / 2, y: battY + 12 + i * 10,
        text: line, fontSize: i === 0 ? 5.5 : 5, anchor: 'middle',
        bold: i === 0, fill: i >= 4 ? '#666' : undefined,
      })
    })

    // ── DURACELL POWER CENTER container (groups battery + combiner + inverter) ──
    const dpcPad = 12
    const dpcLeft = battX - dpcPad
    const dpcTop = Math.min(battY, invTopY) - dpcPad - 14
    const dpcRight = invX + invSize.w + dpcPad
    const dpcBottom = Math.max(battY + battStackSize.h, invTopY + invSize.h) + dpcPad
    elements.push({ type: 'rect', x: dpcLeft, y: dpcTop, w: dpcRight - dpcLeft, h: dpcBottom - dpcTop, strokeWidth: 1.5, dash: true })
    elements.push({ type: 'text', x: (dpcLeft + dpcRight) / 2, y: dpcTop + 10, text: 'DURACELL POWER CENTER', fontSize: 6, anchor: 'middle', bold: true })
    // Battery combiner label (between battery and inverter)
    elements.push({ type: 'text', x: battWireMidX, y: invTopY + invSize.h / 2 - 18, text: '(N) BATTERY COMBINER', fontSize: 4.5, anchor: 'middle', bold: true })

    // Cantex high-current distribution bar on battery DC bus (Task 2.4)
    if (config.hasCantexBar !== false) {
      const cantexX = battX
      const cantexY = battY + battStackSize.h + 8
      elements.push({ type: 'rect', x: cantexX, y: cantexY, w: 90, h: 18 })
      elements.push({ type: 'text', x: cantexX + 45, y: cantexY + 12, text: '(N) CANTEX HIGH-CURRENT BAR', fontSize: 4.5, anchor: 'middle', bold: true })
    }

    // Monitoring gateway (right of inverter)
    const gwX = invX + invSize.w + 25
    elements.push({ type: 'line', x1: invX + invSize.w, y1: invTopY + 20, x2: gwX, y2: invTopY + 20, strokeWidth: 1 })
    elements.push({ type: 'rect', x: gwX, y: invTopY + 8, w: gwSize.w, h: gwSize.h, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: invTopY + 16, text: '(N) DURACELL DTL', fontSize: 5, anchor: 'middle', bold: true })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: invTopY + 25, text: 'SPQHD-CELL', fontSize: 4, anchor: 'middle', fill: '#666' })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: invTopY + 33, text: 'MONITORING GATEWAY', fontSize: 3.8, anchor: 'middle', fill: '#666' })

    // Wireless bridge below gateway
    const wbY = invTopY + 8 + gwSize.h + 8
    elements.push({ type: 'line', x1: gwX + gwSize.w / 2, y1: invTopY + 8 + gwSize.h, x2: gwX + gwSize.w / 2, y2: wbY, strokeWidth: 0.8, dash: true })
    elements.push({ type: 'rect', x: gwX + (gwSize.w - wbSize.w) / 2, y: wbY, w: wbSize.w, h: wbSize.h, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: wbY + 11, text: '(N) WIRELESS BRIDGE', fontSize: 4, anchor: 'middle' })

    // CT clamp text below bridge
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: wbY + wbSize.h + 10, text: 'CT CLAMPS ON MAIN', fontSize: 3.5, anchor: 'middle', fill: '#666' })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: wbY + wbSize.h + 17, text: 'SERVICE ENTRANCE', fontSize: 3.5, anchor: 'middle', fill: '#666' })

    // CAN to CANBUS cable (from gateway to DPC)
    elements.push({ type: 'text', x: gwX - 5, y: invTopY + 5, text: 'CAN TO CANBUS CABLE', fontSize: 3.5, fill: '#999', anchor: 'end' })

    // Link extension cable (between inverters in multi-inverter systems)
    if (config.inverterCount > 1 && inv < config.inverterCount - 1) {
      const nextCol = (inv + 1) % MAX_COLS_PER_ROW
      const nextRow = Math.floor((inv + 1) / MAX_COLS_PER_ROW)
      if (nextRow === row) {
        // Same row — draw horizontal link cable
        const nextCenterX = rowColumnsStartX(row) + nextCol * (invColWidth + COL_GAP) + invColWidth / 2
        const linkY = invTopY + invSize.h - 10
        elements.push({ type: 'line', x1: invX + invSize.w, y1: linkY, x2: nextCenterX - invSize.w / 2, y2: linkY, strokeWidth: 0.5, dash: true })
        elements.push({ type: 'text', x: (invX + invSize.w + nextCenterX - invSize.w / 2) / 2, y: linkY - 4, text: 'LINK EXTENSION CABLE', fontSize: 3, anchor: 'middle', fill: '#999' })
      }
    }

    // AC output from inverter
    elements.push({ type: 'line', x1: invCenterX, y1: invTopY + invSize.h, x2: invCenterX, y2: acDiscY - 15, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: invCenterX + 8, y: invTopY + invSize.h + 12, text: config.acInverterWire ?? '#6 AWG CU THWN-2', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: invTopY + invSize.h + 20, text: '(1) #8 AWG CU EGC', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: invTopY + invSize.h + 28, text: '1" EMT TYPE CONDUIT', fontSize: 5, fill: '#444', italic: true })

    // AC Disconnect
    elements.push({ type: 'disconnect', x: invCenterX, y: acDiscY, label: '(N) AC DISCONNECT, 200A/2P, 240V' })
    // Callout ④ — AC Disconnect (offset past long label text)
    elements.push({ type: 'callout', cx: invCenterX + 130, cy: acDiscY, number: 4 })

    // Wire from AC disconnect to bus
    elements.push({ type: 'line', x1: invCenterX, y1: acDiscY + 10, x2: invCenterX, y2: busY, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: invCenterX + 8, y: acDiscY + 22, text: config.acToPanelWire ?? '(2) #4 AWG CU THWN-2', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: acDiscY + 30, text: '(1) #8 AWG CU EGC', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: acDiscY + 38, text: `${config.acConduit ?? '1-1/4" EMT'} TYPE CONDUIT`, fontSize: 5, fill: '#444', italic: true })

    // Backfeed breaker
    elements.push({ type: 'breaker', x: invCenterX, y: busY - 5, label: `(N) ${config.backfeedBreakerA ?? 100}A BACKFEED`, amps: 'BREAKER' })
    // Callout ⑥ — Rapid Shutdown / Backfeed Breaker (offset past label text)
    elements.push({ type: 'callout', cx: invCenterX + 100, cy: busY - 5, number: 6 })
  }

  // ── Main Service Panel (physical rectangle, not just a line) ──
  const busLeft = 50
  const busRight = sheetWidth - utilChainWidth - 20
  const mspW = busRight - busLeft
  const mspH = 30
  // MSP as a physical box
  elements.push({ type: 'rect', x: busLeft, y: busY - mspH / 2, w: mspW, h: mspH, strokeWidth: 2 })
  elements.push({ type: 'text', x: (busLeft + busRight) / 2, y: busY - 2, text: '(E) MAIN SERVICE PANEL', fontSize: 7, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: (busLeft + busRight) / 2, y: busY + 8, text: '200A RATED, 240V, 200A MAIN (EXTERIOR MOUNTED)', fontSize: 4.5, anchor: 'middle', fill: '#666' })
  // Bus bar inside MSP
  elements.push({ type: 'line', x1: busLeft + 10, y1: busY, x2: busRight - 10, y2: busY, strokeWidth: 2.5 })

  // Sub panel (above MSP, dashed — interior mounted)
  const subPanelY = busY - mspH / 2 - 50
  elements.push({ type: 'rect', x: busLeft, y: subPanelY, w: 130, h: 35, dash: true, strokeWidth: 1 })
  elements.push({ type: 'text', x: busLeft + 65, y: subPanelY + 14, text: '(E) SUB PANEL', fontSize: 5.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: busLeft + 65, y: subPanelY + 24, text: '200A RATED, 240V (INTERIOR)', fontSize: 4.5, anchor: 'middle', fill: '#999' })
  elements.push({ type: 'line', x1: busLeft + 65, y1: subPanelY + 35, x2: busLeft + 65, y2: busY - mspH / 2, strokeWidth: 1, dash: true })

  // Surge protector (above MSP right side)
  const surgeX = busRight - 100
  elements.push({ type: 'rect', x: surgeX, y: subPanelY, w: 90, h: 30, strokeWidth: 1 })
  elements.push({ type: 'text', x: surgeX + 45, y: subPanelY + 14, text: '(N) SURGE PROTECTOR', fontSize: 5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: surgeX + 45, y: subPanelY + 24, text: 'TYPE 2 SPD', fontSize: 4.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'line', x1: surgeX + 45, y1: subPanelY + 30, x2: surgeX + 45, y2: busY - mspH / 2, strokeWidth: 1 })

  // Main breaker (left of MSP, drops down)
  elements.push({ type: 'line', x1: busLeft + 15, y1: busY + mspH / 2, x2: busLeft + 15, y2: busY + mspH / 2 + 25, strokeWidth: 1.5 })
  elements.push({ type: 'breaker', x: busLeft + 15, y: busY + mspH / 2 + 20, label: '(E) MAIN', amps: '200A' })
  elements.push({ type: 'text', x: busLeft + 15, y: busY + mspH / 2 + 50, text: 'TO LOADS', fontSize: 5.5, anchor: 'middle' })

  // IMO Rapid Shutdown Device (left of sub panel)
  elements.push({ type: 'rect', x: busLeft + 145, y: subPanelY, w: 100, h: 30, strokeWidth: 1 })
  elements.push({ type: 'text', x: busLeft + 195, y: subPanelY + 14, text: '(N) IMO RAPID SHUTDOWN', fontSize: 5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: busLeft + 195, y: subPanelY + 24, text: 'DEVICE', fontSize: 5, anchor: 'middle', bold: true })

  // Ground system
  elements.push({ type: 'line', x1: busLeft + 80, y1: busY + mspH / 2, x2: busLeft + 80, y2: busY + mspH / 2 + 45, strokeWidth: 1 })
  elements.push({ type: 'ground', x: busLeft + 80, y: busY + mspH / 2 + 45 })
  elements.push({ type: 'text', x: busLeft + 95, y: busY + mspH / 2 + 45, text: 'EXISTING GROUNDING', fontSize: 5.5 })
  elements.push({ type: 'text', x: busLeft + 95, y: busY + mspH / 2 + 53, text: 'ELECTRODE SYSTEM', fontSize: 5.5 })
  elements.push({ type: 'text', x: busLeft + 95, y: busY + mspH / 2 + 61, text: 'NEC 250.50, 250.52(A)', fontSize: 5, fill: '#666' })

  // Existing PV breaker (if applicable)
  if (config.existingPanels) {
    const epX = (busLeft + busRight) / 2 + 50
    elements.push({ type: 'line', x1: epX, y1: busY, x2: epX, y2: busY + 30, strokeWidth: 1, dash: true })
    elements.push({ type: 'breaker', x: epX, y: busY + 25, label: '(E) 40A PV', amps: 'BREAKER' })
    elements.push({ type: 'text', x: epX, y: busY + 55, text: '(E) EXISTING ENPHASE', fontSize: 5, anchor: 'middle', fill: '#666' })
    elements.push({ type: 'text', x: epX, y: busY + 63, text: 'IQ7PLUS SYSTEM', fontSize: 5, anchor: 'middle', fill: '#666' })

    // Existing system detail box
    elements.push({ type: 'rect', x: epX - 100, y: busY + 70, w: 200, h: 28, dash: true, strokeWidth: 0.5 })
    elements.push({ type: 'text', x: epX - 90, y: busY + 82, text: `(E) ${config.existingPanels}`, fontSize: 5, fill: '#666' })
    elements.push({ type: 'text', x: epX - 90, y: busY + 91, text: `(E) ${config.existingInverters}`, fontSize: 5, fill: '#666' })
  }

  // Generator ready circuit
  const genX = (busLeft + busRight) / 2 + 180
  elements.push({ type: 'line', x1: genX, y1: busY, x2: genX, y2: busY + 40, strokeWidth: 1, dash: true })
  elements.push({ type: 'rect', x: genX - 35, y: busY + 40, w: 70, h: 24, dash: true })
  elements.push({ type: 'text', x: genX, y: busY + 51, text: '(FUTURE) 100A', fontSize: 5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: genX, y: busY + 59, text: 'AC INPUT', fontSize: 5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: genX, y: busY + 75, text: 'FUTURE PLUG-AND-PLAY', fontSize: 4, anchor: 'middle', fill: '#999' })
  elements.push({ type: 'text', x: genX, y: busY + 82, text: '22kW NG GENERATOR', fontSize: 4, anchor: 'middle', fill: '#999' })

  // ── Consumption CT (between bus and utility chain) ──
  const ctX = busRight - 30
  elements.push({ type: 'circle', cx: ctX, cy: busY - 18, r: 8, strokeWidth: 1 })
  elements.push({ type: 'text', x: ctX, y: busY - 16, text: 'CT', fontSize: 5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: ctX, y: busY - 30, text: 'CONSUMPTION CT.', fontSize: 4.5, anchor: 'middle', fill: '#444' })
  // Dashed line from CT to bus
  elements.push({ type: 'line', x1: ctX, y1: busY - 10, x2: ctX, y2: busY, strokeWidth: 0.8, dash: true })

  // ── Utility chain (right of bus) ──
  const utilStartX = busRight
  elements.push({ type: 'line', x1: utilStartX, y1: busY, x2: utilStartX + 30, y2: busY, strokeWidth: 1.5 })

  // Service Disconnect (RUSH: visible, lockable, labeled)
  const gdX = utilStartX + 30
  elements.push({ type: 'rect', x: gdX, y: busY - 20, w: 100, h: 40 })
  elements.push({ type: 'text', x: gdX + 50, y: busY - 8, text: '(N) SERVICE DISCONNECT', fontSize: 5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: gdX + 50, y: busY + 2, text: 'VISIBLE, LOCKABLE,', fontSize: 4.5, anchor: 'middle', fill: '#444' })
  elements.push({ type: 'text', x: gdX + 50, y: busY + 10, text: 'LABELED DISCONNECT', fontSize: 4.5, anchor: 'middle', fill: '#444' })

  // Expansion fittings annotation
  elements.push({ type: 'text', x: gdX + 50, y: busY + 28, text: '(N) EXPANSION FITTINGS', fontSize: 4, anchor: 'middle', fill: '#333', bold: true })
  elements.push({ type: 'text', x: gdX + 50, y: busY + 36, text: 'REQUIRED ON BOTH ENDS', fontSize: 4, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: gdX + 50, y: busY + 44, text: `OF THE ${config.serviceEntranceConduit ?? '2" EMT'} PIPE`, fontSize: 4, anchor: 'middle', fill: '#666' })
  // Callout ⑦ — Service Disconnect
  elements.push({ type: 'callout', cx: gdX + 50, cy: busY - 30, number: 7 })

  // Wire from Service Disc → (RGM →) Utility Meter
  // RGM gated by config.hasRgm — Duracell projects skip it, legacy installs include.
  // Utility meter position (umCx) is kept fixed regardless so downstream layout doesn't shift.
  const rgmX = gdX + 125
  const umCx = rgmX + 120
  if (config.hasRgm) {
    // Service Disc → RGM
    elements.push({ type: 'line', x1: gdX + 100, y1: busY, x2: rgmX, y2: busY, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: gdX + 105, y: busY + 12, text: '(3) 250 kcmil CU THWN-2', fontSize: 4, fill: '#444', italic: true })
    // Revenue Grade Meter
    elements.push({ type: 'rect', x: rgmX, y: busY - 13, w: 70, h: 26, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: rgmX + 35, y: busY - 2, text: '(N) RGM', fontSize: 4.5, anchor: 'middle' })
    elements.push({ type: 'text', x: rgmX + 35, y: busY + 7, text: 'PC-PRO-RGM-W2-BA-L', fontSize: 3.8, anchor: 'middle' })
    // Callout ⑧ — RGM
    elements.push({ type: 'callout', cx: rgmX + 35, cy: busY - 24, number: 8 })
    // RGM → Meter
    elements.push({ type: 'line', x1: rgmX + 70, y1: busY, x2: umCx - 22, y2: busY, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: rgmX + 72, y: busY + 12, text: '(3) 250 kcmil CU THWN-2', fontSize: 4, fill: '#444', italic: true })
  } else {
    // Direct: Service Disc → Meter (single wire, single label centered)
    elements.push({ type: 'line', x1: gdX + 100, y1: busY, x2: umCx - 22, y2: busY, strokeWidth: 1.5 })
    const labelX = (gdX + 100 + umCx - 22) / 2 - 60
    elements.push({ type: 'text', x: labelX, y: busY + 12, text: '(3) 250 kcmil CU THWN-2', fontSize: 4, fill: '#444', italic: true })
  }
  elements.push({ type: 'circle', cx: umCx, cy: busY, r: 22, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: umCx, y: busY - 3, text: 'M', fontSize: 8, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: umCx, y: busY + 8, text: 'kWh', fontSize: 5.5, anchor: 'middle' })
  elements.push({ type: 'text', x: umCx, y: busY - 28, text: `UTILITY: ${config.utility.toUpperCase()}`, fontSize: 4.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: umCx, y: busY - 36, text: '(E) BI-DIRECTIONAL', fontSize: 5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: umCx, y: busY - 44, text: 'UTILITY METER', fontSize: 5.5, anchor: 'middle', fill: '#666', bold: true })
  // Meter + ESID numbers
  if (config.meter) {
    elements.push({ type: 'text', x: umCx, y: busY + 28, text: `METER: ${config.meter}`, fontSize: 4, anchor: 'middle', fill: '#555' })
  }
  if (config.esid) {
    elements.push({ type: 'text', x: umCx, y: busY + 36, text: `ESID: ${config.esid}`, fontSize: 4, anchor: 'middle', fill: '#555' })
  }
  // Wire type annotation
  elements.push({ type: 'text', x: umCx, y: busY + 46, text: '3-WIRE, 120/240V', fontSize: 4, anchor: 'middle', fill: '#555' })
  // Callout ⑨ — Utility Meter
  elements.push({ type: 'callout', cx: umCx, cy: busY - 48, number: 9 })

  // Wire to grid
  elements.push({ type: 'line', x1: umCx + 22, y1: busY, x2: umCx + 50, y2: busY, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: umCx + 55, y: busY - 5, text: 'TO UTILITY', fontSize: 6, fill: '#666' })
  elements.push({ type: 'text', x: umCx + 55, y: busY + 5, text: 'GRID', fontSize: 6, fill: '#666' })
  elements.push({ type: 'text', x: umCx + 55, y: busY + 17, text: config.utility.toUpperCase(), fontSize: 5, fill: '#999' })
  // Utility conduit routing — 250 kcmil service entrance from
  // config.serviceEntranceConduit (default 2" EMT). 1-1/4" EMT can't fit 3×
  // 250 kcmil per Ch 9 Table 4. acConduit is for the inverter→MSP run, not
  // the underground service feed.
  elements.push({ type: 'text', x: umCx + 55, y: busY + 28, text: `${config.serviceEntranceConduit ?? '2" EMT'} TYPE CONDUIT`, fontSize: 4.5, fill: '#444', italic: true })
  elements.push({ type: 'text', x: umCx + 55, y: busY + 36, text: `ROUGHLY ${config.acRunLengthFt ?? 50} FEET (DIRT)`, fontSize: 4.5, fill: '#444', italic: true })
  elements.push({ type: 'text', x: umCx + 55, y: busY + 44, text: 'TRENCHING FROM UTILITY POLE', fontSize: 4.5, fill: '#444', italic: true })
  elements.push({ type: 'text', x: umCx + 55, y: busY + 52, text: 'TO HOME WALL', fontSize: 4.5, fill: '#444', italic: true })

  // 10 FT MAX notation
  elements.push({ type: 'line', x1: utilStartX, y1: busY - 30, x2: umCx + 50, y2: busY - 30, strokeWidth: 0.5 })
  elements.push({ type: 'text', x: (utilStartX + umCx + 50) / 2, y: busY - 33, text: "10' MAX", fontSize: 5.5, anchor: 'middle', bold: true })

  // ── Notes section ──
  const notesW = sheetWidth - 380
  elements.push({ type: 'rect', x: 20, y: notesY, w: notesW, h: notesH, strokeWidth: 0.5 })
  elements.push({ type: 'text', x: 30, y: notesY + 12, text: 'NOTES:', fontSize: 6.5, bold: true })
  const noteLines = [
    '1. ALL ELECTRICAL MATERIALS SHALL BE NEW AND LISTED BY RECOGNIZED TESTING LABORATORY.',
    '2. OUTDOOR EQUIPMENT SHALL BE AT LEAST NEMA 3R RATED.',
    '3. ALL METALLIC EQUIPMENT SHALL BE GROUNDED PER NEC 250.',
    `4. PV SYSTEM SIZE: ${config.systemDcKw.toFixed(2)} kW DC / ${config.systemAcKw} kW AC.`,
    `5. BATTERY SYSTEM: (${config.batteryCount}) ${config.batteryModel.toUpperCase()}, ${config.totalStorageKwh} kWh TOTAL.`,
    `6. RACKING: ${config.rackingModel.toUpperCase()}.`,
    '7. ALL WORK SHALL BE IN ACCORD WITH THE 2020 NEC WITH SPECIAL EMPHASIS ON ARTICLE 690.',
    `NOTE: PCS CONTROLLED CURRENT SETTING: ${config.pcsCurrentSetting ?? 200}A.`,
    'NOTE: STRING CALCULATIONS REQUIRE PE REVIEW BEFORE PERMITTING.',
    ...(config.loadSideBackfeedCompliant === false
      ? [
          `⚠ DESIGNER WARNING: 120% rule fails — total backfeed ${config.totalBackfeedA ?? 0}A + ${config.mainBreakerA ?? 200}A main exceeds 120% × bus (max allowable backfeed = ${config.maxAllowableBackfeedA ?? 0}A).`,
          '   Use line-side tap (NEC 705.12(A)), sub-panel feeder, PCS-limited output (NEC 705.13), or upsize bus before submitting to AHJ.',
        ]
      : []),
  ]
  noteLines.forEach((line, i) => {
    elements.push({ type: 'text', x: 30, y: notesY + 24 + i * 9, text: line, fontSize: 5.5 })
  })

  // ── Title block (bottom right) ──
  const tbW = 320
  const tbH = 120
  const tbX = sheetWidth - tbW - 15
  const tbY = sheetHeight - tbH - 15
  elements.push({ type: 'rect', x: tbX, y: tbY, w: tbW, h: tbH, strokeWidth: 1.5 })
  // Contractor
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 12, text: config.contractor, fontSize: 7, bold: true })
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 22, text: config.contractorAddress, fontSize: 5.5, fill: '#333' })
  elements.push({ type: 'text', x: tbX + 200, y: tbY + 12, text: `Ph: ${config.contractorPhone}`, fontSize: 5.5, fill: '#333' })
  elements.push({ type: 'text', x: tbX + 200, y: tbY + 22, text: `Lic# ${config.contractorLicense}`, fontSize: 5.5, fill: '#333' })
  // Divider
  elements.push({ type: 'line', x1: tbX, y1: tbY + 30, x2: tbX + tbW, y2: tbY + 30, strokeWidth: 0.5 })
  // Project
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 42, text: `${config.projectName}`.toUpperCase(), fontSize: 6.5, bold: true })
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 52, text: config.address, fontSize: 5.5, fill: '#333' })
  // Divider
  elements.push({ type: 'line', x1: tbX, y1: tbY + 58, x2: tbX + tbW, y2: tbY + 58, strokeWidth: 0.5 })
  // Drawn by
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 70, text: 'DRAWN BY: MicroGRID', fontSize: 5.5, fill: '#333' })
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 78, text: `DATE: ${new Date().toLocaleDateString('en-US')}`, fontSize: 5.5, fill: '#333' })
  // Engineer stamp area
  elements.push({ type: 'rect', x: tbX + 160, y: tbY + 60, w: tbW - 165, h: 22, dash: true, strokeWidth: 0.5 })
  elements.push({ type: 'text', x: tbX + 165, y: tbY + 72, text: "ENGINEER'S STAMP", fontSize: 5, fill: '#999' })
  // Divider
  elements.push({ type: 'line', x1: tbX, y1: tbY + 85, x2: tbX + tbW, y2: tbY + 85, strokeWidth: 0.5 })
  // Sheet name
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 97, text: 'SINGLE LINE DIAGRAM', fontSize: 8, bold: true })
  // Sheet number
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 113, text: 'PV-5', fontSize: 14, bold: true })
  elements.push({ type: 'text', x: tbX + 65, y: tbY + 113, text: 'of 6', fontSize: 7, fill: '#333' })

  return { width: sheetWidth, height: sheetHeight, elements }
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
  elements.push({ type: 'rect', x: jbX, y: jbY, w: 60, h: 24 })
  elements.push({ type: 'text', x: jbX + 30, y: jbY + 10, text: '(N) JUNCTION BOX', fontSize: 5, anchor: 'middle' })
  elements.push({ type: 'text', x: jbX + 30, y: jbY + 19, text: '600V, NEMA 3R', fontSize: 4, anchor: 'middle', fill: '#666' })
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
  elements.push({ type: 'rect', x: pvlcX, y: pvlcY, w: 80, h: 55, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: pvlcX + 40, y: pvlcY + 12, text: '(N) PV LOAD CENTER', fontSize: 4.5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: pvlcX + 40, y: pvlcY + 22, text: 'BRP12L125R 125A', fontSize: 4, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: pvlcX + 40, y: pvlcY + 30, text: 'RATED 100A MAIN', fontSize: 4, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: pvlcX + 40, y: pvlcY + 38, text: 'NEMA3R, UL LISTED', fontSize: 3.5, anchor: 'middle', fill: '#999' })
  elements.push({ type: 'text', x: pvlcX + 40, y: pvlcY + 48, text: '(EXTERIOR)', fontSize: 3.5, anchor: 'middle', fill: '#999' })

  // Wire from PV LC down to DC Disconnect
  elements.push({ type: 'line', x1: pvlcX + 40, y1: pvlcY + 55, x2: pvlcX + 40, y2: pvlcY + 75, strokeWidth: 1.5 })

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

    // Battery combiner (center inside DPC)
    const combX = battX + battUnitW + 25, combY = battY + 15
    elements.push({ type: 'rect', x: combX, y: combY, w: 65, h: 40, strokeWidth: 1 })
    elements.push({ type: 'text', x: combX + 32, y: combY + 16, text: '(N) BATTERY', fontSize: 4.5, anchor: 'middle', bold: true })
    elements.push({ type: 'text', x: combX + 32, y: combY + 26, text: 'COMBINER', fontSize: 4.5, anchor: 'middle', bold: true })
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
  const mspW = 130, mspH = 180

  // MSP box
  elements.push({ type: 'rect', x: mspX, y: mspY, w: mspW, h: mspH, strokeWidth: 2 })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY + 20, text: '(E) MAIN SERVICE', fontSize: 6, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY + 30, text: 'PANEL', fontSize: 6, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY + 44, text: '200A RATED, 240V,', fontSize: 4.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY + 52, text: '200A MAIN', fontSize: 4.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY + 66, text: '(EXTERIOR MOUNTED)', fontSize: 4, anchor: 'middle', fill: '#999' })

  // Backfeed breaker inside MSP
  elements.push({ type: 'breaker', x: mspX + mspW / 2, y: mspY + mspH - 30, label: `(N) ${config.backfeedBreakerA ?? 100}A`, amps: 'BACKFEED' })
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

  // Surge protector
  elements.push({ type: 'rect', x: mspX + mspW + 10, y: mspY - 50, w: 80, h: 28, strokeWidth: 1 })
  elements.push({ type: 'text', x: mspX + mspW + 50, y: mspY - 38, text: '(N) SURGE', fontSize: 4.5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: mspX + mspW + 50, y: mspY - 28, text: 'PROTECTOR', fontSize: 4.5, anchor: 'middle', bold: true })

  // IMO RSD
  elements.push({ type: 'rect', x: mspX + mspW + 10, y: mspY - 15, w: 80, h: 28, strokeWidth: 1 })
  elements.push({ type: 'text', x: mspX + mspW + 50, y: mspY - 3, text: '(N) IMO RAPID', fontSize: 4.5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: mspX + mspW + 50, y: mspY + 7, text: 'SHUTDOWN', fontSize: 4.5, anchor: 'middle', bold: true })

  // ── Utility chain (right of MSP) ──
  const utilY = mspY + mspH / 2
  elements.push({ type: 'line', x1: mspX + mspW, y1: utilY, x2: mspX + mspW + 25, y2: utilY, strokeWidth: 1.5 })
  // Wire spec MSP → Service Disconnect
  elements.push({ type: 'text', x: mspX + mspW + 3, y: utilY - 8, text: '(3) 250 kcmil CU THWN-2', fontSize: 3, fill: '#444', italic: true })

  // Service Disconnect
  const sdX = mspX + mspW + 25
  elements.push({ type: 'rect', x: sdX, y: utilY - 18, w: 90, h: 36 })
  elements.push({ type: 'text', x: sdX + 45, y: utilY - 5, text: '(N) SERVICE', fontSize: 5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: sdX + 45, y: utilY + 5, text: 'DISCONNECT', fontSize: 5, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: sdX + 45, y: utilY + 14, text: 'VISIBLE, LOCKABLE', fontSize: 3.5, anchor: 'middle', fill: '#666' })
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
  elements.push({ type: 'circle', cx: umCx, cy: utilY, r: 18, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: umCx, y: utilY - 2, text: 'M', fontSize: 7, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: umCx, y: utilY + 7, text: 'kWh', fontSize: 5, anchor: 'middle' })
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
  elements.push({ type: 'rect', x: jbX, y: jbY, w: jbW, h: jbH, stroke: STROKE, strokeWidth: 1 })
  textBlock(jbX + jbW / 2, jbY + 12, [
    '(N) JUNCTION', 'BOX', '600V, NEMA 3', 'UL LISTED',
  ], { fontSize: 5.5, lineHeight: 7, bold: true, anchor: 'middle' })
  cursorX = jbX + jbW

  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 70, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 12, cy: mainY - 18, number: 2 })
  textBlock(cursorX + 22, mainY - 28, [
    '(4) #10 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  cursorX += 70

  const lcX = cursorX, lcY = mainY - 48, lcW = 110, lcH = 100
  elements.push({ type: 'rect', x: lcX, y: lcY, w: lcW, h: lcH, stroke: STROKE, strokeWidth: 1 })
  textBlock(lcX + lcW / 2, lcY + 11, [
    '(N) PV LOAD CENTER',
  ], { fontSize: 6, bold: true, anchor: 'middle' })
  textBlock(lcX + lcW / 2, lcY + 20, [
    'BRP12L125R 125A',
    'RATED MLO, NEMA3R,',
    'UL LISTED',
    '(EXTERIOR MOUNTED)',
  ], { fontSize: 4.8, lineHeight: 6.5, anchor: 'middle', fill: MUTED })
  pill(lcX + 28, lcY + 62, 36, 12, '20A/2P', 5)
  pill(lcX + 82, lcY + 62, 36, 12, '15A/2P', 5)
  pill(lcX + lcW / 2, lcY + 82, 40, 12, '40A/2P MAIN', 5)
  elements.push({ type: 'text', x: lcX + 6, y: lcY + lcH - 4, text: 'G', fontSize: 6, bold: true })
  cursorX = lcX + lcW

  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 80, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 14, cy: mainY - 18, number: 3 })
  textBlock(cursorX + 24, mainY - 28, [
    '(2) #8 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  cursorX += 80

  const pvdX = cursorX, pvdY = mainY - 38, pvdW = 90, pvdH = 80
  elements.push({ type: 'rect', x: pvdX, y: pvdY, w: pvdW, h: pvdH, stroke: STROKE, strokeWidth: 1 })
  textBlock(pvdX + pvdW / 2, pvdY + 11, ['(N) PV DISCONNECT'], { fontSize: 6, bold: true, anchor: 'middle' })
  textBlock(pvdX + pvdW / 2, pvdY + 20, [
    'NON-FUSIBLE',
    'EATON DG222URB',
    '(60A, 2P, 240V 3R)',
  ], { fontSize: 4.8, lineHeight: 6.5, anchor: 'middle', fill: MUTED })
  elements.push({ type: 'text', x: pvdX + 6, y: pvdY + 56, text: 'LINE', fontSize: 4.5, fill: MUTED })
  elements.push({ type: 'text', x: pvdX + pvdW - 18, y: pvdY + 56, text: 'LOAD', fontSize: 4.5, fill: MUTED })
  elements.push({ type: 'disconnect', x: pvdX + pvdW / 2 - 10, y: pvdY + 50, label: '60A' })
  textBlock(pvdX + pvdW / 2, pvdY + pvdH + 4, [
    'VISIBLE, LOCKABLE,',
    'LABELED "AC DISC"',
    'EXTERIOR WALL',
  ], { fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED })
  cursorX = pvdX + pvdW

  elements.push({ type: 'line', x1: cursorX, y1: mainY, x2: cursorX + 70, y2: mainY, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: cursorX + 12, cy: mainY - 18, number: 4 })
  textBlock(cursorX + 22, mainY - 28, [
    '(2) #8 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  cursorX += 70

  const plpX = cursorX, plpY = mainY - 60, plpW = 120, plpH = 130
  elements.push({ type: 'rect', x: plpX, y: plpY, w: plpW, h: plpH, stroke: STROKE, strokeWidth: 1 })
  textBlock(plpX + plpW / 2, plpY + 11, ['(N) PROTECTED LOAD PANEL'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(plpX + plpW / 2, plpY + 20, [
    'BRP20B125R',
    '125A RATED, NEMA3R,',
    'UL LISTED (EXTERIOR)',
  ], { fontSize: 4.8, lineHeight: 6.5, anchor: 'middle', fill: MUTED })
  pill(plpX + 22, plpY + 60, 36, 12, '35A/2P', 5)
  elements.push({ type: 'text', x: plpX + 22, y: plpY + 70, text: 'PV', fontSize: 4.5, anchor: 'middle', fill: MUTED })
  pill(plpX + plpW - 22, plpY + 60, 36, 12, '40A/2P', 5)
  elements.push({ type: 'text', x: plpX + plpW - 22, y: plpY + 70, text: 'MAIN', fontSize: 4.5, anchor: 'middle', fill: MUTED })
  textBlock(plpX + plpW / 2, plpY + 88, [
    '(N) 35A PV BREAKER AT',
    'OPPOSITE END OF BUS',
    'FROM MAIN BREAKER',
  ], { fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED })
  elements.push({ type: 'text', x: plpX + 6, y: plpY + plpH - 4, text: 'G', fontSize: 6, bold: true })
  elements.push({ type: 'line', x1: plpX + 8, y1: plpY + 50, x2: plpX + plpW - 8, y2: plpY + 50, strokeWidth: 0.7 })
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
  const essdX = battX + battW + 100
  const essdY = battY + 30
  const essdW = 90, essdH = 70
  elements.push({ type: 'line', x1: estopRightX, y1: estopCenterY, x2: essdX, y2: essdY + essdH / 2, strokeWidth: 1.4 })
  elements.push({ type: 'callout', cx: estopRightX + 20, cy: estopCenterY - 9, number: 6 })
  textBlock(estopRightX + 30, estopCenterY - 19, [
    '(2) #14 AWG CU THWN-2',
    '(1) #8 AWG CU EGC',
    '3/4" EMT TYPE CONDUIT',
  ], { fontSize: 4.5, lineHeight: 5.5, fill: MUTED })
  elements.push({ type: 'rect', x: essdX, y: essdY, w: essdW, h: essdH, stroke: STROKE, strokeWidth: 1 })
  textBlock(essdX + essdW / 2, essdY + 11, ['(N) ESS DISCONNECT'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(essdX + essdW / 2, essdY + 20, [
    'NON-FUSIBLE',
    'EATON DG221URB',
    '(30A, 2P, 240V 3R)',
  ], { fontSize: 4.5, lineHeight: 6, anchor: 'middle', fill: MUTED })
  elements.push({ type: 'disconnect', x: essdX + essdW / 2 - 10, y: essdY + 46, label: '30A' })
  textBlock(essdX + essdW / 2, essdY + essdH + 4, [
    'VISIBLE, LOCKABLE,',
    'LABELED "AC DISC"',
  ], { fontSize: 4, lineHeight: 5, anchor: 'middle', fill: MUTED })

  elements.push({ type: 'line', x1: essdX, y1: essdY + essdH - 8, x2: battX + 100, y2: essdY + essdH - 8, strokeWidth: 1.4, dash: true })
  elements.push({ type: 'line', x1: battX + 100, y1: essdY + essdH - 8, x2: battX + 100, y2: battY + 36, strokeWidth: 1.4, dash: true })
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

  const cgdX = cursorX, cgdY = mainY - 48, cgdW = 100, cgdH = 100
  elements.push({ type: 'rect', x: cgdX, y: cgdY, w: cgdW, h: cgdH, stroke: STROKE, strokeWidth: 1 })
  textBlock(cgdX + cgdW / 2, cgdY + 11, ['(N) CUSTOMER GEN'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(cgdX + cgdW / 2, cgdY + 20, ['DISCONNECT / FUSIBLE'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(cgdX + cgdW / 2, cgdY + 29, [
    'EATON DG222NRB',
    '(60A, 2P, 240V 3R)',
    '(45A FUSES)',
  ], { fontSize: 4.5, lineHeight: 6, anchor: 'middle', fill: MUTED })
  fuse(cgdX + 30, cgdY + 70, '45A')
  fuse(cgdX + cgdW - 30, cgdY + 70, '45A')
  textBlock(cgdX + cgdW / 2, cgdY + 86, ['2X45A FUSES'], { fontSize: 5, bold: true, anchor: 'middle' })
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
  elements.push({ type: 'rect', x: mspX, y: mspY, w: mspW, h: mspH, stroke: STROKE, strokeWidth: 1.2 })
  textBlock(mspX + mspW / 2, mspY + 11, ['(N) MAIN SERVICE PANEL'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(mspX + mspW / 2, mspY + 20, [
    `${config.mspBusbarA ?? 225}A RATED 240v`,
    '(EXTERIOR MOUNTED)',
  ], { fontSize: 4.8, lineHeight: 6.5, anchor: 'middle', fill: MUTED })
  elements.push({ type: 'line', x1: mspX + 8, y1: mspY + 60, x2: mspX + mspW - 8, y2: mspY + 60, strokeWidth: 0.7 })
  pill(mspX + 22, mspY + 70, 36, 12, '45A/2P', 5)
  textBlock(mspX + 22, mspY + 82, ['PV'], { fontSize: 4.5, anchor: 'middle', fill: MUTED })
  pill(mspX + mspW - 22, mspY + 70, 36, 12, '125A/2P', 5)
  textBlock(mspX + mspW - 22, mspY + 82, ['MAIN'], { fontSize: 4.5, anchor: 'middle', fill: MUTED })
  elements.push({ type: 'rect', x: mspX + mspW / 2 - 28, y: mspY + 95, w: 56, h: 16, stroke: SUBSTROKE, strokeWidth: 0.6 })
  elements.push({ type: 'text', x: mspX + mspW / 2, y: mspY + 105, text: '(N) SURGE PROTECTOR', fontSize: 4.5, anchor: 'middle' })
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
  elements.push({ type: 'circle', cx: umCx, cy: umCy, r: 18, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: umCx, y: umCy + 5, text: 'M', fontSize: 14, bold: true, anchor: 'middle' })
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
  elements.push({ type: 'rect', x: dpcX, y: dpcY, w: dpcW, h: dpcH, stroke: STROKE, strokeWidth: 0.8 })
  textBlock(dpcX + dpcW / 2, dpcY + 13, ['(N) DPCRGM - CELL'], { fontSize: 5.5, bold: true, anchor: 'middle' })
  textBlock(dpcX + dpcW / 2, dpcY + 25, [
    'DURACELL DTU',
    'PN: PC-PRO-C',
  ], { fontSize: 5, lineHeight: 7, anchor: 'middle', fill: MUTED })
  ;[1, 2, 3, 4].forEach((n, i) => {
    elements.push({
      type: 'circle', cx: dpcX + 18 + i * 22, cy: dpcY + dpcH + 8, r: 4, strokeWidth: 0.4,
    })
    elements.push({
      type: 'text', x: dpcX + 18 + i * 22, y: dpcY + dpcH + 10, text: `${n}`,
      fontSize: 4, anchor: 'middle',
    })
  })

  elements.push({ type: 'line', x1: sonnenCtX + 8, y1: sonnenCtY, x2: dpcX, y2: dpcY + 20, strokeWidth: 0.7, dash: true })
  elements.push({ type: 'line', x1: dpcCtX - 8, y1: dpcCtY, x2: dpcX + dpcW, y2: dpcY + 20, strokeWidth: 0.7, dash: true })

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
