'use client'

import type { AssetProps } from './index'

// Battery Combiner DC Bus Bar — Phase 7 asset.
// Native viewBox 0 0 65 40. anchor-left=(0,20), anchor-right=(65,20).
export function BatteryCombiner({ x, y, w, h }: AssetProps) {
  const sx = w / 65
  const sy = h / 40
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="64" height="39" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1" />
      <rect x="0.5" y="0.5" width="64" height="11" fill="#f5f5f5" stroke="none" />
      <text x="32" y="9" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">(N) BATTERY COMBINER</text>
      <line x1="0.5" y1="12" x2="64.5" y2="12" stroke="#ccc" strokeWidth="0.4" />
      <text x="32" y="22" fontSize="4" fill="#444" textAnchor="middle">DC BUS BAR</text>
      <text x="32" y="30" fontSize="3.5" fill="#999" textAnchor="middle">MAIN FUSED</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-left" transform="translate(0, 20)" />
        <g id="anchor-right" transform="translate(65, 20)" />
      </g>
    </g>
  )
}
