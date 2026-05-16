// lib/sld-v2/labels.ts
//
// Phase 3 — greedy slot picker for external equipment labels.
//
// Each equipment carries `labels: LabelLine[]` (rated voltage, NEMA rating,
// busbar callout, etc. — strings that don't fit inside the asset symbol).
// Each equipment also declares `labelSlots: LabelSlot[]` — up to 4 anchor
// zones (N/S/E/W) with priority + capacity.
//
// Algorithm:
//   1. Walk each laid-out equipment in priority order.
//   2. Walk that equipment's slots in priority order.
//   3. For each slot, fit as many label lines as the slot's maxLines allows,
//      compute world-coord bboxes for each text line, and check against the
//      cumulative "occupied bboxes" set (other components, other labels,
//      and routed wire bbox approximations).
//   4. If collision, move the label to the next slot.
//   5. If no slot accepts the label, queue it for leader-line callout
//      (numbered TAG circle anchored on the equipment, label in a free
//      region of the canvas).
//
// See ~/.claude/plans/smooth-mixing-milner.md (Phase 3).

import type {
  LabelLine,
  LabelSlot,
  PortSide,
} from './equipment'
import type { LaidOutEquipment, RoutedEdge } from './layout'

// ──────────────────────────────────────────────────────────────────────────
// Output types
// ──────────────────────────────────────────────────────────────────────────

export interface PlacedLine {
  text: string
  x: number
  y: number
  fontSize: number
  bold?: boolean
  /** Text-anchor for the SVG <text> element. */
  textAnchor: 'start' | 'middle' | 'end'
}

export interface SlotPlacement {
  equipmentId: string
  side: PortSide
  lines: PlacedLine[]
  /** Bounding box of the placement (debug). */
  bbox: BBox
}

export interface LeaderCallout {
  number: number               // sequential 1..N
  equipmentId: string
  anchor: { x: number; y: number }  // pointer endpoint near equipment
  /** Resolved leader label position — computed by the caller from free zones. */
  label: { x: number; y: number; lines: PlacedLine[]; bbox: BBox }
}

export interface LabelPlacementResult {
  slots: SlotPlacement[]
  callouts: LeaderCallout[]
  /** Bboxes used for collision tracking. Exposed for the validator. */
  occupiedBoxes: BBox[]
}

// ──────────────────────────────────────────────────────────────────────────
// BBox arithmetic (text width approximation matches scripts/sld-collision-check.py
// and lib/sld-layout.ts:estimateTextWidth)
// ──────────────────────────────────────────────────────────────────────────

interface BBox {
  x: number
  y: number
  w: number
  h: number
}

function bboxOverlaps(a: BBox, b: BBox, pad = 0): boolean {
  return !(
    a.x + a.w <= b.x - pad
    || b.x + b.w <= a.x - pad
    || a.y + a.h <= b.y - pad
    || b.y + b.h <= a.y - pad
  )
}

function textWidth(text: string, fontSize: number): number {
  // Match scripts/sld-collision-check.py constant.
  return Math.max(1, text.length) * fontSize * 0.58
}

function textBBox(
  text: string,
  fontSize: number,
  x: number,
  y: number,
  textAnchor: 'start' | 'middle' | 'end',
): BBox {
  const w = textWidth(text, fontSize)
  const h = fontSize * 1.0
  const top = y - fontSize * 0.82
  const left =
    textAnchor === 'middle' ? x - w / 2 :
    textAnchor === 'end'    ? x - w     :
                              x
  return { x: left, y: top, w, h }
}

// ──────────────────────────────────────────────────────────────────────────
// Equipment + edge bbox extractor (for the occupiedBoxes set)
// ──────────────────────────────────────────────────────────────────────────

function equipmentBBox(lo: LaidOutEquipment): BBox {
  return { x: lo.x, y: lo.y, w: lo.equipment.width, h: lo.equipment.height }
}

