'use client'

import type { AssetProps } from './index'

// Emergency stop button per NEC 706.7.
// Native viewBox 0 0 50 50.
export function EStopButton({ x, y, w, h }: AssetProps) {
  const NW = 50, NH = 50
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <rect x={2} y={2} width={NW - 4} height={NH - 4} fill="#fff" stroke="#000" strokeWidth={1.2} />
      <circle cx={NW / 2} cy={NH / 2 - 2} r={11} fill="#fff" stroke="#000" strokeWidth={1.6} />
      <circle cx={NW / 2} cy={NH / 2 - 2} r={7} fill="none" stroke="#000" strokeWidth={1} />
      <line x1={NW / 2 - 8} y1={NH - 12} x2={NW / 2 + 8} y2={NH - 12} stroke="#000" strokeWidth={1} />
      <line x1={NW / 2 - 6} y1={NH - 14} x2={NW / 2 + 6} y2={NH - 10} stroke="#000" strokeWidth={1} />
      <text x={NW / 2} y={NH - 2} textAnchor="middle" fontSize={5.5} fontFamily="monospace" fontWeight={700}>E-STOP</text>
    </g>
  )
}
