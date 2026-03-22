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
}

// Text width estimation: ~0.52 * fontSize * charCount for Arial
function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.52
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
  | { type: 'circle'; cx: number; cy: number; r: number; stroke?: string; strokeWidth?: number }
  | { type: 'text'; x: number; y: number; text: string; fontSize: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; fill?: string; italic?: boolean }
  | { type: 'breaker'; x: number; y: number; label: string; amps?: string }
  | { type: 'disconnect'; x: number; y: number; label: string }
  | { type: 'ground'; x: number; y: number }

export function calculateSldLayout(config: SldConfig): SldLayout {
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
    `${config.batteryCapacity}KWH, 380VDC, IP67, NEMA 3R`,
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
    `${config.batteryCapacity}KWH, 380VDC`,
    `IP67, NEMA 3R`,
    `STACK OF ${config.batteriesPerStack}`,
    `${config.batteriesPerStack * config.batteryCapacity} kWh TOTAL`,
  ]
  const battStackSize = sizeBox(battStackLines, 5, { x: PAD, y: PAD })
  battStackSize.w = Math.max(battStackSize.w, 75)

  // Monitoring gateway box
  const gwSize = sizeBox(['(N) DCCGRGL', 'DURACELL MONITORING GW'], 4.5, { x: PAD, y: PAD })
  gwSize.w = Math.max(gwSize.w, 95)

  // Wireless bridge box
  const wbSize = sizeBox(['(N) WIRELESS BRIDGE'], 4, { x: PAD, y: PAD })
  wbSize.w = Math.max(wbSize.w, 75)

  // ── PHASE 2: Calculate positions (top to bottom flow) ──

  // Total width: need room for 2 inverter columns + batteries + gateway on each side
  const invColWidth = battStackSize.w + 60 + invSize.w + 30 + gwSize.w
  const totalInvWidth = invColWidth * config.inverterCount + COL_GAP
  // Sheet width must accommodate inverter columns + utility chain (350px for bus-to-grid)
  const utilChainWidth = 400 // gen disconnect + RGM + meter + grid text
  const sheetWidth = Math.max(totalInvWidth + utilChainWidth + 150, 1500)

  // String arrays section
  const stringRowH = 40 // height per string row
  const maxStringsPerInv = Math.max(...config.stringsPerInverter.map(s => s.length))
  const stringsTopY = 80
  const stringsSectionH = maxStringsPerInv * stringRowH + 30

  // Junction box section
  const jbY = stringsTopY + stringsSectionH + 10
  const jbH = 25

  // DC disconnect section
  const dcDiscY = jbY + jbH + 40

  // Inverter section
  const invTopY = dcDiscY + 25

  // AC disconnect section
  const acDiscY = invTopY + invSize.h + SECTION_GAP

  // Bus bar section
  const busY = acDiscY + 60

  // Below bus (breakers, ground, existing system, generator)
  const belowBusH = 100

  // Notes section
  const notesY = busY + belowBusH + 20
  const notesH = 100

  // Title block
  const titleBlockH = 120

  const sheetHeight = notesY + notesH + titleBlockH + 30

  // Center the inverter columns
  const totalColumnsWidth = config.inverterCount * invColWidth + (config.inverterCount - 1) * COL_GAP
  const columnsStartX = (sheetWidth - totalColumnsWidth) / 2

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

  // Battery scope box (top right)
  const battScopeX = sheetWidth - battScopeSize.w - 20
  elements.push({ type: 'rect', x: battScopeX, y: 16, w: battScopeSize.w, h: battScopeSize.h + 10 })
  elements.push({ type: 'text', x: battScopeX + 8, y: 28, text: 'BATTERY SCOPE', fontSize: 6, bold: true })
  battLines.forEach((line, i) => {
    elements.push({ type: 'text', x: battScopeX + 8, y: 40 + i * 9, text: line, fontSize: 5.5 })
  })

  // ── Per-inverter columns ──
  for (let inv = 0; inv < config.inverterCount; inv++) {
    const stringIndices = config.stringsPerInverter[inv]
    const invCenterX = columnsStartX + inv * (invColWidth + COL_GAP) + invColWidth / 2

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

      // RSD label
      elements.push({ type: 'text', x: stringsBaseX, y: sy + moduleH + 10, text: '(N) RSD-D-20 ROOFTOP MODULE LEVEL RAPID SHUTDOWN DEVICE', fontSize: 4.5, fill: '#444' })
    })

    // Roof array wiring label
    const afterStringsY = stringsTopY + stringsForInv.length * stringRowH + 5
    elements.push({ type: 'text', x: stringsBaseX, y: afterStringsY, text: 'ROOF ARRAY WIRING', fontSize: 5.5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: stringsBaseX + 10, y: afterStringsY + 10, text: '#10 AWG CU PV WIRE, 3/4" EMT TYPE CONDUIT', fontSize: 5, fill: '#444', italic: true })

    // Junction box — centered under string arrays
    const jbW = 65, jbBoxH = 24
    elements.push({ type: 'rect', x: invCenterX - jbW / 2, y: jbY, w: jbW, h: jbBoxH })
    elements.push({ type: 'text', x: invCenterX, y: jbY + 10, text: '(N) JUNCTION BOX', fontSize: 5.5, anchor: 'middle' })
    elements.push({ type: 'text', x: invCenterX, y: jbY + 19, text: '600V, NEMA 3', fontSize: 5, anchor: 'middle', fill: '#666' })

    // Wire from JB to DC disconnect
    elements.push({ type: 'line', x1: invCenterX, y1: jbY + jbH + 5, x2: invCenterX, y2: dcDiscY - 15, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: invCenterX + 8, y: dcDiscY - 30, text: '(2) #10 AWG CU THWN-2', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: dcDiscY - 22, text: '(1) #6 AWG BARE CU EGC', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: dcDiscY - 14, text: '3/4" EMT TYPE CONDUIT', fontSize: 5, fill: '#444', italic: true })

    // DC Disconnect
    elements.push({ type: 'disconnect', x: invCenterX, y: dcDiscY, label: '(N) DC DISCONNECT' })

    // Wire to inverter
    elements.push({ type: 'line', x1: invCenterX, y1: dcDiscY + 10, x2: invCenterX, y2: invTopY, strokeWidth: 1.5 })

    // Inverter box
    const invX = invCenterX - invSize.w / 2
    elements.push({ type: 'rect', x: invX, y: invTopY, w: invSize.w, h: invSize.h, strokeWidth: 2 })

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
    elements.push({ type: 'text', x: battWireMidX, y: invTopY + invSize.h / 2 - 8, text: '(2) #4/0 AWG', fontSize: 4.5, anchor: 'middle', fill: '#444', italic: true })
    elements.push({ type: 'text', x: battWireMidX, y: invTopY + invSize.h / 2 + 12, text: '2" EMT', fontSize: 4.5, anchor: 'middle', fill: '#444', italic: true })
    elements.push({ type: 'rect', x: battX, y: battY, w: battStackSize.w, h: battStackSize.h, strokeWidth: 1.5 })
    battStackLines.forEach((line, i) => {
      elements.push({
        type: 'text', x: battX + battStackSize.w / 2, y: battY + 12 + i * 10,
        text: line, fontSize: i === 0 ? 5.5 : 5, anchor: 'middle',
        bold: i === 0, fill: i >= 4 ? '#666' : undefined,
      })
    })

    // Monitoring gateway (right of inverter)
    const gwX = invX + invSize.w + 25
    elements.push({ type: 'line', x1: invX + invSize.w, y1: invTopY + 20, x2: gwX, y2: invTopY + 20, strokeWidth: 1 })
    elements.push({ type: 'rect', x: gwX, y: invTopY + 8, w: gwSize.w, h: gwSize.h, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: invTopY + 19, text: '(N) DCCGRGL', fontSize: 4.5, anchor: 'middle' })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: invTopY + 28, text: 'DURACELL MONITORING GW', fontSize: 3.8, anchor: 'middle' })

    // Wireless bridge below gateway
    const wbY = invTopY + 8 + gwSize.h + 8
    elements.push({ type: 'line', x1: gwX + gwSize.w / 2, y1: invTopY + 8 + gwSize.h, x2: gwX + gwSize.w / 2, y2: wbY, strokeWidth: 0.8, dash: true })
    elements.push({ type: 'rect', x: gwX + (gwSize.w - wbSize.w) / 2, y: wbY, w: wbSize.w, h: wbSize.h, strokeWidth: 0.8 })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: wbY + 11, text: '(N) WIRELESS BRIDGE', fontSize: 4, anchor: 'middle' })

    // CT clamp text below bridge
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: wbY + wbSize.h + 10, text: 'CT CLAMPS ON MAIN', fontSize: 3.5, anchor: 'middle', fill: '#666' })
    elements.push({ type: 'text', x: gwX + gwSize.w / 2, y: wbY + wbSize.h + 17, text: 'SERVICE ENTRANCE', fontSize: 3.5, anchor: 'middle', fill: '#666' })

    // AC output from inverter
    elements.push({ type: 'line', x1: invCenterX, y1: invTopY + invSize.h, x2: invCenterX, y2: acDiscY - 15, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: invCenterX + 8, y: invTopY + invSize.h + 12, text: '#6 AWG CU THWN-2', fontSize: 5, fill: '#444', italic: true })

    // AC Disconnect
    elements.push({ type: 'disconnect', x: invCenterX, y: acDiscY, label: '(N) AC DISCONNECT, 200A/2P, 240V' })

    // Wire from AC disconnect to bus
    elements.push({ type: 'line', x1: invCenterX, y1: acDiscY + 10, x2: invCenterX, y2: busY, strokeWidth: 1.5 })
    elements.push({ type: 'text', x: invCenterX + 8, y: acDiscY + 22, text: '(2) #4 AWG CU THWN-2', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: acDiscY + 30, text: '(1) #8 AWG CU EGC', fontSize: 5, fill: '#444', italic: true })
    elements.push({ type: 'text', x: invCenterX + 8, y: acDiscY + 38, text: '1-1/4" EMT TYPE CONDUIT', fontSize: 5, fill: '#444', italic: true })

    // Backfeed breaker
    elements.push({ type: 'breaker', x: invCenterX, y: busY - 5, label: '(N) 100A BACKFEED', amps: 'BREAKER' })
  }

  // ── Bus bar ──
  const busLeft = 50
  const busRight = sheetWidth - 350
  elements.push({ type: 'line', x1: busLeft, y1: busY, x2: busRight, y2: busY, strokeWidth: 3 })
  elements.push({ type: 'text', x: (busLeft + busRight) / 2, y: busY - 12, text: '(E) EXISTING HOME ELECTRICAL PANEL', fontSize: 7, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: (busLeft + busRight) / 2, y: busY + 18, text: '200A RATED, 240V, SINGLE PHASE', fontSize: 5.5, anchor: 'middle', fill: '#666' })

  // Main breaker
  elements.push({ type: 'line', x1: busLeft - 10, y1: busY, x2: busLeft - 10, y2: busY + 30, strokeWidth: 1.5 })
  elements.push({ type: 'breaker', x: busLeft - 10, y: busY + 25, label: '(E) MAIN', amps: '200A' })
  elements.push({ type: 'text', x: busLeft - 10, y: busY + 55, text: 'TO LOADS', fontSize: 5.5, anchor: 'middle' })

  // Ground system
  elements.push({ type: 'line', x1: busLeft + 50, y1: busY, x2: busLeft + 50, y2: busY + 50, strokeWidth: 1 })
  elements.push({ type: 'ground', x: busLeft + 50, y: busY + 50 })
  elements.push({ type: 'text', x: busLeft + 65, y: busY + 50, text: 'EXISTING GROUNDING', fontSize: 5.5 })
  elements.push({ type: 'text', x: busLeft + 65, y: busY + 58, text: 'ELECTRODE SYSTEM', fontSize: 5.5 })
  elements.push({ type: 'text', x: busLeft + 65, y: busY + 66, text: 'NEC 250.50, 250.52(A)', fontSize: 5, fill: '#666' })

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

  // ── Utility chain (right of bus) ──
  const utilStartX = busRight
  elements.push({ type: 'line', x1: utilStartX, y1: busY, x2: utilStartX + 30, y2: busY, strokeWidth: 1.5 })

  // Generation disconnect
  const gdX = utilStartX + 30
  elements.push({ type: 'rect', x: gdX, y: busY - 14, w: 80, h: 28 })
  elements.push({ type: 'text', x: gdX + 40, y: busY - 2, text: '(N) GENERATION', fontSize: 5.5, anchor: 'middle' })
  elements.push({ type: 'text', x: gdX + 40, y: busY + 8, text: 'DISCONNECT', fontSize: 5.5, anchor: 'middle' })

  // Wire to RGM
  elements.push({ type: 'line', x1: gdX + 80, y1: busY, x2: gdX + 105, y2: busY, strokeWidth: 1.5 })

  // Revenue Grade Meter
  const rgmX = gdX + 105
  elements.push({ type: 'rect', x: rgmX, y: busY - 13, w: 70, h: 26, strokeWidth: 0.8 })
  elements.push({ type: 'text', x: rgmX + 35, y: busY - 2, text: '(N) RGM', fontSize: 4.5, anchor: 'middle' })
  elements.push({ type: 'text', x: rgmX + 35, y: busY + 7, text: 'PC-PRO-RGM-W2-BA-L', fontSize: 3.8, anchor: 'middle' })

  // Wire to utility meter
  elements.push({ type: 'line', x1: rgmX + 70, y1: busY, x2: rgmX + 95, y2: busY, strokeWidth: 1.5 })

  // Utility meter circle
  const umCx = rgmX + 120
  elements.push({ type: 'circle', cx: umCx, cy: busY, r: 22, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: umCx, y: busY - 3, text: 'M', fontSize: 8, anchor: 'middle', bold: true })
  elements.push({ type: 'text', x: umCx, y: busY + 8, text: 'kWh', fontSize: 5.5, anchor: 'middle' })
  elements.push({ type: 'text', x: umCx, y: busY - 28, text: 'UTILITY METER', fontSize: 5.5, anchor: 'middle', fill: '#666' })
  elements.push({ type: 'text', x: umCx, y: busY - 36, text: '(E) BIDIRECTIONAL', fontSize: 5.5, anchor: 'middle', fill: '#666' })

  // Wire to grid
  elements.push({ type: 'line', x1: umCx + 22, y1: busY, x2: umCx + 50, y2: busY, strokeWidth: 1.5 })
  elements.push({ type: 'text', x: umCx + 55, y: busY - 5, text: 'TO UTILITY', fontSize: 6, fill: '#666' })
  elements.push({ type: 'text', x: umCx + 55, y: busY + 5, text: 'GRID', fontSize: 6, fill: '#666' })
  elements.push({ type: 'text', x: umCx + 55, y: busY + 17, text: config.utility.toUpperCase(), fontSize: 5, fill: '#999' })

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
    'NOTE: PCS CONTROLLED CURRENT SETTING: 200A.',
    'NOTE: STRING CALCULATIONS REQUIRE PE REVIEW BEFORE PERMITTING.',
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
  elements.push({ type: 'text', x: tbX + 5, y: tbY + 70, text: 'DRAWN BY: NOVA CRM', fontSize: 5.5, fill: '#333' })
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
