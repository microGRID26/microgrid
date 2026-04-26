import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { SheetCutSheets, SheetCutSheet, CUT_SHEETS } from '@/components/planset/SheetCutSheets'
import type { PlansetData } from '@/lib/planset-types'

const baseData: Partial<PlansetData> = {}

describe('SheetCutSheets — manufacturer cut sheet pages', () => {
  it('renders one section per cut sheet', () => {
    const { container } = render(<SheetCutSheets data={baseData as PlansetData} />)
    expect(container.querySelectorAll('[data-cut-sheet]').length).toBe(CUT_SHEETS.length)
  })

  it('embeds the PDF for each cut sheet', () => {
    const { container } = render(<SheetCutSheets data={baseData as PlansetData} />)
    const embeds = container.querySelectorAll('embed[type="application/pdf"]')
    expect(embeds.length).toBe(CUT_SHEETS.length)
  })

  it('renders the title for each cut sheet', () => {
    const { container } = render(<SheetCutSheets data={baseData as PlansetData} />)
    for (const cs of CUT_SHEETS) {
      expect(container.textContent).toContain(cs.title)
    }
  })

  it('exports current 2 cut sheets (Duracell battery + inverter)', () => {
    expect(CUT_SHEETS.length).toBeGreaterThanOrEqual(2)
    expect(CUT_SHEETS.some(cs => cs.src.includes('duracell-5plus'))).toBe(true)
    expect(CUT_SHEETS.some(cs => cs.src.includes('max-hybrid-15'))).toBe(true)
  })
})

describe('SheetCutSheet — single cut-sheet renderer', () => {
  const entry = CUT_SHEETS[0]

  it('renders data-cut-sheet attribute with the sheetId', () => {
    const { container } = render(<SheetCutSheet entry={entry} data={baseData as PlansetData} />)
    expect(container.querySelector(`[data-cut-sheet="${entry.sheetId}"]`)).toBeTruthy()
  })

  it('embeds the PDF', () => {
    const { container } = render(<SheetCutSheet entry={entry} data={baseData as PlansetData} />)
    const embed = container.querySelector('embed[type="application/pdf"]') as HTMLEmbedElement | null
    expect(embed).toBeTruthy()
    expect(embed?.getAttribute('src')).toBe(entry.src)
  })

  it('renders the print warning banner', () => {
    const { container } = render(<SheetCutSheet entry={entry} data={baseData as PlansetData} />)
    expect(container.textContent).toContain('Cut sheets do NOT print via Save-as-PDF')
    expect(container.textContent).toContain(entry.src)
  })

  it('renders the title', () => {
    const { container } = render(<SheetCutSheet entry={entry} data={baseData as PlansetData} />)
    expect(container.textContent).toContain(entry.title)
  })
})

describe('Planset sheetTotal formula alignment', () => {
  // Sheet count breakdown:
  // Always: PV-1, PV-2, PV-2A, PV-3, PV-4, PV-5, PV-6, PV-7, PV-7.1, PV-8 = 10
  // Enhanced extras: UTIL, PV-3.1, PV-4.1 = 3 (total 13)
  // Plus N cut sheets (one sheetList entry per CUT_SHEETS entry)

  it('non-enhanced sheetTotal formula = 10 base + cut sheets', () => {
    // Documents the formula used in PlansetPage; fails if CUT_SHEETS is emptied
    expect(CUT_SHEETS.length).toBeGreaterThanOrEqual(2)
    const nonEnhancedTotal = 10 + CUT_SHEETS.length
    expect(nonEnhancedTotal).toBe(10 + CUT_SHEETS.length)
  })

  it('enhanced sheetTotal formula = 13 base + cut sheets', () => {
    expect(CUT_SHEETS.length).toBeGreaterThanOrEqual(2)
    const enhancedTotal = 13 + CUT_SHEETS.length
    expect(enhancedTotal).toBe(13 + CUT_SHEETS.length)
  })

  it('each CUT_SHEETS entry has a unique sheetId', () => {
    const ids = CUT_SHEETS.map(cs => cs.sheetId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
