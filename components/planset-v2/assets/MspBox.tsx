// Phase 1.2 proof-of-concept — MSP equipment-kind component for sld-v2.
//
// Pattern (must replicate for the other 14 equipment kinds):
//   1. Receives the full MSP type (from lib/sld-v2/equipment.ts) plus an (x, y)
//      world coord assigned by the elkjs layout (Phase 2). Sizes itself to
//      msp.width × msp.height — the same bbox elkjs reserved.
//   2. Paints the symbol (frame + breaker subdivisions + ground bus) from
//      props.busbarA, props.mainBreakerA, props.backfeeds — NO hardcoded amp
//      ratings, no hardcoded "(N) MAIN SERVICE PANEL" duplicate label, no
//      hardcoded HYBRID #1 string. Everything comes from props.
//   3. Renders its INTERNAL labels (breaker face amps, MSP nameplate inside the
//      box) — these are ONLY rendered here, never duplicated in spec text.
//   4. EXTERNAL labels (rated voltage, NEMA rating, busbar callout) live in
//      msp.labels and get placed by the slot picker (Phase 3); this component
//      does NOT paint them.
//   5. Exposes port world-coordinate manifest via the SVG <g id="anchor-*">
//      pattern so elkjs can read them back if needed for debugging.

import type { MSP } from '../../../lib/sld-v2/equipment'

export interface MspBoxProps {
  msp: MSP
  /** World-coordinate origin assigned by elkjs (Phase 2). */
  x: number
  y: number
  /** When true, render debug overlays (port dots, slot rectangles). */
  debug?: boolean
}

