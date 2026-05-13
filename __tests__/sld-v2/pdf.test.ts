// Phase 5 verification — renderSldToPdf produces a valid single-page ANSI B
// PDF with selectable text. Uses the same Tyson-topology stub the HTML
// harnesses use.
//
// Runs under the default jsdom env. svg2pdf.js's text measurement reaches
// for canvas.getContext('2d'); jsdom auto-integrates with the `canvas`
// npm package (installed). pdf.ts itself runs against svgdom in
// production (Next.js API route, no DOM); the canvas-via-svgdom stub
// inside pdf.ts handles that path.

import { describe, it, expect, vi } from 'vitest'

// Spy on the Inter ttf loader so we can assert it is NEVER invoked from
// the default-options render path. The Phase 7b font-gating contract is
// that titleBlock presence is the ONLY trigger for Inter registration;
// regression catch for a future "always-call" refactor that would re-
// break the Phase 5 NEC 690.12 strings-grep assertion. Closes #1024.
vi.mock('../../lib/sld-v2/fonts/inter-loader', async () => {
  const actual = await vi.importActual<
    typeof import('../../lib/sld-v2/fonts/inter-loader')
  >('../../lib/sld-v2/fonts/inter-loader')
  return {
    ...actual,
    loadInterTtfBase64: vi.fn(actual.loadInterTtfBase64),
    loadInterBoldTtfBase64: vi.fn(actual.loadInterBoldTtfBase64),
  }
})

import { buildPlansetData, type PlansetData } from '../../lib/planset-types'
import { equipmentGraphFromPlansetData } from '../../lib/sld-v2/from-planset-data'
import { renderSldToPdf } from '../../lib/sld-v2/pdf'
import {
  loadInterTtfBase64,
  loadInterBoldTtfBase64,
} from '../../lib/sld-v2/fonts/inter-loader'
import type { Project } from '../../types/database'

const project = {
  id: 'PROJ-DEMO',
  name: 'Demo Hybrid Install',
  address: '123 Main St',
  city: 'Houston',
  state: 'TX',
  zip: '77073',
  utility: 'CenterPoint Energy',
  meter_number: '00 000 000',
  esid: '10000000000000000000',
  ahj: 'City of Houston',
  voltage: '120/240V',
  msp_bus_rating: '225',
  main_breaker: '125',
  module_qty: 20,
  module: 'Seraphim SRP-440-BTD-BG',
  battery_qty: 16,
  inverter_qty: 2,
  inverter: 'Duracell Power Center Max Hybrid 15kW',
} as unknown as Project

const data: PlansetData = buildPlansetData(project, {
  inverterCount: 2,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterAcPower: 15,
  batteryCount: 16,
  batteriesPerStack: 8,
})

const TIMEOUT_MS = 10_000

