'use client'

import type { AssetProps } from './index'

// Surge Protector / Type 2 SPD — Phase 6 asset.
// Native viewBox 0 0 80 28. anchor-top=(40,0), anchor-bottom=(40,28), anchor-left=(0,14), anchor-right=(80,14).
export function SurgeProtectorSpd({ x, y, w, h }: AssetProps) {
  const sx = w / 80
  const sy = h / 28
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="79" height="27" rx="1" ry="1" fill="white" stroke="#888" strokeWidth="0.8" />
      <polyline points="13,8 9,14 12,14 8,20" stroke="#555" strokeWidth="1" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <text x="45" y="11" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">(N) SURGE PROTECTOR</text>
      <text x="45" y="20" fontSize="4" fill="#555" textAnchor="middle">TYPE 2 SPD</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-top" transform="translate(40, 0)" />
        <g id="anchor-bottom" transform="translate(40, 28)" />
        <g id="anchor-left" transform="translate(0, 14)" />
        <g id="anchor-right" transform="translate(80, 14)" />
      </g>
    </g>
  )
}
