// SldRenderer — Phase 2 renderer that consumes a LayoutResult from
// lib/sld-v2/layout.ts (elkjs adapter) and paints to SVG.
//
// Dispatch by equipment.kind to the per-kind component shipped in
// components/planset-v2/assets/. Edges are painted as orthogonal polylines
// with conductor spec callouts attached at midpoint.

import type { LayoutResult, RoutedEdge } from '../../lib/sld-v2/layout'
import type { Equipment } from '../../lib/sld-v2/equipment'
import type { LabelPlacementResult } from '../../lib/sld-v2/labels'
import { TYSON_CALLOUTS_PV5 } from '../../lib/sld-v2/callout-legend'

import { MspBox } from './assets/MspBox'
import { DisconnectBox } from './assets/DisconnectBox'
import { HybridInverterBox } from './assets/HybridInverterBox'
import { BatteryStackBox } from './assets/BatteryStackBox'
import { MeterBox } from './assets/MeterBox'
import { PVArrayBox } from './assets/PVArrayBox'
import { RapidShutdownBox } from './assets/RapidShutdownBox'
import { JunctionBoxBox } from './assets/JunctionBoxBox'
import { BackupPanelBox } from './assets/BackupPanelBox'
import { ProductionCtBox } from './assets/ProductionCtBox'
import { CommGatewayBox } from './assets/CommGatewayBox'
import { HomeRouterBox } from './assets/HomeRouterBox'
import { GroundingElectrodeBox } from './assets/GroundingElectrodeBox'

export interface SldRendererProps {
  layout: LayoutResult
  /** Optional output of placeLabels(layout.laidOut, layout.edges).
   *  When supplied, the renderer paints external-label slot text + leader callouts. */
  labelPlacement?: LabelPlacementResult
  debug?: boolean
}

const EDGE_COLOR_BY_CATEGORY: Record<string, string> = {
  'dc-string': '#16a34a',   // green
  'dc-battery': '#d97706',  // orange
  'ac-inverter': '#0e7490', // teal
  'ac-service': '#222',     // black (utility-class)
  'comm': '#9333ea',        // purple
  'ground': '#84cc16',      // lime
  'gec': '#84cc16',
}

function renderEquipment(eq: Equipment, x: number, y: number, debug: boolean) {
  switch (eq.kind) {
    case 'MSP':
      return <MspBox key={eq.id} msp={eq} x={x} y={y} debug={debug} />
    case 'Disconnect':
      return <DisconnectBox key={eq.id} disc={eq} x={x} y={y} debug={debug} />
    case 'HybridInverter':
      return <HybridInverterBox key={eq.id} inv={eq} x={x} y={y} debug={debug} />
    case 'BatteryStack':
      return <BatteryStackBox key={eq.id} stack={eq} x={x} y={y} debug={debug} />
    case 'Meter':
      return <MeterBox key={eq.id} meter={eq} x={x} y={y} debug={debug} />
    case 'PVArray':
      return <PVArrayBox key={eq.id} arr={eq} x={x} y={y} debug={debug} />
    case 'RapidShutdown':
      return <RapidShutdownBox key={eq.id} rsd={eq} x={x} y={y} debug={debug} />
    case 'JunctionBox':
      return <JunctionBoxBox key={eq.id} jb={eq} x={x} y={y} debug={debug} />
    case 'BackupPanel':
      return <BackupPanelBox key={eq.id} panel={eq} x={x} y={y} debug={debug} />
    case 'ProductionCT':
      return <ProductionCtBox key={eq.id} ct={eq} x={x} y={y} debug={debug} />
    case 'CommGateway':
      return <CommGatewayBox key={eq.id} gw={eq} x={x} y={y} debug={debug} />
    case 'HomeRouter':
      return <HomeRouterBox key={eq.id} router={eq} x={x} y={y} debug={debug} />
    case 'GroundingElectrode':
      return <GroundingElectrodeBox key={eq.id} ge={eq} x={x} y={y} debug={debug} />
    // Phase 1.3-deferred kinds — Phase 7 will fill these in.
    case 'StringInverter':
    case 'MicroInverter':
    case 'EVCharger':
    default:
      return (
        <g key={eq.id} transform={`translate(${x},${y})`}>
          <rect width={eq.width} height={eq.height} fill="#fef3c7" stroke="#d97706" strokeWidth="1" />
          <text x={eq.width / 2} y={eq.height / 2} fontSize="8" textAnchor="middle" fill="#92400e">
            TODO: {eq.kind}
          </text>
        </g>
      )
  }
}

