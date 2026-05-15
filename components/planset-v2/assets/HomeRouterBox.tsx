// Homeowner router — existing equipment, dashed border per (E) convention.
// Phase H8 Category H.

import type { HomeRouter } from '../../../lib/sld-v2/equipment'

export interface HomeRouterBoxProps {
  router: HomeRouter
  x: number
  y: number
  debug?: boolean
}

export function HomeRouterBox({ router, x, y, debug }: HomeRouterBoxProps) {
  const { width: w, height: h } = router
  const { label } = router.props
  const sx = w / 70
  const sy = h / 30

  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        <rect
          x="0.5"
          y="0.5"
          width="69"
          height="29"
          rx="1.5"
          ry="1.5"
          fill="white"
          stroke="#111"
          strokeWidth="1"
          strokeDasharray="2.5,1.5"
        />

        <text x="35" y="13" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">
          (E) HOMEOWNER
        </text>
        <text x="35" y="22" fontSize="5" fontWeight="bold" fill="#222" textAnchor="middle">
          {label.toUpperCase()}
        </text>

        <g id={`anchors-${router.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${router.id}-W`} transform="translate(0, 15)" />
          <g id={`${router.id}-E`} transform="translate(70, 15)" />
          <g id={`${router.id}-N`} transform="translate(35, 0)" />
          <g id={`${router.id}-S`} transform="translate(35, 30)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            <circle cx="0" cy="15" r="1.2" fill="cyan" />
            <circle cx="70" cy="15" r="1.2" fill="cyan" />
          </g>
        )}
      </g>
    </g>
  )
}
