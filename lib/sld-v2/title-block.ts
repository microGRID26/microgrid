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
  /**
   * When true, the painter trusts the font (typically 'Inter' with both
   * Regular + Bold registered) to handle Unicode codepoints natively and
   * skips the lossy WinAnsi transliteration. When false (or omitted), the
   * painter applies `winAnsi()` to every string so Helvetica Type 1
   * doesn't emit broken glyphs for accents, smart-quotes, em-dashes, etc.
   *
   * Set by `pdf.ts` based on whether Inter Regular + Bold both registered
   * successfully. RUSH-stamped output ideally goes through the
   * unicodeSafe=true branch so customer names like "Peña" render correctly.
   */
  unicodeSafe?: boolean
}

// Row heights in pt — sum to 720 (default sidebar height = page 792 − 2×36 margin).
// Mirrors v1 TitleBlockHtml's layout exactly: row 3 (PE stamp) pinned at 1.7" =
// 122.4 pt per Greg's 2026-05-01 measurement; row 10 (sheet number) absorbs the
// flex remainder.
const ROW_HEIGHTS = {
  contractor: 70,
  project: 60,
  stamp: 122,
  drawnDate: 26,
  drawnBy: 26,
  revision: 36,
  sheetSize: 26,
  ahj: 26,
  sheetName: 30,
  // sheetNumber consumes the remainder.
} as const

const PAD_X = 6
const PAD_Y_LABEL = 8
const PAD_Y_VALUE = 16
const LINE_GAP = 8.5
const LABEL_SIZE_PT = 4.5
const VALUE_SIZE_PT = 6.5
const SHEET_NAME_SIZE_PT = 7
const SHEET_NUMBER_SIZE_PT = 32
const SHEET_OF_SIZE_PT = 7
const LABEL_GRAY: [number, number, number] = [102, 102, 102]
const VALUE_NEAR_BLACK: [number, number, number] = [17, 17, 17]
const SHEET_NUMBER_GRAY_LABEL: [number, number, number] = [187, 187, 187]
const STAMP_PLACEHOLDER_GRAY: [number, number, number] = [187, 187, 187]

// R1-H1 fix — Phase 7b title-block painter uses Helvetica (Type 1 standard,
// WinAnsi encoding). Non-ASCII codepoints like ñ / é / smart-quotes / em-dash
// render as boxes/garbled glyphs in jsPDF's text-showing operator. Texas CRM
// data has plenty of Hispanic surnames (Peña, Núñez, Jiménez) that would
// produce a broken plansheet for RUSH. Sanitize every string before paint.
//
// Strategy: transliterate the common Latin diacritics + replace smart-quotes
// and dashes with their WinAnsi equivalents, then strip anything still
// outside the Latin-1 (WinAnsi) range. Reversible-looking enough that RUSH
// reviewers see a recognizable name; lossy enough to never break the PDF.
const TRANSLIT_MAP: Record<string, string> = {
  'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a',
  'Á': 'A', 'À': 'A', 'Â': 'A', 'Ä': 'A', 'Ã': 'A', 'Å': 'A', 'Ā': 'A', 'Ă': 'A',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ė': 'e', 'ę': 'e',
  'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E', 'Ē': 'E', 'Ė': 'E', 'Ę': 'E',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i',
  'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I', 'Ī': 'I',
  'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ø': 'o', 'ō': 'o',
  'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Ö': 'O', 'Õ': 'O', 'Ø': 'O', 'Ō': 'O',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ū': 'u',
  'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U', 'Ū': 'U',
  'ñ': 'n', 'Ñ': 'N',
  'ç': 'c', 'Ç': 'C',
  'ß': 'ss',
  'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE',
  '‘': "'", '’': "'", '“': '"', '”': '"', '′': "'", '″': '"',
  '–': '-', '—': '-', '‐': '-', '−': '-',
  '…': '...', ' ': ' ',
}

