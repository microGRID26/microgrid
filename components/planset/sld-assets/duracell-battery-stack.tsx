'use client'

import type { AssetProps } from './index'

// 8x Duracell 5kWh LFP battery modules stacked = 40 kWh per stack.
// Native viewBox 0 0 120 320. System uses 2 stacks side-by-side = 80 kWh total.
export function DuracellBatteryStack({ x, y, w, h }: AssetProps) {
  const NW = 120, NH = 320
  const cellH = 32, startY = 12
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <rect x={0} y={0} width={NW} height={NH} fill="#fff" stroke="#000" strokeWidth={1.4} />
      <text x={NW / 2} y={9} textAnchor="middle" fontSize={6} fontFamily="monospace" fontWeight={700}>DURACELL · 40 kWh STACK</text>
      {Array.from({ length: 8 }).map((_, i) => (
        <g key={i}>
          <rect x={8} y={startY + i * cellH} width={NW - 16} height={cellH - 4} fill="#fff" stroke="#000" strokeWidth={0.7} />
          <text x={16} y={startY + i * cellH + cellH / 2 + 1} fontSize={5.5} fontFamily="monospace">{`MOD ${i + 1}`}</text>
          <text x={NW - 16} y={startY + i * cellH + cellH / 2 + 1} textAnchor="end" fontSize={5.5} fontFamily="monospace">5 kWh LFP</text>
          <circle cx={NW / 2} cy={startY + i * cellH + cellH / 2 - 2} r={1.4} fill="#000" />
        </g>
      ))}
      <rect x={6} y={NH - 10} width={NW - 12} height={5} fill="#000" />
      <text x={NW / 2} y={NH - 12} textAnchor="middle" fontSize={5} fontFamily="monospace" fontWeight={700}>{'+ DC BUS −'}</text>
    </g>
  )
}
