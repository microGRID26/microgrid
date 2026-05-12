// SldRenderer — Phase 2 renderer that consumes a LayoutResult from
// lib/sld-v2/layout.ts (elkjs adapter) and paints to SVG.
//
// Dispatch by equipment.kind to the per-kind component shipped in
// components/planset-v2/assets/. Edges are painted as orthogonal polylines
// with conductor spec callouts attached at midpoint.

import type { LayoutResult, RoutedEdge } from '../../lib/sld-v2/layout'
import type { Equipment } from '../../lib/sld-v2/equipment'

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

function midpoint(edge: RoutedEdge): { x: number; y: number } {
  const pts = edge.polyline
  if (pts.length === 0) return { x: 0, y: 0 }
  if (pts.length === 1) return pts[0]
  // Pick the segment with the largest length and label its midpoint.
  let best = { ax: pts[0].x, ay: pts[0].y, bx: pts[1].x, by: pts[1].y, len: 0 }
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x, by = pts[i + 1].y
    const len = Math.hypot(bx - ax, by - ay)
    if (len > best.len) best = { ax, ay, bx, by, len }
  }
  return { x: (best.ax + best.bx) / 2, y: (best.ay + best.by) / 2 }
}

export function SldRenderer({ layout, debug = false }: SldRendererProps) {
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
        {layout.edges.map((edge) => {
          const color = EDGE_COLOR_BY_CATEGORY[edge.connection.category] ?? '#111'
          const mid = midpoint(edge)
          return (
            <g key={edge.connection.id}>
              <polyline
                points={polylinePoints(edge)}
                fill="none"
                stroke={color}
                strokeWidth={edge.connection.category === 'ground' || edge.connection.category === 'gec' ? 1.4 : 1.6}
                strokeDasharray={edge.connection.category === 'comm' ? '4,2' : undefined}
              />
              {edge.connection.conductor && (
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
        })}
      </g>

      {/* Nodes on top */}
      <g transform={`translate(${ox}, ${oy})`}>
        {layout.laidOut.map((lo) => renderEquipment(lo.equipment, lo.x, lo.y, debug))}
      </g>
    </svg>
  )
}
