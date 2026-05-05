'use client'

import type { AssetProps } from './index'

// IMO Rapid Shutdown Device RSD-D-20 — Phase 6 asset.
// Native viewBox 0 0 80 28. anchor-top=(40,0), anchor-bottom=(40,28), anchor-left=(0,14), anchor-right=(80,14).
export function ImoRsd({ x, y, w, h }: AssetProps) {
  const sx = w / 80
  const sy = h / 28
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="79" height="27" rx="1" ry="1" fill="white" stroke="#888" strokeWidth="0.8" />
      <g stroke="#d44" strokeWidth="1" fill="none">
        <circle cx="10" cy="14" r="5" />
        <line x1="10" y1="9" x2="10" y2="19" />
      </g>
      <text x="48" y="11" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">(N) IMO RAPID SHUTDOWN</text>
      <text x="48" y="20" fontSize="4" fill="#555" textAnchor="middle">RSD-D-20</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-top" transform="translate(40, 0)" />
        <g id="anchor-bottom" transform="translate(40, 28)" />
        <g id="anchor-left" transform="translate(0, 14)" />
        <g id="anchor-right" transform="translate(80, 14)" />
      </g>
    </g>
  )
}
