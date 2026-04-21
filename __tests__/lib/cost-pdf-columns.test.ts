// __tests__/lib/cost-pdf-columns.test.ts
//
// Source-level guard on lib/cost/pdf.tsx — Paul's 2026-04-21 feedback was that
// the basis report was reading as raw cost instead of fully loaded cost. We
// dropped the Raw + K columns from the PDF and renamed the EPC Price column
// to "Fully Loaded Cost". These assertions pin that so a future refactor
// can't silently re-introduce the raw column.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

const PDF_SRC = readFileSync(resolve(__dirname, '../../lib/cost/pdf.tsx'), 'utf8')

describe('cost basis PDF columns', () => {
  it('does not render the Raw column header', () => {
    // Header cell was: <Text style={[styles.tableHeaderCell, styles.cellRaw]}>Raw</Text>
    expect(PDF_SRC).not.toMatch(/styles\.cellRaw\]\s*}\s*>\s*Raw\s*<\/Text>/)
  })

  it('does not render the K (markup) column header', () => {
    expect(PDF_SRC).not.toMatch(/styles\.cellMarkup\]\s*}\s*>\s*K\s*<\/Text>/)
  })

  it('does not render raw_cost or markup_to_distro in row cells', () => {
    expect(PDF_SRC).not.toMatch(/fmtMoney\(li\.raw_cost\)/)
    expect(PDF_SRC).not.toMatch(/fmtMarkupX\(li\.markup_to_distro\)/)
  })

  it('leads the money columns with "Fully Loaded Cost"', () => {
    expect(PDF_SRC).toMatch(/>\s*Fully Loaded Cost\s*</)
  })

  it('still renders battery / PV / basis columns', () => {
    expect(PDF_SRC).toMatch(/fmtMoney\(li\.battery_cost\)/)
    expect(PDF_SRC).toMatch(/fmtMoney\(li\.pv_cost\)/)
    expect(PDF_SRC).toMatch(/li\.basis_eligibility/)
  })
})