function edgeBBoxes(edges: RoutedEdge[]): BBox[] {
  // Treat each polyline segment as a thin bbox (height/width ≈ 3 px).
  const out: BBox[] = []
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

// ──────────────────────────────────────────────────────────────────────────
// Slot anchor geometry
// ──────────────────────────────────────────────────────────────────────────

const SLOT_GAP = 6   // px gap between equipment edge and slot zone

// H14 — REFERENCE_FS is the fontSize the slot capacity heuristics (maxLineWidth
// in equipment.ts:361-364, textBBox/textWidth) were calibrated against. The
// slot pre-filter scales maxLineWidth by (fs / REFERENCE_FS) so a label line
// with a bigger fontSize doesn't trip the cheap pre-filter on width budget that
// was set assuming this reference size.
//
// Design intent: bboxOverlaps (combined-bbox vs occupied set, line 236-238)
// is GEOMETRIC TRUTH — it uses real page coordinates and gates the placement
// regardless of fontSize. slot.maxLineWidth is a CALIBRATION BUDGET — cheap
// early-exit that scales with the assumed reference size. Loosening the
// budget at high fontSize cannot cause silent collisions; it can only let
// borderline-fit lines reach the truth-check.
const REFERENCE_FS = 7

/**
 * Compute the slot anchor point + textAnchor for a given equipment + side.
 * Returns where the FIRST line of the label group should be painted.
 *
 * Conventions:
 *   N — text grows DOWNWARD from above the equipment; left-aligned, x = eq.x
 *   S — text grows DOWNWARD from below the equipment; left-aligned, x = eq.x
 *   E — text grows DOWNWARD from right of the equipment; left-aligned, x = right edge + gap
 *   W — text grows DOWNWARD from left of the equipment; right-aligned, x = left edge − gap
 */
function slotAnchor(
  lo: LaidOutEquipment,
  side: PortSide,
  lineHeight: number,
  totalLines: number,
): { x: number; y: number; textAnchor: 'start' | 'middle' | 'end' } {
  const { x, y, equipment: { width, height } } = lo
  switch (side) {
    case 'N':
      // Top edge minus line stack height; first baseline = top - (lines-1)*lh - cap
      return {
        x,
        y: y - SLOT_GAP - (totalLines - 1) * lineHeight,
        textAnchor: 'start',
      }
    case 'S':
      return {
        x,
        y: y + height + SLOT_GAP + lineHeight,
        textAnchor: 'start',
      }
    case 'E':
      return {
        x: x + width + SLOT_GAP,
        y: y + lineHeight,
        textAnchor: 'start',
      }
    case 'W':
      return {
        x: x - SLOT_GAP,
        y: y + lineHeight,
        textAnchor: 'end',
      }
  }
}

/** Try to fit label lines in a slot. Returns null if doesn't fit. */
function tryFitInSlot(
  lo: LaidOutEquipment,
  slot: LabelSlot,
  labels: LabelLine[],
  occupied: BBox[],
): SlotPlacement | null {
  if (labels.length === 0) return null
  const lh = slot.lineHeight ?? 10
  // Truncate labels to slot capacity (drop lowest-priority lines first).
  const ordered = [...labels].sort((a, b) => b.priority - a.priority)
  const fittable = ordered.slice(0, slot.maxLines)
  if (fittable.length === 0) return null

  // Reject lines that exceed slot.maxLineWidth (cheap pre-filter).
  // H14 — scale maxLineWidth by (fs / REFERENCE_FS): equipment.ts slot widths
  // were calibrated at REFERENCE_FS, so a line bumped above that size gets
  // proportionally more headroom in the pre-filter and falls through to the
  // real-coordinate collision check at bboxOverlaps below.
  for (const line of fittable) {
    const fs = line.fontSize ?? REFERENCE_FS
    const effectiveMax = slot.maxLineWidth * (fs / REFERENCE_FS)
    if (textWidth(line.text, fs) > effectiveMax) return null
  }

  const anchor = slotAnchor(lo, slot.side, lh, fittable.length)
  const placedLines: PlacedLine[] = []
  const placedBboxes: BBox[] = []

  for (let i = 0; i < fittable.length; i++) {
    const line = fittable[i]
    const fs = line.fontSize ?? REFERENCE_FS
    const y = anchor.y + i * lh
    const bbox = textBBox(line.text, fs, anchor.x, y, anchor.textAnchor)
    placedLines.push({
      text: line.text,
      x: anchor.x,
      y,
      fontSize: fs,
      bold: line.bold,
      textAnchor: anchor.textAnchor,
    })
    placedBboxes.push(bbox)
  }

  // Combined bbox for this slot.
  const minX = Math.min(...placedBboxes.map((b) => b.x))
  const minY = Math.min(...placedBboxes.map((b) => b.y))
  const maxX = Math.max(...placedBboxes.map((b) => b.x + b.w))
  const maxY = Math.max(...placedBboxes.map((b) => b.y + b.h))
  const bbox: BBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }

  // Collision-check the COMBINED slot bbox against occupied boxes (ignore self).
  for (const occ of occupied) {
    if (bboxOverlaps(occ, bbox, 1)) return null
  }

  return {
    equipmentId: lo.equipment.id,
    side: slot.side,
    lines: placedLines,
    bbox,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────

export function placeLabels(
  laidOut: LaidOutEquipment[],
  edges: RoutedEdge[],
  options?: { freeZone?: { x: number; y: number; w: number; h: number } },
): LabelPlacementResult {
  // Build initial occupied-bbox set: all equipment bboxes + all edge segments.
  const equipBoxes = laidOut.map(equipmentBBox)
  const edgeBoxes = edgeBBoxes(edges)
  const occupied: BBox[] = [...equipBoxes, ...edgeBoxes]

  const slots: SlotPlacement[] = []
  const callouts: LeaderCallout[] = []
  let calloutCounter = 0

  // Free-zone for callouts (right margin or below diagram).
  const freeZone = options?.freeZone ?? null

  // Order: highest-label-priority equipment first (more important labels get
  // first dibs on N/S slots).
  const ranked = [...laidOut].sort((a, b) => {
    const maxA = Math.max(0, ...a.equipment.labels.map((l) => l.priority))
    const maxB = Math.max(0, ...b.equipment.labels.map((l) => l.priority))
    return maxB - maxA
  })

  for (const lo of ranked) {
    if (lo.equipment.labels.length === 0) continue

    // Sort slots by priority desc, labels by priority desc.
    const orderedSlots = [...lo.equipment.labelSlots].sort((a, b) => b.priority - a.priority)
    let remaining = [...lo.equipment.labels].sort((a, b) => b.priority - a.priority)

    for (const slot of orderedSlots) {
      if (remaining.length === 0) break
      const placement = tryFitInSlot(lo, slot, remaining, occupied)
      if (placement) {
        slots.push(placement)
        occupied.push(placement.bbox)
        // Mark placed labels as consumed (by text identity).
        const placedTexts = new Set(placement.lines.map((l) => l.text))
        remaining = remaining.filter((l) => !placedTexts.has(l.text))
      }
    }

    // Any remaining labels → ONE grouped leader callout per equipment.
    // Multiple orphan lines stack as a multi-line label so we don't get
    // numbered circles overlapping each other on the same equipment center.
    if (remaining.length > 0) {
      calloutCounter += 1
      // H10 Pass-2 — anchor orphan callout INSIDE the equipment's top-LEFT
      // corner (6,6 inset). Center-of-box was colliding with internal
      // hardcoded labels (BatteryStackBox MOD rows, CommGatewayBox COMM
      // GATEWAY caption). Top-right is reserved for NEC numbered callouts
      // (TYSON_CALLOUTS_PV5 in SldRenderer); top-left is whitespace across
      // every existing equipment box.
      const calloutAnchor = {
        x: lo.x + 6,
        y: lo.y + 6,
      }
      // Default callout label placement — right margin staircase.
      // Step by the number of lines in the prior callout (variable-height).
      const totalPriorLines = callouts.reduce((acc, c) => acc + c.label.lines.length, 0)
      const lineH = 11
      const labelXY = freeZone
        ? { x: freeZone.x + 14, y: freeZone.y + 14 + totalPriorLines * lineH }
        : { x: 10, y: 10 + totalPriorLines * lineH }

      const placedLines: PlacedLine[] = remaining.map((orphan, i) => ({
        text: orphan.text,
        x: labelXY.x,
        y: labelXY.y + i * lineH,
        fontSize: orphan.fontSize ?? REFERENCE_FS,
        bold: orphan.bold,
        textAnchor: 'start' as const,
      }))

      const bboxes = placedLines.map((pl) => textBBox(pl.text, pl.fontSize, pl.x, pl.y, pl.textAnchor))
      const minX = Math.min(...bboxes.map((b) => b.x))
      const minY = Math.min(...bboxes.map((b) => b.y))
      const maxX = Math.max(...bboxes.map((b) => b.x + b.w))
      const maxY = Math.max(...bboxes.map((b) => b.y + b.h))
      const calloutBox: BBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }

      callouts.push({
        number: calloutCounter,
        equipmentId: lo.equipment.id,
        anchor: calloutAnchor,
        label: {
          x: labelXY.x,
          y: labelXY.y,
          lines: placedLines,
          bbox: calloutBox,
        },
      })
      occupied.push(calloutBox)
    }
  }

  return { slots, callouts, occupiedBoxes: occupied }
}
