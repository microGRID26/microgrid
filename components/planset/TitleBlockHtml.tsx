// ── TitleBlockHtml ─────────────────────────────────────────────────────────
// Right-sidebar title block — full-height, labeled-row stack matching the
// Tyson PROJ-26922 / TriSMART planset standard. Replaces the prior compact
// stack, which packed contractor + project + dates into a single bottom block
// with no per-row labels.
//
// Layout (top→bottom, full sidebar height):
//   ┌──────────────────────┐
//   │ CONTRACTOR            │  (row 1)
//   │ PROJECT NAME & ADDR   │  (row 2)
//   │ ENGINEER'S STAMP      │  (row 3 — flexible height, reserved area)
//   │ DRAWN DATE            │  (row 4)
//   │ DRAWN BY              │  (row 5)
//   │ REVISION              │  (row 6 — most-recent rev + table on hover/print)
//   │ SHEET SIZE            │  (row 7)
//   │ AHJ                   │  (row 8)
//   │ SHEET NAME            │  (row 9)
//   │ SHEET NUMBER          │  (row 10 — large numeral)
//   └──────────────────────┘
//
// Each row has an UPPERCASE label header (~5pt) above its value content, with
// a thin black rule between rows. Row heights are FIXED so all 10 rows are
// always visible; the stamp row is pinned at 1.7in (per Greg measurement
// 2026-05-01: free flex: 1 was eating 62% of sidebar height + clipping rows
// 4-10). Sheet number row is largest (the visual anchor per Tyson).
//
// New PlansetData fields read here (all OPTIONAL — defaults shipped in
// planset-types.patch.ts):
//   - data.drawnBy       → row 5    (default: 'MicroGRID')
//   - data.revisions     → row 6    (default: [{rev:0, date:data.drawnDate, note:'Initial issue'}])
//   - data.sheetSize     → row 7    (default: 'ANSI B (11"×17")')
//
// Sheet name + number stay as props (per-sheet, not per-data).

import type { PlansetData } from '@/lib/planset-types'

interface TitleBlockHtmlProps {
  sheetName: string
  sheetNumber: string
  data: PlansetData
}

// Single source of truth for the row-label styling. 5pt uppercase, slight
// letter-spacing, muted gray — drafted to match Tyson's printed planset
// where labels are subordinate to values.
const labelStyle: React.CSSProperties = {
  fontSize: '4.5pt',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#666',
  marginBottom: '1pt',
  lineHeight: 1.1,
}

// Single source of truth for value text. 6.5pt regular, near-black.
const valueStyle: React.CSSProperties = {
  fontSize: '6.5pt',
  color: '#111',
  lineHeight: 1.3,
}

const rowStyle: React.CSSProperties = {
  borderBottom: '0.75pt solid #000',
  padding: '4pt 6pt',
}

