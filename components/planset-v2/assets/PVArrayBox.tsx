// PV array — grid of modules sized to moduleCount + stringCount.

import type { PVArray } from '../../../lib/sld-v2/equipment'

export interface PVArrayBoxProps {
  arr: PVArray
  x: number
  y: number
  debug?: boolean
}

export function PVArrayBox({ arr, x, y, debug }: PVArrayBoxProps) {
  const { width: w, height: h } = arr
  const { moduleCount, stringCount, modulesPerString, moduleModel, moduleWatts } = arr.props
  const sx = w / 280
  const sy = h / 140

  // Layout: stringCount rows × modulesPerString columns
  const headerH = 20
  const cellW = 260 / modulesPerString
  const cellH = (140 - headerH - 14) / stringCount

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="279" height="139" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1.2" />

        {/* Header */}
        <text x="140" y="11" fontSize="6.5" fontWeight="bold" fill="#222" textAnchor="middle">
          PV ARRAY
        </text>
        <text x="140" y="18" fontSize="4" fill="#666" textAnchor="middle">
          ({moduleCount}) × {moduleModel.split(' ').slice(0, 2).join(' ')} · {moduleWatts}W
        </text>

        {/* Module grid */}
        {Array.from({ length: stringCount }).map((_, si) =>
          Array.from({ length: modulesPerString }).map((_, mi) => {
            const cx = 10 + mi * cellW
            const cy = headerH + si * cellH
            return (
              <rect
                key={`${si}-${mi}`}
                x={cx}
                y={cy}
                width={cellW - 2}
                height={cellH - 2}
                rx="0.5"
                ry="0.5"
                fill="#f1f5f9"
                stroke="#444"
                strokeWidth="0.3"
              />
            )
          })
        )}

        {/* String labels */}
        {Array.from({ length: stringCount }).map((_, si) => (
          <text
            key={`label-${si}`}
            x="6"
            y={headerH + si * cellH + cellH / 2 + 1.5}
            fontSize="3.5"
            fill="#666"
          >
            S{si + 1}
          </text>
        ))}

        {/* Footer */}
        <text x="140" y="135" fontSize="3.5" fill="#888" textAnchor="middle">
          {stringCount} string{stringCount > 1 ? 's' : ''} × {modulesPerString} modules · NEC 690.12
        </text>

        <g id={`anchors-${arr.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${arr.id}-N`} transform="translate(140, 0)" />
          <g id={`${arr.id}-S`} transform="translate(140, 140)" />
          <g id={`${arr.id}-W`} transform="translate(0, 70)" />
          <g id={`${arr.id}-E`} transform="translate(280, 70)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="140" cy="0" r="2" fill="cyan" />
            <circle cx="140" cy="140" r="2" fill="cyan" />
            <circle cx="0" cy="70" r="2" fill="cyan" />
            <circle cx="280" cy="70" r="2" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
