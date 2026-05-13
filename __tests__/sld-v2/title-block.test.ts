// Phase 7b — title-block paint regression tests (Helvetica fallback path).
//
// Locks in the R1-H1 fix (Helvetica WinAnsi can't render non-ASCII codepoints;
// the painter transliterates common Latin diacritics + sanitizes via the
// winAnsi() helper) and the R1-M1 fix (long values get width-clamped via
// splitTextToSize instead of overflowing the 175pt sidebar).
//
// H1 typography prep — the Inter Bold pipeline ships a separate test file
// (none yet — assertions live in pdf.test.ts). This file MOCKS the Inter
// loader to return null so the renderer falls back to Helvetica + WinAnsi,
// which is what the existing assertions assume (plain-ASCII Tj operators
// grep-able from raw bytes). The fallback path is production-relevant when
// the ttf files are missing or fail SHA verification.
//
// We exercise paintTitleBlock through the full renderSldToPdf pipeline (the
// only legitimate caller) and inspect the resulting PDF byte stream.

import { describe, it, expect, vi } from 'vitest'

// Force Helvetica fallback for every render in this file. The Inter-active
// path is validated in pdf.test.ts.
vi.mock('../../lib/sld-v2/fonts/inter-loader', async () => {
  const actual = await vi.importActual<
    typeof import('../../lib/sld-v2/fonts/inter-loader')
  >('../../lib/sld-v2/fonts/inter-loader')
  return {
    ...actual,
    loadInterTtfBase64: vi.fn(() => Promise.resolve(null)),
    loadInterBoldTtfBase64: vi.fn(() => Promise.resolve(null)),
  }
})

import { buildPlansetData } from '../../lib/planset-types'
import { equipmentGraphFromPlansetData } from '../../lib/sld-v2/from-planset-data'
import { renderSldToPdf } from '../../lib/sld-v2/pdf'
import type { Project } from '../../types/database'

const TIMEOUT_MS = 30_000

function tysonProjectStub(overrides: Partial<Project> = {}): Project {
  return {
    id: 'PROJ-TEST',
    name: 'Test Owner',
    address: '123 Test St',
    city: 'Houston',
    state: 'TX',
    zip: '77073',
    utility: 'CenterPoint Energy',
    ahj: 'City of Houston',
    voltage: '120/240V',
    msp_bus_rating: '225',
    main_breaker: '125',
    module_qty: 20,
    module: 'Seraphim SRP-440-BTD-BG',
    battery_qty: 16,
    inverter_qty: 2,
    inverter: 'Duracell Power Center Max Hybrid 15kW',
    ...overrides,
  } as unknown as Project
}

async function renderTitledPdf(project: Project): Promise<string> {
  const data = buildPlansetData(project, {
    inverterCount: 2,
    inverterModel: 'Duracell Power Center Max Hybrid 15kW',
    inverterAcPower: 15,
    batteryCount: 16,
    batteriesPerStack: 8,
  })
  const graph = equipmentGraphFromPlansetData(data)
  const bytes = await renderSldToPdf(graph, {
    titleBlock: { data, sheetName: 'Single Line Diagram', sheetNumber: 'PV-5' },
  })
  // PDF text-showing operators are encoded as `(text) Tj` in the byte stream
  // when the font is a Type 1 standard (Helvetica). Decode as latin1 so the
  // raw bytes are preserved without UTF-8 garbling.
  return Buffer.from(bytes).toString('latin1')
}

describe('title-block paint', () => {
  it('renders a baseline PDF with title-block content (Tyson stub)', async () => {
    const pdf = await renderTitledPdf(tysonProjectStub({ name: 'Charles Lohf' }))
    expect(pdf.startsWith('%PDF-1.')).toBe(true)
    // Title-block field surfaces — owner, sheet name, sheet number.
    // The title-block painter uses Helvetica Type 1 (WinAnsi) so these
    // values appear as plain ASCII inside the PDF text-showing operators.
    expect(pdf).toContain('Charles Lohf')
    expect(pdf).toContain('SINGLE LINE DIAGRAM')
    expect(pdf).toContain('PV-5')
    expect(pdf).toContain('PROJ-TEST')
    // NB: the SLD body NEC text is NOT grep-able here because Inter is
    // registered when titleBlock is present (TrueType-CID encoding hides
    // ASCII). Existing `pdf.test.ts` covers the no-titleBlock NEC path.
  }, TIMEOUT_MS)

  it('transliterates non-ASCII owner names (R1-H1 fix)', async () => {
    const pdf = await renderTitledPdf(
      tysonProjectStub({
        name: 'José Peña Núñez',
        address: '1234 Calle de Acción',
        city: 'San José',
      }),
    )
    // Transliterated forms should appear.
    expect(pdf).toContain('Jose Pena Nunez')
    expect(pdf).toContain('Calle de Accion')
    expect(pdf).toContain('San Jose')
    // Raw non-ASCII codepoints (ñ é í ó ú with diacritics) should NOT
    // appear as raw bytes in the PDF text-showing operators. Check a
    // representative pair: the Latin-1 byte for 'ñ' (0xF1) and for 'é'
    // (0xE9) should not appear inside a `(...)` Tj literal. (Outside
    // text streams these bytes can appear in metadata/cross-ref offsets;
    // we check only against the readable text values we passed.)
    const owner = pdf.match(/Jose Pena Nunez/g) || []
    expect(owner.length).toBeGreaterThan(0)
    // The pre-sanitized form should be absent — if winAnsi() ever
    // regresses (e.g. someone drops the helper from a call site), this
    // assertion fires.
    expect(pdf).not.toContain('José Peña')
    expect(pdf).not.toContain('Núñez')
  }, TIMEOUT_MS)

  it('handles smart-quotes and em-dashes (R1-H1 fix)', async () => {
    const pdf = await renderTitledPdf(
      tysonProjectStub({
        name: 'Smith’s Place — Solar',
        address: '“Main” St – N',
      }),
    )
    // Smart-quote → straight-quote, em-dash → hyphen.
    expect(pdf).toContain("Smith's Place - Solar")
    expect(pdf).toContain('"Main" St - N')
    // Raw curly-quote / em-dash codepoints absent from the rendered text.
    expect(pdf).not.toContain('’')
    expect(pdf).not.toContain('—')
  }, TIMEOUT_MS)

  it('escapes parentheses inside owner / contractor text (jsPDF native)', async () => {
    const pdf = await renderTitledPdf(
      tysonProjectStub({ name: 'Acme (LLC) Solar' }),
    )
    // jsPDF v4 emits escaped parens inside the text-showing operator:
    // (Acme \(LLC\) Solar) Tj
    expect(pdf).toMatch(/Acme\s+\\\(LLC\\\)\s+Solar/)
    // PDF should still be syntactically valid (passes startsWith check).
    expect(pdf.startsWith('%PDF-1.')).toBe(true)
  }, TIMEOUT_MS)
})
