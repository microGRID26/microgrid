// Phase 5 verification harness — same PlansetData stub as
// scripts/render-sld-v2-from-planset.tsx (Tyson topology), routed through
// renderSldToPdf() and written to ~/.claude/tmp/sld-v2-tyson.pdf.
//
//   npx tsx scripts/render-sld-v2-pdf.tsx
//   open ~/.claude/tmp/sld-v2-tyson.pdf
//   pdfgrep "NEC 690.12" ~/.claude/tmp/sld-v2-tyson.pdf

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildPlansetData, type PlansetData } from '../lib/planset-types'
import { equipmentGraphFromPlansetData } from '../lib/sld-v2/from-planset-data'
import { renderSldToPdf } from '../lib/sld-v2/pdf'
import type { Project } from '../types/database'

// Stub Project — only the fields buildPlansetData touches are needed.
// Mirror of scripts/render-sld-v2-from-planset.tsx so the HTML and PDF
// harnesses render the SAME topology.
const project = {
  id: 'PROJ-DEMO',
  name: 'Demo Hybrid Install',
  address: '123 Main St',
  city: 'Houston',
  state: 'TX',
  zip: '77073',
  utility: 'CenterPoint Energy',
  meter_number: '00 000 000',
  esid: '10000000000000000000',
  ahj: 'City of Houston',
  voltage: '120/240V',
  msp_bus_rating: '225',
  main_breaker: '125',
  module_qty: 20,
  module: 'Seraphim SRP-440-BTD-BG',
  battery_qty: 16,
  inverter_qty: 2,
  inverter: 'Duracell Power Center Max Hybrid 15kW',
} as unknown as Project

const data: PlansetData = buildPlansetData(project, {
  inverterCount: 2,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterAcPower: 15,
  batteryCount: 16,
  batteriesPerStack: 8,
})

async function main() {
  const graph = equipmentGraphFromPlansetData(data)
  const bytes = await renderSldToPdf(graph)

  const outDir = path.join(os.homedir(), '.claude', 'tmp')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'sld-v2-tyson.pdf')
  fs.writeFileSync(outPath, bytes)

  process.stdout.write(
    `wrote ${outPath} (${bytes.byteLength.toLocaleString()} bytes)\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err?.stack ?? err}\n`)
  process.exit(1)
})
