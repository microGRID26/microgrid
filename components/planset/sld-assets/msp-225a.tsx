'use client'

import type { AssetProps } from './index'

// 225A Main Service Panel — Phase 5 asset.
// Native viewBox 0 0 130 140 (portrait). Anchor-left=(0,70), anchor-right=(130,70).
export function Msp225a({ x, y, w, h }: AssetProps) {
  const sx = w / 130
  const sy = h / 140
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="129" height="139" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1.2" />

      <text x="65" y="11" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">(N) MAIN SERVICE PANEL</text>
      <text x="65" y="20" fontSize="4.8" fill="#444" textAnchor="middle">225A RATED 240V</text>
      <text x="65" y="27" fontSize="4" fill="#999" textAnchor="middle">(EXTERIOR MOUNTED)</text>
      <line x1="0.5" y1="32" x2="129.5" y2="32" stroke="#111" strokeWidth="1" />

      <rect x="9" y="43" width="38" height="14" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="0.8" />
      <text x="28" y="53" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">100A / 2P</text>
      <text x="28" y="74" fontSize="4" fill="#444" textAnchor="middle">HYBRID #1</text>

      <rect x="83" y="43" width="38" height="14" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1.4" />
      <text x="102" y="53" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">125A / 2P</text>
      <text x="102" y="74" fontSize="4" fill="#444" textAnchor="middle">MAIN</text>

      <line x1="10" y1="62" x2="120" y2="62" stroke="#888" strokeWidth="0.8" />

      <rect x="37" y="82" width="56" height="18" rx="1" ry="1" fill="white" stroke="#888" strokeWidth="0.6" />
      <text x="65" y="93" fontSize="4" fill="#555" textAnchor="middle">(N) SURGE PROTECTOR</text>

      <text x="6" y="136" fontSize="6" fontWeight="bold" fill="#222">G</text>
      <text x="65" y="134" fontSize="4" fill="#888" textAnchor="middle">NEMA 3R · UL</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-top" transform="translate(65, 0)" />
        <g id="anchor-bottom" transform="translate(65, 140)" />
        <g id="anchor-left" transform="translate(0, 70)" />
        <g id="anchor-right" transform="translate(130, 70)" />
      </g>
    </g>
  )
}