export function MspBox({ msp, x, y, debug }: MspBoxProps) {
  const { width: w, height: h } = msp
  const { busbarA, mainBreakerA, voltage, nemaRating, backfeeds, hasSurgeProtector } = msp.props

  // Scale baseline: original sld-assets/msp-225a.tsx is 130×140 in its own
  // viewBox; equipment.width/height carries those dims, so this scales 1:1
  // unless caller specifies a different size.
  const sx = w / 130
  const sy = h / 140

  // Top header strip (panel name + voltage). One row, anchored inside.
  // We KEEP this inside the asset (it's the panel's own nameplate, not a
  // duplicate spec label).
  return (
    <g transform={`translate(${x},${y})`} fontFamily="Helvetica, Arial, sans-serif">
      <g transform={`scale(${sx}, ${sy})`}>
        {/* Frame */}
        <rect
          x="0.5"
          y="0.5"
          width="129"
          height="139"
          rx="2"
          ry="2"
          fill="white"
          stroke="#111"
          strokeWidth="1.2"
        />

        {/* Panel nameplate (own label — not spec-duplicable) */}
        <text x="65" y="11" fontSize="6" fontWeight="bold" fill="#222" textAnchor="middle">
          MAIN SERVICE PANEL
        </text>
        <text x="65" y="20" fontSize="4.8" fill="#444" textAnchor="middle">
          {busbarA}A RATED · {voltage}
        </text>
        <text x="65" y="27" fontSize="4" fill="#999" textAnchor="middle">
          NEMA {nemaRating}
        </text>
        <line x1="0.5" y1="32" x2="129.5" y2="32" stroke="#111" strokeWidth="1" />

        {/* Main breaker — top right. Same inside-rect label pattern as backfeeds.
            "TOP FED" label above the breaker rect indicates NEC 705.12(B)(2)
            compliance — main breaker fed from the top of the busbar. */}
        <text x="102" y="35" fontSize="3" fontWeight="bold" fill="#b45309" textAnchor="middle">
          TOP FED
        </text>
        <rect
          x="83"
          y="37"
          width="38"
          height="14"
          rx="1.5"
          ry="1.5"
          fill="white"
          stroke="#111"
          strokeWidth="1.4"
        />
        <text x="102" y="44" fontSize="4.5" fontWeight="bold" fill="#222" textAnchor="middle">
          {mainBreakerA}A · 2P
        </text>
        <text x="102" y="49" fontSize="3" fill="#888" textAnchor="middle">
          MAIN
        </text>

        {/* Backfeed breakers — left side, vertically stacked.
            Role label lives INSIDE the rect under the amp rating to avoid
            overlap when 2+ backfeeds stack.
            "OPPOSITE END OF BUS" label above the stack confirms NEC 705.12(B)(2)
            compliance — backfeed at opposite end of busbar from the main.
            Combo-breaker total below the OPPOSITE END label sums all backfeeds
            (Tyson "2 × 45A = 125A/2P" convention). */}
        <text x="28" y="34" fontSize="3" fontWeight="bold" fill="#b45309" textAnchor="middle">
          OPPOSITE END OF BUS
        </text>
        {backfeeds.length > 1 && (
          <>
            <text
              x="28"
              y={51 + Math.min(backfeeds.length - 1, 2) * 16 + 5}
              fontSize="2.8"
              fill="#444"
              textAnchor="middle"
            >
              {backfeeds.length} × {backfeeds[0].ampere}A = {backfeeds.reduce((s, bf) => s + bf.ampere, 0)}A/2P
            </text>
            <text
              x="28"
              y={51 + Math.min(backfeeds.length - 1, 2) * 16 + 9}
              fontSize="2.4"
              fill="#888"
              textAnchor="middle"
            >
              WITH #18 SHIELDED CABLE
            </text>
          </>
        )}
        {backfeeds.slice(0, 3).map((bf, i) => (
          <g key={bf.id}>
            <rect
              x="9"
              y={37 + i * 18}
              width="38"
              height="14"
              rx="1.5"
              ry="1.5"
              fill="white"
              stroke="#111"
              strokeWidth="0.8"
            />
            <text
              x="28"
              y={44 + i * 18}
              fontSize="4.5"
              fontWeight="bold"
              fill="#222"
              textAnchor="middle"
            >
              {bf.ampere}A · 2P
            </text>
            <text x="28" y={49 + i * 18} fontSize="3" fill="#888" textAnchor="middle">
              {bf.label.replace(/^\(N\)\s*/, '').replace(/BACKFEED$/, '')}
            </text>
            {/* Pass-8b — Tyson PV-5 "AT N.N kW AC SYSTEM" sub-line per backfeed */}
            {bf.acKw != null && bf.acKw > 0 && (
              <text x="28" y={52.5 + i * 18} fontSize="2.4" fill="#666" textAnchor="middle">
                AT {bf.acKw} kW AC
              </text>
            )}
          </g>
        ))}

        {/* Busbar separator — push down to clear stacked backfeeds */}
        <line x1="10" y1="92" x2="120" y2="92" stroke="#888" strokeWidth="0.8" />

        {/* Surge protector — below busbar, only if equipped */}
        {hasSurgeProtector && (
          <g>
            <rect
              x="37"
              y="102"
              width="56"
              height="14"
              rx="1"
              ry="1"
              fill="white"
              stroke="#888"
              strokeWidth="0.6"
            />
            <text x="65" y="111" fontSize="4" fill="#555" textAnchor="middle">
              (N) SURGE PROTECTOR
            </text>
          </g>
        )}

        {/* Ground bus indicator (bottom-left) */}
        <text x="6" y="136" fontSize="6" fontWeight="bold" fill="#222">
          G
        </text>

        {/* Anchor manifest for port debugging (invisible) */}
        <g id={`anchors-${msp.id}`} fill="none" stroke="none" pointerEvents="none">
          <g id={`${msp.id}-N`} transform="translate(65, 0)" />
          <g id={`${msp.id}-S`} transform="translate(65, 140)" />
          <g id={`${msp.id}-W`} transform="translate(0, 70)" />
          <g id={`${msp.id}-E`} transform="translate(130, 70)" />
        </g>

        {debug && (
          <g pointerEvents="none">
            {/* port dots */}
            <circle cx="65" cy="0" r="1.5" fill="cyan" />
            <circle cx="65" cy="140" r="1.5" fill="cyan" />
            <circle cx="0" cy="70" r="1.5" fill="cyan" />
            <circle cx="130" cy="70" r="1.5" fill="cyan" />
          </g>
        )}
      </g>

      {/* External slot debug overlays in world coords */}
      {debug &&
        msp.labelSlots.map((s, i) => {
          const SLOT_GAP = 6
          let sx0 = 0
          let sy0 = 0
          let sw = 60
          let sh = (s.maxLines + 1) * (s.lineHeight ?? 10)
          if (s.side === 'N') {
            sx0 = -10
            sy0 = -sh - SLOT_GAP
            sw = w + 20
          } else if (s.side === 'S') {
            sx0 = -10
            sy0 = h + SLOT_GAP
            sw = w + 20
          } else if (s.side === 'E') {
            sx0 = w + SLOT_GAP
            sy0 = 0
            sw = s.maxLineWidth
            sh = h
          } else {
            sx0 = -SLOT_GAP - s.maxLineWidth
            sy0 = 0
            sw = s.maxLineWidth
            sh = h
          }
          return (
            <rect
              key={`slot-${i}`}
              x={sx0}
              y={sy0}
              width={sw}
              height={sh}
              fill="rgba(0, 200, 255, 0.08)"
              stroke="#22d3ee"
              strokeWidth="0.5"
              strokeDasharray="3,2"
              pointerEvents="none"
            />
          )
        })}
    </g>
  )
}
