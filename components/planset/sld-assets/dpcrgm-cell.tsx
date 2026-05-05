'use client'

import type { AssetProps } from './index'

// Duracell DPCRGM-Cell comms controller — Phase 7 asset.
// Native viewBox 0 0 110 50. anchor-left=(0,25), anchor-right=(110,25).
export function DpcrgmCell({ x, y, w, h }: AssetProps) {
  const sx = w / 110
  const sy = h / 50
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="109" height="49" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1" />
      <rect x="0.5" y="0.5" width="109" height="13" fill="#f5f5f5" stroke="none" />
      <text x="55" y="11" fontSize="5.5" fontWeight="bold" fill="#222" textAnchor="middle">(N) DPCRGM — CELL</text>
      <line x1="0.5" y1="14" x2="109.5" y2="14" stroke="#ccc" strokeWidth="0.4" />
      <text x="55" y="25" fontSize="5" fill="#444" textAnchor="middle">DURACELL DTU</text>
      <text x="55" y="33" fontSize="4" fill="#999" textAnchor="middle">PN: PC-PRO-C</text>
      <g fill="white" stroke="#111" strokeWidth="0.4">
        <circle cx="18" cy="43" r="4" />
        <circle cx="40" cy="43" r="4" />
        <circle cx="62" cy="43" r="4" />
        <circle cx="84" cy="43" r="4" />
      </g>
      <g fontSize="4" fill="#444" textAnchor="middle">
        <text x="18" y="44.5">1</text>
        <text x="40" y="44.5">2</text>
        <text x="62" y="44.5">3</text>
        <text x="84" y="44.5">4</text>
      </g>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-left" transform="translate(0, 25)" />
        <g id="anchor-right" transform="translate(110, 25)" />
      </g>
    </g>
  )
}