function winAnsi(input: string | null | undefined): string {
  if (input == null) return ''
  let out = ''
  for (const ch of input) {
    if (ch in TRANSLIT_MAP) {
      out += TRANSLIT_MAP[ch]
      continue
    }
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0x20 && cp <= 0x7E) {
      // ASCII printable range — safe.
      out += ch
    } else if (cp >= 0xA0 && cp <= 0xFF) {
      // Latin-1 supplement — WinAnsi-safe, jsPDF Helvetica handles natively.
      out += ch
    }
    // Else: drop (control char, emoji, Greek, etc.).
  }
  return out
}

interface RowCtx {
  doc: jsPDF
  font: string
  x: number
  y: number
  width: number
  height: number
  /**
   * Per-render sanitizer. When `unicodeSafe=true` is passed to paintTitleBlock,
   * this is the identity (null → ''); when false, it's `winAnsi()`. Bound at
   * paint time and threaded through every row so render correctness is
   * deterministic regardless of font choice.
   */
  sanitize: (s: string | null | undefined) => string
}

function drawRowSeparator(ctx: RowCtx): void {
  const { doc, x, y, width, height } = ctx
  doc.setDrawColor(0)
  doc.setLineWidth(0.75)
  doc.line(x, y + height, x + width, y + height)
}

function drawLabel(ctx: RowCtx, text: string): void {
  const { doc, font, x, y, sanitize } = ctx
  doc.setFont(font, 'bold')
  doc.setFontSize(LABEL_SIZE_PT)
  doc.setTextColor(...LABEL_GRAY)
  // Letter-spacing approximation: jsPDF doesn't support tracking directly;
  // the uppercase + bold + 4.5pt rendering reads as a label even without
  // explicit tracking. Matches the v1 visual hierarchy well enough for RUSH.
  doc.text(sanitize(text.toUpperCase()), x + PAD_X, y + PAD_Y_LABEL)
}

function drawValueLines(
  ctx: RowCtx,
  lines: Array<{ text: string; bold?: boolean; size?: number; color?: [number, number, number] }>,
): void {
  const { doc, font, x, y, width, sanitize } = ctx
  // R1-M1 fix — width-clamp values via splitTextToSize so long values
  // (long addresses, long contractor names) don't overflow the 175pt
  // sidebar into the SLD body. Inner width = sidebar - 2 × side padding.
  const innerWidth = width - PAD_X * 2
  let cursorY = y + PAD_Y_VALUE
  for (const line of lines) {
    doc.setFont(font, line.bold ? 'bold' : 'normal')
    doc.setFontSize(line.size ?? VALUE_SIZE_PT)
    doc.setTextColor(...(line.color ?? VALUE_NEAR_BLACK))
    const wrapped = doc.splitTextToSize(sanitize(line.text), innerWidth) as string[]
    for (const segment of wrapped) {
      doc.text(segment, x + PAD_X, cursorY)
      cursorY += LINE_GAP
    }
  }
}

