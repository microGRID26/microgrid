// Junction box — DC / AC / comms. Voltage rating + NEMA in props.

import type { JunctionBox } from '../../../lib/sld-v2/equipment'

export interface JunctionBoxBoxProps {
  jb: JunctionBox
  x: number
  y: number
  debug?: boolean
}

export function JunctionBoxBox({ jb, x, y, debug }: JunctionBoxBoxProps) {
  const { width: w, height: h } = jb
  const { role, nemaRating, voltageRating } = jb.props
  const sx = w / 60
  const sy = h / 40

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="59" height="39" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1" />

        <text x="30" y="11" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">
          {role.toUpperCase()} JB
        </text>
        <text x="30" y="20" fontSize="3.5" fill="#666" textAnchor="middle">{voltageRating}</text>
        <text x="30" y="27" fontSize="3.5" fill="#666" textAnchor="middle">NEMA {nemaRating}</text>

        {/* Conductor splice marks */}
        <circle cx="18" cy="33" r="1.2" fill="#111" />
        <circle cx="30" cy="33" r="1.2" fill="#111" />
        <circle cx="42" cy="33" r="1.2" fill="#111" />

        <g id={`anchors-${jb.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${jb.id}-N`} transform="translate(30, 0)" />
          <g id={`${jb.id}-S`} transform="translate(30, 40)" />
          <g id={`${jb.id}-W`} transform="translate(0, 20)" />
          <g id={`${jb.id}-E`} transform="translate(60, 20)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="30" cy="0" r="1.2" fill="cyan" />
            <circle cx="30" cy="40" r="1.2" fill="cyan" />
            <circle cx="0" cy="20" r="1.2" fill="cyan" />
            <circle cx="60" cy="20" r="1.2" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
