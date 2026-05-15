// Phase H8 Category C — distributed numbered callouts 1-9 + legend block.
//
// Tyson PV-5 convention: small numbered circles distributed across the
// diagram pointing at relevant equipment, with a corresponding numbered
// legend block listing the NEC reference + plain-English note for each.
//
// This file defines the canonical 9-callout set + the legend painter.
// The numbered circles themselves are rendered inside SldRenderer (SVG
// world), this legend lives in PDF page chrome (jsPDF native).

import type { jsPDF } from 'jspdf'

export const CALLOUT_LEGEND_HEIGHT_PT = 90
export const CALLOUT_LEGEND_WIDTH_PT = 300

interface PaintOptions {
  fontName?: string
}

const TITLE_SIZE_PT = 6
const BODY_SIZE_PT = 4.5
// Row spacing: enough room for the NEC ref line + the body line + a gap.
// Was 5.4 which collided body-on-next-ref. 11pt clears both lines + gap.
const LINE_GAP = 11
const NEC_TO_BODY_GAP = 5.4
const PAD_X = 4
const PAD_Y = 8
const NEAR_BLACK: [number, number, number] = [17, 17, 17]
const MUTED: [number, number, number] = [85, 85, 85]
const RED: [number, number, number] = [180, 0, 0]

/** Canonical 9-callout set for a residential PV + storage SLD.
 *  Each callout: number + the equipment.id to anchor the circle near
 *  (consumed by SldRenderer) + the legend text painted here.
 *  NEC citations sourced from 2023 NEC residential PV/ESS body. */
export const TYSON_CALLOUTS_PV5: Array<{
  number: number
  equipmentId: string
  nec: string
  text: string
}> = [
  { number: 1, equipmentId: 'rsd', nec: 'NEC 690.12', text: 'RAPID SHUTDOWN INITIATOR · ARRAY-LEVEL · ≤ 80V WITHIN 30S' },
  { number: 2, equipmentId: 'disc-pv', nec: 'NEC 690.13', text: 'PV SYSTEM DISCONNECT · VISIBLE, LOCKABLE, LABELED' },
  { number: 3, equipmentId: 'msp', nec: 'NEC 705.12(B)(2)', text: '120% BUSBAR RULE · BREAKER OPPOSITE END OF MAIN' },
  { number: 4, equipmentId: 'stack-1', nec: 'NEC 706.7', text: 'ESS INSTALLATION · MFR INSTRUCTIONS · WORKING SPACE PER 706.10' },
  { number: 5, equipmentId: 'dc-jb', nec: 'NEC 250.166', text: 'DC GROUNDING ELECTRODE CONDUCTOR · BONDED TO SERVICE GROUND' },
  { number: 6, equipmentId: 'msp', nec: 'NEC 250.118', text: 'EQUIPMENT GROUNDING CONDUCTOR · SIZED PER TABLE 250.122' },
  { number: 7, equipmentId: 'pv', nec: 'NEC 690.31(B)', text: 'PV SOURCE CIRCUIT WIRING · CU THWN-2 OR PV WIRE · 90°C INSULATION' },
  { number: 8, equipmentId: 'disc-service', nec: 'NEC 110.26', text: 'WORKING SPACE · 36" DEPTH · 30" WIDTH · 78" HEIGHT' },
  { number: 9, equipmentId: 'meter', nec: 'NEC 110.21(B)', text: 'PERMANENT WARNING LABELS · BI-DIR METER · BACKFED BREAKER' },
]

/** Paint the numbered-callout legend at (x, y) with given width/height.
 *  Two-column layout — callouts 1-5 left column, 6-9 right column. */
export function paintCalloutLegend(
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  options: PaintOptions = {},
): void {
  const fontName = options.fontName ?? 'helvetica'

  // Frame
  pdf.setDrawColor(...NEAR_BLACK)
  pdf.setLineWidth(0.6)
  pdf.rect(x, y, w, h)

  // Title
  pdf.setFont(fontName, 'bold')
  pdf.setFontSize(TITLE_SIZE_PT)
  pdf.setTextColor(...RED)
  pdf.text('NUMBERED CALLOUTS (NEC REFS)', x + PAD_X, y + PAD_Y - 1)

  // Body — 2 columns, 5 rows in column 1, 4 in column 2.
  pdf.setFont(fontName, 'normal')
  pdf.setFontSize(BODY_SIZE_PT)
  pdf.setTextColor(...NEAR_BLACK)

  const colW = (w - PAD_X * 2) / 2
  const col1X = x + PAD_X
  const col2X = x + PAD_X + colW
  const bodyY0 = y + PAD_Y + 6
  const splitAt = 5

  TYSON_CALLOUTS_PV5.forEach((c, i) => {
    const inCol1 = i < splitAt
    const cx = inCol1 ? col1X : col2X
    const cy = bodyY0 + (inCol1 ? i : i - splitAt) * LINE_GAP

    // Small numbered circle — number rendered with baseline:'middle' so
    // the digit sits visually centered on the circle's center y.
    const circleCx = cx + 2.5
    const circleCy = cy - 1.5
    pdf.setDrawColor(...NEAR_BLACK)
    pdf.setFillColor(255, 255, 255)
    pdf.setLineWidth(0.5)
    pdf.circle(circleCx, circleCy, 2.2, 'FD')
    pdf.setFont(fontName, 'bold')
    pdf.setFontSize(4)
    pdf.setTextColor(...NEAR_BLACK)
    pdf.text(String(c.number), circleCx, circleCy, {
      align: 'center',
      baseline: 'middle',
    })

    // NEC ref (bold)
    pdf.setFont(fontName, 'bold')
    pdf.setTextColor(...MUTED)
    pdf.text(c.nec, cx + 7, cy)

    // Plain-English note (regular) — body sits a full line-height below
    // the ref, with sane truncation given the wider column.
    pdf.setFont(fontName, 'normal')
    pdf.setTextColor(...NEAR_BLACK)
    const charsPerCol = 56
    const truncated = c.text.length > charsPerCol ? c.text.slice(0, charsPerCol - 3) + '...' : c.text
    pdf.text(truncated, cx + 7, cy + NEC_TO_BODY_GAP)
  })
}
