// Phase H8 polish — wire color legend block.
//
// Now that we render 3-line color-coded conductors (L1 red / L2 black /
// N white-gray) for AC edges + 2-line splits for DC + dashed purple for
// comm + green for ground, an AHJ-readable color key on the sheet
// chrome eliminates ambiguity. Mirrors the jsPDF native paint style
// used by installer-notes.ts and callout-legend.ts.

import type { jsPDF } from 'jspdf'

// H11 Pass-7 — bumped from 130×60 / TITLE=6 / BODY=4.5 / ROW_GAP=6.5
// / stripeLen=14 so the legend is print-readable on the RUSH stamp page.
// Available canvas at the bottom-right strip (after installer-notes +
// callout-legend) is ~397pt before the title-block edge; using 220 leaves
// generous buffer.
//
// Phase H12 Pass-10 — bumped 80→92 to accommodate split DC+/DC− rows
// (was a single "DC + / DC −" row painted with a single red stripe — but
// in the SLD body DC + renders red and DC − renders black per
// MULTI_LINE_PHASES, so the legend's single-color stripe misrepresented
// the actual rendering convention).
export const WIRE_LEGEND_HEIGHT_PT = 92
export const WIRE_LEGEND_WIDTH_PT = 220

interface PaintOptions {
  fontName?: string
}

const TITLE_SIZE_PT = 8
const BODY_SIZE_PT = 6.5
const ROW_GAP = 9.5
const PAD_X = 5
const PAD_Y = 10
const NEAR_BLACK: [number, number, number] = [17, 17, 17]
const RED: [number, number, number] = [180, 0, 0]

interface WireKey {
  label: string
  /** Stroke color (CSS hex without #). */
  color: [number, number, number]
  dashed?: boolean
}

// Phase H12 Pass-10 — split DC + and DC − so the legend matches what the
// renderer actually paints (MULTI_LINE_PHASES draws DC + in red and DC −
// in black; a single combined row was misrepresenting that). Order
// follows the AC-then-DC progression an AHJ reviewer expects.
const KEYS: WireKey[] = [
  { label: 'L1 — Line 1 (AC hot)', color: [220, 38, 38] },
  { label: 'L2 — Line 2 (AC hot)', color: [17, 17, 17] },
  { label: 'N — Neutral', color: [156, 163, 175] },
  { label: 'G / GEC — Ground', color: [22, 163, 74] },
  { label: 'Comm (CAT-6 / CAN)', color: [126, 34, 206], dashed: true },
  { label: 'DC + — Positive', color: [220, 38, 38] },
  { label: 'DC − — Negative', color: [17, 17, 17] },
]

export function paintWireLegend(
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  options: PaintOptions = {},
): void {
  const fontName = options.fontName ?? 'helvetica'

  pdf.setDrawColor(...NEAR_BLACK)
  pdf.setLineWidth(0.6)
  pdf.rect(x, y, w, h)

  pdf.setFont(fontName, 'bold')
  pdf.setFontSize(TITLE_SIZE_PT)
  pdf.setTextColor(...RED)
  pdf.text('WIRE COLOR LEGEND', x + PAD_X, y + PAD_Y - 1)

  pdf.setFont(fontName, 'normal')
  pdf.setFontSize(BODY_SIZE_PT)
  pdf.setTextColor(...NEAR_BLACK)

  // Title is now TITLE_SIZE_PT=8 (was 6 pre-Pass-7); body must start
  // below the title's descent or the first row overlaps the title.
  const bodyY0 = y + PAD_Y + 11
  const stripeX = x + PAD_X
  const stripeLen = 22

  KEYS.forEach((k, i) => {
    const cy = bodyY0 + i * ROW_GAP
    pdf.setDrawColor(...k.color)
    pdf.setLineWidth(1.2)
    if (k.dashed) pdf.setLineDashPattern([1.5, 1], 0)
    pdf.line(stripeX, cy - 1, stripeX + stripeLen, cy - 1)
    if (k.dashed) pdf.setLineDashPattern([], 0)

    pdf.setTextColor(...NEAR_BLACK)
    pdf.setFont(fontName, 'normal')
    pdf.text(k.label, stripeX + stripeLen + 3, cy)
  })
}
