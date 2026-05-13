// Phase 7b — title block painter (mirrors v1 TitleBlockHtml.tsx, painted
// inside the v2 PDF via jsPDF native primitives: doc.text / doc.rect /
// doc.line / doc.setFillColor).
//
// SERVER-ONLY by association — only `lib/sld-v2/pdf.ts` (also server-only)
// imports this module. No DOM, no React, no expensive deps; pure jsPDF
// drawing calls.

import type { jsPDF } from 'jspdf'
import type { PlansetData } from '../planset-types'

/**
 * Width in pt of the right-sidebar title block. Subtracted from the
 * SLD body's printable width by `renderSldToPdf` so the SLD scales to
 * fit ALONGSIDE the title block instead of overlapping it.
 *
 * 175 pt ≈ 2.43" — matches the v1 right-sidebar feel (2.5" target) on
 * the ANSI B landscape 1224×792 pt page.
 */
export const TITLE_BLOCK_WIDTH_PT = 175

/** Visual gap in pt between the SLD body and the title block. */
export const TITLE_BLOCK_GAP_PT = 6

export interface TitleBlockData {
  /** PlansetData powering the v1 sidebar. Renderer plucks the fields it needs. */
  data: PlansetData
  /** Sheet name (e.g. "Single Line Diagram"). */
  sheetName: string
  /** Sheet number (e.g. "PV-5"). */
  sheetNumber: string
}

interface PaintOptions {
  /** Font family registered with jsPDF for body text. Defaults to 'helvetica'. */
  fontName?: string
}

/**
 * Paint the right-sidebar title block onto the given jsPDF document.
 *
 * Coordinate system: (x, y) is the TOP-LEFT corner of the sidebar
 * rectangle. The sidebar spans (x, y) → (x + width, y + height).
 *
 * Phase 7b stub — actual paint implementation lands in the next sub-edit.
 * The stub renders a single placeholder rectangle + a "TITLE BLOCK
 * COMING NEXT" label so the surrounding pipeline can be smoke-tested
 * end-to-end before the paint code lands.
 */
export function paintTitleBlock(
  doc: jsPDF,
  tb: TitleBlockData,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: PaintOptions = {},
): void {
  void tb
  const font = opts.fontName ?? 'helvetica'
  doc.setDrawColor(0)
  doc.setLineWidth(0.75)
  doc.rect(x, y, width, height)
  doc.setFont(font, 'normal')
  doc.setFontSize(6)
  doc.text('TITLE BLOCK (Phase 7b — paint pending)', x + 6, y + 14)
}
