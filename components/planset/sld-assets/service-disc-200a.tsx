'use client'

import type { AssetProps } from './index'

// Service Disconnect 200A — Phase 6 asset.
// Native viewBox 0 0 90 36. anchor-left=(0,18), anchor-right=(90,18).
export function ServiceDisc200a({ x, y, w, h }: AssetProps) {
  const sx = w / 90
  const sy = h / 36
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="89" height="35" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1.2" />
      <rect x="0.5" y="0.5" width="89" height="10" rx="1.5" ry="1.5" fill="#f5f5f5" stroke="none" />
      <text x="45" y="9" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">(N) SERVICE DISCONNECT</text>
      <line x1="0.5" y1="12" x2="89.5" y2="12" stroke="#ccc" strokeWidth="0.4" />
      <text x="45" y="21" fontSize="4.5" fill="#444" textAnchor="middle">200A / 2P, 240V</text>
      <text x="45" y="28" fontSize="4" fill="#999" textAnchor="middle">VISIBLE · LOCKABLE</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-left" transform="translate(0, 18)" />
        <g id="anchor-right" transform="translate(90, 18)" />
      </g>
    </g>
  )
}
