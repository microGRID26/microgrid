import type { PlansetData } from '@/lib/planset-types'

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

/**
 * Single cut-sheet page — one entry in sheetList per PDF.
 * Includes a screen-only banner warning that browser print skips PDF embeds.
 */
export function SheetCutSheet({ entry, data: _data }: { entry: CutSheetEntry; data: PlansetData }) {
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

      {/* Screen-only warning — browser print engine skips <embed type="application/pdf"> */}
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

      {/* Full-height PDF embed */}
      <embed
        src={entry.src}
        type="application/pdf"
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  )
}

/**
 * Legacy multi-sheet wrapper — renders all CUT_SHEETS in one component.
 * Kept for back-compat; planset page.tsx now spreads CUT_SHEETS into sheetList individually.
 */
export function SheetCutSheets({ data }: { data: PlansetData }) {
  return (
    <>
      {CUT_SHEETS.map(cs => (
        <SheetCutSheet key={cs.src} entry={cs} data={data} />
      ))}
    </>
  )
}
