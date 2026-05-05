'use client'

import type { AssetProps } from './index'

// Eaton DG222URB 60A 2-pole PV disconnect — Phase 2 asset.
// Native viewBox 0 0 100 130. Callout #4 on PV-5 sheet.
// Anchors: top=(50,0), bottom=(50,130), left=(0,65), right=(100,65).
export function EatonDg222Urb({ x, y, w, h }: AssetProps) {
  const sx = w / 100
  const sy = h / 130
  return (
    <g transform={`translate(${x},${y}) scale(${sx}, ${sy})`} fontFamily="Helvetica, Arial, sans-serif">
      <rect x="0.5" y="0.5" width="99" height="129" rx="3" ry="3" fill="white" stroke="#111" strokeWidth="1" />

      <text x="50" y="9.5" fontSize="7" fontWeight="bold" fill="#222" textAnchor="middle">DG222URB</text>
      <text x="50" y="15.5" fontSize="5.5" fill="#444" textAnchor="middle">60A / 2P</text>
      <line x1="0.5" y1="18" x2="99.5" y2="18" stroke="#111" strokeWidth="1" />

      <text x="35" y="29" fontSize="4.5" fill="#666" textAnchor="middle">L1</text>
      <text x="65" y="29" fontSize="4.5" fill="#666" textAnchor="middle">L2</text>

      <g stroke="#111" strokeLinecap="round">
        <line x1="35" y1="32" x2="35" y2="55" strokeWidth="1" />
        <line x1="35" y1="55" x2="29" y2="85" strokeWidth="1.1" />
        <line x1="35" y1="85" x2="35" y2="103" strokeWidth="1" />
        <line x1="65" y1="32" x2="65" y2="55" strokeWidth="1" />
        <line x1="65" y1="55" x2="71" y2="85" strokeWidth="1.1" />
        <line x1="65" y1="85" x2="65" y2="103" strokeWidth="1" />
      </g>

      <g fill="#111" stroke="none">
        <circle cx="35" cy="55" r="2" />
        <circle cx="35" cy="85" r="2" />
        <circle cx="65" cy="55" r="2" />
        <circle cx="65" cy="85" r="2" />
      </g>

      <line x1="29" y1="85" x2="71" y2="85" stroke="#444" strokeWidth="0.4" strokeDasharray="1.2 1.2" />

      <text x="50" y="118" fontSize="5" fill="#555" textAnchor="middle">240V, 3R</text>

      <g id="anchors" fill="none" stroke="none" pointerEvents="none">
        <g id="anchor-top" transform="translate(50, 0)" />
        <g id="anchor-bottom" transform="translate(50, 130)" />
        <g id="anchor-left" transform="translate(0, 65)" />
        <g id="anchor-right" transform="translate(100, 65)" />
      </g>
    </g>
  )
}
