// @vitest-environment node
// pdf-lib's type detection (Uint8Array vs Buffer vs ArrayBuffer) breaks under
// jsdom because jsdom polyfills the global TypedArray prototypes. Force the
// node environment for this file — it doesn't need DOM APIs anyway.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { mergePlansetWithCutSheets, type CutSheetEntry } from '@/lib/planset/pdf-merge'

// Build small in-memory PDFs for the test fixture. pdf-lib supports
// creating PDFs from scratch, so we don't need binary blobs on disk.

async function makeFixturePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792]) // 8.5" x 11" portrait
  }
  return doc.save()
}

let cutSheetsDir: string

beforeAll(async () => {
  cutSheetsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-merge-test-'))
  // Two valid cut sheets + one will-be-missing.
  await fs.writeFile(path.join(cutSheetsDir, 'a.pdf'), await makeFixturePdf(2))
  await fs.writeFile(path.join(cutSheetsDir, 'b.pdf'), await makeFixturePdf(1))
  // Plus one corrupt file.
  await fs.writeFile(path.join(cutSheetsDir, 'corrupt.pdf'), 'not a real pdf')
})

afterAll(async () => {
  if (cutSheetsDir) await fs.rm(cutSheetsDir, { recursive: true, force: true })
})

describe('mergePlansetWithCutSheets', () => {
  it('appends cut-sheet pages after the planset pages in order', async () => {
    const planset = await makeFixturePdf(10) // pretend the planset is 10 pages
    const entries: CutSheetEntry[] = [
      { sheetId: 'PV-9', filename: 'a.pdf', title: 'Cut A' },
      { sheetId: 'PV-10', filename: 'b.pdf', title: 'Cut B' },
    ]
    const result = await mergePlansetWithCutSheets(planset, entries, cutSheetsDir)

    // Diagnose merged/skipped FIRST so a failure on these surfaces the
    // cause before the page-count assert masks it.
    expect(result.skipped, JSON.stringify(result.skipped)).toEqual([])
    expect(result.merged).toEqual(['a.pdf', 'b.pdf'])
    const out = await PDFDocument.load(result.bytes)
    expect(out.getPageCount()).toBe(10 + 2 + 1) // 10 planset + 2 (a.pdf) + 1 (b.pdf)
  })

  it('skips missing files without failing the whole merge', async () => {
    const planset = await makeFixturePdf(5)
    const entries: CutSheetEntry[] = [
      { sheetId: 'PV-9', filename: 'a.pdf', title: 'Cut A' },
      { sheetId: 'PV-11', filename: 'does-not-exist.pdf', title: 'Cut C' },
    ]
    const result = await mergePlansetWithCutSheets(planset, entries, cutSheetsDir)

    const out = await PDFDocument.load(result.bytes)
    // 5 planset + 2 from a.pdf, missing one is skipped.
    expect(out.getPageCount()).toBe(5 + 2)
    expect(result.merged).toEqual(['a.pdf'])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].filename).toBe('does-not-exist.pdf')
    expect(result.skipped[0].reason).toMatch(/not found/i)
  })

  it('skips corrupt PDFs without failing', async () => {
    const planset = await makeFixturePdf(3)
    const entries: CutSheetEntry[] = [
      { sheetId: 'PV-bad', filename: 'corrupt.pdf', title: 'Cut Bad' },
      { sheetId: 'PV-9', filename: 'a.pdf', title: 'Cut A' },
    ]
    const result = await mergePlansetWithCutSheets(planset, entries, cutSheetsDir)

    const out = await PDFDocument.load(result.bytes)
    // 3 planset + 2 from a.pdf, corrupt one is skipped.
    expect(out.getPageCount()).toBe(3 + 2)
    expect(result.merged).toEqual(['a.pdf'])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].filename).toBe('corrupt.pdf')
    expect(result.skipped[0].reason).toMatch(/load failed|corrupt/i)
  })

  it('refuses path-traversal entries', async () => {
    const planset = await makeFixturePdf(2)
    const entries: CutSheetEntry[] = [
      { sheetId: 'PV-evil', filename: '../../etc/passwd', title: 'attack' },
    ]
    const result = await mergePlansetWithCutSheets(planset, entries, cutSheetsDir)

    // Skipped, not crashed; output is the planset alone.
    const out = await PDFDocument.load(result.bytes)
    expect(out.getPageCount()).toBe(2)
    expect(result.merged).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toMatch(/escapes/i)
  })

  it('returns valid PDF bytes when cut-sheet list is empty', async () => {
    const planset = await makeFixturePdf(7)
    const result = await mergePlansetWithCutSheets(planset, [], cutSheetsDir)

    const out = await PDFDocument.load(result.bytes)
    expect(out.getPageCount()).toBe(7)
    expect(result.merged).toEqual([])
    expect(result.skipped).toEqual([])
  })
})