export function TitleBlockHtml({ sheetName, sheetNumber, data }: TitleBlockHtmlProps) {
  // Default-fill optional fields so existing fixtures don't break before the
  // planset-types patch lands. Once buildPlansetData() defaults these, the
  // ?? fallbacks become dead code — keep them as a belt-and-suspenders
  // safety until the data layer is updated.
  const drawnBy = (data as PlansetData & { drawnBy?: string }).drawnBy ?? 'MicroGRID'
  const sheetSize = (data as PlansetData & { sheetSize?: string }).sheetSize ?? 'ANSI B (11"×17")'
  const revisions =
    (data as PlansetData & { revisions?: Array<{ rev: number; date: string; note: string }> }).revisions ??
    [{ rev: 0, date: data.drawnDate, note: 'Initial issue' }]
  const latestRev = revisions[revisions.length - 1]

  return (
    <div
      className="sheet-sidebar"
      style={{
        borderLeft: '1px solid #000',
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
      }}
    >
      {/* Row 1 — CONTRACTOR */}
      <div style={rowStyle}>
        <div style={labelStyle}>Contractor</div>
        <div style={{ ...valueStyle, fontWeight: 700 }}>{data.contractor.name}</div>
        <div style={valueStyle}>{data.contractor.address}</div>
        <div style={valueStyle}>{data.contractor.city}</div>
        <div style={valueStyle}>Ph: {data.contractor.phone}</div>
        <div style={valueStyle}>Lic# {data.contractor.license}</div>
      </div>

      {/* Row 2 — PROJECT NAME & ADDRESS */}
      <div style={rowStyle}>
        <div style={labelStyle}>Project Name & Address</div>
        <div style={{ ...valueStyle, fontWeight: 700 }}>{data.owner}</div>
        <div style={valueStyle}>{data.projectId}</div>
        <div style={valueStyle}>{data.address}</div>
        <div style={valueStyle}>
          {data.city}, {data.state} {data.zip}
        </div>
      </div>

      {/* Row 3 — ENGINEER'S STAMP — FIXED 1.7in. Was previously flex:1
          which absorbed 62% of sidebar height (Greg 2026-05-01 DOM measure).
          Now sized to fit a typical 1.6" PE seal + ~3 lines of signature
          area below. Adjust if Rush Engineering provides a larger seal. */}
      <div
        style={{
          ...rowStyle,
          height: '1.7in',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={labelStyle}>Engineer&apos;s Stamp</div>
        <div
          style={{
            flex: 1,
            border: '0.75pt dashed #999',
            margin: '2pt 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '5.5pt',
            color: '#bbb',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          PE Stamp Area
        </div>
      </div>

      {/* Row 4 — DRAWN DATE */}
      <div style={rowStyle}>
        <div style={labelStyle}>Drawn Date</div>
        <div style={valueStyle}>{data.drawnDate}</div>
      </div>

      {/* Row 5 — DRAWN BY */}
      <div style={rowStyle}>
        <div style={labelStyle}>Drawn By</div>
        <div style={valueStyle}>{drawnBy}</div>
      </div>

      {/* Row 6 — REVISION (latest rev shown; full table available via data.revisions) */}
      <div style={rowStyle}>
        <div style={labelStyle}>Revision</div>
        <div style={valueStyle}>
          REV {latestRev.rev} &nbsp;·&nbsp; {latestRev.date}
        </div>
        {latestRev.note && (
          <div style={{ ...valueStyle, fontSize: '5.5pt', color: '#555' }}>{latestRev.note}</div>
        )}
      </div>

      {/* Row 7 — SHEET SIZE */}
      <div style={rowStyle}>
        <div style={labelStyle}>Sheet Size</div>
        <div style={valueStyle}>{sheetSize}</div>
      </div>

      {/* Row 8 — AHJ */}
      <div style={rowStyle}>
        <div style={labelStyle}>AHJ</div>
        <div style={valueStyle}>{data.ahj || '—'}</div>
      </div>

      {/* Row 9 — SHEET NAME */}
      <div style={rowStyle}>
        <div style={labelStyle}>Sheet Name</div>
        <div style={{ ...valueStyle, fontWeight: 700, fontSize: '7pt', textTransform: 'uppercase' }}>
          {sheetName}
        </div>
      </div>

      {/* Row 10 — SHEET NUMBER. Most prominent text on the sheet per Tyson
          standard. flex:1 absorbs any remaining sidebar height after the
          1.7in stamp + fixed rows, ensuring the sheet number row is at the
          bottom edge. Vertically centered. */}
      <div
        style={{
          ...rowStyle,
          borderBottom: 'none',
          flex: 1,
          minHeight: '0.85in',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#000',
          color: '#fff',
          padding: '6pt 10pt',
        }}
      >
        <div style={{ ...labelStyle, color: '#bbb' }}>Sheet Number</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8pt', marginTop: '2pt' }}>
          <span style={{ fontSize: '32pt', fontWeight: 800, lineHeight: 1, color: '#fff', fontFamily: '"Helvetica Neue", Arial, sans-serif' }}>
            {sheetNumber}
          </span>
          <span style={{ fontSize: '7pt', color: '#bbb' }}>of {data.sheetTotal}</span>
        </div>
      </div>
    </div>
  )
}
