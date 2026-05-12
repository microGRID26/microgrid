// Phase 2 — build a Tyson-style EquipmentGraph, run elkjs, render via SldRenderer.
// Output: ~/.claude/tmp/sld-v2-tyson.html
// Validator must report 0 text-text overlaps on the laid-out result.

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { layoutEquipmentGraph } from '../lib/sld-v2/layout'
import { SldRenderer } from '../components/planset-v2/SldRenderer'
import {
  defaultLabelSlots,
  quadPorts,
  type EquipmentGraph,
  type MSP,
  type Disconnect,
  type HybridInverter,
  type BatteryStack,
  type Meter,
  type PVArray,
  type RapidShutdown,
  type JunctionBox,
  type BackupPanel,
} from '../lib/sld-v2/equipment'

// ──────────────────────────────────────────────────────────────────────────
// Tyson PROJ-26922 topology
// ──────────────────────────────────────────────────────────────────────────

const pvArray: PVArray = {
  id: 'pv', kind: 'PVArray', width: 280, height: 140,
  ports: quadPorts('pv'), labelSlots: defaultLabelSlots(280, 140), labels: [],
  props: {
    moduleModel: 'Seraphim SRP-440-BTD-BG', moduleWatts: 440,
    moduleCount: 20, stringCount: 2, modulesPerString: 10,
  },
}

const rsd: RapidShutdown = {
  id: 'rsd', kind: 'RapidShutdown', width: 60, height: 24,
  ports: quadPorts('rsd'), labelSlots: defaultLabelSlots(60, 24), labels: [],
  props: { model: 'RSD-D-20', role: 'initiator', necCitation: 'NEC 690.12(A)' },
}

const dcJb: JunctionBox = {
  id: 'dc-jb', kind: 'JunctionBox', width: 60, height: 40,
  ports: quadPorts('dc-jb'), labelSlots: defaultLabelSlots(60, 40), labels: [],
  props: { role: 'dc', nemaRating: '3R', voltageRating: '600V' },
}

const hybrid1: HybridInverter = {
  id: 'hybrid-1', kind: 'HybridInverter', width: 110, height: 100,
  ports: quadPorts('hybrid-1'), labelSlots: defaultLabelSlots(110, 100), labels: [],
  props: { model: 'Duracell PC-MAX-15', acKw: 15, backupAcA: 100, listingStandard: 'UL 1741-SB' },
}

const hybrid2: HybridInverter = {
  ...hybrid1, id: 'hybrid-2',
  ports: quadPorts('hybrid-2'), labelSlots: defaultLabelSlots(110, 100),
}

const stack1: BatteryStack = {
  id: 'stack-1', kind: 'BatteryStack', width: 90, height: 110,
  ports: quadPorts('stack-1'), labelSlots: defaultLabelSlots(90, 110), labels: [],
  props: { model: 'Duracell 5kWh LFP', moduleCount: 8, moduleKwh: 5, chemistry: 'LFP' },
}

const stack2: BatteryStack = { ...stack1, id: 'stack-2', ports: quadPorts('stack-2') }

const pvDisc: Disconnect = {
  id: 'disc-pv', kind: 'Disconnect', width: 80, height: 90,
  ports: quadPorts('disc-pv'), labelSlots: defaultLabelSlots(80, 90), labels: [],
  props: { role: 'pv', model: 'Eaton DG223URB', ampere: 100, poles: 2, fusible: false, nemaRating: '3R' },
}

const genDisc: Disconnect = {
  id: 'disc-gen', kind: 'Disconnect', width: 80, height: 90,
  ports: quadPorts('disc-gen'), labelSlots: defaultLabelSlots(80, 90), labels: [],
  props: { role: 'gen', model: 'Eaton DG222NRB', ampere: 60, poles: 2, fusible: true, fuseAmpere: 45, nemaRating: '3R' },
}

const msp: MSP = {
  id: 'msp', kind: 'MSP', width: 130, height: 140,
  ports: quadPorts('msp'), labelSlots: defaultLabelSlots(130, 140), labels: [],
  props: {
    busbarA: 225, mainBreakerA: 125, voltage: '240V 1Φ 3W',
    location: 'EXTERIOR', nemaRating: '3R',
    backfeeds: [
      { id: 'h1', label: '(N) HYBRID #1 BACKFEED', ampere: 100 },
      { id: 'h2', label: '(N) HYBRID #2 BACKFEED', ampere: 100 },
    ],
    hasSurgeProtector: true,
  },
}

const serviceDisc: Disconnect = {
  id: 'disc-service', kind: 'Disconnect', width: 80, height: 90,
  ports: quadPorts('disc-service'), labelSlots: defaultLabelSlots(80, 90), labels: [],
  props: { role: 'service', model: 'Service Disc', ampere: 200, poles: 2, fusible: false, nemaRating: '3R', bidirectional: true },
}

