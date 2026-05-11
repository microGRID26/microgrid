'use client'

import type { AssetProps } from './index'

// 8-port communication ethernet switch.
// Native viewBox 0 0 100 30.
export function EthernetSwitch({ x, y, w, h }: AssetProps) {
  const NW = 100, NH = 30
  return (
    <g transform={`translate(${x},${y}) scale(${w / NW},${h / NH})`}>
      <rect x={0} y={0} width={NW} height={NH} fill="#fff" stroke="#000" strokeWidth={1.2} />
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x={6 + i * 10} y={NH - 10} width={7} height={6} fill="#fff" stroke="#000" strokeWidth={0.6} />
      ))}
      <text x={6} y={11} fontSize={6.5} fontFamily="monospace" fontWeight={700}>ETHERNET SWITCH</text>
      <text x={NW - 6} y={11} textAnchor="end" fontSize={5.5} fontFamily="monospace">8-PORT</text>
    </g>
  )
}
