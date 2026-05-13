// lib/sld-v2/layout.ts
//
// elkjs adapter — Phase 2 of the SLD v2 refactor.
//
// Takes an EquipmentGraph (lib/sld-v2/equipment.ts) and produces:
//   - laidOut: an array of { equipment, x, y } where (x, y) is the world
//     coord assigned by elkjs (or the manual override).
//   - edges: routed orthogonal polylines per connection, with conductor
//     spec preserved.
//
// Layout config:
//   · algorithm = layered     (Sugiyama-style)
//   · direction = RIGHT       (utility flows left → loads)
//   · edgeRouting = ORTHOGONAL
//   · portConstraints = FIXED_SIDE (each Port carries its `side` from
//     the equipment definition)
//   · separators (spacing) tuned for SLD density
//
// See ~/.claude/plans/smooth-mixing-milner.md (Phase 2).

import ELK from 'elkjs/lib/elk.bundled.js'

import type {
  Connection,
  Equipment,
  EquipmentGraph,
  Port,
} from './equipment'

// ──────────────────────────────────────────────────────────────────────────
// Output types
// ──────────────────────────────────────────────────────────────────────────

export interface LaidOutEquipment {
  equipment: Equipment
  x: number
  y: number
}

export interface RoutedEdge {
  connection: Connection
  /** ELK returns one or more sections per edge for orthogonal routing.
   *  We flatten them into a single polyline. */
  polyline: Array<{ x: number; y: number }>
}

export interface LayoutResult {
  laidOut: LaidOutEquipment[]
  edges: RoutedEdge[]
  /** Final SVG canvas size (computed from elkjs output + margin). */
  width: number
  height: number
  /** Pre-route margin around the laid-out content. */
  margin: number
}

// ──────────────────────────────────────────────────────────────────────────
// ELK adapter
// ──────────────────────────────────────────────────────────────────────────

// Phase 7b deploy fix — lazy ELK construction. `new ELK()` spawns a Web
// Worker; constructing it at module-load time crashed `/planset`'s static
// prerender in Next.js 16 ("l is not a constructor" out of the worker
// factory in Node SSR where Worker isn't defined). Phase 7a wired
// layoutEquipmentGraph into the client page via a useEffect that only
// fires after hydration, so the actual elkjs call is always client-side
// — but the IMPORT graph evaluated this module at module-load during
// prerender. Lazy-construct so the worker isn't instantiated until first
// layout call (which is always client-side by construction of the caller).
type ElkInstance = InstanceType<typeof ELK>
let _elkInstance: ElkInstance | null = null
function getElk(): ElkInstance {
  if (_elkInstance === null) {
    _elkInstance = new ELK()
  }
  return _elkInstance
}

const DEFAULT_LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '60',
  'elk.spacing.edgeNode': '20',
  'elk.spacing.edgeEdge': '15',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.padding': '[top=40,bottom=40,left=40,right=40]',
}

/** Map our Port.side ('N'/'S'/'E'/'W') to ELK port side enum. */
function elkPortSide(side: Port['side']): 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' {
  return { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' }[side] as
    | 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'
}

/** Build the ELK input graph.
 *
 * Port IDs are used as-is (already in `${nodeId}.${side}` format from
 * quadPorts). Connection.from / Connection.to reference these directly. */
function toElkGraph(graph: EquipmentGraph, options: Record<string, string>) {
  return {
    id: 'root',
    layoutOptions: options,
    children: graph.equipment.map((eq) => ({
      id: eq.id,
      width: eq.width,
      height: eq.height,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_SIDE',
      },
      ports: eq.ports.map((p) => ({
        id: p.id,
        layoutOptions: {
          'elk.port.side': elkPortSide(p.side),
        },
      })),
    })),
    edges: graph.connections.map((c) => ({
      id: c.id,
      sources: [c.from],
      targets: [c.to],
    })),
  }
}

/**
 * Apply manual overrides on top of an ELK result.
 * For each equipment with overrideXY (or graph.nodeOverrides[id]), shift its
 * laid-out position to the override. Edges connected to overridden nodes
 * keep their ELK-computed waypoints (the renderer can re-snap endpoints).
 */
function applyOverrides(
  laidOut: LaidOutEquipment[],
  graph: EquipmentGraph,
): LaidOutEquipment[] {
  const overrides = graph.nodeOverrides ?? {}
  return laidOut.map((lo) => {
    const eqOverride = lo.equipment.overrideXY
    const graphOverride = overrides[lo.equipment.id]
    if (eqOverride) return { ...lo, x: eqOverride.x, y: eqOverride.y }
    if (graphOverride) return { ...lo, x: graphOverride.x, y: graphOverride.y }
    return lo
  })
}

/**
 * Main entry point.
 * Returns a Promise (elkjs is async because the WASM backend takes time).
 */
export async function layoutEquipmentGraph(
  graph: EquipmentGraph,
  layoutOptions: Record<string, string> = DEFAULT_LAYOUT_OPTIONS,
): Promise<LayoutResult> {
  const input = toElkGraph(graph, layoutOptions)
  const elk = getElk()
  const laid = await elk.layout(input as Parameters<typeof elk.layout>[0])

  // Extract children (node positions)
  const laidOut: LaidOutEquipment[] = (laid.children ?? []).map((c) => {
    const equipment = graph.equipment.find((e) => e.id === c.id)
    if (!equipment) {
      throw new Error(`ELK returned a node id we don't recognize: ${c.id}`)
    }
    return {
      equipment,
      x: c.x ?? 0,
      y: c.y ?? 0,
    }
  })

  // Extract edges (routed polylines)
  const edges: RoutedEdge[] = (laid.edges ?? []).map((edge) => {
    const connection = graph.connections.find((c) => c.id === edge.id)
    if (!connection) {
      throw new Error(`ELK returned an edge id we don't recognize: ${edge.id}`)
    }
    // Each ELK edge has 0..N sections, each with startPoint / endPoint /
    // optional bendPoints[]. Flatten into one polyline.
    const polyline: Array<{ x: number; y: number }> = []
    for (const section of edge.sections ?? []) {
      if (polyline.length === 0) polyline.push({ x: section.startPoint.x, y: section.startPoint.y })
      for (const bp of section.bendPoints ?? []) polyline.push({ x: bp.x, y: bp.y })
      polyline.push({ x: section.endPoint.x, y: section.endPoint.y })
    }
    return { connection, polyline }
  })

  const overridden = applyOverrides(laidOut, graph)

  return {
    laidOut: overridden,
    edges,
    width: laid.width ?? 1500,
    height: laid.height ?? 950,
    margin: 40,
  }
}
