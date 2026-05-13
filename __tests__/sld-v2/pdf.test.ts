// Phase 5 verification — renderSldToPdf produces a valid single-page ANSI B
// PDF with selectable text. Uses the same Tyson-topology stub the HTML
// harnesses use.
//
// Runs under the default jsdom env. svg2pdf.js's text measurement reaches
// for canvas.getContext('2d'); jsdom auto-integrates with the `canvas`
// npm package (installed). pdf.ts itself runs against svgdom in
// production (Next.js API route, no DOM); the canvas-via-svgdom stub
// inside pdf.ts handles that path.

import { describe, it, expect } from 'vitest'

import { buildPlansetData, type PlansetData } from '../../lib/planset-types'
import { equipmentGraphFromPlansetData } from '../../lib/sld-v2/from-planset-data'
import { renderSldToPdf } from '../../lib/sld-v2/pdf'
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

      // 4. Page-count assertion: exactly one "/Type /Page " (singular Page
      //    object, NOT /Pages catalog). Tolerate any whitespace.
      const pageMatches = text.match(/\/Type\s*\/Page\b(?!s)/g) ?? []
      expect(pageMatches.length).toBe(1)

      // 5. NEC text grep (C1 fix — was "NEC 705.13", which isn't emitted).
      //    The RSD label emits "NEC 690.12(A)" reliably; the MSP busbar
      //    label emits "NEC 705.12(B)". Either proves text-selectability.
      //    jsPDF default output is uncompressed so ASCII text content
      //    appears as plain bytes inside (...) Tj operators. Note PDF
      //    escapes parens, so "NEC 690.12(A)" appears as "NEC 690.12\(A\)".
      expect(text).toMatch(/NEC\s*690\.12/)
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
})
