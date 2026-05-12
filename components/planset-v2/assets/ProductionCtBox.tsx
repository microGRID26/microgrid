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
  const sx = w / 40
  const sy = h / 20

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        {/* CT ring (donut) */}
        <circle cx="20" cy="10" r="8" fill="white" stroke="#111" strokeWidth="1" />
        <circle cx="20" cy="10" r="4" fill="white" stroke="#666" strokeWidth="0.5" />
        <text x="20" y="12" fontSize="4" fontWeight="bold" fill="#222" textAnchor="middle">
          CT
        </text>

        <g id={`anchors-${ct.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${ct.id}-W`} transform="translate(0, 10)" />
          <g id={`${ct.id}-E`} transform="translate(40, 10)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="0" cy="10" r="1" fill="cyan" />
            <circle cx="40" cy="10" r="1" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