const meter: Meter = {
  id: 'meter', kind: 'Meter', width: 70, height: 70,
  ports: quadPorts('meter'), labelSlots: defaultLabelSlots(70, 70), labels: [],
  props: { utility: 'CenterPoint Energy', serviceA: 200, voltage: '120/240V', bidirectional: true },
}

const backupPanel: BackupPanel = {
  id: 'blp', kind: 'BackupPanel', width: 110, height: 70,
  ports: quadPorts('blp'), labelSlots: defaultLabelSlots(110, 70), labels: [],
  props: { model: 'Eaton BRP20B125R', mainLugAmperage: 125, circuitCount: 20, nemaRating: '3R' },
}

const graph: EquipmentGraph = {
  equipment: [pvArray, rsd, dcJb, hybrid1, hybrid2, stack1, stack2, pvDisc, genDisc, msp, serviceDisc, meter, backupPanel],
  connections: [
    { id: 'pv-rsd', from: 'pv.E', to: 'rsd.W', conductor: '#10 AWG · DC string', category: 'dc-string' },
    { id: 'rsd-dc-jb', from: 'rsd.E', to: 'dc-jb.W', conductor: '#10 AWG', category: 'dc-string' },
    { id: 'dc-jb-h1', from: 'dc-jb.E', to: 'hybrid-1.W', conductor: '(2) #10 + EGC', category: 'dc-string' },
    { id: 'dc-jb-h2', from: 'dc-jb.E', to: 'hybrid-2.W', conductor: '(2) #10 + EGC', category: 'dc-string' },
    { id: 'h1-batt', from: 'hybrid-1.S', to: 'stack-1.N', conductor: '(2) #4/0 · 175A FUSED', category: 'dc-battery' },
    { id: 'h2-batt', from: 'hybrid-2.S', to: 'stack-2.N', conductor: '(2) #4/0 · 175A FUSED', category: 'dc-battery' },
    { id: 'h1-ac', from: 'hybrid-1.E', to: 'disc-pv.W', conductor: '(2) #3 · 100A', category: 'ac-inverter' },
    { id: 'h2-ac', from: 'hybrid-2.E', to: 'disc-pv.W', conductor: '(2) #3 · 100A', category: 'ac-inverter' },
    { id: 'pv-disc-msp', from: 'disc-pv.E', to: 'msp.W', conductor: '(2) #3 · 100A', category: 'ac-inverter' },
    { id: 'gen-disc-msp', from: 'disc-gen.E', to: 'msp.W', conductor: '(2) #6 · 45A', category: 'ac-inverter' },
    { id: 'msp-service', from: 'msp.E', to: 'disc-service.W', conductor: '(2) #4/0 · 200A', category: 'ac-service' },
    { id: 'service-meter', from: 'disc-service.E', to: 'meter.W', conductor: '(2) #4/0 · 200A', category: 'ac-service' },
    { id: 'h1-backup', from: 'hybrid-1.N', to: 'blp.E', conductor: '#6 AWG', category: 'ac-inverter' },
  ],
  sheet: {
    size: 'ANSI_B', orientation: 'landscape',
    titleBlock: {
      sheetCode: 'PV-5',
      sheetTitle: 'Electrical Single Line Diagram',
      projectName: 'PROJ-26922 · Corey Tyson',
      projectNumber: 'PROJ-26922',
      projectAddress: 'Houston, TX',
      contractor: 'MicroGRID Energy',
      contractorAddress: '600 Northpark Central Dr Suite 140, Houston TX 77073',
      contractorPhone: '+1 555 0100',
      contractorLicense: 'TX-XXXX',
      revision: 'v2 · 2026-05-12',
      drawnBy: 'Atlas',
    },
  },
}

async function main() {
  const layout = await layoutEquipmentGraph(graph)
  const svg = <SldRenderer layout={layout} />
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>sld-v2 — Tyson via elkjs</title>
<style>body{margin:0;padding:24px;background:#fafafa;font-family:system-ui}
h1{font-size:14px;margin:0 0 8px}
.frame{background:white;border:1px solid #ddd;padding:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:inline-block}
svg{display:block}
</style></head><body>
<h1>sld-v2 Phase 2 — Tyson topology via elkjs (layered, RIGHT, FIXED_SIDE, ORTHOGONAL)</h1>
<div class="frame">
${renderToStaticMarkup(svg)}
</div>
<pre style="font-size:11px;color:#666;margin-top:16px;font-family:ui-monospace,monospace">
canvas: ${layout.width}×${layout.height} + margin ${layout.margin}
equipment placed: ${layout.laidOut.length}
edges routed: ${layout.edges.length}
</pre>
</body></html>`
  process.stdout.write(body)
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err}\n`)
  process.exit(1)
})
