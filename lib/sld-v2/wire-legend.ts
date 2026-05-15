// Phase H8 polish — wire color legend block.
//
// Now that we render 3-line color-coded conductors (L1 red / L2 black /
// N white-gray) for AC edges + 2-line splits for DC + dashed purple for
// comm + green for ground, an AHJ-readable color key on the sheet
// chrome eliminates ambiguity. Mirrors the jsPDF native paint style
// used by installer-notes.ts and callout-legend.ts.

import type { jsPDF } from 'jspdf'

export const WIRE_LEGEND_HEIGHT_PT = 60
export const WIRE_LEGEND_WIDTH_PT = 130

interface PaintOptions {
  fontName?: string
}

const TITLE_SIZE_PT = 6
const BODY_SIZE_PT = 4.5
const ROW_GAP = 6.5
const PAD_X = 4
const PAD_Y = 8
const NEAR_BLACK: [number, number, number] = [17, 17, 17]
const RED: [number, number, number] = [180, 0, 0]

interface WireKey {
  label: string
  /** Stroke color (CSS hex without #). */
  color: [number, number, number]
  dashed?: boolean
}

const KEYS: WireKey[] = [
  { label: 'L1 — Line 1 (hot)', color: [220, 38, 38] },
  { label: 'L2 — Line 2 (hot)', color: [17, 17, 17] },
  { label: 'N — Neutral', color: [156, 163, 175] },
  { label: 'G / GEC — Ground', color: [22, 163, 74] },
  { label: 'Comm (CAT-6 / CAN)', color: [126, 34, 206], dashed: true },
  { label: 'DC + / DC −', color: [220, 38, 38] },
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

  const bodyY0 = y + PAD_Y + 5
  const stripeX = x + PAD_X
  const stripeLen = 14

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
