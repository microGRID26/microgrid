// Phase H7 — installer-notes block (bottom-left of PV-5).
//
// Replicates the "INSTALLER NOTE" bullet block from the RUSH-stamped
// Tyson reference (PROJ-26922 Rev1 PV-5.1). AHJs scan this block to
// confirm specific installation requirements were called out:
//
//   - Relocate essential loads to protected loads panel
//   - Test for Edison circuit before energization
//   - Single-pole loads backed up per homeowner selection
//   - Batteries floor-mounted
//   - Heat detectors on interior for all batteries
//   - Bollards 3ft from battery
//   - CT wire extension + #18 shielded
//   - Main panel upgrade
//   - Smoke detectors required
//
// Painted via jsPDF native primitives, same approach as header-strip.ts
// and title-block.ts.

import type { jsPDF } from 'jspdf'
import type { PlansetData } from '../planset-types'

/** Height of the installer-notes block in pt. */
export const INSTALLER_NOTES_HEIGHT_PT = 125

/** Width of the installer-notes block in pt. */
export const INSTALLER_NOTES_WIDTH_PT = 260

interface PaintOptions {
  fontName?: string
  unicodeSafe?: boolean
}

const VALUE_NEAR_BLACK: [number, number, number] = [17, 17, 17]
const RED: [number, number, number] = [180, 0, 0]

// Phase H12 Pass-2 — bumped title 6→7 and body 5→6 for AHJ-reviewer
// print readability. The Tyson reference renders bullets at ~6pt; at 5pt
// the block was illegible under typical office-copier reproduction. Kept
// LINE_GAP=6 so the 17-bullet stack still fits inside the 125pt block
// (17 × 6 = 102pt ≤ 107pt available after PAD_Y + title row).
const TITLE_SIZE_PT = 7
const BODY_SIZE_PT = 6
const LINE_GAP = 6
const PAD_X = 4
const PAD_Y = 8

function winAnsi(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/[™]/g, 'TM')
    .replace(/[ ]/g, ' ')
}

function makeSanitizer(unicodeSafe: boolean | undefined): (s: string) => string {
  return unicodeSafe ? (s: string) => s : (s: string) => winAnsi(s)
}

/**
 * Build the bullet lines from PlansetData. Most notes are static (NEC-
 * mandated for any battery+PV system) but a few are equipment-specific —
 * battery model determines whether bollards apply, panel-upgrade text
 * only fires when busbar was upgraded.
 */
function buildNoteLines(data: PlansetData): string[] {
  const isLfp = /lfp|duracell/i.test(data.batteryModel)
  const hasBattery = data.batteryCount > 0
  const lines = [
    'REQUIRES TO RELOCATE (E) ESSENTIAL LOADS FROM (E) MAIN',
    '  SERVICE PANEL TO (N) PROTECTED LOADS PANEL',
    'REQUIRES TO TEST FOR EDISON CIRCUIT BEFORE ENERGIZATION',
    'ONLY 10-12 SINGLE POLE LOADS WILL BE BACKED UP PER',
    "  HOMEOWNER'S SELECTION",
  ]
  if (hasBattery) {
    lines.push(`REQUIRES ${data.batteryModel.toUpperCase()} BATTERIES FLOOR MOUNTED`)
    lines.push('HEAT DETECTORS REQUIRED ON INTERIOR FOR ALL BATTERIES')
    if (isLfp) lines.push('REQUIRES BOLLARDS 3 FEET FROM THE BATTERY')
  }
  lines.push('REQUIRES MAIN PANEL UPGRADE')
  lines.push('REQUIRES (N) SMOKE DETECTOR')
  lines.push('IF ROMEX IS USED THROUGH ATTIC - RUNS SHALL BE KEPT')
  lines.push('  SEPARATE AND NOT BUNDLED')
  lines.push('IF CONDUIT IS USED ON EXTERIOR - WITHIN 10\' OF UTILITY')
  lines.push('  METER')
  lines.push('REQUIRES CT EXTENSION KIT — PART #1001808')
  lines.push('REQUIRES TO EXTEND CT WIRES WITH #18 AWG SHIELDED')
  lines.push('  CABLE')
  return lines
}

/**
 * Paint the installer-notes block at (x, y) within (w, h).
 */
export function paintInstallerNotes(
  pdf: jsPDF,
  data: PlansetData,
  x: number,
  y: number,
  w: number,
  h: number,
  options: PaintOptions = {},
): void {
  const fontName = options.fontName ?? 'helvetica'
  const sanitize = makeSanitizer(options.unicodeSafe)

  // Title (red, matches Tyson convention).
  pdf.setFont(fontName, 'bold')
  pdf.setFontSize(TITLE_SIZE_PT)
  pdf.setTextColor(RED[0], RED[1], RED[2])
  pdf.text(sanitize('INSTALLER NOTE:'), x + PAD_X, y + PAD_Y, { baseline: 'middle' })

  // Bullets (black, indented).
  pdf.setFont(fontName, 'normal')
  pdf.setFontSize(BODY_SIZE_PT)
  pdf.setTextColor(VALUE_NEAR_BLACK[0], VALUE_NEAR_BLACK[1], VALUE_NEAR_BLACK[2])

  let textY = y + PAD_Y + LINE_GAP + 2
  const maxY = y + h - 2
  for (const note of buildNoteLines(data)) {
    if (textY > maxY) break
    const isContinuation = note.startsWith('  ')
    const bulletX = x + PAD_X
    if (!isContinuation) {
      pdf.text(sanitize('•'), bulletX, textY, { baseline: 'middle' })
    }
    pdf.text(sanitize(note.trimStart()), bulletX + 6, textY, { baseline: 'middle' })
    textY += LINE_GAP
  }
}
