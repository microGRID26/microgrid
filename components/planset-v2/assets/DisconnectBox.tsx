// Disconnect — generic NEMA disconnect box used for PV/GEN/SERVICE/ESS roles.
// Role-discriminator drives the internal label only; geometry is shared.

import type { Disconnect } from '../../../lib/sld-v2/equipment'

export interface DisconnectBoxProps {
  disc: Disconnect
  x: number
  y: number
  debug?: boolean
}

export function DisconnectBox({ disc, x, y, debug }: DisconnectBoxProps) {
  const { width: w, height: h } = disc
  const { role, ampere, poles, fusible, fuseAmpere, bidirectional } = disc.props
  const sx = w / 80
  const sy = h / 90

  // L1/L2 contact lines + (optional) fuse symbols
  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="79" height="89" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1.2" />

        {/* Header: amp / poles */}
        <text x="40" y="11" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">
          {ampere}A / {poles}P
        </text>

        {/* L1 / L2 contact labels */}
        <text x="22" y="22" fontSize="4" fill="#666" textAnchor="middle">L1</text>
        <text x="58" y="22" fontSize="4" fill="#666" textAnchor="middle">L2</text>

        {/* Contact lines (open-blade disconnect symbol) */}
        <line x1="22" y1="26" x2="22" y2="42" stroke="#111" strokeWidth="1" />
        <line x1="58" y1="26" x2="58" y2="42" stroke="#111" strokeWidth="1" />
        <line x1="22" y1="56" x2="22" y2="72" stroke="#111" strokeWidth="1" />
        <line x1="58" y1="56" x2="58" y2="72" stroke="#111" strokeWidth="1" />

        {/* Open blade — diagonal stub */}
        <line x1="22" y1="42" x2="32" y2="50" stroke="#111" strokeWidth="1" />
        <line x1="58" y1="42" x2="48" y2="50" stroke="#111" strokeWidth="1" />

        {/* Optional middle "dotted couple" line */}
        <line x1="22" y1="50" x2="58" y2="50" stroke="#666" strokeWidth="0.5" strokeDasharray="1,1" />

        {fusible && (
          <g>
            {/* Fuse rectangles below the contacts (CL fuse symbol) */}
            <rect x="18" y="58" width="8" height="14" fill="white" stroke="#111" strokeWidth="0.8" />
            <rect x="54" y="58" width="8" height="14" fill="white" stroke="#111" strokeWidth="0.8" />
            <text x="40" y="72" fontSize="3.5" fill="#666" textAnchor="middle">
              {fuseAmpere}A FUSIBLE
            </text>
          </g>
        )}

        {/* Bottom label: voltage class + bidirectional flag */}
        <text x="40" y="84" fontSize="4" fill="#444" textAnchor="middle">
          240V · {disc.props.nemaRating}{bidirectional ? ' · BI-DIR' : ''}
        </text>

        {/* Role hint inside (small) */}
        <text x="4" y="86" fontSize="3" fill="#999">{role.toUpperCase()}</text>

        {/* Anchor manifest */}
        <g id={`anchors-${disc.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${disc.id}-N`} transform="translate(40, 0)" />
          <g id={`${disc.id}-S`} transform="translate(40, 90)" />
          <g id={`${disc.id}-W`} transform="translate(0, 45)" />
          <g id={`${disc.id}-E`} transform="translate(80, 45)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="40" cy="0" r="1.5" fill="cyan" />
            <circle cx="40" cy="90" r="1.5" fill="cyan" />
            <circle cx="0" cy="45" r="1.5" fill="cyan" />
            <circle cx="80" cy="45" r="1.5" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