function polylinePoints(edge: RoutedEdge): string {
  return edge.polyline.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Phase H8 Category G full — multi-line conductor split.
 *  Returns polyline points offset perpendicular to each segment. ELK gives
 *  orthogonal routing (segments are horizontal or vertical), so perpendicular
 *  is trivial: horizontal seg ⇒ offset y; vertical seg ⇒ offset x. At corners
 *  the offset segments meet with a small visual gap which reads acceptably
 *  for AHJ stamping. */
function offsetPolylinePoints(edge: RoutedEdge, offset: number): string {
  const pts = edge.polyline
  if (pts.length < 2) return ''
  if (offset === 0) return polylinePoints(edge)

  const out: Array<{ x: number; y: number }> = []
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    // Decide perpendicular direction from the adjacent segment.
    const adj = i < pts.length - 1 ? pts[i + 1] : pts[i - 1]
    const dx = adj.x - cur.x
    const dy = adj.y - cur.y
    let nx = 0, ny = 0
    if (Math.abs(dx) >= Math.abs(dy)) {
      // Horizontal segment — offset in y.
      ny = 1
    } else {
      // Vertical segment — offset in x.
      nx = 1
    }
    out.push({ x: cur.x + nx * offset, y: cur.y + ny * offset })
  }
  return out.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Three-line / two-line conductor color schemes per category.
 *  Phase H8 Category G full. Empty = single-line legacy render. */
const MULTI_LINE_PHASES: Record<string, Array<{ color: string; label: string }>> = {
  'ac-inverter': [
    { color: '#dc2626', label: 'L1' },
    { color: '#111',    label: 'L2' },
    { color: '#9ca3af', label: 'N' },
    { color: '#16a34a', label: 'G' },
  ],
  'ac-service': [
    { color: '#dc2626', label: 'L1' },
    { color: '#111',    label: 'L2' },
    { color: '#9ca3af', label: 'N' },
    { color: '#16a34a', label: 'G' },
  ],
  'dc-string': [
    { color: '#dc2626', label: '+' },
    { color: '#111',    label: '-' },
    { color: '#16a34a', label: 'G' },
  ],
  'dc-battery': [
    { color: '#dc2626', label: '+' },
    { color: '#111',    label: '-' },
    { color: '#16a34a', label: 'G' },
  ],
}

/** Spacing between parallel phase polylines, in svg user-units.
 *  H10 Pass-5 — bumped 1.6 → 2.8 so AC L1 / L2 / N (and DC + / −)
 *  visually separate at the standard PV-5 print scale. Tyson Rev1
 *  shows them clearly distinguishable; at 1.6 they blended into one
 *  thick stroke at default zoom.
 *  H10 Pass-18d — trimmed 2.8 → 2.2. Pass-6 widened bundles from 3
 *  to 4 stripes (added G ground); at 2.8pt × 4 stripes the AC bundle
 *  was 11.2pt wide and crossed visibly through HYBRID box bodies on
 *  the tight routing area. 2.2 × 4 = 8.8pt — still visually distinct
 *  but ~20% less visual mass through congested regions. */
const PHASE_SPACING = 2.2

interface LayoutBBox { x: number; y: number; w: number; h: number }

function bboxesOverlap(a: LayoutBBox, b: LayoutBBox): boolean {
  return !(
    a.x + a.w <= b.x
    || b.x + b.w <= a.x
    || a.y + a.h <= b.y
    || b.y + b.h <= a.y
  )
}

/** Polyline segment as a thin avoidance bbox (matches lib/sld-v2/labels.ts
 *  edgeBBoxes shape so the two avoidance sets stay coherent). */
function edgeSegmentBoxes(edges: RoutedEdge[]): LayoutBBox[] {
  const out: LayoutBBox[] = []
  for (const e of edges) {
    for (let i = 0; i < e.polyline.length - 1; i++) {
      const a = e.polyline[i]
      const b = e.polyline[i + 1]
      const minX = Math.min(a.x, b.x) - 1
      const minY = Math.min(a.y, b.y) - 1
      const maxX = Math.max(a.x, b.x) + 1
      const maxY = Math.max(a.y, b.y) + 1
      out.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY })
    }
  }
  return out
}

