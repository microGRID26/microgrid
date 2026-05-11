'use client'

import type { AssetProps } from './index'

// Production current transformer (IEEE donut symbol).
// Native viewBox 0 0 60 36. Conductor passes horizontally through donut.
export function ProductionCt({ x, y, w, h }: AssetProps) {
  const NW = 60, NH = 36
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <circle cx={NW / 2} cy={NH / 2} r={11} fill="#fff" stroke="#000" strokeWidth={1.2} />
      <circle cx={NW / 2} cy={NH / 2} r={6} fill="none" stroke="#000" strokeWidth={0.8} />
      <line x1={2} y1={NH / 2} x2={NW - 2} y2={NH / 2} stroke="#000" strokeWidth={1.6} />
      <line x1={NW / 2} y1={NH / 2 + 11} x2={NW / 2} y2={NH - 2} stroke="#000" strokeWidth={0.7} strokeDasharray="2 1.5" />
      <text x={NW / 2 + 14} y={NH / 2 - 12} fontSize={6} fontFamily="monospace" fontWeight={700}>CT</text>
    </g>
  )
}
