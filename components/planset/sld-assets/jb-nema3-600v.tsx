'use client'

import type { AssetProps } from './index'

// DC Junction Box 600V NEMA 3R — Phase 6 asset.
// Native viewBox 0 0 70 56. anchor-left=(0,28), anchor-right=(70,28).
export function JbNema3600v({ x, y, w, h }: AssetProps) {
  const sx = w / 70
  const sy = h / 56
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="69" height="55" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1" />

      <text x="35" y="12" fontSize="5.5" fontWeight="bold" fill="#222" textAnchor="middle">(N) DC JUNCTION BOX</text>
      <text x="35" y="19" fontSize="4.5" fill="#444" textAnchor="middle">600V NEMA 3R</text>
      <text x="35" y="25" fontSize="4" fill="#999" textAnchor="middle">UL LISTED</text>

      <line x1="6" y1="34" x2="64" y2="34" stroke="#888" strokeWidth="0.7" />

      <g fill="white" stroke="#111" strokeWidth="0.8">
        <circle cx="20" cy="34" r="4" />
        <line x1="20" y1="30" x2="20" y2="38" />
        <circle cx="50" cy="34" r="4" />
        <line x1="50" y1="30" x2="50" y2="38" />
      </g>

      <text x="26" y="33" fontSize="5" fontWeight="bold" fill="#222">+</text>
      <text x="56" y="33" fontSize="5" fontWeight="bold" fill="#222">−</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-left" transform="translate(0, 28)" />
        <g id="anchor-right" transform="translate(70, 28)" />
      </g>
    </g>
  )
}