/** Phase H8 Category B — conductor text may carry `\n`-separated multi-line
 *  Tyson-convention spec (wire / EGC / conduit). Compute the bbox the wire
 *  label occupies on the page so midpoint placement + avoidance keep working.
 *  Pass-15e — lineHeight bumped 7 -> 8 because at fontSize=6, consecutive
 *  baselines 7pt apart caused 0.13pt overlap between lines (pdftotext bbox
 *  bottom of "(3) #6 CU THWN-2" intruded into top of "(1) #10 EGC"). 8pt
 *  baseline-to-baseline gives ~1pt clean visual gap. */
const LABEL_LINE_HEIGHT = 8
function labelMetrics(text: string): { lines: string[]; w: number; h: number } {
  const lines = text.split('\n')
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0)
  return {
    lines,
    w: maxLen * 3.5 + 4,
    h: LABEL_LINE_HEIGHT * lines.length + 2,
  }
}

/** Find a midpoint along the edge such that the conductor LABEL bbox
 *  (anchored at midpoint, extending rightward by ~labelText.length × 3.5 px,
 *  grows upward 7px per line) does NOT overlap any avoidance box. avoidance =
 *  equipment bboxes + segments of OTHER edges + previously-placed wire
 *  labels. Returns null if no segment works — caller skips the label. */
function midpoint(
  edge: RoutedEdge,
  avoidance: LayoutBBox[],
  labelText: string,
): { x: number; y: number } | null {
  const pts = edge.polyline
  if (pts.length < 2) return null

  const { w: labelW, h: labelH } = labelMetrics(labelText)

  const segments: Array<{ ax: number; ay: number; bx: number; by: number; len: number }> = []
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x, by = pts[i + 1].y
    segments.push({ ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay) })
  }
  segments.sort((a, b) => b.len - a.len)

  for (const s of segments) {
    const mx = (s.ax + s.bx) / 2
    const my = (s.ay + s.by) / 2
    const labelBBox: LayoutBBox = {
      x: mx - 2,
      y: my - 1 - labelH,
      w: labelW,
      h: labelH,
    }
    if (!avoidance.some((b) => bboxesOverlap(b, labelBBox))) {
      return { x: mx, y: my }
    }
  }
  return null
}

