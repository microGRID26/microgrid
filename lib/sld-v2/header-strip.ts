// Phase H7 — top-of-sheet header strip painter for PV-5 SLD.
//
// Replicates the 4 metadata boxes from the RUSH-stamped Tyson reference
// (PROJ-26922 Rev1 PV-5.1):
//   1. STC box       — module + inverter DC/AC math
//   2. METER+ESID    — utility identifiers
//   3. BATTERY SCOPE — storage + electrical info + MSP/MSB ratings
//   4. SCOPE         — full system summary (right-most, widest)
//
// PE reviewers scan these first; without them the SLD won't pass stamp
// review even if the diagram itself is correct. Painted via jsPDF native
// primitives (rect/text/line), same approach as title-block.ts.

import type { jsPDF } from 'jspdf'
import type { PlansetData } from '../planset-types'

/**
 * Total height of the header strip in pt. Subtracted from the SLD body's
 * printable height by `renderSldToPdf` so the auto-fit scale leaves room
 * at the top.
 */
// Phase H12 Pass-4 — was 60. Bumped to 70 to accommodate larger body text
// (4.8pt was illegible at office-copier reproduction). The 4-box header is
// the first thing PE/AHJ reviewers look at; values must be readable. Pass-1
// top-aligned the SLD body, so the additional 10pt of header reserve simply
// shifts the body down 10pt with no scale impact.
export const HEADER_STRIP_HEIGHT_PT = 70

/** Gap below the header strip before the SLD body starts. */
export const HEADER_STRIP_GAP_PT = 6

interface PaintOptions {
  fontName?: string
  unicodeSafe?: boolean
}

// Box widths (sum to header strip total width; the 4th absorbs remainder).
// Tuned against the Tyson reference proportions, then scaled to whatever
// width the caller passes in.
const BOX_WEIGHTS = {
  stc: 0.17,
  meter: 0.18,
  battery: 0.30,
  scope: 0.35,
} as const

const BORDER: [number, number, number] = [0, 0, 0]
const LABEL_GRAY: [number, number, number] = [102, 102, 102]
const VALUE_NEAR_BLACK: [number, number, number] = [17, 17, 17]
const HEADER_FILL: [number, number, number] = [245, 245, 245]

// Phase H12 Pass-4 — body 4.8→5.5, title 5.5→6.5, LINE_GAP 6.0→6.5.
// Print-readable at AHJ copier scale. 8 lines × 6.5pt + HEADER_BAND_H +
// PAD_Y_TITLE = 69pt, fits in the new 70pt header height.
const TITLE_SIZE_PT = 6.5
const BODY_SIZE_PT = 5.5
const LINE_GAP = 6.5
const PAD_X = 4
const PAD_Y_TITLE = 6
const HEADER_BAND_H = 11

// Helpers ─────────────────────────────────────────────────────────────────

function winAnsi(s: string): string {
  // Same defensive transliteration as title-block.ts. Identity when the
  // caller flags unicodeSafe=true (Inter is registered).
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/[™]/g, 'TM')
    .replace(/[ ]/g, ' ')
}

function makeSanitizer(unicodeSafe: boolean | undefined): (s: string) => string {
  return unicodeSafe ? (s: string) => s : (s: string) => winAnsi(s)
}

