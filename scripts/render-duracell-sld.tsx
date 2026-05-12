// One-off: render Duracell-hybrid PV-5 SLD (rush-spatial.json v11) as standalone HTML.
// Run: npx tsx scripts/render-duracell-sld.tsx > ~/.claude/tmp/duracell-pv5-current.html
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { calculateSldLayout, type SldConfig } from '../lib/sld-layout'
import { SldRenderer } from '../components/SldRenderer'

const duracell: SldConfig = {
  projectName: 'EDGE Redesign · Duracell Hybrid Reference',
  address: 'Sample address, Houston TX 77073',
  panelModel: 'Seraphim SRP-440-BTD-BG',
  panelWattage: 440,
  panelCount: 20,
  inverterModel: 'Duracell Power Center Max Hybrid 15kW',
  inverterCount: 2,
  inverterAcKw: 15,
  maxPvPower: 19500,
  mpptsPerInverter: 3,
  stringsPerMppt: 2,
  maxCurrentPerMppt: 26,
  batteryModel: 'Duracell 5kWh LFP',
  batteryCount: 16,
  batteryCapacity: 5,
  batteriesPerStack: 8,
  rackingModel: 'IronRidge XR100',
  strings: [
    { id: 1, modules: 10, roofFace: 1, vocCold: 47, vmp: 348, imp: 12.65 },
    { id: 2, modules: 10, roofFace: 1, vocCold: 47, vmp: 348, imp: 12.65 },
  ],
  stringsPerInverter: [[0], [1]],
  meter: 'M-DEMO',
  esid: 'ESID-DEMO',
  utility: 'CenterPoint Energy',
  systemDcKw: 8.8,
  systemAcKw: 30,
  totalStorageKwh: 80,
  contractor: 'MicroGRID Energy',
  contractorAddress: '600 Northpark Central Dr, Suite 140',
  contractorPhone: '(832) 280-7764',
  contractorLicense: '32259',
  contractorEmail: 'engineering@microgridenergy.com',
  systemTopology: 'string-mppt',
  rapidShutdownModel: 'RSD-D-20',
  hasCantexBar: true,
  hasRgm: false,
  batteryKwAc: 15,
  mspBusbarA: 225,
  mainBreakerA: 125,
}

const layout = calculateSldLayout(duracell)
const svg = renderToStaticMarkup(React.createElement(SldRenderer as any, { layout }))

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Duracell Hybrid PV-5 SLD — current state</title>
<style>body{margin:0;padding:24px;background:#fafafa;font-family:system-ui}h1{font-size:14px;margin:0 0 8px}.frame{background:white;border:1px solid #ddd;padding:8px;box-shadow:0 1px 4px rgba(0,0,0,.06)}svg{display:block;width:1680px;height:auto}</style>
</head><body>
<h1>Duracell Hybrid PV-5 SLD — rush-spatial.json v11 + ASSET_REGISTRY (8 new assets wired)</h1>
<div class="frame">${svg}</div>
</body></html>`

process.stdout.write(html)
