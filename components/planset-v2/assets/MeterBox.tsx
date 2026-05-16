// Utility meter — circular kWh meter with bi-directional flag.

import type { Meter } from '../../../lib/sld-v2/equipment'

export interface MeterBoxProps {
  meter: Meter
  x: number
  y: number
  debug?: boolean
}

export function MeterBox({ meter, x, y, debug }: MeterBoxProps) {
  const { width: w, height: h } = meter
  const { utility, serviceA, voltage, bidirectional, isRevenueGrade, meterNumber } = meter.props
  const sx = w / 70
  const sy = h / 70

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        {/* Outer frame */}
        <rect x="0.5" y="0.5" width="69" height="69" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1" />

        {/* H10 Pass-3 — Tyson PV-5 customer-generation caption above face */}
        <text x="35" y="8" fontSize="3.2" fontWeight="bold" fill="#222" textAnchor="middle">
          (N) CUSTOMER GENERATION
        </text>

        {/* Meter face (circle) */}
        <circle cx="35" cy="30" r="14" fill="white" stroke="#111" strokeWidth="1.4" />
        <text x="35" y="29" fontSize="9" fontWeight="bold" fill="#222" textAnchor="middle">
          M
        </text>
        <text x="35" y="36" fontSize="3" fill="#666" textAnchor="middle">
          kWh
        </text>

        {/* Bi-dir flag */}
        {bidirectional && (
          <text x="35" y="40.5" fontSize="2.6" fill="#22d3ee" textAnchor="middle">
            ↔ BI-DIR
          </text>
        )}

        {/* Footer info */}
        <text x="35" y="51" fontSize="3.5" fontWeight="bold" fill="#222" textAnchor="middle">
          (E) BI-DIR METER
        </text>
        <text x="35" y="55.5" fontSize="3" fill="#444" textAnchor="middle">
          {voltage} · {serviceA}A
        </text>
        <text x="35" y="60" fontSize="2.8" fill="#666" textAnchor="middle">
          {utility}{isRevenueGrade ? ' · RGM' : ''}
        </text>
        {meterNumber && (
          <text x="35" y="63.5" fontSize="2.6" fontWeight="bold" fill="#222" textAnchor="middle">
            METER NO: {meterNumber}
          </text>
        )}
        <text x="35" y="67" fontSize="3" fontWeight="bold" fill="#0e7490" textAnchor="middle">
          TO UTILITY GRID →
        </text>

        <g id={`anchors-${meter.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${meter.id}-N`} transform="translate(35, 0)" />
          <g id={`${meter.id}-S`} transform="translate(35, 70)" />
          <g id={`${meter.id}-W`} transform="translate(0, 35)" />
          <g id={`${meter.id}-E`} transform="translate(70, 35)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="35" cy="0" r="1.5" fill="cyan" />
            <circle cx="35" cy="70" r="1.5" fill="cyan" />
            <circle cx="0" cy="35" r="1.5" fill="cyan" />
            <circle cx="70" cy="35" r="1.5" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