/**
 * Paint the right-sidebar title block onto the given jsPDF document.
 * Mirrors the v1 TitleBlockHtml.tsx 10-row layout field-for-field so RUSH
 * sees the same sheet anatomy they're used to from the v1 plansets.
 *
 * Coordinate system: (x, y) is the TOP-LEFT corner of the sidebar
 * rectangle. The sidebar spans (x, y) → (x + width, y + height).
 *
 * Rows (top→bottom):
 *   1  CONTRACTOR              (5 lines: name bold, address, city, phone, license)
 *   2  PROJECT NAME & ADDRESS  (4 lines: owner bold, projectId, street, city/state/zip)
 *   3  ENGINEER'S STAMP        (1.7" tall fixed; dashed placeholder rectangle)
 *   4  DRAWN DATE
 *   5  DRAWN BY                (defaults to 'MicroGRID')
 *   6  REVISION                (latest rev shown; full table available via data.revisions)
 *   7  SHEET SIZE              (defaults to 'ANSI B (11"×17")')
 *   8  AHJ                     (project's authority-having-jurisdiction)
 *   9  SHEET NAME              (uppercase, slightly larger)
 *  10  SHEET NUMBER            (flex remainder; large numeral, white on black fill)
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
  const font = opts.fontName ?? 'helvetica'
  // When unicodeSafe=true (font has full Unicode coverage — typically
  // Inter Regular + Bold), skip the lossy WinAnsi transliteration so
  // "Peña" stays "Peña" instead of becoming "Pena". When false, the
  // sanitizer protects Helvetica Type 1 from glyph corruption on
  // accents, smart-quotes, em-dashes, etc.
  const sanitize: (s: string | null | undefined) => string = opts.unicodeSafe
    ? (s) => (s == null ? '' : s)
    : winAnsi
  const { data, sheetName, sheetNumber } = tb

  // Default-fill optional PlansetData fields (mirror v1's `??` fallbacks at
  // TitleBlockHtml lines 73-78 so existing fixtures don't break).
  const dataWithOpt = data as PlansetData & {
    drawnBy?: string
    sheetSize?: string
    revisions?: Array<{ rev: number; date: string; note: string }>
  }
  const drawnBy = dataWithOpt.drawnBy ?? 'MicroGRID'
  const sheetSize = dataWithOpt.sheetSize ?? 'ANSI B (11"×17")'
  const revisions =
    dataWithOpt.revisions ?? [{ rev: 0, date: data.drawnDate, note: 'Initial issue' }]
  const latestRev = revisions[revisions.length - 1]

  // Outer border.
  doc.setDrawColor(0)
  doc.setLineWidth(0.75)
  doc.rect(x, y, width, height)

  let cursorY = y

  // ── Row 1 — CONTRACTOR ─────────────────────────────────────────────
  const row1: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.contractor }
  drawLabel(row1, 'Contractor')
  drawValueLines(row1, [
    { text: data.contractor.name, bold: true },
    { text: data.contractor.address },
    { text: data.contractor.city },
    { text: `Ph: ${data.contractor.phone}` },
    { text: `Lic# ${data.contractor.license}` },
  ])
  drawRowSeparator(row1)
  cursorY += ROW_HEIGHTS.contractor

  // ── Row 2 — PROJECT NAME & ADDRESS ────────────────────────────────
  const row2: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.project }
  drawLabel(row2, 'Project Name & Address')
  drawValueLines(row2, [
    { text: data.owner ?? '—', bold: true },
    { text: data.projectId ?? '' },
    { text: data.address ?? '' },
    { text: [data.city, data.state, data.zip].filter(Boolean).join(', ') },
  ])
  drawRowSeparator(row2)
  cursorY += ROW_HEIGHTS.project

  // ── Row 3 — ENGINEER'S STAMP (1.7" fixed) ─────────────────────────
  const row3: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.stamp }
  drawLabel(row3, "Engineer's Stamp")
  // Dashed placeholder rectangle for the PE seal area.
  const stampInsetX = x + PAD_X
  const stampInsetY = cursorY + PAD_Y_VALUE - 2
  const stampW = width - PAD_X * 2
  const stampH = ROW_HEIGHTS.stamp - PAD_Y_VALUE - 4
  doc.setLineDashPattern([2, 2], 0)
  doc.setDrawColor(153, 153, 153)
  doc.setLineWidth(0.75)
  doc.rect(stampInsetX, stampInsetY, stampW, stampH)
  doc.setLineDashPattern([], 0)
  doc.setTextColor(...STAMP_PLACEHOLDER_GRAY)
  doc.setFont(font, 'normal')
  doc.setFontSize(5.5)
  // Centered placeholder text.
  const placeholderText = sanitize('PE STAMP AREA')
  const ptWidth = doc.getTextWidth(placeholderText)
  doc.text(placeholderText, stampInsetX + (stampW - ptWidth) / 2, stampInsetY + stampH / 2 + 2)
  drawRowSeparator(row3)
  cursorY += ROW_HEIGHTS.stamp

  // ── Row 4 — DRAWN DATE ─────────────────────────────────────────────
  const row4: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.drawnDate }
  drawLabel(row4, 'Drawn Date')
  drawValueLines(row4, [{ text: data.drawnDate ?? '—' }])
  drawRowSeparator(row4)
  cursorY += ROW_HEIGHTS.drawnDate

  // ── Row 5 — DRAWN BY ──────────────────────────────────────────────
  const row5: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.drawnBy }
  drawLabel(row5, 'Drawn By')
  drawValueLines(row5, [{ text: drawnBy }])
  drawRowSeparator(row5)
  cursorY += ROW_HEIGHTS.drawnBy

  // ── Row 6 — REVISION ──────────────────────────────────────────────
  const row6: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.revision }
  drawLabel(row6, 'Revision')
  const revLines: Array<{ text: string; size?: number; color?: [number, number, number] }> = [
    { text: `REV ${latestRev.rev}  ·  ${latestRev.date}` },
  ]
  if (latestRev.note) {
    revLines.push({ text: latestRev.note, size: 5.5, color: [85, 85, 85] })
  }
  drawValueLines(row6, revLines)
  drawRowSeparator(row6)
  cursorY += ROW_HEIGHTS.revision

  // ── Row 7 — SHEET SIZE ────────────────────────────────────────────
  const row7: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.sheetSize }
  drawLabel(row7, 'Sheet Size')
  drawValueLines(row7, [{ text: sheetSize }])
  drawRowSeparator(row7)
  cursorY += ROW_HEIGHTS.sheetSize

  // ── Row 8 — AHJ ───────────────────────────────────────────────────
  const row8: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.ahj }
  drawLabel(row8, 'AHJ')
  drawValueLines(row8, [{ text: data.ahj || '—' }])
  drawRowSeparator(row8)
  cursorY += ROW_HEIGHTS.ahj

  // ── Row 9 — SHEET NAME (uppercase, slightly larger) ───────────────
  const row9: RowCtx = { doc, font, x, y: cursorY, width, sanitize, height: ROW_HEIGHTS.sheetName }
  drawLabel(row9, 'Sheet Name')
  drawValueLines(row9, [
    { text: sheetName.toUpperCase(), bold: true, size: SHEET_NAME_SIZE_PT },
  ])
  drawRowSeparator(row9)
  cursorY += ROW_HEIGHTS.sheetName

  // ── Row 10 — SHEET NUMBER (flex remainder, black fill, white text) ─
  const row10Height = y + height - cursorY
  // Black fill background.
  doc.setFillColor(0, 0, 0)
  doc.rect(x, cursorY, width, row10Height, 'F')
  // Label — small gray.
  doc.setFont(font, 'bold')
  doc.setFontSize(LABEL_SIZE_PT)
  doc.setTextColor(...SHEET_NUMBER_GRAY_LABEL)
  doc.text(sanitize('SHEET NUMBER'), x + PAD_X + 4, cursorY + 14)
  // Large numeral. Sanitize even though the typical value is 'PV-5'
  // (pure ASCII) — defensive in case a future caller passes a Unicode
  // glyph in the sheet number (and harmless under unicodeSafe).
  const safeNumber = sanitize(sheetNumber)
  doc.setFont(font, 'bold')
  doc.setFontSize(SHEET_NUMBER_SIZE_PT)
  doc.setTextColor(255, 255, 255)
  doc.text(safeNumber, x + PAD_X + 4, cursorY + row10Height / 2 + 14)
  // "of N" small.
  const sheetTotalRaw = (data as PlansetData & { sheetTotal?: string | number }).sheetTotal
  const sheetTotal = sheetTotalRaw != null ? sanitize(String(sheetTotalRaw)) : ''
  if (sheetTotal) {
    doc.setFont(font, 'normal')
    doc.setFontSize(SHEET_OF_SIZE_PT)
    doc.setTextColor(...SHEET_NUMBER_GRAY_LABEL)
    const numeralWidth = doc.getTextWidth(safeNumber) + 8
    doc.text(`of ${sheetTotal}`, x + PAD_X + 4 + numeralWidth, cursorY + row10Height / 2 + 14)
  }
}
