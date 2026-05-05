'use client'

import type { AssetProps } from './index'

// DC Junction Box 600V NEMA 3R — landscape variant — Phase 7 asset.
// Native viewBox 0 0 65 24. anchor-left=(0,12), anchor-right=(65,12).
export function JbNema3600vLs({ x, y, w, h }: AssetProps) {
  const sx = w / 65
  const sy = h / 24
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="64" height="23" rx="1" ry="1" fill="white" stroke="#111" strokeWidth="1" />
      <text x="32" y="9" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">(N) DC JUNCTION BOX</text>
      <text x="32" y="18" fontSize="3.5" fill="#666" textAnchor="middle">600V · NEMA 3R</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-left" transform="translate(0, 12)" />
        <g id="anchor-right" transform="translate(65, 12)" />
      </g>
    </g>
  )
}
