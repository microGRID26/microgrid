// Production CT — clamp-on current transformer marker.

import type { ProductionCT } from '../../../lib/sld-v2/equipment'

export interface ProductionCtBoxProps {
  ct: ProductionCT
  x: number
  y: number
  debug?: boolean
}

export function ProductionCtBox({ ct, x, y, debug }: ProductionCtBoxProps) {
  const { width: w, height: h } = ct
  const sx = w / 60
  const sy = h / 40

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        {/* CT ring (donut) — centered horizontally, top third */}
        <circle cx="30" cy="10" r="7" fill="white" stroke="#111" strokeWidth="1" />
        <circle cx="30" cy="10" r="3.5" fill="white" stroke="#666" strokeWidth="0.5" />
        <text x="30" y="12" fontSize="3.5" fontWeight="bold" fill="#222" textAnchor="middle">
          CT
        </text>

        {/* H10 Pass-3 — Tyson PV-5 captions hardcoded below donut */}
        <text x="30" y="24" fontSize="3.2" fontWeight="bold" fill="#222" textAnchor="middle">
          PRIMARY CONSUMPTION
        </text>
        <text x="30" y="28" fontSize="3.2" fontWeight="bold" fill="#222" textAnchor="middle">
          + PRODUCTION
        </text>
        <text x="30" y="34" fontSize="2.8" fill="#666" textAnchor="middle">
          FROM MAIN BREAKER
        </text>
        <text x="30" y="37.5" fontSize="2.8" fill="#666" textAnchor="middle">
          CT P/N 1001808
        </text>

        <g id={`anchors-${ct.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${ct.id}-N`} transform="translate(30, 0)" />
          <g id={`${ct.id}-S`} transform="translate(30, 40)" />
          <g id={`${ct.id}-W`} transform="translate(0, 10)" />
          <g id={`${ct.id}-E`} transform="translate(60, 10)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="0" cy="10" r="1" fill="cyan" />
            <circle cx="60" cy="10" r="1" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
