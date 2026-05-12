// Phase 4 verification harness — build a real PlansetData via buildPlansetData()
// (the existing v1 entry point), pipe through equipmentGraphFromPlansetData()
// adapter, run elkjs layout, place labels, render via SldRenderer, output HTML.
//
// Validates that v2 can render from the SAME data source v1 consumes.
//
//   npx tsx scripts/render-sld-v2-from-planset.tsx > ~/.claude/tmp/sld-v2-from-planset.html
//   python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-from-planset.html

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { buildPlansetData, type PlansetData } from '../lib/planset-types'
import { equipmentGraphFromPlansetData } from '../lib/sld-v2/from-planset-data'
import { layoutEquipmentGraph } from '../lib/sld-v2/layout'
import { placeLabels } from '../lib/sld-v2/labels'
import { SldRenderer } from '../components/planset-v2/SldRenderer'
import type { Project } from '../types/database'

// Stub Project — only the fields buildPlansetData touches are needed.
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
  // Force Tyson-like topology
  inverterCount: 2,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterAcPower: 15,
  batteryCount: 16,
  batteriesPerStack: 8,
})

async function main() {
  const graph = equipmentGraphFromPlansetData(data)
  const layout = await layoutEquipmentGraph(graph)
  const labelPlacement = placeLabels(layout.laidOut, layout.edges, {
    freeZone: { x: layout.width - 240, y: 0, w: 240, h: layout.height },
  })

  const svg = <SldRenderer layout={layout} labelPlacement={labelPlacement} />
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>sld-v2 — Phase 4 from PlansetData</title>
<style>body{margin:0;padding:24px;background:#fafafa;font-family:system-ui}
h1{font-size:14px;margin:0 0 8px}
.frame{background:white;border:1px solid #ddd;padding:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:inline-block}
svg{display:block}
</style></head><body>
<h1>sld-v2 Phase 4 — PlansetData → EquipmentGraph → elkjs → SldRenderer</h1>
<div class="frame">
${renderToStaticMarkup(svg)}
</div>
<pre style="font-size:11px;color:#666;margin-top:16px;font-family:ui-monospace,monospace">
project:           ${data.projectId} · ${data.owner}
topology:          ${data.systemTopology} · inverterModel: ${data.inverterModel}
panels:            ${data.panelCount} × ${data.panelModel} ${data.panelWattage}W
inverters:         ${data.inverterCount} × ${data.inverterAcPower}kW
batteries:         ${data.batteryCount} × ${data.batteryCapacity}kWh = ${data.totalStorageKwh}kWh
msp:               ${data.mspBusRating}A busbar / ${data.mainBreaker} main
canvas:            ${layout.width}×${layout.height} + margin ${layout.margin}
equipment placed:  ${layout.laidOut.length}
edges routed:      ${layout.edges.length}
label slots filled:${labelPlacement.slots.length}
leader callouts:   ${labelPlacement.callouts.length}
notes:             ${(graph.notes ?? []).length}
</pre>
</body></html>`
  process.stdout.write(body)
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err}\n`)
  process.exit(1)
})
