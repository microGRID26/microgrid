// Comm gateway (DPCRGM-Cell) — aggregates inverter + battery comm, bridges
// to homeowner network via ethernet/cellular. Phase H8 Category H.

import type { CommGateway } from '../../../lib/sld-v2/equipment'

export interface CommGatewayBoxProps {
  gw: CommGateway
  x: number
  y: number
  debug?: boolean
}

export function CommGatewayBox({ gw, x, y, debug }: CommGatewayBoxProps) {
  const { width: w, height: h } = gw
  const { model, bridge } = gw.props
  const sx = w / 90
  const sy = h / 40

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="89" height="39" rx="1.5" ry="1.5" fill="white" stroke="#111" strokeWidth="1" />

        <text x="45" y="11" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">
          (N) {model.toUpperCase()}
        </text>
        <text x="45" y="20" fontSize="3.5" fill="#666" textAnchor="middle">COMM GATEWAY</text>
        <text x="45" y="27" fontSize="3.5" fill="#666" textAnchor="middle">BRIDGE: {bridge.toUpperCase()}</text>

        {/* Aggregation marks — three small dots indicating multi-source comm input */}
        <circle cx="20" cy="34" r="1.2" fill="#111" />
        <circle cx="45" cy="34" r="1.2" fill="#111" />
        <circle cx="70" cy="34" r="1.2" fill="#111" />

        <g id={`anchors-${gw.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${gw.id}-N`} transform="translate(45, 0)" />
          <g id={`${gw.id}-S`} transform="translate(45, 40)" />
          <g id={`${gw.id}-W`} transform="translate(0, 20)" />
          <g id={`${gw.id}-E`} transform="translate(90, 20)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="45" cy="0" r="1.2" fill="cyan" />
            <circle cx="45" cy="40" r="1.2" fill="cyan" />
            <circle cx="0" cy="20" r="1.2" fill="cyan" />
            <circle cx="90" cy="20" r="1.2" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
