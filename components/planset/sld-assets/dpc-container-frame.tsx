'use client'

import type { AssetProps } from './index'

// Duracell Power Center NEMA 3R outer cabinet outline (frame only).
// Native viewBox 0 0 320 360. Sits behind inverter + battery stack as a grouping outline.
export function DpcContainerFrame({ x, y, w, h }: AssetProps) {
  const NW = 320, NH = 360
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <rect x={0} y={0} width={NW} height={NH} fill="none" stroke="#000" strokeWidth={2.2} />
      {[[0, 0], [NW, 0], [0, NH], [NW, NH]].map(([cx, cy], i) => (
        <g key={i}>
          <line x1={cx - 10} y1={cy} x2={cx + 10} y2={cy} stroke="#000" strokeWidth={2.5} />
          <line x1={cx} y1={cy - 10} x2={cx} y2={cy + 10} stroke="#000" strokeWidth={2.5} />
        </g>
      ))}
      <rect x={0} y={0} width={NW} height={20} fill="#fff" stroke="#000" strokeWidth={1.2} />
      <text x={10} y={14} fontSize={9} fontFamily="monospace" fontWeight={700}>DURACELL POWER CENTER · NEMA 3R</text>
      <text x={NW - 10} y={14} textAnchor="end" fontSize={8} fontFamily="monospace">PN: PC-MAX-15-40 ×2</text>
      <text x={10} y={NH - 6} fontSize={6.5} fontFamily="monospace">FLOOR-MOUNTED · NFPA 855 CLEARANCE PER PV-3.2</text>
    </g>
  )
}
