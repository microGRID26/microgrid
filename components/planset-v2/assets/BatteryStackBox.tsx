// Battery stack — N modules stacked vertically, chemistry-labeled.

import type { BatteryStack } from '../../../lib/sld-v2/equipment'

export interface BatteryStackBoxProps {
  stack: BatteryStack
  x: number
  y: number
  debug?: boolean
}

export function BatteryStackBox({ stack, x, y, debug }: BatteryStackBoxProps) {
  const { width: w, height: h } = stack
  const { moduleCount, moduleKwh, chemistry } = stack.props
  const sx = w / 90
  const sy = h / 110

  const totalKwh = moduleCount * moduleKwh
  // Module rows — scale to fit moduleCount in the body area
  const bodyTop = 30
  const bodyBot = 96
  const rowH = (bodyBot - bodyTop) / Math.max(moduleCount, 1)

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect x="0.5" y="0.5" width="89" height="109" rx="2" ry="2" fill="white" stroke="#111" strokeWidth="1.2" />

        {/* Header */}
        <text x="45" y="12" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">
          BATTERY STACK
        </text>
        <text x="45" y="20" fontSize="4.5" fill="#444" textAnchor="middle">
          {chemistry} · {totalKwh} kWh
        </text>
        <text x="45" y="27" fontSize="4" fill="#888" textAnchor="middle">
          ({moduleCount}) × {moduleKwh} kWh
        </text>

        {/* Module bricks */}
        {Array.from({ length: moduleCount }).map((_, i) => {
          const yTop = bodyTop + i * rowH
          return (
            <g key={i}>
              <rect
                x="10"
                y={yTop + 0.5}
                width="70"
                height={rowH - 1}
                rx="0.8"
                ry="0.8"
                fill="#f9fafb"
                stroke="#666"
                strokeWidth="0.4"
              />
              <text
                x="14"
                y={yTop + rowH / 2 + 1.5}
                fontSize="3"
                fill="#666"
              >
                MOD {i + 1}
              </text>
            </g>
          )
        })}

        {/* Plus/minus terminal markers */}
        <text x="6" y="34" fontSize="4" fontWeight="bold" fill="#dc2626" textAnchor="middle">+</text>
        <text x="6" y="94" fontSize="4" fontWeight="bold" fill="#111" textAnchor="middle">−</text>

        <g id={`anchors-${stack.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${stack.id}-N`} transform="translate(45, 0)" />
          <g id={`${stack.id}-S`} transform="translate(45, 110)" />
          <g id={`${stack.id}-W`} transform="translate(0, 55)" />
          <g id={`${stack.id}-E`} transform="translate(90, 55)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="45" cy="0" r="1.5" fill="cyan" />
            <circle cx="45" cy="110" r="1.5" fill="cyan" />
            <circle cx="0" cy="55" r="1.5" fill="cyan" />
            <circle cx="90" cy="55" r="1.5" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
