// Server-side PDF merge: planset puppeteer render + static cut-sheet PDFs.
// Pure helper, unit-testable. Called by app/api/planset/[projectId]/pdf/route.ts.
//
// Closes greg_actions #332 (planset full-PDF server route) and the
// follow-on gap from #323 (server-side cut-sheet merge).

import fs from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

export interface CutSheetEntry {
  /** Sheet id displayed in the planset, e.g. "PV-9". */
  sheetId: string
  /** Filename relative to the cut-sheets dir, e.g. "duracell-5plus.pdf". */
  filename: string
  /** Human-readable title — not used by the merge itself, kept for parity
   * with the static CUT_SHEETS shape in SheetCutSheets.tsx. */
  title: string
}

export interface MergeResult {
  bytes: Uint8Array
  /** Filenames whose PDFs were appended successfully. */
  merged: string[]
  /** Filenames that were skipped because the file was missing or invalid.
   * Caller logs these; the merge does not fail the request. */
  skipped: { filename: string; reason: string }[]
}

/**
 * Merge a freshly-rendered planset PDF buffer with the active static
 * cut-sheet PDFs from disk, in the order given.
 *
 * Behavior:
 *  - Each cut-sheet file is `fs.readFile`'d from `cutSheetsDir`. Missing
 *    files (`ENOENT`) are skipped + reported via `skipped`; corrupt PDFs
 *    (load failure) likewise. The merge always returns a valid PDF
 *    containing at minimum the planset pages.
 *  - Cut sheets are appended in the order of `cutSheetEntries`. The static
 *    CUT_SHEETS array in `components/planset/SheetCutSheets.tsx` is the
 *    canonical source of order.
 *  - Page size is preserved per-source. The planset is 17×11 landscape;
 *    cut sheets are typically 8.5×11 portrait. PDF viewers handle the mix.
 */
export async function mergePlansetWithCutSheets(
  plansetPdfBytes: Uint8Array,
  cutSheetEntries: CutSheetEntry[],
  cutSheetsDir: string = path.join(process.cwd(), 'public', 'cut-sheets'),
): Promise<MergeResult> {
  const merged: string[] = []
  const skipped: MergeResult['skipped'] = []

  const mergedDoc = await PDFDocument.load(plansetPdfBytes)

  for (const entry of cutSheetEntries) {
    const filename = entry.filename
    let cutSheetBytes: Uint8Array
    try {
      // Resolve against the configured dir; guard against `..` traversal
      // (defense in depth — caller is supposed to pass canonical entries
      // but the route handler reads them from a constant, so a future
      // refactor mixing in user input shouldn't escape the cut-sheets dir).
      const resolved = path.resolve(cutSheetsDir, filename)
      if (!resolved.startsWith(path.resolve(cutSheetsDir) + path.sep)) {
        skipped.push({ filename, reason: 'path escapes cut-sheets dir' })
        continue
      }
      cutSheetBytes = await fs.readFile(resolved)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      skipped.push({
        filename,
        reason: code === 'ENOENT' ? 'file not found' : `read error: ${code ?? 'unknown'}`,
      })
      continue
    }

    let cutSheetDoc: PDFDocument
    try {
      cutSheetDoc = await PDFDocument.load(cutSheetBytes)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      skipped.push({ filename, reason: `pdf-lib load failed: ${errMsg.slice(0, 200)}` })
      continue
    }

    const pageIndices = cutSheetDoc.getPageIndices()
    const copiedPages = await mergedDoc.copyPages(cutSheetDoc, pageIndices)
    for (const page of copiedPages) {
      mergedDoc.addPage(page)
    }
    merged.push(filename)
  }

  const bytes = await mergedDoc.save()
  return { bytes, merged, skipped }
}
