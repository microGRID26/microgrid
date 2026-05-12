// Phase 1.2 proof-of-concept harness — render MspBox standalone with debug
// overlays (port dots + slot rectangles). Verifies the equipment-kind component
// pattern works before grinding through the other 14 equipment kinds.
//
// Usage:
//   npx tsx scripts/render-sld-v2-mspbox.tsx > ~/.claude/tmp/sld-v2-mspbox.html
//
// Then open the HTML in a browser (or chrome-devtools MCP) to inspect.

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { MspBox } from '../components/planset-v2/assets/MspBox'
import { defaultLabelSlots, quadPorts, type MSP } from '../lib/sld-v2/equipment'

// Construct a Tyson-style MSP: 225A busbar, 125A main, dual 100A hybrid backfeeds.
const msp: MSP = {
  id: 'msp-1',
  kind: 'MSP',
  width: 130,
  height: 140,
  ports: quadPorts('msp-1'),
  labelSlots: defaultLabelSlots(130, 140),
  labels: [
    { text: '(N) MAIN SERVICE PANEL', priority: 9 },
    { text: '225A · 240V 1Φ 3W · EXTERIOR · NEMA 3R', priority: 7 },
    { text: 'BUSBAR 225A · 120% RULE PER 705.12(B)', priority: 6 },
  ],
  props: {
    busbarA: 225,
    mainBreakerA: 125,
    voltage: '240V 1Φ 3W',
    location: 'EXTERIOR',
    nemaRating: '3R',
    backfeeds: [
      { id: 'h1', label: '(N) HYBRID #1 BACKFEED', ampere: 100 },
      { id: 'h2', label: '(N) HYBRID #2 BACKFEED', ampere: 100 },
    ],
    hasSurgeProtector: true,
  },
}

// World canvas — paint MSP twice: left=clean, right=debug overlays.
const W = 600
const H = 320

const svg = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={W}
    height={H}
    viewBox={`0 0 ${W} ${H}`}
  >
    {/* Title strip */}
    <text x={W / 2} y="16" fontSize="11" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fill="#222">
      sld-v2 Phase 1.2 — MspBox standalone
    </text>
    <text x={W / 2} y="30" fontSize="9" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fill="#666">
      left: clean render · right: debug (port dots in cyan, slot zones dashed cyan)
    </text>

    {/* Clean render */}
    <MspBox msp={msp} x={60} y={70} />

    {/* Debug render */}
    <MspBox msp={msp} x={380} y={70} debug />
  </svg>
)

const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>sld-v2 — MspBox</title>
<style>body{margin:0;padding:24px;background:#fafafa;font-family:system-ui}
.frame{background:white;border:1px solid #ddd;padding:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);display:inline-block}
svg{display:block}
</style></head><body>
<div class="frame">
${renderToStaticMarkup(svg)}
</div>
</body></html>`

process.stdout.write(body)
