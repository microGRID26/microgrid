// Phase 1.3 — render every equipment-kind component side-by-side for
// visual verification. Collision validator must report 0 text-text overlaps.
//
//   npx tsx scripts/render-sld-v2-all-kinds.tsx > ~/.claude/tmp/sld-v2-all-kinds.html
//   python3.12 scripts/sld-collision-check.py ~/.claude/tmp/sld-v2-all-kinds.html

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MspBox } from '../components/planset-v2/assets/MspBox'
import { DisconnectBox } from '../components/planset-v2/assets/DisconnectBox'
import { HybridInverterBox } from '../components/planset-v2/assets/HybridInverterBox'
import { BatteryStackBox } from '../components/planset-v2/assets/BatteryStackBox'
import { MeterBox } from '../components/planset-v2/assets/MeterBox'
import { PVArrayBox } from '../components/planset-v2/assets/PVArrayBox'
import { RapidShutdownBox } from '../components/planset-v2/assets/RapidShutdownBox'
import { JunctionBoxBox } from '../components/planset-v2/assets/JunctionBoxBox'
import { BackupPanelBox } from '../components/planset-v2/assets/BackupPanelBox'
import { ProductionCtBox } from '../components/planset-v2/assets/ProductionCtBox'

import {
  defaultLabelSlots,
  quadPorts,
  type MSP,
  type Disconnect,
  type HybridInverter,
  type BatteryStack,
  type Meter,
  type PVArray,
  type RapidShutdown,
  type JunctionBox,
  type BackupPanel,
  type ProductionCT,
} from '../lib/sld-v2/equipment'

// ──────────────────────────────────────────────────────────────────────────
// Construct samples for every kind
// ──────────────────────────────────────────────────────────────────────────

