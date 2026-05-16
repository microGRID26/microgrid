// Phase H14 — slot-picker fontSize decouple regression suite.
//
// Verifies tryFitInSlot's pre-filter scales slot.maxLineWidth by
// (fs / REFERENCE_FS=7) so bumping a label's fontSize doesn't trip the
// cheap width-budget pre-filter while the geometric collision check at
// the combined-bbox layer still gates on real page coordinates.

import { describe, it, expect } from 'vitest'
import {
  defaultLabelSlots,
  quadPorts,
  type Equipment,
  type JunctionBox,
  type LabelLine,
} from '../../lib/sld-v2/equipment'
import { placeLabels } from '../../lib/sld-v2/labels'
import type { LaidOutEquipment } from '../../lib/sld-v2/layout'

function makeJunctionBox(id: string, labels: LabelLine[]): JunctionBox {
  const width = 120
  const height = 80
  return {
    id,
    kind: 'JunctionBox',
    width,
    height,
    ports: quadPorts(id),
    labelSlots: defaultLabelSlots(width, height),
    labels,
    props: { role: 'dc', nemaRating: '3R', voltageRating: '600V' },
  }
}

function loneFixture(labels: LabelLine[]): LaidOutEquipment[] {
  // Place ONE equipment far from any margin so collision-check is never the
  // gate — pre-filter is the only thing in play.
  return [{ equipment: makeJunctionBox('jb-1', labels), x: 400, y: 400 }]
}

describe('H14 slot-picker fontSize decouple', () => {
  it('places a 30-char label at reference fontSize (7) without slotting to callout', () => {
    const labels: LabelLine[] = [
      { text: '12345678901234567890123456789X', priority: 8, fontSize: 7 },
    ]
    const result = placeLabels(loneFixture(labels), [])
    expect(result.slots.length).toBe(1)
    expect(result.callouts.length).toBe(0)
  })

  it('45-char label at fontSize 8 lands in N/S slot — pre-decouple it would have fallen to a callout', () => {
    // 45 chars × 0.58 = 26.1 chars-equivalent.
    //   At fs=8: textWidth = 45 * 8 * 0.58 = 208.8pt.
    //     N/S maxLineWidth = width+80 = 200pt:    pre-H14 → reject (208.8 > 200)
    //                                            post-H14 → accept (effMax=228.6 > 208.8)
    //     E/W maxLineWidth = 180pt:               pre-H14 → reject (208.8 > 180)
    //                                            post-H14 → reject (effMax=205.7 < 208.8)
    //   Pre-H14: ALL slots reject → label goes to callout.
    //   Post-H14: N/S accepts → label lands in a slot, callout count stays 0.
    const longLabel: LabelLine[] = [
      { text: '123456789012345678901234567890123456789012345', priority: 8, fontSize: 8 },
    ]
    const result = placeLabels(loneFixture(longLabel), [])
    expect(result.slots.length).toBe(1)
    expect(result.callouts.length).toBe(0)
  })

  it('rejects a label that overflows even the scaled budget (geometric truth preserved)', () => {
    // 70 chars at fs=8 → textWidth = 70 * 8 * 0.58 = 324.8pt.
    // N/S effectiveMax = (120+80) * (8/7) = 228.6pt — overflow ✗.
    // E/W effectiveMax = 180 * (8/7) = 205.7pt — overflow ✗.
    // All 4 slots must reject → label falls to callout.
    const tooLong: LabelLine[] = [
      {
        text: '12345678901234567890123456789012345678901234567890123456789012345678X0',
        priority: 8,
        fontSize: 8,
      },
    ]
    const result = placeLabels(loneFixture(tooLong), [])
    expect(result.slots.length).toBe(0)
    expect(result.callouts.length).toBe(1)
  })

  it('placement count at fontSize 8 is at least as high as at fontSize 7 (no fit-rate degradation)', () => {
    // The regression this catches: bumping fontSize should never DROP a
    // line that was placed at the reference size.
    //
    //   At fs=7, textWidth = 45 * 7 * 0.58 = 182.7pt.
    //     N/S maxLineWidth = 200pt:    accept (182.7 < 200).
    //     E/W maxLineWidth = 180pt:    reject (182.7 > 180).
    //     → lines placed in N (maxLines=2) and S (maxLines=4) slots.
    //
    //   At fs=8, textWidth = 45 * 8 * 0.58 = 208.8pt.
    //     Pre-H14 N/S: reject (208.8 > 200).  Pre-H14 E/W: reject (208.8 > 180).
    //       → ALL slots reject → every line falls to a callout → placedAt8 = 0.
    //     Post-H14 N/S effMax = 228.6pt: accept.  Post-H14 E/W effMax = 205.7pt: reject.
    //       → lines placed in N + S → placedAt8 == placedAt7.
    //
    // Pre-H14 the assertion `placedAt8 >= placedAt7` FAILS (0 < 2 or 0 < N+S
    // count). Post-H14 it passes. Locks the decouple.
    const line = (priority: number, fs: number): LabelLine => ({
      text: '123456789012345678901234567890123456789012345',
      priority,
      fontSize: fs,
    })
    const mkLines = (fs: number): LabelLine[] => [
      line(9, fs),
      line(8, fs),
      line(7, fs),
      line(6, fs),
    ]
    const at7 = placeLabels(loneFixture(mkLines(7)), [])
    const at8 = placeLabels(loneFixture(mkLines(8)), [])

    const placedAt7 = at7.slots.reduce((sum, s) => sum + s.lines.length, 0)
    const placedAt8 = at8.slots.reduce((sum, s) => sum + s.lines.length, 0)

    expect(placedAt7).toBeGreaterThan(0)            // sanity — fs=7 actually places lines
    expect(placedAt8).toBeGreaterThanOrEqual(placedAt7) // the H14 invariant
  })
})