function paintBox(
  pdf: jsPDF,
  title: string,
  lines: string[],
  x: number,
  y: number,
  w: number,
  h: number,
  fontName: string,
  sanitize: (s: string) => string,
): void {
  // Outer border
  pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2])
  pdf.setLineWidth(0.5)
  pdf.rect(x, y, w, h, 'S')

  // Header band fill
  pdf.setFillColor(HEADER_FILL[0], HEADER_FILL[1], HEADER_FILL[2])
  pdf.rect(x, y, w, HEADER_BAND_H, 'F')
  pdf.setDrawColor(BORDER[0], BORDER[1], BORDER[2])
  pdf.line(x, y + HEADER_BAND_H, x + w, y + HEADER_BAND_H)

  // Title text (centered in the band)
  pdf.setFont(fontName, 'bold')
  pdf.setFontSize(TITLE_SIZE_PT)
  pdf.setTextColor(VALUE_NEAR_BLACK[0], VALUE_NEAR_BLACK[1], VALUE_NEAR_BLACK[2])
  pdf.text(sanitize(title), x + w / 2, y + HEADER_BAND_H / 2 + 1.5, {
    align: 'center',
    baseline: 'middle',
  })

  // Body lines
  pdf.setFont(fontName, 'normal')
  pdf.setFontSize(BODY_SIZE_PT)
  pdf.setTextColor(VALUE_NEAR_BLACK[0], VALUE_NEAR_BLACK[1], VALUE_NEAR_BLACK[2])

  let textY = y + HEADER_BAND_H + PAD_Y_TITLE
  const maxY = y + h - 2
  for (const line of lines) {
    if (textY > maxY) break
    pdf.text(sanitize(line), x + PAD_X, textY, { baseline: 'middle' })
    textY += LINE_GAP
  }
}

// Box content builders ────────────────────────────────────────────────────

function fmtN(n: number, decimals = 3): string {
  // 6.885 -> "6.885", 24.2 -> "24.200" — three decimals for kW math per
  // the Tyson reference convention.
  return n.toFixed(decimals)
}

// Strip a trailing 'A' from a number-with-units string so we can append
// units cleanly without doubling ("200A" + "A" = "200AA"). Tolerates
// whitespace and case.
function stripTrailingA(s: string): string {
  return s.replace(/\s*A\s*$/i, '')
}

function buildStcLines(data: PlansetData): string[] {
  // Phase H12 Pass-8 — STC column was 3 short lines at the top of the box
  // with empty space below, visually asymmetric with the other 3 columns
  // that distribute content across the full box height. Added panel model
  // detail + DC array rating + Tyson-convention STC test conditions line
  // so the STC box reads as "module-level performance at STC" the way an
  // AHJ reviewer expects (STC = Standard Test Conditions in solar).
  const dc = data.panelCount * data.panelWattage
  const invKw = data.inverterCount * data.inverterAcPower
  return [
    `MODULES: ${data.panelCount} x ${data.panelWattage}W = ${fmtN(dc / 1000)} kW DC`,
    `MODEL: ${data.panelModel}`,
    `INVERTER(S): ${data.inverterCount} x ${data.inverterAcPower}kW = ${fmtN(invKw)} kW AC`,
    `TOTAL: ${fmtN(data.systemAcKw)} kW AC NAMEPLATE`,
    `STC: 1000 W/m${'²'} · 25${'°'}C · AM 1.5`,
    `OPERATING: -40${'°'}C to +85${'°'}C`,
  ]
}

function buildMeterLines(data: PlansetData): string[] {
  return [
    `METER NUMBER: ${data.meter || '__________'}`,
    `ESID NUMBER: ${data.esid || '__________'}`,
    `UTILITY: ${data.utility || ''}`,
    `AHJ: ${data.ahj || ''}`,
  ]
}

function buildBatteryLines(data: PlansetData): string[] {
  const totalKw = data.inverterCount * data.inverterAcPower
  const totalKwh = data.batteryCount * data.batteryCapacity
  const busbar = stripTrailingA(data.mspBusRating || '')
  const brkr = stripTrailingA(data.mainBreaker || '')
  return [
    `${fmtN(totalKwh, 1)} kWh / ${fmtN(totalKw, 1)} kW AC`,
    `(${data.inverterCount}) ${data.inverterModel}`,
    `(${data.batteryCount}) x ${data.batteryModel} = ${fmtN(totalKwh, 1)} kWh`,
    // Pass-16d — Tyson PV-5 spells "1-PHASE, 3-WIRE" alongside the symbol
    // shorthand. AHJ reviewers expect the literal phrase.
    `ELECTRICAL: 1${'Φ'} (1-PHASE), 3W, ${data.voltage || '120/240V'}`,
    // Pass-18a — Tyson "NEW SERVICE: 1Φ, 3W, 200A" explicit callout.
    `NEW SERVICE: 1${'Φ'}, 3W, ${busbar || '—'}A`,
    `MSP BUSBAR: ${busbar || '—'}A   MSB BRKR: ${brkr || '—'}A`,
  ]
}

