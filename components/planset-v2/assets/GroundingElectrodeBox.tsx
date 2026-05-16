// Grounding electrode — universal earth-ground triangle glyph.
// Phase H8 Category E.

import type { GroundingElectrode } from '../../../lib/sld-v2/equipment'

export interface GroundingElectrodeBoxProps {
  ge: GroundingElectrode
  x: number
  y: number
  debug?: boolean
}

export function GroundingElectrodeBox({ ge, x, y, debug }: GroundingElectrodeBoxProps) {
  const { width: w, height: h } = ge
  const sx = w / 50
  const sy = h / 50

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        {/* Vertical lead-in line */}
        <line x1="25" y1="0" x2="25" y2="18" stroke="#111" strokeWidth="1.2" />

        {/* Triangle pointing down (universal earth-ground glyph) */}
        <polygon points="13,18 37,18 25,32" fill="none" stroke="#111" strokeWidth="1" />

        {/* Three descending horizontal strokes inside the triangle */}
        <line x1="16" y1="22" x2="34" y2="22" stroke="#111" strokeWidth="0.8" />
        <line x1="19" y1="26" x2="31" y2="26" stroke="#111" strokeWidth="0.8" />
        <line x1="22" y1="30" x2="28" y2="30" stroke="#111" strokeWidth="0.8" />

        {/* H10 Pass-4 — Tyson PV-5 GE captions hardcoded; was orphaning.
            Pass-15b — line baselines were 4pt apart for fontSize 3.5
            (overlap by 0.14pt per pdftotext) and 3pt apart for fontSize 3
            (overlap by 0.38pt). Bumped to 4.5/4.5 gaps for clean 1pt+ gaps
            between consecutive baselines. */}
        <text x="25" y="38" fontSize="3.5" fontWeight="bold" fill="#222" textAnchor="middle">
          (E) GROUNDING
        </text>
        <text x="25" y="42.5" fontSize="3.5" fontWeight="bold" fill="#222" textAnchor="middle">
          ELECTRODE
        </text>
        <text x="25" y="47" fontSize="3" fill="#666" textAnchor="middle">
          5/8&quot; × 8&apos; CU ROD
        </text>
        <text x="25" y="51" fontSize="3" fill="#666" textAnchor="middle">
          NEC 250.52
        </text>

        <g id={`anchors-${ge.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${ge.id}-N`} transform="translate(25, 0)" />
          <g id={`${ge.id}-S`} transform="translate(25, 50)" />
          <g id={`${ge.id}-W`} transform="translate(0, 25)" />
          <g id={`${ge.id}-E`} transform="translate(50, 25)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="25" cy="0" r="1.2" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
