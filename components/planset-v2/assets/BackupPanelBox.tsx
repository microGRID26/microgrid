// Backup loads panel — MLO sub-panel fed from hybrid inverter BACKUP AC port.

import type { BackupPanel } from '../../../lib/sld-v2/equipment'

export interface BackupPanelBoxProps {
  panel: BackupPanel
  x: number
  y: number
  debug?: boolean
}

export function BackupPanelBox({ panel, x, y, debug }: BackupPanelBoxProps) {
  const { width: w, height: h } = panel
  const { mainLugAmperage, circuitCount, nemaRating } = panel.props
  const sx = w / 110
  const sy = h / 70

  // Circuit grid — circuitCount columns split into 2 rows
  const cols = Math.ceil(circuitCount / 2)
  const cellW = 90 / cols
  const cellH = 8

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="109" height="69" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1.2" />

        <text x="55" y="11" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">
          BACKUP LOADS PANEL
        </text>
        <text x="55" y="20" fontSize="4" fill="#666" textAnchor="middle">
          {mainLugAmperage}A MLO · {circuitCount}-circ · NEMA {nemaRating}
        </text>

        {/* Circuit slots */}
        {Array.from({ length: cols }).map((_, ci) => (
          <g key={ci}>
            <rect
              x={10 + ci * cellW}
              y="28"
              width={cellW - 1}
              height={cellH}
              fill="white"
              stroke="#888"
              strokeWidth="0.3"
            />
            <rect
              x={10 + ci * cellW}
              y={28 + cellH + 2}
              width={cellW - 1}
              height={cellH}
              fill="white"
              stroke="#888"
              strokeWidth="0.3"
            />
          </g>
        ))}

        <text x="6" y="64" fontSize="3.5" fontWeight="bold" fill="#222">G</text>
        <text x="55" y="64" fontSize="3.5" fill="#888" textAnchor="middle">
          FED FROM HYBRID BACKUP AC
        </text>

        <g id={`anchors-${panel.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${panel.id}-N`} transform="translate(55, 0)" />
          <g id={`${panel.id}-S`} transform="translate(55, 70)" />
          <g id={`${panel.id}-W`} transform="translate(0, 35)" />
          <g id={`${panel.id}-E`} transform="translate(110, 35)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="55" cy="0" r="1.5" fill="cyan" />
            <circle cx="55" cy="70" r="1.5" fill="cyan" />
            <circle cx="0" cy="35" r="1.5" fill="cyan" />
            <circle cx="110" cy="35" r="1.5" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