function buildScopeLines(data: PlansetData): string[] {
  const dcKw = (data.panelCount * data.panelWattage) / 1000
  const acKw = data.systemAcKw
  const busbar = stripTrailingA(data.mspBusRating || '')
  const brkr = stripTrailingA(data.mainBreaker || '')
  // Strings summary: groups by modules-per-string count.
  // e.g. "(2) STRINGS OF (28) MODULES CONNECTED IN SERIES"
  const stringsByLength = new Map<number, number>()
  for (const s of data.strings) {
    const len = s.modules ?? 0
    if (len > 0) stringsByLength.set(len, (stringsByLength.get(len) ?? 0) + 1)
  }
  const stringSummary = Array.from(stringsByLength.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([len, count]) =>
      count === 1
        ? `(1) STRING OF (${len}) MODULES IN SERIES`
        : `(${count}) STRINGS OF (${len}) MODULES IN SERIES`,
    )
  // Explicit per-Tyson AC math callout — INVERTER(S): N × kW = total kW AC.
  // Pair with the kW-DC/kW-AC summary line for the AHJ math check.
  const invMath = `INVERTER(S): ${data.inverterCount} × ${data.inverterAcPower}kW = ${fmtN(acKw)} kW AC`
  return [
    `${fmtN(dcKw)} kW DC / ${fmtN(acKw)} kW AC`,
    `(${data.panelCount}) ${data.panelModel} ${data.panelWattage}W`,
    `(${data.inverterCount}) ${data.inverterModel}`,
    invMath,
    // Pass-18b/c — Tyson PV-5 SCOPE block has explicit verbose ratings.
    `BUSBAR RATING: ${busbar || '—'}A`,
    `MAIN SERVICE BREAKER RATING: ${brkr || '—'}A`,
    ...stringSummary.slice(0, 2),
  ]
}

// Public API ──────────────────────────────────────────────────────────────

/**
 * Paint the 4-box header strip across the top of the page.
 *
 * Layout: STC | METER | BATTERY SCOPE | SCOPE, left-to-right, widths
 * weighted per BOX_WEIGHTS. Each box has a header band with the title,
 * then 4-6 lines of metadata.
 */
export function paintHeaderStrip(
  pdf: jsPDF,
  data: PlansetData,
  x: number,
  y: number,
  w: number,
  h: number,
  options: PaintOptions = {},
): void {
  const fontName = options.fontName ?? 'helvetica'
  const sanitize = makeSanitizer(options.unicodeSafe)

  const wStc = w * BOX_WEIGHTS.stc
  const wMeter = w * BOX_WEIGHTS.meter
  const wBattery = w * BOX_WEIGHTS.battery
  // Scope absorbs the remainder so rounding doesn't leave a sliver gap.
  const wScope = w - wStc - wMeter - wBattery

  let cursorX = x

  paintBox(pdf, 'STC', buildStcLines(data), cursorX, y, wStc, h, fontName, sanitize)
  cursorX += wStc

  paintBox(pdf, 'METER + UTILITY', buildMeterLines(data), cursorX, y, wMeter, h, fontName, sanitize)
  cursorX += wMeter

  paintBox(pdf, 'BATTERY SCOPE', buildBatteryLines(data), cursorX, y, wBattery, h, fontName, sanitize)
  cursorX += wBattery

  paintBox(pdf, 'SCOPE', buildScopeLines(data), cursorX, y, wScope, h, fontName, sanitize)
}