const msp: MSP = {
  id: 'msp-1', kind: 'MSP', width: 130, height: 140,
  ports: quadPorts('msp-1'), labelSlots: defaultLabelSlots(130, 140), labels: [],
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

const pvDisc: Disconnect = {
  id: 'disc-pv', kind: 'Disconnect', width: 80, height: 90,
  ports: quadPorts('disc-pv'), labelSlots: defaultLabelSlots(80, 90), labels: [],
  props: {
    role: 'pv', model: 'Eaton DG223URB', ampere: 100, poles: 2,
    fusible: false, nemaRating: '3R',
  },
}

const genDisc: Disconnect = {
  id: 'disc-gen', kind: 'Disconnect', width: 80, height: 90,
  ports: quadPorts('disc-gen'), labelSlots: defaultLabelSlots(80, 90), labels: [],
  props: {
    role: 'gen', model: 'Eaton DG222NRB', ampere: 60, poles: 2,
    fusible: true, fuseAmpere: 45, nemaRating: '3R',
  },
}

const serviceDisc: Disconnect = {
  id: 'disc-service', kind: 'Disconnect', width: 80, height: 90,
  ports: quadPorts('disc-service'), labelSlots: defaultLabelSlots(80, 90), labels: [],
  props: {
    role: 'service', model: 'Service Disc', ampere: 200, poles: 2,
    fusible: false, nemaRating: '3R', bidirectional: true,
  },
}

const hybrid: HybridInverter = {
  id: 'hybrid-1', kind: 'HybridInverter', width: 110, height: 100,
  ports: quadPorts('hybrid-1'), labelSlots: defaultLabelSlots(110, 100), labels: [],
  props: { model: 'Duracell PC-MAX-15', acKw: 15, backupAcA: 100, listingStandard: 'UL 1741-SB' },
}

const stack: BatteryStack = {
  id: 'stack-1', kind: 'BatteryStack', width: 90, height: 110,
  ports: quadPorts('stack-1'), labelSlots: defaultLabelSlots(90, 110), labels: [],
  props: { model: 'Duracell 5kWh LFP', moduleCount: 8, moduleKwh: 5, chemistry: 'LFP' },
}

const meter: Meter = {
  id: 'meter', kind: 'Meter', width: 70, height: 70,
  ports: quadPorts('meter'), labelSlots: defaultLabelSlots(70, 70), labels: [],
  props: { utility: 'CenterPoint Energy', serviceA: 200, voltage: '120/240V', bidirectional: true },
}

const pvArray: PVArray = {
  id: 'pv', kind: 'PVArray', width: 280, height: 140,
  ports: quadPorts('pv'), labelSlots: defaultLabelSlots(280, 140), labels: [],
  props: {
    moduleModel: 'Seraphim SRP-440-BTD-BG', moduleWatts: 440,
    moduleCount: 20, stringCount: 2, modulesPerString: 10,
  },
}

const imoRsd: RapidShutdown = {
  id: 'rsd-init', kind: 'RapidShutdown', width: 60, height: 24,
  ports: quadPorts('rsd-init'), labelSlots: defaultLabelSlots(60, 24), labels: [],
  props: { model: 'RSD-D-20', role: 'initiator', necCitation: 'NEC 690.12(A)' },
}

const dcJb: JunctionBox = {
  id: 'dc-jb', kind: 'JunctionBox', width: 60, height: 40,
  ports: quadPorts('dc-jb'), labelSlots: defaultLabelSlots(60, 40), labels: [],
  props: { role: 'dc', nemaRating: '3R', voltageRating: '600V' },
}

const backupPanel: BackupPanel = {
  id: 'blp', kind: 'BackupPanel', width: 110, height: 70,
  ports: quadPorts('blp'), labelSlots: defaultLabelSlots(110, 70), labels: [],
  props: { model: 'Eaton BRP20B125R', mainLugAmperage: 125, circuitCount: 20, nemaRating: '3R' },
}

const ct: ProductionCT = {
  id: 'ct-1', kind: 'ProductionCT', width: 40, height: 20,
  ports: quadPorts('ct-1'), labelSlots: defaultLabelSlots(40, 20), labels: [],
  props: { model: 'CT EXT P/N 1001808', targetLabel: 'Hybrid AC OUT · 100A', cableSpec: '#18 SHIELDED' },
}

// ──────────────────────────────────────────────────────────────────────────
// Layout — grid them with gaps so no two equipment overlap visually.
// Real layout engine comes in Phase 2 (elkjs).
// ──────────────────────────────────────────────────────────────────────────

const W = 1200
const H = 650
const titleH = 50

const layout: Array<{ el: React.ReactNode; label: string }> = [
  { el: <PVArrayBox arr={pvArray} x={20} y={titleH + 20} />, label: 'PVArray' },
  { el: <RapidShutdownBox rsd={imoRsd} x={20} y={titleH + 180} />, label: 'RapidShutdown' },
  { el: <JunctionBoxBox jb={dcJb} x={120} y={titleH + 180} />, label: 'JunctionBox' },
  { el: <HybridInverterBox inv={hybrid} x={320} y={titleH + 200} />, label: 'HybridInverter' },
  { el: <BatteryStackBox stack={stack} x={460} y={titleH + 200} />, label: 'BatteryStack' },
  { el: <MspBox msp={msp} x={580} y={titleH + 200} />, label: 'MSP' },
  { el: <DisconnectBox disc={pvDisc} x={740} y={titleH + 200} />, label: 'Disconnect · pv' },
  { el: <DisconnectBox disc={genDisc} x={840} y={titleH + 200} />, label: 'Disconnect · gen (fusible)' },
  { el: <DisconnectBox disc={serviceDisc} x={940} y={titleH + 200} />, label: 'Disconnect · service' },
  { el: <MeterBox meter={meter} x={1050} y={titleH + 200} />, label: 'Meter' },
  { el: <BackupPanelBox panel={backupPanel} x={320} y={titleH + 380} />, label: 'BackupPanel' },
  { el: <ProductionCtBox ct={ct} x={460} y={titleH + 400} />, label: 'ProductionCT' },
]

const svg = (
  <svg xmlns="http://www.w3.org/2000/svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
    <text x={W / 2} y="20" fontSize="13" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight="bold" fill="#222">
      sld-v2 Phase 1.3 — 10 equipment-kind components, prop-driven labels
    </text>
    <text x={W / 2} y="36" fontSize="9" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fill="#666">
      all internal text comes from props.* — no hardcoded amp ratings, model names, or duplicate spec labels
    </text>
    {layout.map((item, i) => (
      <React.Fragment key={i}>{item.el}</React.Fragment>
    ))}
  </svg>
)

const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>sld-v2 — all kinds</title>
<style>body{margin:0;padding:24px;background:#fafafa;font-family:system-ui}
.frame{background:white;border:1px solid #ddd;padding:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:inline-block}
svg{display:block}
</style></head><body>
<div class="frame">
${renderToStaticMarkup(svg)}
</div>
</body></html>`

process.stdout.write(body)
