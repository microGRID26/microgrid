// Phase 7b pilot — render Charles Lohf's plansheet (PROJ-32115) via the v2
// path. Mirrors the production route's data flow exactly:
//   project row → buildPlansetData(proj) → equipmentGraphFromPlansetData(data)
//     → renderSldToPdf(graph, { titleBlock: { data, sheetName, sheetNumber } })
//
//   npx tsx scripts/render-sld-v2-pilot-lohf.tsx
//   open ~/.claude/tmp/sld-v2-pilot-lohf.pdf
//
// Project row snapshot pulled from MG prod via Supabase MCP 2026-05-13.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildPlansetData, type PlansetData } from '../lib/planset-types'
import { equipmentGraphFromPlansetData } from '../lib/sld-v2/from-planset-data'
import { renderSldToPdf } from '../lib/sld-v2/pdf'
import type { Project } from '../types/database'

// Snapshot of PROJ-32115 from MG prod (2026-05-13). Nulls in voltage/
// msp_bus_rating/main_breaker/ahj fall back to DURACELL_DEFAULTS inside
// buildPlansetData.
const project = {
  id: 'PROJ-32115',
  name: 'Charles Lohf',
  address: '1608 Windrift Way',
  city: 'Round Rock',
  state: 'Texas',
  zip: '78664',
  utility: 'Oncor Electric Delivery Company, LLC',
  esid: null,
  ahj: null,
  voltage: null,
  msp_bus_rating: null,
  main_breaker: null,
  module: 'SRP-440-BTD-BG',
  module_qty: '55',
  battery: 'Dura5',
  battery_qty: '16',
  inverter: 'Duracell MAX Hybrid 15',
  inverter_qty: '2',
  use_sld_v2: true,
} as unknown as Project

const data: PlansetData = buildPlansetData(project, {
  inverterCount: 2,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterAcPower: 15,
  batteryCount: 16,
  batteriesPerStack: 8,
})
// Pass-8c — exercise the title-block DRAWN BY render path with an actual
// draftsperson name. Without an override the row falls back to 'MicroGRID'.
;(data as PlansetData & { drawnBy?: string }).drawnBy = 'G. Kelsch · MicroGRID Engineering'
// Pass-8e — Tyson PV-5 shows project lat/long; Lohf's Round Rock coords.
;(data as PlansetData & { coordinates?: string }).coordinates = '(30.5083, -97.6789)'
// Pass-8d — exercise the revisions `by` column with a Tyson-style entry.
;(data as PlansetData & {
  revisions?: Array<{ rev: number; date: string; note: string; by?: string }>
}).revisions = [
  { rev: 0, date: data.drawnDate, note: 'Initial issue', by: 'G. Kelsch' },
  { rev: 1, date: data.drawnDate, note: 'Tyson-match polish', by: 'G. Kelsch' },
]

async function main() {
  const graph = equipmentGraphFromPlansetData(data)
  const bytes = await renderSldToPdf(graph, {
    titleBlock: {
      data,
      sheetName: 'Electrical Three Line Diagram',
      sheetNumber: 'PV-5',
    },
  })

  const outDir = path.join(os.homedir(), '.claude', 'tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'sld-v2-pilot-lohf.pdf')
  fs.writeFileSync(outPath, bytes)

  // Also drop into the brainstorming companion content dir (if present) and
  // ~/Desktop so Greg can grab it for the RUSH handoff.
  const companionPath = path.join(
    process.cwd(),
    '.superpowers/brainstorm/82440-1778691839/content/sld-v2-pilot-lohf.pdf',
  )
  try {
    fs.mkdirSync(path.dirname(companionPath), { recursive: true })
    fs.copyFileSync(outPath, companionPath)
  } catch {
    // Companion dir may not exist outside the live worktree; ignore.
  }
  const desktopPath = path.join(os.homedir(), 'Desktop', 'sld-v2-pilot-lohf.pdf')
  try {
    fs.copyFileSync(outPath, desktopPath)
  } catch {
    // Best-effort.
  }

  process.stdout.write(
    `wrote ${outPath} (${bytes.byteLength.toLocaleString()} bytes)\n` +
      `      mirror → ${companionPath}\n` +
      `      mirror → ${desktopPath}\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err?.stack ?? err}\n`)
  process.exit(1)
})
