// One-off: render Tyson PV-5 SLD as standalone HTML for round-1 visual review.
// Run: npx tsx scripts/render-tyson-sld.tsx > /Users/gregkelsch/.claude/tmp/tyson-pv5.html
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { calculateSldLayout, type SldConfig } from '../lib/sld-layout'
import { SldRenderer } from '../components/SldRenderer'

const tyson: SldConfig = {
  projectName: 'Corey Tyson',
  address: 'PROJ-26922 Tyson reference (round-1 SLD review)',
  panelModel: 'D700-M2',
  panelWattage: 700,
  panelCount: 9,
  inverterModel: 'IQ8MC-72-M-US',
  inverterCount: 9,
  inverterAcKw: 0.384,
  maxPvPower: 6300,
  mpptsPerInverter: 1,
  stringsPerMppt: 1,
  maxCurrentPerMppt: 14,
  batteryModel: 'sonnenCore+ SCORE-P20',
  batteryCount: 1,
  batteryCapacity: 20,
  batteriesPerStack: 1,
  rackingModel: 'IronRidge XR10',
  strings: [
    { id: 1, modules: 8, roofFace: 1, vocCold: 47, vmp: 39, imp: 17.95 },
    { id: 2, modules: 1, roofFace: 1, vocCold: 47, vmp: 39, imp: 17.95 },
  ],
  stringsPerInverter: [[0], [1]],
  meter: 'M-TYSON-DEMO',
  esid: 'ESID-TYSON-DEMO',
  utility: 'CenterPoint',
  systemDcKw: 6.3,
  systemAcKw: 4.8,
  totalStorageKwh: 20,
  contractor: 'MicroGRID Energy',
  contractorAddress: '600 Northpark Central Dr, Suite 140',
  contractorPhone: '(832) 280-7764',
  contractorLicense: '32259',
  contractorEmail: 'engineering@microgridenergy.com',
  systemTopology: 'micro-inverter',
  rapidShutdownModel: 'IQ8MC built-in',
  hasCantexBar: false,
  hasRgm: true,
  inverterMix: [
    { model: 'IQ8MC-72-M-US', count: 8, acKw: 0.384 },
    { model: 'IQ8M-72-M-US', count: 1, acKw: 0.366 },
  ],
  batteryKwAc: 4.8,
  batteryKwhCapacity: 20,
}

const layout = calculateSldLayout(tyson)
const svg = renderToStaticMarkup(React.createElement(SldRenderer as any, { layout }))

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Tyson PV-5 SLD — round 1 review</title>
<style>body{margin:0;padding:24px;background:#fafafa;font-family:system-ui}h1{font-size:14px;margin:0 0 8px}.frame{background:white;border:1px solid #ddd;padding:8px;box-shadow:0 1px 4px rgba(0,0,0,.06)}svg{display:block;width:1680px;height:auto}</style>
</head><body>
<h1>Tyson PV-5 SLD — round-1 integrated review (Sonnen SCORE-P20 svg-asset live)</h1>
<div class="frame">${svg}</div>
</body></html>`

process.stdout.write(html)
