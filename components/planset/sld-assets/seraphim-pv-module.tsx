'use client'

import type { AssetProps } from './index'

// Seraphim SRP-440-BTD-BG single PV module symbol.
// Native viewBox 0 0 100 70. Repeatable in array.
export function SeraphimPvModule({ x, y, w, h }: AssetProps) {
  const NW = 100, NH = 70
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <rect x={0} y={0} width={NW} height={NH} fill="#fff" stroke="#000" strokeWidth={1.2} />
      {Array.from({ length: 6 }).map((_, c) => (
        <line key={`v${c}`} x1={(c + 1) * (NW / 7)} y1={2} x2={(c + 1) * (NW / 7)} y2={NH - 2} stroke="#000" strokeWidth={0.3} />
      ))}
      {Array.from({ length: 3 }).map((_, r) => (
        <line key={`h${r}`} x1={2} y1={(r + 1) * (NH / 4)} x2={NW - 2} y2={(r + 1) * (NH / 4)} stroke="#000" strokeWidth={0.3} />
      ))}
      <rect x={NW / 2 - 6} y={NH - 6} width={12} height={4} fill="#000" />
      <line x1={NW / 2 - 3} y1={NH - 2} x2={NW / 2 - 3} y2={NH + 4} stroke="#000" strokeWidth={0.8} />
      <line x1={NW / 2 + 3} y1={NH - 2} x2={NW / 2 + 3} y2={NH + 4} stroke="#000" strokeWidth={0.8} />
      <text x={NW / 2} y={12} textAnchor="middle" fontSize={5} fontFamily="monospace" fontWeight={700}>SRP-440-BTD-BG</text>
      <text x={NW / 2} y={NH - 10} textAnchor="middle" fontSize={4.5} fontFamily="monospace">{'+    −'}</text>
    </g>
  )
}
