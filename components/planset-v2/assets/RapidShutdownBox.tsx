// Rapid shutdown initiator or module-level RSD device.

import type { RapidShutdown } from '../../../lib/sld-v2/equipment'

export interface RapidShutdownBoxProps {
  rsd: RapidShutdown
  x: number
  y: number
  debug?: boolean
}

export function RapidShutdownBox({ rsd, x, y, debug }: RapidShutdownBoxProps) {
  const { width: w, height: h } = rsd
  const { model, role, necCitation } = rsd.props
  const sx = w / 60
  const sy = h / 24

  // Initiator = round red button. Module-level = small box.
  const isInitiator = role === 'initiator'

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="59" height="23" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1" />

        {isInitiator ? (
          // Red maintenance switch — circle on left
          <circle cx="10" cy="12" r="6" fill="#dc2626" stroke="#7f1d1d" strokeWidth="1" />
        ) : (
          // Module-level — small rect
          <rect x="4" y="6" width="12" height="12" fill="#fef3c7" stroke="#92400e" strokeWidth="0.6" />
        )}

        <text x="22" y="9" fontSize="4" fontWeight="bold" fill="#222">
          {isInitiator ? 'IMO RSD' : 'RSD'}
        </text>
        <text x="22" y="14" fontSize="3" fill="#666">{model}</text>
        <text x="22" y="19" fontSize="3" fill="#888">{necCitation}</text>

        <g id={`anchors-${rsd.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${rsd.id}-N`} transform="translate(30, 0)" />
          <g id={`${rsd.id}-S`} transform="translate(30, 24)" />
          <g id={`${rsd.id}-W`} transform="translate(0, 12)" />
          <g id={`${rsd.id}-E`} transform="translate(60, 12)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="30" cy="0" r="1.2" fill="cyan" />
            <circle cx="30" cy="24" r="1.2" fill="cyan" />
            <circle cx="0" cy="12" r="1.2" fill="cyan" />
            <circle cx="60" cy="12" r="1.2" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
