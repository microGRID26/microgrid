'use client'

import type { AssetProps } from './index'

// Existing homeowner router. Dashed border per (E)-existing-equipment convention.
// Native viewBox 0 0 80 30.
export function HomeownerRouter({ x, y, w, h }: AssetProps) {
  const NW = 80, NH = 30
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <rect x={0} y={0} width={NW} height={NH} fill="#fff" stroke="#000" strokeWidth={1.2} strokeDasharray="3 2" />
      <text x={NW / 2} y={11} textAnchor="middle" fontSize={7} fontFamily="monospace" fontWeight={700}>(E) ROUTER</text>
      <path d={`M ${NW / 2 - 14} ${NH - 6} q 3 -6 6 0 q 3 -6 6 0`} fill="none" stroke="#000" strokeWidth={0.7} />
      <path d={`M ${NW / 2 + 2} ${NH - 6} q 3 -6 6 0 q 3 -6 6 0`} fill="none" stroke="#000" strokeWidth={0.7} />
      <text x={NW / 2} y={NH - 2} textAnchor="middle" fontSize={5} fontFamily="monospace">HOMEOWNER WAN</text>
    </g>
  )
}
