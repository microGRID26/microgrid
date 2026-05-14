'use client'

import { useEffect, useState } from 'react'

export interface CutSheetEntry {
  src: string       // path relative to /public/
  title: string     // display title above the embed
  sheetId: string   // 'PV-9', 'PV-10', etc. — ONE per cut sheet
}

export const CUT_SHEETS: CutSheetEntry[] = [
  { src: '/cut-sheets/duracell-5plus.pdf', title: 'Duracell 5+ Battery (LiFePO4)', sheetId: 'PV-9' },
  { src: '/cut-sheets/max-hybrid-15.pdf',  title: 'Duracell Power Center Max Hybrid 15kW Inverter', sheetId: 'PV-10' },
  // Pending — add when received from William (greg_action #317):
  // { src: '/cut-sheets/ja-solar-amp-380.pdf', title: 'JA Solar AMP 380W', sheetId: 'PV-11' },
  // { src: '/cut-sheets/rsd-d-20.pdf', title: 'RSD-D-20 Rapid Shutdown Device', sheetId: 'PV-12' },
  // { src: '/cut-sheets/ecofasten-corruslide.pdf', title: 'EcoFasten ClickFit + CorruSlide Mounting', sheetId: 'PV-13' },
  // { src: '/cut-sheets/cantex-bar.pdf', title: 'Cantex High-Current Distribution Bar', sheetId: 'PV-14' },
]

// Sheet count breakdown:
//   Always: PV-1, PV-2, PV-2A, PV-3, PV-4, PV-5, PV-6, PV-7, PV-7.1, PV-8 = 10
//   Enhanced extras: UTIL, PV-3.1, PV-4.1 = 3 (total 13)
//   Plus N cut sheets (one sheetList entry per CUT_SHEETS entry)
//
// Single source for both the page-render header ("Sheet X of TOTAL") and the
// SheetCutSheets test that verifies the formula. Adding a sheet now requires
// one change here, not two in lockstep.
export function computeSheetTotal(enhanced: boolean): number {
  return (enhanced ? 13 : 10) + CUT_SHEETS.length
}

/**
 * Single cut-sheet page — one entry in sheetList per PDF.
 *
 * Behavior:
 *  - Fires a HEAD request on mount to verify the PDF exists. Missing files
 *    render a visible "PDF UNAVAILABLE" overlay instead of the browser's
 *    default broken-embed icon, so a designer notices a missing cut sheet
 *    immediately rather than discovering it post-AHJ-submittal.
 *  - Includes a screen-only banner warning that the browser print engine
 *    skips <embed type="application/pdf"> (use server-side PDF merge to
 *    bake the cut sheets into the final permit PDF — #323 P1).
 */
/**
 * `isPrintMode=true` is set by the puppeteer print route (`?print=1` on the
 * planset page). In that mode the `<embed>` is replaced with a placeholder
 * because:
 *   1. chromium's PDF renderer does not render nested PDFs from <embed> when
 *      rendering its own PDF — the embed comes through as a blank rectangle.
 *   2. The cut-sheet pages are merged in by lib/planset/pdf-merge.ts after
 *      the puppeteer render, so the placeholder is the visible seam between
 *      the rendered planset and the appended cut sheet.
 * The screen banner is also suppressed because it's not relevant in print
 * mode (the merge IS the fix it points at).
 */
export function SheetCutSheet({ entry, isPrintMode = false }: { entry: CutSheetEntry; isPrintMode?: boolean }) {
  const [status, setStatus] = useState<'pending' | 'ok' | 'missing'>(
    isPrintMode ? 'ok' : 'pending',
  )

  useEffect(() => {
    if (isPrintMode) return // skip the HEAD probe in print mode — pdf-merge handles missing files
    let cancelled = false
    fetch(entry.src, { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return
        setStatus(res.ok ? 'ok' : 'missing')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('missing')
      })
    return () => { cancelled = true }
  }, [entry.src, isPrintMode])

  return (
    <div
      data-cut-sheet={entry.sheetId}
      className="sheet"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto auto 1fr',
        border: '2px solid #000',
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '8pt',
        width: '16.5in',
        height: '10.5in',
        overflow: 'hidden',
        position: 'relative',
        pageBreakBefore: 'always',
      }}
    >
      {/* Header bar matching other sheets */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        borderBottom: '1px solid #ccc',
        background: '#f5f5f5',
      }}>
        <span style={{
          fontSize: '7pt',
          fontWeight: 'bold',
          background: '#111',
          color: 'white',
          padding: '2px 6px',
          borderRadius: '2px',
        }}>
          {entry.sheetId}
        </span>
        <h2 style={{
          margin: 0,
          fontSize: '8pt',
          fontWeight: 'bold',
          color: '#111',
          textTransform: 'uppercase' as const,
        }}>
          {entry.title}
        </h2>
        <span style={{ marginLeft: 'auto', fontSize: '6pt', color: '#888' }}>
          MANUFACTURER CUT SHEET
        </span>
      </div>

      {/* Screen-only warning — browser print engine skips <embed type="application/pdf">. */}
      {/* Suppressed in print mode because the server-side merge route IS the fix. */}
      {!isPrintMode && (
        <div
          className="print:hidden"
          style={{
            background: '#fefce8',
            border: '1px solid #ca8a04',
            color: '#713f12',
            fontSize: '7pt',
            padding: '4px 10px',
          }}
        >
          ⚠ Cut sheets do NOT print via Save-as-PDF — browser PDF embeds are skipped by the print
          engine. For permit submission, append the PDF directly:{' '}
          <code style={{ background: '#fef9c3', padding: '0 4px' }}>{entry.src}</code>
        </div>
      )}

      {/* Print-mode placeholder — pdf-merge appends the real PDF after the planset. */}
      {/* Skip the regular <embed>/<missing-file> branch entirely so chromium */}
      {/* doesn't render a blank rectangle in its place. */}
      {isPrintMode ? (
        <div
          data-cut-sheet-placeholder
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f9fafb',
            border: '2px dashed #9ca3af',
            color: '#374151',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: '8px' }}>
            {entry.title}
          </div>
          <div style={{ fontSize: '8pt', maxWidth: '6in', color: '#6b7280' }}>
            Cut sheet PDF appended after this page by the server-side merge route.
          </div>
          <div style={{ fontSize: '7pt', marginTop: '12px', color: '#9ca3af' }}>
            <code>{entry.src}</code>
          </div>
        </div>
      ) : status === 'missing' ? (
        <div
          data-cut-sheet-missing
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fef2f2',
            border: '2px dashed #dc2626',
            color: '#7f1d1d',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: '8px' }}>
            PDF UNAVAILABLE
          </div>
          <div style={{ fontSize: '8pt', maxWidth: '6in' }}>
            <code style={{ background: '#fee2e2', padding: '0 4px' }}>{entry.src}</code> returned a non-OK response.
            Verify the file exists in <code>public/cut-sheets/</code> and redeploy.
          </div>
        </div>
      ) : (
        <embed
          src={entry.src}
          type="application/pdf"
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      )}
    </div>
  )
}
