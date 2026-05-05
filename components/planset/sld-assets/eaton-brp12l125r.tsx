'use client'

import type { AssetProps } from './index'

// Eaton BRP12L125R 125A PV Load Center — Phase 4 asset.
// Native viewBox 0 0 120 80 (landscape, 3:2). PV-5 sheet.
// Anchors: top=(60,0), bottom=(60,80), left=(0,40), right=(120,40).
export function EatonBrp12l125r({ x, y, w, h }: AssetProps) {
  const sx = w / 120
  const sy = h / 80
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="119" height="79" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1.5" />

      <text x="60" y="10" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">BRP12L125R</text>
      <text x="60" y="17" fontSize="4.5" fill="#444" textAnchor="middle">125A / MLO</text>
      <line x1="0.5" y1="20" x2="119.5" y2="20" stroke="#111" strokeWidth="1" />

      <rect x="4" y="30" width="28" height="16" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="0.8" />
      <text x="18" y="37.5" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">20A / 2P</text>
      <text x="18" y="43" fontSize="3.5" fill="#666" textAnchor="middle">BR220</text>

      <rect x="46" y="30" width="28" height="16" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="0.8" />
      <text x="60" y="37.5" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">15A / 2P</text>
      <text x="60" y="43" fontSize="3.5" fill="#666" textAnchor="middle">BR215</text>

      <rect x="88" y="30" width="28" height="16" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1.4" />
      <text x="102" y="37.5" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">40A / 2P</text>
      <text x="102" y="43" fontSize="3.5" fill="#666" textAnchor="middle">BRN240</text>
      <text x="102" y="27" fontSize="3.5" fontWeight="bold" fill="#222" textAnchor="middle" letterSpacing="0.4">MAIN</text>

      <line x1="6" y1="55" x2="114" y2="55" stroke="#888" strokeWidth="0.5" />

      <text x="6" y="75" fontSize="6" fontWeight="bold" fill="#222">G</text>
      <text x="60" y="74" fontSize="4" fill="#888" textAnchor="middle">NEMA 3R · UL</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-top" transform="translate(60, 0)" />
        <g id="anchor-bottom" transform="translate(60, 80)" />
        <g id="anchor-left" transform="translate(0, 40)" />
        <g id="anchor-right" transform="translate(120, 40)" />
      </g>
    </g>
  )
}
