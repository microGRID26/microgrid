// SldRenderer — Phase 2 renderer that consumes a LayoutResult from
// lib/sld-v2/layout.ts (elkjs adapter) and paints to SVG.
//
// Dispatch by equipment.kind to the per-kind component shipped in
// components/planset-v2/assets/. Edges are painted as orthogonal polylines
// with conductor spec callouts attached at midpoint.

import type { LayoutResult, RoutedEdge } from '../../lib/sld-v2/layout'
import type { Equipment } from '../../lib/sld-v2/equipment'
import type { LabelPlacementResult } from '../../lib/sld-v2/labels'

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

interface LayoutBBox { x: number; y: number; w: number; h: number }

function bboxesOverlap(a: LayoutBBox, b: LayoutBBox): boolean {
  return !(
    a.x + a.w <= b.x
    || b.x + b.w <= a.x
    || a.y + a.h <= b.y
    || b.y + b.h <= a.y
  )
}

/** Find a midpoint along the edge such that the conductor LABEL bbox
 *  (anchored at midpoint, extending rightward by ~labelText.length × 3.5 px,
 *  about 9 px tall) does NOT overlap any equipment bbox. Returns null if
 *  no segment works — caller skips the label entirely. */
function midpoint(
  edge: RoutedEdge,
  blockBoxes: LayoutBBox[],
  labelText: string,
): { x: number; y: number } | null {
  const pts = edge.polyline
  if (pts.length < 2) return null

  const labelW = labelText.length * 3.5 + 4
  const labelH = 9

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
      y: my - 10,
      w: labelW,
      h: labelH,
    }
    if (!blockBoxes.some((b) => bboxesOverlap(b, labelBBox))) {
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
          // Build equipment bbox list for label-placement avoidance.
          const blockBoxes: LayoutBBox[] = layout.laidOut.map((lo) => ({
            x: lo.x,
            y: lo.y,
            w: lo.equipment.width,
            h: lo.equipment.height,
          }))
          return layout.edges.map((edge) => {
            const color = EDGE_COLOR_BY_CATEGORY[edge.connection.category] ?? '#111'
            const mid = midpoint(edge, blockBoxes, edge.connection.conductor ?? '')
            return (
              <g key={edge.connection.id}>
                <polyline
                  points={polylinePoints(edge)}
                  fill="none"
                  stroke={color}
                  strokeWidth={edge.connection.category === 'ground' || edge.connection.category === 'gec' ? 1.4 : 1.6}
                  strokeDasharray={edge.connection.category === 'comm' ? '4,2' : undefined}
                />
                {edge.connection.conductor && mid && (
                  <g transform={`translate(${mid.x}, ${mid.y - 3})`}>
                    <rect
                      x={-2}
                      y={-7}
                      width={edge.connection.conductor.length * 3.5 + 4}
                      height={9}
                      fill="white"
                      stroke="none"
                    />
                    <text fontSize="6" fill={color} fontFamily="Helvetica, Arial, sans-serif">
                      {edge.connection.conductor}
                    </text>
                  </g>
                )}
              </g>
            )
          })
        })()}
      </g>

      {/* Nodes on top */}
      <g transform={`translate(${ox}, ${oy})`}>
        {layout.laidOut.map((lo) => renderEquipment(lo.equipment, lo.x, lo.y, debug))}
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
