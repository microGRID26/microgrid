'use client'

import type { AssetProps } from './index'

// Duracell Power Center Max Hybrid 15kW central string-MPPT inverter.
// Native viewBox 0 0 140 200. Used 2x for EDGE redesigns.
export function DuracellHybridInverter({ x, y, w, h }: AssetProps) {
  const NW = 140, NH = 200
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <rect x={0} y={0} width={NW} height={NH} fill="#fff" stroke="#000" strokeWidth={1.4} />
      <line x1={0} y1={40} x2={NW} y2={40} stroke="#000" strokeWidth={0.8} />
      <line x1={0} y1={NH - 60} x2={NW} y2={NH - 60} stroke="#000" strokeWidth={0.8} />
      <text x={NW / 2} y={18} textAnchor="middle" fontSize={9} fontFamily="monospace" fontWeight={700}>DURACELL</text>
      <text x={NW / 2} y={32} textAnchor="middle" fontSize={7} fontFamily="monospace">PC MAX HYBRID 15kW</text>
      <text x={8} y={56} fontSize={5.5} fontFamily="monospace">MPPT-1</text>
      <text x={8} y={66} fontSize={5.5} fontFamily="monospace">MPPT-2</text>
      <circle cx={NW - 14} cy={54} r={2.4} fill="#fff" stroke="#000" strokeWidth={0.8} />
      <circle cx={NW - 14} cy={64} r={2.4} fill="#fff" stroke="#000" strokeWidth={0.8} />
      <circle cx={NW / 2} cy={NH / 2 + 6} r={26} fill="#fff" stroke="#000" strokeWidth={1.2} />
      <path d={`M ${NW / 2 - 16} ${NH / 2 + 12} Q ${NW / 2 - 8} ${NH / 2 - 4} ${NW / 2} ${NH / 2 + 12} Q ${NW / 2 + 8} ${NH / 2 + 28} ${NW / 2 + 16} ${NH / 2 + 12}`} fill="none" stroke="#000" strokeWidth={1.2} />
      <line x1={NW / 2 - 16} y1={NH / 2 + 18} x2={NW / 2 - 8} y2={NH / 2 + 18} stroke="#000" strokeWidth={1.4} />
      <line x1={NW / 2 - 4} y1={NH / 2 + 14} x2={NW / 2 - 4} y2={NH / 2 + 22} stroke="#000" strokeWidth={1.4} />
      <line x1={NW / 2 - 4} y1={NH / 2 + 22} x2={NW / 2 + 4} y2={NH / 2 + 22} stroke="#000" strokeWidth={1.4} />
      <line x1={NW / 2 + 4} y1={NH / 2 + 22} x2={NW / 2 + 4} y2={NH / 2 + 14} stroke="#000" strokeWidth={1.4} />
      <text x={8} y={NH - 48} fontSize={5.5} fontFamily="monospace">AC-OUT L1/L2/N/G</text>
      <text x={8} y={NH - 38} fontSize={5.5} fontFamily="monospace">BATT ±</text>
      <text x={8} y={NH - 28} fontSize={5.5} fontFamily="monospace">GRID L1/L2/N/G</text>
      <text x={NW / 2} y={NH - 8} textAnchor="middle" fontSize={6} fontFamily="monospace" fontWeight={700}>15 kW · 240 VAC · 1Ø</text>
    </g>
  )
}