describe('renderSldToPdf', () => {
  it(
    'produces a single-page ANSI B PDF with selectable NEC text',
    async () => {
      const graph = equipmentGraphFromPlansetData(data)
      const bytes = await renderSldToPdf(graph)

      // 1. PDF signature header.
      expect(bytes.byteLength).toBeGreaterThan(0)
      const header = new TextDecoder().decode(bytes.slice(0, 8))
      expect(header.startsWith('%PDF-1.')).toBe(true)

      // 2. Positive-content lower bound + < 200 KB upper bound.
      //    Empty-page jsPDFs are ~3 KB. A real Tyson SLD with text labels
      //    is typically 10-80 KB with built-in Helvetica.
      expect(bytes.byteLength).toBeGreaterThan(8_000)
      expect(bytes.byteLength).toBeLessThan(200 * 1024)

      // 3. ANSI B landscape page dimensions = 1224 × 792 pt.
      //    jsPDF emits the MediaBox as "/MediaBox [0 0 1224. 792.]"
      //    (trailing-dot decimal pretty-print). Allow optional fraction.
      const text = new TextDecoder('latin1').decode(bytes)
      expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+1224\.?\d*\s+792\.?\d*\s*\]/)

      // 4. Page-count assertion (R1-M3 stiffened + L-tightened in R2).
      //    Prefer the canonical /Pages catalog `/Count N` — but anchor the
      //    regex to the dict's closing `>>` so we can't match a /Count
      //    that belongs to a sibling catalog ref further in the stream.
      //    Falls back to the old singular-Page-object assertion only if
      //    /Count can't be located (jsPDF formatting variance protection).
      const countMatch = text.match(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)[^>]*?>>/)
      if (countMatch) {
        expect(Number(countMatch[1])).toBe(1)
      } else {
        const pageMatches = text.match(/\/Type\s*\/Page\b(?!s)/g) ?? []
        expect(pageMatches.length).toBe(1)
      }

      // 5. NEC text grep (R1-M4 stiffened). Tolerates jsPDF text-split
      //    that breaks the NEC string across multiple Tj operators on
      //    whitespace or open-paren. C1 fix — was "NEC 705.13", which
      //    isn't emitted; switched to "NEC 690.12" (RSD label, always
      //    present in the Duracell-hybrid topology). PDF escapes parens
      //    so "NEC 690.12(A)" appears in the bytes as "NEC 690.12\(A\)".
      //    L-tightened: require at least one whitespace/paren between NEC
      //    and the article number — `NEC690.12` is not a shape jsPDF emits.
      const necMatches = text.match(/NEC[\s(]+690\.12/g) ?? []
      expect(necMatches.length).toBeGreaterThanOrEqual(1)
    },
    TIMEOUT_MS,
  )

  it(
    'module-load smoke test — pdf.ts imports cleanly under Node test env',
    async () => {
      const mod = await import('../../lib/sld-v2/pdf')
      expect(typeof mod.renderSldToPdf).toBe('function')
    },
    TIMEOUT_MS,
  )

  it(
    'does NOT load Inter ttf when titleBlock is absent (#1024 regression catch)',
    async () => {
      const regularSpy = vi.mocked(loadInterTtfBase64)
      const boldSpy = vi.mocked(loadInterBoldTtfBase64)
      regularSpy.mockClear()
      boldSpy.mockClear()
      const graph = equipmentGraphFromPlansetData(data)
      await renderSldToPdf(graph)
      // Default-options path stays on Helvetica + WinAnsi so the
      // NEC 690.12 strings-grep assertion in the Phase 5 test above
      // continues to work. If a future refactor unconditionally
      // registers Inter, this assertion catches it.
      expect(regularSpy).not.toHaveBeenCalled()
      expect(boldSpy).not.toHaveBeenCalled()
    },
    TIMEOUT_MS,
  )

  it(
    'loads Inter Regular AND Bold when titleBlock IS present (H1 typography prep)',
    async () => {
      const regularSpy = vi.mocked(loadInterTtfBase64)
      const boldSpy = vi.mocked(loadInterBoldTtfBase64)
      regularSpy.mockClear()
      boldSpy.mockClear()
      const graph = equipmentGraphFromPlansetData(data)
      await renderSldToPdf(graph, {
        titleBlock: { data, sheetName: 'Single Line Diagram', sheetNumber: 'PV-5' },
      })
      // Both ttfs MUST be loaded — atomic-pair guarantee in pdf.ts. If a
      // future refactor only loads Regular and tries to setFont('Inter','bold')
      // without registering the Bold variant, jsPDF emits a warning and falls
      // back unpredictably. This assertion catches that regression.
      expect(regularSpy).toHaveBeenCalledTimes(1)
      expect(boldSpy).toHaveBeenCalledTimes(1)
    },
    TIMEOUT_MS,
  )

  it(
    'BOTH Inter Regular and Inter Bold embedded in PDF when titleBlock present',
    async () => {
      const graph = equipmentGraphFromPlansetData(data)
      const bytes = await renderSldToPdf(graph, {
        titleBlock: { data, sheetName: 'Single Line Diagram', sheetNumber: 'PV-5' },
      })
      // jsPDF identifies registered TrueType fonts by their postscript family
      // name in the FontDescriptor — both 'normal' and 'bold' variants of
      // Inter use the family name "Inter". Each variant has its own
      // FontDescriptor block, so the dictionary contains exactly TWO
      // `/FontName /Inter` entries when both variants are registered.
      // Built-in Helvetica/Courier/Times are Type 1 standard fonts (not
      // embedded as TrueType), so they have NO FontFile2 reference — we
      // also assert exactly two FontFile2 blocks, one per embedded ttf.
      const text = new TextDecoder('latin1').decode(bytes)
      const interFontNames = text.match(/\/FontName\s+\/Inter\b/g) ?? []
      expect(interFontNames.length).toBe(2)
      const fontFile2Refs = text.match(/\/FontFile2\s+\d+\s+0\s+R/g) ?? []
      expect(fontFile2Refs.length).toBe(2)
    },
    TIMEOUT_MS,
  )

  it(
    'Unicode customer names render WITHOUT lossy transliteration when Inter is registered',
    async () => {
      // Unicode test — owner name "Charles Peña" should NOT be sanitized to
      // "Charles Pena" when Inter is registered (unicodeSafe=true path).
      const unicodeProject = { ...project, name: 'Charles Peña' } as Project
      const unicodeData = buildPlansetData(unicodeProject, {
        inverterCount: 2,
        inverterModel: 'Duracell Power Center Max Hybrid 15kW',
        inverterAcPower: 15,
        batteryCount: 16,
        batteriesPerStack: 8,
      })
      const graph = equipmentGraphFromPlansetData(unicodeData)
      const bytes = await renderSldToPdf(graph, {
        titleBlock: { data: unicodeData, sheetName: 'Single Line Diagram', sheetNumber: 'PV-5' },
      })
      // PDF byte-grep for the lossy "Pena" form. With Inter registered
      // (unicodeSafe=true), the sanitizer is bypassed and "Pena" should
      // NOT appear — the painter passes "Peña" through unchanged.
      // We can't grep for "Peña" directly in the CID-encoded font stream,
      // but we CAN catch the regression of the sanitizer firing when it
      // shouldn't.
      //
      // Note: "Pena" CAN appear in 5-char ASCII Tj operators outside the
      // Inter font block (e.g. inside resource catalog, metadata, etc.),
      // so we restrict the grep to plain Tj operators with parens —
      // jsPDF's title-block paint emits `(Charles Pena) Tj` under
      // Helvetica fallback. Restricting the regex to that shape avoids
      // false positives.
      const text = new TextDecoder('latin1').decode(bytes)
      expect(text).not.toMatch(/\(Charles Pena\)\s*Tj/)
    },
    TIMEOUT_MS,
  )
})