export function SldRenderer({ layout, labelPlacement, debug = false }: SldRendererProps) {
  const W = layout.width + layout.margin * 2
  const H = layout.height + layout.margin * 2
  const ox = layout.margin
  const oy = layout.margin

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
    >
      {/* Edges first (drawn under nodes) */}
      <g transform={`translate(${ox}, ${oy})`}>
        {(() => {
          // Build avoidance pieces:
          //   1. Equipment bboxes — wire labels never sit on a block.
          //   2. Per-edge "other-edge segment" bboxes — wire labels never
          //      sit on a parallel conductor (#1006 fix). Computed via
          //      lookup table so we don't recompute the full segment list
          //      for every edge.
          //   3. Equipment-label bboxes (when labelPlacement is supplied)
          //      so wire labels also avoid the printed equipment text.
          //   4. Cumulative wire-label bboxes — wire labels don't stack
          //      on each other.
          const blockBoxes: LayoutBBox[] = layout.laidOut.map((lo) => ({
            x: lo.x,
            y: lo.y,
            w: lo.equipment.width,
            h: lo.equipment.height,
          }))
          const placedLabelBoxes: LayoutBBox[] = (labelPlacement?.slots ?? []).map((s) => s.bbox)
          // Pass-17 bugfix — was computing per-edge "own segments" via a Map
          // built from `edgeSegmentBoxes([e])`, then trying to filter the
          // ALL-EDGES bbox list by `!ownSegments.includes(b)`. But
          // edgeSegmentBoxes constructs new objects each call, so reference
          // equality NEVER matched — every wire label was checking against
          // its OWN segments as avoidance and getting rejected on tight runs
          // (pv-rsd / rsd-dc-jb / dc-jb-hybrid-1 were silently dropping their
          // labels for the entire chain). Replaced with a value-equality
          // approach: build "other-edge bboxes" by edge id at compute time.
          const allOtherSegmentsByEdge = new Map<string, LayoutBBox[]>()
          for (const e of layout.edges) {
            const others = layout.edges.filter((o) => o.connection.id !== e.connection.id)
            allOtherSegmentsByEdge.set(e.connection.id, edgeSegmentBoxes(others))
          }
          const placedWireLabelBoxes: LayoutBBox[] = []
          const edgeRenderData = layout.edges.map((edge) => {
            const color = EDGE_COLOR_BY_CATEGORY[edge.connection.category] ?? '#111'
            const otherEdgeBoxes = allOtherSegmentsByEdge.get(edge.connection.id) ?? []
            const avoidance: LayoutBBox[] = [
              ...blockBoxes,
              ...otherEdgeBoxes,
              ...placedLabelBoxes,
              ...placedWireLabelBoxes,
            ]
            const mid = midpoint(edge, avoidance, edge.connection.conductor ?? '')
            if (mid && edge.connection.conductor) {
              const { w, h } = labelMetrics(edge.connection.conductor)
              placedWireLabelBoxes.push({ x: mid.x - 2, y: mid.y - 1 - h, w, h })
            }
            return { edge, color, mid }
          })
          return (
            <>
              {/* Pass 1 — all polylines. Phase H8 Category G full:
                  ac-inverter / ac-service render as 3 parallel L1/L2/N
                  polylines; dc-string / dc-battery render as 2 parallel +/-
                  polylines. comm / ground / gec stay single-line legacy. */}
              {edgeRenderData.map(({ edge, color }) => {
                const phases = MULTI_LINE_PHASES[edge.connection.category]
                if (phases) {
                  const baseOffset = -((phases.length - 1) / 2) * PHASE_SPACING
                  // Phase H8 polish — inline phase labels at the TARGET end
                  // of each parallel polyline (where the wire enters the
                  // downstream equipment). One small colored label per phase,
                  // text matches the phase ("L1" / "N" / "L2" / "+" / "-").
                  const pts = edge.polyline
                  const last = pts[pts.length - 1]
                  const prev = pts[pts.length - 2] ?? last
                  const dx = last.x - prev.x
                  const dy = last.y - prev.y
                  // Pull labels back 5pt along the segment direction so they
                  // sit just BEFORE the equipment port instead of inside it.
                  const segLen = Math.hypot(dx, dy) || 1
                  const pullX = -(dx / segLen) * 5
                  const pullY = -(dy / segLen) * 5
                  // Perpendicular axis for stacking labels per parallel line.
                  const perpAxis = Math.abs(dx) >= Math.abs(dy) ? 'y' : 'x'
                  return (
                    <g key={`line-${edge.connection.id}`}>
                      {phases.map((p, i) => {
                        const offset = baseOffset + i * PHASE_SPACING
                        // Pass-10 — Ground stripe rendered thinner than the
                        // load-bearing L1/L2/N (or +/-) lines so it reads as
                        // "additional NEC ground" rather than competing for
                        // visual weight with the actual phase conductors.
                        // Cuts down bundle "thickness" complaints from the
                        // 4-wide AC stripes added in Pass-6.
                        const isGround = p.label === 'G'
                        return (
                          <polyline
                            key={`line-${edge.connection.id}-${p.label}`}
                            points={offsetPolylinePoints(edge, offset)}
                            fill="none"
                            stroke={p.color}
                            strokeWidth={isGround ? '0.55' : '1.1'}
                          />
                        )
                      })}
                      {phases.map((p, i) => {
                        // Pass-15d — labels at perpendicular spacing 3.4
                        // (separate from polyline PHASE_SPACING).
                        // Pass-18e — drop the 'G' label text entirely. Ground
                        // is documented in the wire-color legend; the thin
                        // green stripe carries the visual cue. Cuts label
                        // crowding at edge endpoints by 25%.
                        if (p.label === 'G') return null
                        const labelOffset = baseOffset * (3.4 / PHASE_SPACING) + i * 3.4
                        const lx = last.x + pullX + (perpAxis === 'x' ? labelOffset : 0)
                        const ly = last.y + pullY + (perpAxis === 'y' ? labelOffset : 0)
                        return (
                          <text
                            key={`phase-${edge.connection.id}-${p.label}`}
                            x={lx}
                            y={ly + 1}
                            fontSize="2.6"
                            fontWeight="bold"
                            textAnchor="middle"
                            fill={p.color}
                            fontFamily="Helvetica, Arial, sans-serif"
                          >
                            {p.label}
                          </text>
                        )
                      })}
                    </g>
                  )
                }
                return (
                  <polyline
                    key={`line-${edge.connection.id}`}
                    points={polylinePoints(edge)}
                    fill="none"
                    stroke={color}
                    strokeWidth={edge.connection.category === 'ground' || edge.connection.category === 'gec' ? 1.4 : 1.6}
                    strokeDasharray={edge.connection.category === 'comm' ? '4,2' : undefined}
                  />
                )
              })}
              {/* Pass 2 — all wire labels (always paint on top of any line).
                  Phase H8 Category B: multi-line stack grows UPWARD from the
                  wire midpoint, so the bottom line baseline matches today's
                  1-line position. */}
              {edgeRenderData.map(({ edge, color, mid }) => {
                if (!edge.connection.conductor || !mid) return null
                const { lines, w, h } = labelMetrics(edge.connection.conductor)
                const groupY = mid.y - 3 - LABEL_LINE_HEIGHT * (lines.length - 1)
                return (
                  <g key={`label-${edge.connection.id}`} transform={`translate(${mid.x}, ${groupY})`}>
                    <rect
                      x={-2}
                      y={-7}
                      width={w}
                      height={h}
                      fill="white"
                      stroke="none"
                    />
                    <text fontSize="6" fill={color} fontFamily="Helvetica, Arial, sans-serif">
                      {lines.map((line, i) => (
                        <tspan key={i} x={0} dy={i === 0 ? 0 : LABEL_LINE_HEIGHT}>{line}</tspan>
                      ))}
                    </text>
                  </g>
                )
              })}
            </>
          )
        })()}
      </g>

      {/* Nodes on top */}
      <g transform={`translate(${ox}, ${oy})`}>
        {layout.laidOut.map((lo) => renderEquipment(lo.equipment, lo.x, lo.y, debug))}
      </g>

      {/* Phase H8 Category E — "10' MAX" dimension annotation between PV
          disconnect and utility meter. NEC 230.70(A)(1) — service disconnect
          must be within sight of and ≤10' from the meter. Skipped silently
          if either target is missing. */}
      <g transform={`translate(${ox}, ${oy})`}>
        {(() => {
          const pvDisc = layout.laidOut.find((lo) => lo.equipment.id === 'disc-pv')
          const meter = layout.laidOut.find((lo) => lo.equipment.id === 'meter')
          if (!pvDisc || !meter) return null
          // Move the dim line ABOVE every equipment-top + every
          // placed label slot above any equipment (top-slot labels can
          // stack 2-3 lines). -40 from min equipment top gives ~18pt
          // for label text + ~5pt clearance for callout circles
          // (which sit at equipmentTop - 5).
          const minEquipTop = layout.laidOut.reduce(
            (m, lo) => Math.min(m, lo.y),
            Math.min(pvDisc.y, meter.y),
          )
          const y = minEquipTop - 40
          const x1 = pvDisc.x + pvDisc.equipment.width / 2
          const x2 = meter.x + meter.equipment.width / 2
          const midX = (x1 + x2) / 2
          return (
            <g>
              <line x1={x1} y1={y} x2={x2} y2={y} stroke="#d97706" strokeWidth="0.6" />
              {/* End-cap tick marks */}
              <line x1={x1} y1={y - 3} x2={x1} y2={y + 3} stroke="#d97706" strokeWidth="0.6" />
              <line x1={x2} y1={y - 3} x2={x2} y2={y + 3} stroke="#d97706" strokeWidth="0.6" />
              {/* Arrows */}
              <polygon points={`${x1},${y} ${x1 + 4},${y - 2} ${x1 + 4},${y + 2}`} fill="#d97706" />
              <polygon points={`${x2},${y} ${x2 - 4},${y - 2} ${x2 - 4},${y + 2}`} fill="#d97706" />
              {/* Pass-15c — bumped rect height + NEC baseline up so "10' MAX"
                  fontSize 6 apostrophe doesn't kiss the NEC line above (apostrophe
                  glyph extends nearly a full em above baseline). */}
              <rect x={midX - 22} y={y - 16} width="44" height="13" fill="white" stroke="none" />
              <text
                x={midX}
                y={y - 10}
                fontSize="4"
                textAnchor="middle"
                fill="#666"
                fontFamily="Helvetica, Arial, sans-serif"
              >
                NEC 230.70(A)(1)
              </text>
              <text
                x={midX}
                y={y - 2}
                fontSize="6"
                fontWeight="bold"
                textAnchor="middle"
                fill="#d97706"
                fontFamily="Helvetica, Arial, sans-serif"
              >
                10&apos; MAX
              </text>
            </g>
          )
        })()}
      </g>

      {/* Phase H8 Category C — distributed NEC numbered callouts (1-9).
          Yellow filled circles at the NE corner of each target equipment.
          Callouts whose target equipment isn't in the laid-out set are
          silently skipped (e.g. RSD absent on integrated-microinverter topology). */}
      <g transform={`translate(${ox}, ${oy})`}>
        {(() => {
          // H11 Pass-2 — when two callouts share the same anchor equipment
          // (e.g. #3 BUSBAR + #6 EGC both on 'msp'), offset each successive
          // sibling 12 SVG units to the left so the circles don't stack
          // into a single-digit double-stamp. Circle diameter 8 + 4 gap.
          const siblingIndex = new Map<string, number>()
          return TYSON_CALLOUTS_PV5.map((c) => {
            const target = layout.laidOut.find((lo) => lo.equipment.id === c.equipmentId)
            if (!target) return null
            const seenBefore = siblingIndex.get(c.equipmentId) ?? 0
            siblingIndex.set(c.equipmentId, seenBefore + 1)
            // Anchor INSIDE the equipment's top-right corner. External-label
            // space above the box is owned by Phase 3 label placement (and
            // can stack 3+ lines), so placing OUTSIDE causes collisions.
            // Inside the corner, equipment box components keep their text
            // centered or left-aligned away from corners — top-right (-6,+6)
            // is reliably whitespace for boxes ≥ 50pt wide.
            // Phase H12 Pass-9 — sibling offset bumped 12→14 to accommodate
            // the larger r=5 circles without overlap (2 × r + 4pt gap).
            const cx = target.x + target.equipment.width - 7 - seenBefore * 14
            const cy = target.y + 7
            return (
              <g key={`nec-callout-${c.number}`}>
                {/* Phase H12 Pass-9 — bumped r=4→5 and fontSize=5→6 for AHJ
                    readability. After the SVG-to-PDF body scale (~0.79),
                    r=4/fontSize=5 rendered as r~3.16pt/digit~3.95pt — barely
                    visible. r=5/fontSize=6 renders as r~3.95pt/digit~4.74pt,
                    a 25% bump that compounds with Pass-3's legend bump.
                    cy offset re-centered for the larger digit. */}
                <circle cx={cx} cy={cy} r="5" fill="#fde047" stroke="#111" strokeWidth="0.7" />
                <text
                  x={cx}
                  y={cy + 2}
                  fontSize="6"
                  fontWeight="bold"
                  textAnchor="middle"
                  fill="#111"
                >
                  {c.number}
                </text>
              </g>
            )
          })
        })()}
      </g>

      {/* External slot labels (Phase 3) */}
      {labelPlacement && (
        <g transform={`translate(${ox}, ${oy})`} fontFamily="Helvetica, Arial, sans-serif">
          {labelPlacement.slots.map((s, i) =>
            s.lines.map((line, j) => (
              <text
                key={`slot-${i}-${j}`}
                x={line.x}
                y={line.y}
                fontSize={line.fontSize}
                fontWeight={line.bold ? 'bold' : undefined}
                textAnchor={line.textAnchor}
                fill="#222"
              >
                {line.text}
              </text>
            )),
          )}

          {/* Leader-line callouts for orphan labels */}
          {labelPlacement.callouts.map((c) => (
            <g key={`callout-${c.number}`}>
              <line
                x1={c.anchor.x}
                y1={c.anchor.y}
                x2={c.label.x}
                y2={c.label.y}
                stroke="#22d3ee"
                strokeWidth="0.5"
                strokeDasharray="3,2"
              />
              <circle cx={c.anchor.x} cy={c.anchor.y} r="4" fill="#22d3ee" stroke="#0e7490" strokeWidth="0.6" />
              <text x={c.anchor.x} y={c.anchor.y + 2} fontSize="5" fontWeight="bold" textAnchor="middle" fill="white">
                {c.number}
              </text>
              {c.label.lines.map((line, j) => (
                <text
                  key={`callout-text-${c.number}-${j}`}
                  x={line.x}
                  y={line.y}
                  fontSize={line.fontSize}
                  fill="#222"
                >
                  {line.text}
                </text>
              ))}
            </g>
          ))}

          {debug &&
            labelPlacement.slots.map((s, i) => (
              <rect
                key={`slot-debug-${i}`}
                x={s.bbox.x}
                y={s.bbox.y}
                width={s.bbox.w}
                height={s.bbox.h}
                fill="rgba(0, 200, 255, 0.08)"
                stroke="#22d3ee"
                strokeWidth="0.3"
                strokeDasharray="2,2"
                pointerEvents="none"
              />
            ))}
        </g>
      )}
    </svg>
  )
}
