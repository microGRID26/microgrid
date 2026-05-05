'use client'

import type { AssetProps } from './index'

// Utility Meter 200A (bi-directional) — Phase 6 asset.
// Native viewBox 0 0 40 40. anchor-left=(2,20), anchor-right=(38,20).
// Position: x=cx-20, y=cy-20 to center on wire.
export function UtilityMeter200a({ x, y, w, h }: AssetProps) {
  const sx = w / 40
  const sy = h / 40
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <circle cx="20" cy="20" r="18" fill="white" stroke="#111" strokeWidth="1.5" />
      <text x="20" y="25" fontSize="14" fontWeight="bold" fill="#222" textAnchor="middle">M</text>
      <text x="20" y="35" fontSize="5" fill="#555" textAnchor="middle">kWh</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-left" transform="translate(2, 20)" />
        <g id="anchor-right" transform="translate(38, 20)" />
      </g>
    </g>
  )
}
