'use client'

import type { AssetProps } from './index'

// Eaton BRP20B125R 125A Protected Load Panel — Phase 4 asset.
// Native viewBox 0 0 120 130 (portrait). PV-5 sheet.
// Anchors: top=(60,0), bottom=(60,130), left=(0,65), right=(120,65).
export function EatonBrp20b125r({ x, y, w, h }: AssetProps) {
  const sx = w / 120
  const sy = h / 130
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="119" height="129" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1" />

      <text x="60" y="10" fontSize="5.5" fontWeight="bold" fill="#222" textAnchor="middle">(N) PROTECTED LOAD PANEL</text>
      <text x="60" y="18" fontSize="4.5" fill="#444" textAnchor="middle">BRP20B125R · 125A</text>
      <text x="60" y="25" fontSize="3.5" fill="#999" textAnchor="middle">NEMA 3R · UL LISTED · EXTERIOR</text>
      <line x1="0.5" y1="30" x2="119.5" y2="30" stroke="#111" strokeWidth="1" />

      <rect x="12" y="48" width="36" height="14" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="0.8" />
      <text x="30" y="58" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">35A / 2P</text>
      <text x="30" y="70" fontSize="4" fill="#444" textAnchor="middle">PV</text>

      <rect x="72" y="48" width="36" height="14" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1.4" />
      <text x="90" y="58" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">40A / 2P</text>
      <text x="90" y="70" fontSize="4" fill="#444" textAnchor="middle">MAIN</text>

      <line x1="10" y1="65" x2="110" y2="65" stroke="#888" strokeWidth="0.8" />

      <g fontSize="4" fill="#999" textAnchor="middle">
        <text x="60" y="88">(N) 35A PV BREAKER AT</text>
        <text x="60" y="93.5">OPPOSITE END OF BUS</text>
        <text x="60" y="99">FROM MAIN BREAKER</text>
      </g>

      <text x="6" y="126" fontSize="6" fontWeight="bold" fill="#222">G</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-top" transform="translate(60, 0)" />
        <g id="anchor-bottom" transform="translate(60, 130)" />
        <g id="anchor-left" transform="translate(0, 65)" />
        <g id="anchor-right" transform="translate(120, 65)" />
      </g>
    </g>
  )
}
